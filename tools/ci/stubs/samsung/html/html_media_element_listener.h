// Syntax-check stub of <samsung/html/html_media_element_listener.h>. Declarations only.
#pragma once

#include "../wasm/common.h"

namespace samsung {
namespace html {

class HTMLMediaElementListener {
 public:
  virtual ~HTMLMediaElementListener() = default;
  virtual void OnCanPlay() {}
  virtual void OnEnded() {}
  virtual void OnLoadStart() {}
  virtual void OnLoadedData() {}
  virtual void OnLoadedMetadata() {}
  virtual void OnPause() {}
  virtual void OnPlay() {}
  virtual void OnPlaying() {}
  virtual void OnTimeUpdate(samsung::wasm::Seconds) {}
  virtual void OnWaiting() {}
};

}  // namespace html
}  // namespace samsung
