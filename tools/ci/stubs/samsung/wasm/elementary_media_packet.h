// Syntax-check stub of <samsung/wasm/elementary_media_packet.h>. Declarations only.
#pragma once

#include "common.h"

namespace samsung {
namespace wasm {

struct ElementaryMediaPacket {
  Seconds pts;
  Seconds dts;
  Seconds duration;
  bool is_key_frame;
  size_t data_size;
  const void* data;
  uint32_t width;
  uint32_t height;
  uint32_t framerate_num;
  uint32_t framerate_den;
  SessionId session_id;
};

}  // namespace wasm
}  // namespace samsung
