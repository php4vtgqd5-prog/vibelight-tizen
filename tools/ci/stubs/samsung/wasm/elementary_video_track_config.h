// Syntax-check stub of <samsung/wasm/elementary_video_track_config.h>. Declarations only.
#pragma once

#include "common.h"

namespace samsung {
namespace wasm {

struct ElementaryVideoTrackConfig {
  std::string mimeType;
  std::vector<uint8_t> extradata;
  DecodingMode decoding_mode;
  uint32_t width;
  uint32_t height;
  uint32_t framerate_num;
  uint32_t framerate_den;
};

}  // namespace wasm
}  // namespace samsung
