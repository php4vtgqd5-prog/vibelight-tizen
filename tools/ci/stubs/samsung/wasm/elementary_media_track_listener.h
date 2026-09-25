// Syntax-check stub of <samsung/wasm/elementary_media_track_listener.h>. Declarations only.
#pragma once

#include "elementary_media_track.h"

namespace samsung {
namespace wasm {

class ElementaryMediaTrackListener {
 public:
  virtual ~ElementaryMediaTrackListener() = default;
  virtual void OnTrackOpen() {}
  virtual void OnTrackClosed(ElementaryMediaTrack::CloseReason) {}
  virtual void OnSeek(Seconds) {}
  virtual void OnSessionIdChanged(SessionId) {}
  virtual void OnAppendError(OperationResult) {}
};

}  // namespace wasm
}  // namespace samsung
