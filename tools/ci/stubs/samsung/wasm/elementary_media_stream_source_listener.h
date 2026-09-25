// Syntax-check stub of <samsung/wasm/elementary_media_stream_source_listener.h>. Declarations only.
#pragma once

#include "common.h"

namespace samsung {
namespace wasm {

class ElementaryMediaStreamSourceListener {
 public:
  virtual ~ElementaryMediaStreamSourceListener() = default;
  virtual void OnSourceDetached() {}
  virtual void OnSourceClosed() {}
  virtual void OnSourceOpenPending() {}
  virtual void OnSourceOpen() {}
  virtual void OnSourceEnded() {}
  virtual void OnPlaybackPositionChanged(Seconds) {}
};

}  // namespace wasm
}  // namespace samsung
