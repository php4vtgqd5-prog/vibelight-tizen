// Syntax-check stub of <samsung/html/html_media_element.h>. Declarations only.
#pragma once

#include "../wasm/common.h"
#include "../wasm/elementary_media_stream_source.h"

namespace samsung {
namespace html {

class HTMLMediaElementListener;

class HTMLMediaElement {
 public:
  using AsyncResultCallback = std::function<void(samsung::wasm::OperationResult)>;

  explicit HTMLMediaElement(const char*) {}

  samsung::wasm::Result<void> SetSrc(samsung::wasm::ElementaryMediaStreamSource*) { return {}; }
  samsung::wasm::Result<void> Play(AsyncResultCallback) { return {}; }
  samsung::wasm::Result<void> SetListener(HTMLMediaElementListener*) { return {}; }
};

}  // namespace html
}  // namespace samsung
