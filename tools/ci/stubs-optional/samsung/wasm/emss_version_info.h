// Syntax-check stub of <samsung/wasm/emss_version_info.h>. Declarations only.
//
// This header only exists on SDKs that ship the WASM Player feature detection
// API, so it lives in a separate include directory: the syntax check compiles
// the sources both with and without it.
#pragma once

namespace samsung {
namespace wasm {

struct EmssVersionInfo {
  static EmssVersionInfo Create() { return EmssVersionInfo(); }

  bool has_legacy_emss = false;
  bool has_emss = true;
  bool has_ultra_low_latency = true;
  bool has_decoding_mode = true;
  bool has_video_texture = true;
  bool has_low_latency_video_texture = true;
};

}  // namespace wasm
}  // namespace samsung
