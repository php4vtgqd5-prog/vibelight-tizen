// Syntax-check stub of <samsung/wasm/elementary_audio_track_config.h>. Declarations only.
#pragma once

#include "common.h"

namespace samsung {
namespace wasm {

struct ElementaryAudioTrackConfig {
  std::string mimeType;
  std::vector<uint8_t> extradata;
  DecodingMode decoding_mode;
  SampleFormat sample_format;
  ChannelLayout channel_layout;
  uint32_t sample_rate;
};

}  // namespace wasm
}  // namespace samsung
