// Syntax-check stub of <samsung/wasm/elementary_media_stream_source.h>. Declarations only.
#pragma once

#include "common.h"
#include "elementary_audio_track_config.h"
#include "elementary_media_track.h"
#include "elementary_video_track_config.h"

namespace samsung {
namespace wasm {

class ElementaryMediaStreamSourceListener;

class ElementaryMediaStreamSource {
 public:
  enum class LatencyMode {
    kNormal,
    kLow,
    kUltraLow,
  };

  enum class RenderingMode {
    kMediaElement,
    kVideoTexture,
  };

  enum class ReadyState {
    kDetached,
    kClosed,
    kOpenPending,
    kOpen,
    kEnded,
  };

  using AsyncResultCallback = std::function<void(OperationResult)>;

  ElementaryMediaStreamSource(LatencyMode, RenderingMode) {}

  Result<ElementaryMediaTrack> AddTrack(const ElementaryAudioTrackConfig&) { return {}; }
  Result<ElementaryMediaTrack> AddTrack(const ElementaryVideoTrackConfig&) { return {}; }
  Result<void> Open(AsyncResultCallback) { return {}; }
  Result<void> Close(AsyncResultCallback) { return {}; }
  Result<void> SetListener(ElementaryMediaStreamSourceListener*) { return {}; }
  Result<ReadyState> GetReadyState() const { return {}; }
};

}  // namespace wasm
}  // namespace samsung
