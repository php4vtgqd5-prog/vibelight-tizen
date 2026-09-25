# API stubs for the host syntax check

The WASM module can only be linked with the Samsung Emscripten SDK, which is
distributed from `developer.samsung.com` and is too heavy for a quick check on
every push. These headers declare the small part of the Emscripten and Samsung
Tizen WASM Player APIs that `wasm/*.cpp` uses, so `tools/ci/check-wasm-syntax.sh`
can type-check the C++ sources with a regular host compiler in a few seconds.

They are **not** a replacement for the real SDK:

- Only declarations exist, nothing here is meant to be linked or executed.
- Signatures follow the way the VibeLight sources call the APIs. When a source
  file starts using another part of an API, extend the stub accordingly.
- The Docker build (`Dockerfile`) remains the reference build of the widget.
