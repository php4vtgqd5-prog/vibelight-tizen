// Syntax-check stub of <samsung/wasm/elementary_media_track.h>. Declarations only.
#pragma once

#include "common.h"
#include "elementary_media_packet.h"

namespace samsung {
namespace wasm {

class ElementaryMediaTrackListener;

class ElementaryMediaTrack {
 public:
  enum class CloseReason {
    kUnknown,
    kSourceClosed,
    kSourceError,
    kSourceDetached,
    kTrackDisabled,
    kTrackRemoved,
  };

  ElementaryMediaTrack() = default;
  ElementaryMediaTrack(ElementaryMediaTrack&&) = default;
  ElementaryMediaTrack& operator=(ElementaryMediaTrack&&) = default;

  Result<void> AppendPacket(const ElementaryMediaPacket&) { return {}; }
  Result<void> AppendEndOfTrack(SessionId) { return {}; }
  Result<void> SetListener(ElementaryMediaTrackListener*) { return {}; }
  bool IsOpen() const { return true; }
  bool IsValid() const { return true; }
};

}  // namespace wasm
}  // namespace samsung
