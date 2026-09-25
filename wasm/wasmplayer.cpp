#include "moonlight_wasm.hpp"

#include <condition_variable>
#include <functional>
#include <mutex>

#include <h264_stream.h>

#include <assert.h>
#include <pthread.h>
#include <unistd.h>

#include "samsung/wasm/elementary_audio_track_config.h"
#include "samsung/wasm/elementary_media_packet.h"
#include "samsung/wasm/elementary_video_track_config.h"
#include "samsung/html/html_media_element_listener.h"
#include "samsung/wasm/operation_result.h"

#define INITIAL_DECODE_BUFFER_LEN 1024 * 1024
#define MAX_SPS_EXTRA_SIZE 32

using std::chrono_literals::operator""s;
using std::chrono_literals::operator""ms;
using EmssReadyState = samsung::wasm::ElementaryMediaStreamSource::ReadyState;
using EmssOperationResult = samsung::wasm::OperationResult;
using EmssAsyncResult = samsung::wasm::OperationResult;
using HTMLAsyncResult = samsung::wasm::OperationResult;
using TimeStamp = samsung::wasm::Seconds;

static constexpr TimeStamp kFrameTimeMargin = 0.5ms;
static constexpr TimeStamp kPacerSpinThreshold = 1ms;
static constexpr TimeStamp kTimeWindow = 1s;
static constexpr uint32_t kSampleRate = 48000;

static uint32_t s_VideoFormat = 0;
static uint32_t s_Width = 0;
static uint32_t s_Height = 0;
static uint32_t s_Framerate = 0;

static std::vector<unsigned char> s_DecodeBuffer;

static TimeStamp s_frameDuration;
static TimeStamp s_pktPts;

static TimeStamp s_ptsDiff;
static TimeStamp s_lastSec;

static std::chrono::time_point<std::chrono::steady_clock> s_firstAppend;
static std::chrono::time_point<std::chrono::steady_clock> s_lastTime;

static bool s_hasFirstFrame = false;
static bool s_FramePacingEnabled = false;

// Interval between two reports of the stream statistics to the front end, in milliseconds
static constexpr uint64_t kStatsIntervalMs = 1000;

// Statistics of the video frames handled during the current reporting interval. They are only
// touched by the thread that submits the decode units, and reported to the front end as JSON.
struct StatsWindow {
  uint64_t startMs;              // Start of the interval
  uint32_t receivedFrames;       // Frames received from the network
  uint32_t renderedFrames;       // Frames accepted by the decoder
  uint32_t failedFrames;         // Frames the decoder rejected
  uint32_t networkDroppedFrames; // Frames that never arrived, from gaps in the frame numbers
  uint32_t idrFrames;            // Key frames received, each one usually follows a loss
  uint64_t receivedBytes;        // Video payload received
  uint32_t hostLatencyTotal;     // Host processing latency, in tenths of a millisecond
  uint32_t hostLatencyFrames;    // Frames that reported their host processing latency
  uint16_t hostLatencyMin;
  uint16_t hostLatencyMax;
  uint64_t reassemblyTimeTotal;  // Time spent receiving the packets of each frame, in ms
  uint64_t queueTimeTotal;       // Time frames waited in the decode queue, in ms
  uint64_t pacerTimeTotal;       // Time frames were held back by the frame pacer, in ms
  uint64_t submitTimeTotal;      // Time taken to hand frames to the decoder, in ms
};

static StatsWindow s_StatsWindow;
static uint64_t s_StatsStreamStartMs = 0;
static int m_LastFrameNumber = 0;

MoonlightInstance::SourceListener::SourceListener(
  MoonlightInstance* instance
) : m_Instance(instance) {}

void MoonlightInstance::SourceListener::OnSourceOpen() {
  ClLogMessage("EMSS::OnOpen\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_EmssReadyState = EmssReadyState::kOpen;
  m_Instance->m_EmssStateChanged.notify_all();
}

void MoonlightInstance::SourceListener::OnSourceOpenPending() {
  ClLogMessage("EMSS::OnOpenPending\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_EmssReadyState = EmssReadyState::kOpenPending;
  m_Instance->m_EmssStateChanged.notify_all();
}

void MoonlightInstance::SourceListener::OnSourceClosed() {
  ClLogMessage("EMSS::OnClosed\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_EmssReadyState = EmssReadyState::kClosed;
  m_Instance->m_EmssStateChanged.notify_all();
}

MoonlightInstance::AudioTrackListener::AudioTrackListener(
  MoonlightInstance* instance
) : m_Instance(instance) {}

void MoonlightInstance::AudioTrackListener::OnTrackOpen() {
  ClLogMessage("AUDIO ElementaryMediaTrack::OnTrackOpen\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_AudioStarted = true;
  m_Instance->m_EmssAudioStateChanged.notify_all();
}

void MoonlightInstance::AudioTrackListener::OnTrackClosed(samsung::wasm::ElementaryMediaTrack::CloseReason) {
  ClLogMessage("AUDIO ElementaryMediaTrack::OnTrackClosed\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_AudioStarted = false;
}

void MoonlightInstance::AudioTrackListener::OnSessionIdChanged(samsung::wasm::SessionId new_session_id) {
  ClLogMessage("AUDIO ElementaryMediaTrack::OnSessionIdChanged\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_AudioSessionId.store(new_session_id);
}

MoonlightInstance::VideoTrackListener::VideoTrackListener(
  MoonlightInstance* instance
) : m_Instance(instance) {}

void MoonlightInstance::VideoTrackListener::OnTrackOpen() {
  ClLogMessage("VIDEO ElementaryMediaTrack::OnTrackOpen\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_VideoStarted = true;
  m_Instance->m_EmssVideoStateChanged.notify_all();
  LiRequestIdrFrame();
}

void MoonlightInstance::VideoTrackListener::OnTrackClosed(samsung::wasm::ElementaryMediaTrack::CloseReason) {
  ClLogMessage("VIDEO ElementaryMediaTrack::OnTrackClosed\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_VideoStarted = false;
}

void MoonlightInstance::VideoTrackListener::OnSessionIdChanged(samsung::wasm::SessionId new_session_id) {
  ClLogMessage("VIDEO ElementaryMediaTrack::OnSessionIdChanged\n");
  std::unique_lock<std::mutex> lock(m_Instance->m_Mutex);
  m_Instance->m_VideoSessionId.store(new_session_id);
}

void MoonlightInstance::DidChangeFocus(bool got_focus) {
  // Request an IDR frame to dump the frame queue that may have
  // built up from the GL pipeline being stalled.
  if (got_focus) {
    LiRequestIdrFrame();
  }
}

bool MoonlightInstance::InitializeRenderingSurface(int width, int height) {
  return true;
}

int MoonlightInstance::StartupVidDecSetup(int videoFormat, int width, int height, int redrawRate, void* context, int drFlags) {
  // Bind the media source to the media element
  g_Instance->m_MediaElement.SetSrc(g_Instance->m_Source.get());
  ClLogMessage("Waiting to close\n");

  g_Instance->WaitFor(&g_Instance->m_EmssStateChanged, [] {
    return g_Instance->m_EmssReadyState == EmssReadyState::kClosed;
  });
  if (g_Instance->m_ConnectionCancelled) {
    ClLogMessage("Connection cancelled during initial close wait\n");
    return -1;
  }
  ClLogMessage("Closed\n");

  // The Web Audio backend renders the audio itself in platform/audio.js, so the EMSS audio
  // track is only added when the EMSS backend is selected
  if (g_Instance->m_AudioBackend == AudioBackend::Emss) {
    // Selected audio channel layout from audio config, Stereo unless a surround layout matches
    samsung::wasm::ChannelLayout channelLayout = samsung::wasm::ChannelLayout::kStereo;
    switch (CHANNEL_COUNT_FROM_AUDIO_CONFIGURATION(g_Instance->m_AudioConfig)) {
      case 2:
        channelLayout = samsung::wasm::ChannelLayout::kStereo; // Audio Channel: Stereo
        ClLogMessage("Selected channel layout for Stereo audio\n");
        break;
      case 6:
        channelLayout = samsung::wasm::ChannelLayout::k5_1; // Audio Channel: 5.1 Surround Sound
        ClLogMessage("Selected channel layout for 5.1 Surround audio\n");
        break;
      case 8:
        channelLayout = samsung::wasm::ChannelLayout::k7_1; // Audio Channel: 7.1 Surround Sound
        ClLogMessage("Selected channel layout for 7.1 Surround audio\n");
        break;
      default:
        ClLogMessage("Unable to select channel layout from audio configuration, using Stereo\n");
        break;
    }

    auto add_track_result = g_Instance->m_Source->AddTrack(
      samsung::wasm::ElementaryAudioTrackConfig {
        "audio/webm; codecs=\"pcm\"", // Audio Codec: Pulse Code Modulation (PCM) Profile
        {}, // Extradata: Empty
        samsung::wasm::DecodingMode::kHardware, // Decoding mode: Hardware
        samsung::wasm::SampleFormat::kS16, // Sample Format: 16-bit signed integer (S16)
        channelLayout, // Channel Layout: Stereo (2-CH), 5.1 Surround (6-CH), 7.1 Surround (8-CH)
        kSampleRate, // Sample Rate: 48 kHz (48000 Hz)
      }
    );
    if (add_track_result) {
      g_Instance->m_AudioTrack = std::move(*add_track_result);
      g_Instance->m_AudioTrack.SetListener(&g_Instance->m_AudioTrackListener);
    } else {
      // Without a track the audio never opens, so waiting for it below would hang the connection
      ClLogMessage("Failed to add the EMSS audio track for %d channels\n",
        CHANNEL_COUNT_FROM_AUDIO_CONFIGURATION(g_Instance->m_AudioConfig));
      PostToJs("DecoderSetupFailed: audio:" + std::to_string(CHANNEL_COUNT_FROM_AUDIO_CONFIGURATION(g_Instance->m_AudioConfig)));
      return -1;
    }
  }

  {
    const char *mimetype = "video/mp4"; // MIME-type: Video MP4 Container
    if (videoFormat & VIDEO_FORMAT_H264) {
      mimetype = "video/mp4; codecs=\"avc1.64002A\""; // Video codec: H.264 High Level Profile 4.2
      /* NOTE: Depending on the capabilities of the TV, it may support higher-level codec profiles, such as:
      5.1 (avc1.640033); */
      ClLogMessage("Video codec profile selected: H.264 High Level Profile 4.2\n");
    } else if (videoFormat & VIDEO_FORMAT_H265) {
      mimetype = "video/mp4; codecs=\"hev1.1.6.L153.B0\""; // Video Codec: HEVC Main Level Profile 5.1
      /* NOTE: Depending on the capabilities of the TV, it may support higher-level codec profiles, such as:
      5.2 (hev1.1.6.L156.B0); */
      ClLogMessage("Video codec profile selected: HEVC Main Level Profile 5.1\n");
    } else if (videoFormat & VIDEO_FORMAT_H265_MAIN10) {
      mimetype = "video/mp4; codecs=\"hev1.2.4.L153.B0\""; // Video Codec: HEVC Main10 Level Profile 5.1
      /* NOTE: Depending on the capabilities of the TV, it may support higher-level codec profiles, such as:
      5.2 (hev1.2.4.L156.B0); */
      ClLogMessage("Video codec profile selected: HEVC Main10 Level Profile 5.1\n");
    } else if (videoFormat & VIDEO_FORMAT_AV1_MAIN8) {
      mimetype = "video/mp4; codecs=\"av01.0.13M.08\""; // Video Codec: AV1 Main Level Profile 5.1
      /* NOTE: Depending on the capabilities of the TV, it may support higher-level codec profiles, such as:
      5.2 (av01.0.14M.08); */
      ClLogMessage("Video codec profile selected: AV1 Main Level Profile 5.1\n");
    } else if (videoFormat & VIDEO_FORMAT_AV1_MAIN10) {
      mimetype = "video/mp4; codecs=\"av01.0.13M.10\""; // Video Codec: AV1 Main10 Level Profile 5.1
      /* NOTE: Depending on the capabilities of the TV, it may support higher-level codec profiles, such as:
      5.2 (av01.0.14M.10); */
      ClLogMessage("Video codec profile selected: AV1 Main10 Level Profile 5.1\n");
    } else {
      ClLogMessage("Failed to select video codec profile (videoFormat=0x%x)\n", videoFormat);
      return -1;
    }

    ClLogMessage("Using mimeType %s\n", mimetype);
    auto add_track_result = g_Instance->m_Source->AddTrack(
      samsung::wasm::ElementaryVideoTrackConfig {
        mimetype, // MIME-type: Selected Video Format
        {}, // Extradata: Empty
        samsung::wasm::DecodingMode::kHardware, // Decoding mode: Hardware
        static_cast<uint32_t>(width), // Video resolution: Width
        static_cast<uint32_t>(height), // Video resolution: Height
        static_cast<uint32_t>(redrawRate), // Framerate: Numerator
        1, // Framerate: Denominator
      }
    );
    if (add_track_result) {
      g_Instance->m_VideoTrack = std::move(*add_track_result);
      g_Instance->m_VideoTrack.SetListener(&g_Instance->m_VideoTrackListener);
    } else {
      // The TV has no decoder for this codec profile. Without a track the video never opens, so
      // waiting for it below would leave the connection hanging until the user cancels it.
      ClLogMessage("Failed to add the EMSS video track for %s\n", mimetype);
      PostToJs(std::string("DecoderSetupFailed: video:") + mimetype);
      return -1;
    }
  }

  ClLogMessage("Inb4 source open\n");
  g_Instance->m_Source->Open([](EmssOperationResult){});
  g_Instance->WaitFor(&g_Instance->m_EmssStateChanged, [] {
    return g_Instance->m_EmssReadyState == EmssReadyState::kOpenPending || 
           g_Instance->m_EmssReadyState == EmssReadyState::kOpen;
  });
  if (g_Instance->m_ConnectionCancelled) {
    ClLogMessage("Connection cancelled during open wait\n");
    return -1;
  }

  ClLogMessage("Source ready to open\n");
  g_Instance->m_MediaElement.Play([](EmssOperationResult err) {
    if (err != EmssOperationResult::kSuccess) {
      ClLogMessage("Play error\n");
    } else {
      ClLogMessage("Play success\n");
    }
  });

  ClLogMessage("Waiting to start\n");
  // Only the EMSS backend opens an audio track, so the Web Audio backend has nothing to wait for
  if (g_Instance->m_AudioBackend == AudioBackend::Emss) {
    g_Instance->WaitFor(&g_Instance->m_EmssAudioStateChanged, [] {
      return g_Instance->m_AudioStarted.load();
    });
  }
  g_Instance->WaitFor(&g_Instance->m_EmssVideoStateChanged, [] {
    return g_Instance->m_VideoStarted.load();
  });
  if (g_Instance->m_ConnectionCancelled) {
    ClLogMessage("Connection cancelled during audio/video wait\n");
    return -1;
  }

  ClLogMessage("Started\n");
  return 0;
}

int MoonlightInstance::VidDecSetup(int videoFormat, int width, int height, int redrawRate, void* context, int drFlags) {
  ClLogMessage("Video decoding setup has started.\n");

  // Resize the decode buffer based on initial decode buffer length
  s_DecodeBuffer.resize(INITIAL_DECODE_BUFFER_LEN);

  // Set the video format, video resolution and video frame rate based on the input parameters
  s_VideoFormat = videoFormat;
  s_Width = width;
  s_Height = height;
  s_Framerate = redrawRate;

  // Calculate frame duration from the frame rate
  s_frameDuration = TimeStamp(1.0 / (float)redrawRate);

  // Initialize packet timestamp to zero
  s_pktPts = 0s;

  // Flag indicating whether this is the first frame of video to be decoded
  s_hasFirstFrame = false;

  // Initialize the last second timestamp to zero
  s_lastSec = 0s;

  // Initialize the timestamp difference to zero
  s_ptsDiff = 0s;

  // Set the frame pacing flag based on instance configuration
  s_FramePacingEnabled = g_Instance->m_FramePacingEnabled;

  // Start the statistics of the new session from scratch
  memset(&s_StatsWindow, 0, sizeof(s_StatsWindow));
  s_StatsStreamStartMs = 0;
  g_AudioPacketsDropped = 0;
  g_AudioErrors = 0;
  g_Instance->m_ConnectionPoor = false;

  // Reset last frame number to prevent massive integer underflow on subsequent streams
  m_LastFrameNumber = 0;

  // Ensure that StartupVidDecSetup is called every time when VidDecSetup is invoked to reinitialize the media pipeline
  int initVidDec = StartupVidDecSetup(videoFormat, width, height, redrawRate, context, drFlags);

  // Check and handle errors from video decoding configuration and propagating failures
  if (initVidDec != 0) {
    ClLogMessage("Initialization of video decoding configuration failed: %d\n", initVidDec);
    return initVidDec;
  }

  return DR_OK;
}

void MoonlightInstance::VidDecCleanup(void) {
  // Clear the decode buffer
  s_DecodeBuffer.clear();

  // Shrink the decode buffer to fit its contents
  s_DecodeBuffer.shrink_to_fit();
}

int MoonlightInstance::VidDecSubmitDecodeUnit(PDECODE_UNIT decodeUnit) {
  // Check if video playback has not started
  if (!g_Instance->m_VideoStarted) {
    return DR_OK;
  }

  // Declare variables for entry data, offset, and total length
  PLENTRY entry;
  unsigned int offset;
  unsigned int totalLength;

  // Build one packet from multiple data chunks
  totalLength = decodeUnit->fullLength;

  // Check if the frame type from the decoding unit is IDR frame
  if (decodeUnit->frameType == FRAME_TYPE_IDR) {
    // Add some extra space in case we need to do an SPS fixup
    totalLength += MAX_SPS_EXTRA_SIZE;
  }

  // Ensure the decode buffer is large enough to hold the full packet
  if (totalLength > s_DecodeBuffer.size()) {
    // Resize decode buffer to accommodate the larger data
    s_DecodeBuffer.resize(totalLength);
  }

  // Initialize the entry pointer to the start of the buffer list
  entry = decodeUnit->bufferList;

  // Initialize the offset to 0 before starting to copy data
  offset = 0;

  // Iterate through the buffer list of video data entries
  while (entry != NULL) {
    // Copy the data of the current entry to the decode buffer at the specified offset
    memcpy(&s_DecodeBuffer[offset], entry->data, entry->length);
    // Update the offset based on the length of the copied data
    offset += entry->length;
    // Move to the next entry in the buffer list
    entry = entry->next;
  }

  // Get the current time
  auto now = std::chrono::steady_clock::now();

  // Check if this is the first video frame
  if (!s_hasFirstFrame) {
    // Record the time of the first frame
    s_firstAppend = std::chrono::steady_clock::now();
    // Update the flag to indicate that the first frame has been processed
    s_hasFirstFrame = true;
  }

  // Calculate the start of the pacing duration in milliseconds
  uint64_t pacingStart = LiGetMillis();

  // Check if the frame pacing is enabled
  if (s_FramePacingEnabled) {
    // Calculate the time elapsed since the first frame
    TimeStamp fromStart = now - s_firstAppend;
    // Time left until the packet timestamp is within the frame time margin
    TimeStamp remaining = s_pktPts - (fromStart - s_ptsDiff + kFrameTimeMargin);
    // Never hold a frame back for longer than two frame durations. A larger gap means the clocks
    // drifted apart, so realign them instead of adding that much latency to every frame.
    if (remaining > 2 * s_frameDuration) {
      s_ptsDiff = fromStart - s_pktPts;
      remaining = TimeStamp::zero();
    }
    // Wait until the packet timestamp is within the frame time margin. Sleep through most of the
    // wait rather than spinning, which kept a CPU core busy on the thread receiving the video, and
    // only spin for the last moment to keep the pacing precise.
    while (remaining > TimeStamp::zero()) {
      if (remaining > kPacerSpinThreshold) {
        usleep(static_cast<useconds_t>(
          std::chrono::duration_cast<std::chrono::microseconds>(remaining - kPacerSpinThreshold).count()));
      }
      // Update the current time and recalculate the elapsed time
      now = std::chrono::steady_clock::now();
      fromStart = now - s_firstAppend;
      remaining = s_pktPts - (fromStart - s_ptsDiff + kFrameTimeMargin);
    }
    // Synchronize packet presentation timing every time window
    if (fromStart > s_lastSec + kTimeWindow) {
      // Update the last second to the current time plus the time window
      s_lastSec += kTimeWindow;
      // Update the time difference to synchronize with the packet presentation time
      s_ptsDiff = fromStart - s_pktPts;
    }
  }

  // Calculate the end of the pacing duration in milliseconds
  uint64_t pacingEnd = LiGetMillis();

  // Update the timestamp of the last packet append
  s_lastTime = now;

  // Start measuring when the first frame of the session arrives
  if (s_StatsStreamStartMs == 0) {
    s_StatsStreamStartMs = pacingStart;
    s_StatsWindow.startMs = pacingStart;
  }

  // Any frame number greater than the last frame number + 1 represents frames lost on the way
  if (m_LastFrameNumber != 0 && decodeUnit->frameNumber > m_LastFrameNumber + 1) {
    s_StatsWindow.networkDroppedFrames += decodeUnit->frameNumber - (m_LastFrameNumber + 1);
  }
  m_LastFrameNumber = decodeUnit->frameNumber;

  // Count the received frame and its payload
  s_StatsWindow.receivedFrames++;
  s_StatsWindow.receivedBytes += decodeUnit->fullLength;
  if (decodeUnit->frameType == FRAME_TYPE_IDR) {
    s_StatsWindow.idrFrames++;
  }

  // Track the processing latency the host reported for this frame, when it provided one
  if (decodeUnit->frameHostProcessingLatency != 0) {
    const uint16_t hostLatency = decodeUnit->frameHostProcessingLatency;
    if (s_StatsWindow.hostLatencyFrames == 0) {
      s_StatsWindow.hostLatencyMin = hostLatency;
      s_StatsWindow.hostLatencyMax = hostLatency;
    } else {
      s_StatsWindow.hostLatencyMin = MIN(s_StatsWindow.hostLatencyMin, hostLatency);
      s_StatsWindow.hostLatencyMax = MAX(s_StatsWindow.hostLatencyMax, hostLatency);
    }
    s_StatsWindow.hostLatencyTotal += hostLatency;
    s_StatsWindow.hostLatencyFrames++;
  }

  // Track the time spent reassembling the frame, waiting in the decode queue and in the pacer
  if (decodeUnit->enqueueTimeMs > decodeUnit->receiveTimeMs) {
    s_StatsWindow.reassemblyTimeTotal += decodeUnit->enqueueTimeMs - decodeUnit->receiveTimeMs;
  }
  if (pacingStart > decodeUnit->enqueueTimeMs) {
    s_StatsWindow.queueTimeTotal += pacingStart - decodeUnit->enqueueTimeMs;
  }
  s_StatsWindow.pacerTimeTotal += pacingEnd - pacingStart;

  // Create an ElementaryMediaPacket and start decoding with the decoded video data
  samsung::wasm::ElementaryMediaPacket pkt {
    s_pktPts, // presentation timestamp
    s_pktPts, // decoding timestamp
    s_frameDuration, // packet duration
    decodeUnit->frameType == FRAME_TYPE_IDR, // packet of frame type
    offset, // packet size
    s_DecodeBuffer.data(), // pointer to packet payload
    s_Width, // packet of width
    s_Height, // packet of height
    s_Framerate, // packet of framerate numerator
    1, // packet of framerate denominator
    g_Instance->m_VideoSessionId.load() // session identifier
  };

  // Attempt to append the packet to the video track for rendering
  const uint64_t beforeSubmit = LiGetMillis();
  const bool appended = static_cast<bool>(g_Instance->m_VideoTrack.AppendPacket(pkt));
  const uint64_t afterSubmit = LiGetMillis();

  if (appended) {
    // Increment packet timestamp for next frame
    s_pktPts += s_frameDuration;
    s_StatsWindow.submitTimeTotal += afterSubmit - beforeSubmit;
    s_StatsWindow.renderedFrames++;
  } else {
    ClLogMessage("Append video packet failed\n");
    s_StatsWindow.failedFrames++;
  }

  // Report the statistics of the interval roughly every second
  if (afterSubmit >= s_StatsWindow.startMs + kStatsIntervalMs) {
    ReportStreamStats(afterSubmit);
  }

  return appended ? DR_OK : DR_NEED_IDR;
}

// Name of the negotiated video format as shown to the user
static const char* VideoFormatName(uint32_t videoFormat) {
  switch (videoFormat) {
    case VIDEO_FORMAT_H264:
      return "H.264";
    case VIDEO_FORMAT_H265:
      return "HEVC";
    case VIDEO_FORMAT_H265_MAIN10:
      return "HEVC 10-bit";
    case VIDEO_FORMAT_AV1_MAIN8:
      return "AV1";
    case VIDEO_FORMAT_AV1_MAIN10:
      return "AV1 10-bit";
    default:
      return "Unknown";
  }
}

void MoonlightInstance::ReportStreamStats(uint64_t nowMs) {
  StatsWindow& window = s_StatsWindow;
  const double elapsedSeconds = MAX(1, (double)(nowMs - window.startMs)) / 1000.0;
  const uint32_t expectedFrames = window.receivedFrames + window.networkDroppedFrames;

  // Estimated network round trip time, which ENet keeps above zero once it is known
  uint32_t rtt = 0;
  uint32_t rttVariance = 0;
  if (!LiGetEstimatedRttInfo(&rtt, &rttVariance)) {
    rtt = 0;
    rttVariance = 0;
  }

  // Averages of the interval, in milliseconds
  const double hostLatencyAverage = window.hostLatencyFrames > 0
    ? (double)window.hostLatencyTotal / 10.0 / window.hostLatencyFrames : 0.0;
  const double queueAverage = window.receivedFrames > 0 ? (double)window.queueTimeTotal / window.receivedFrames : 0.0;
  const double reassemblyAverage = window.receivedFrames > 0 ? (double)window.reassemblyTimeTotal / window.receivedFrames : 0.0;
  const double pacerAverage = window.receivedFrames > 0 ? (double)window.pacerTimeTotal / window.receivedFrames : 0.0;
  const double submitAverage = window.renderedFrames > 0 ? (double)window.submitTimeTotal / window.renderedFrames : 0.0;

  // The front end renders the overlay, keeps the session summary and feeds Auto-Tune from this
  // report, so it is sent for every interval whether or not the overlay is visible
  char json[768];
  snprintf(json, sizeof(json),
    "StatsJson: {\"t\":%.1f,\"w\":%u,\"h\":%u,\"fps\":%u,\"codec\":\"%s\",\"hdr\":%d,"
    "\"rx\":%.2f,\"dec\":%.2f,\"ren\":%.2f,\"mbps\":%.2f,\"loss\":%.2f,\"fail\":%.2f,"
    "\"rtt\":%u,\"rttv\":%u,\"host\":%.1f,\"hostMin\":%.1f,\"hostMax\":%.1f,"
    "\"reasm\":%.2f,\"queue\":%.2f,\"pace\":%.2f,\"sub\":%.2f,"
    "\"poor\":%d,\"aDrop\":%u,\"aErr\":%u,\"idr\":%u}",
    (double)(nowMs - s_StatsStreamStartMs) / 1000.0, s_Width, s_Height, s_Framerate,
    VideoFormatName(s_VideoFormat), LiGetCurrentHostDisplayHdrMode() ? 1 : 0,
    window.receivedFrames / elapsedSeconds,
    (window.renderedFrames + window.failedFrames) / elapsedSeconds,
    window.renderedFrames / elapsedSeconds,
    (double)window.receivedBytes * 8.0 / elapsedSeconds / 1000000.0,
    expectedFrames > 0 ? (double)window.networkDroppedFrames * 100.0 / expectedFrames : 0.0,
    window.receivedFrames > 0 ? (double)window.failedFrames * 100.0 / window.receivedFrames : 0.0,
    rtt, rttVariance, hostLatencyAverage,
    (double)window.hostLatencyMin / 10.0, (double)window.hostLatencyMax / 10.0,
    reassemblyAverage, queueAverage, pacerAverage, submitAverage,
    g_Instance->m_ConnectionPoor.load() ? 1 : 0,
    g_AudioPacketsDropped.exchange(0), g_AudioErrors.exchange(0), window.idrFrames);

  // Posted asynchronously, so the thread submitting the video never waits for the main thread
  PostToJsAsync(json);

  // Start the next interval
  memset(&window, 0, sizeof(window));
  window.startMs = nowMs;
}

void MoonlightInstance::TogglePerformanceStats() {
  // The front end owns the statistics overlay, so let it cycle through the overlay modes
  m_PerformanceStatsEnabled = !m_PerformanceStatsEnabled;
  PostToJsAsync("StatsToggle");
}

void MoonlightInstance::WaitFor(std::condition_variable* variable, std::function<bool()> condition) {
  std::unique_lock<std::mutex> lock(m_Mutex);
  variable->wait(lock, [&]() { return m_ConnectionCancelled.load() || condition(); });
}

DECODER_RENDERER_CALLBACKS MoonlightInstance::s_DrCallbacks = {
  .setup = MoonlightInstance::VidDecSetup,
  .cleanup = MoonlightInstance::VidDecCleanup,
  .submitDecodeUnit = MoonlightInstance::VidDecSubmitDecodeUnit,
  .capabilities = CAPABILITY_SLICES_PER_FRAME(4),
};
