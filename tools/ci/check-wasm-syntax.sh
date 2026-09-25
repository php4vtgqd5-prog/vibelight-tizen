#!/usr/bin/env bash
# Type-check the WASM module sources with a host compiler.
#
# The real widget can only be linked with the Samsung Emscripten SDK (see the
# Dockerfile). This script compiles every source of the moonlight-wasm target
# with -fsyntax-only against the API stubs in tools/ci/stubs, which catches
# syntax and type errors in seconds. It runs twice: once without and once with
# the optional <samsung/wasm/emss_version_info.h> header, so that both sides of
# the feature detection in the sources are checked.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CXX="${CXX:-clang++}"
CC="${CC:-clang}"

INCLUDES=(
  -I"$ROOT/tools/ci/stubs"
  -I"$ROOT/wasm"
  -I"$ROOT/wasm/dispatcher"
  -I"$ROOT/moonlight-common-c/src"
  -I"$ROOT/moonlight-common-c/enet/include"
  -I"$ROOT/moonlight-common-c/reedsolomon"
  -I"$ROOT/libgamestream"
  -I"$ROOT/h264bitstream"
  -I"$ROOT/opus/include"
  -I"$ROOT/ports/include"
)
DEFINES=(-DSAMSUNG_WRT -DOS_WASM -DNDEBUG)
WARNINGS=(-Wall -Wno-unused-function -Wno-unused-variable -Wno-unused-private-field -Wno-deprecated-declarations)

status=0
for variant in base with-emss-version-info; do
  extra=()
  if [ "$variant" = "with-emss-version-info" ]; then
    extra=(-I"$ROOT/tools/ci/stubs-optional")
  fi
  echo "== Checking the WASM sources ($variant)"
  for source in "$ROOT"/wasm/*.cpp; do
    if ! "$CXX" -std=c++17 -fsyntax-only "${WARNINGS[@]}" "${DEFINES[@]}" "${INCLUDES[@]}" "${extra[@]}" "$source"; then
      echo "!! $source failed the syntax check ($variant)"
      status=1
    fi
  done
  for source in "$ROOT"/wasm/*.c; do
    if ! "$CC" -std=c99 -fsyntax-only "${DEFINES[@]}" "${INCLUDES[@]}" "${extra[@]}" "$source"; then
      echo "!! $source failed the syntax check ($variant)"
      status=1
    fi
  done
done

if [ "$status" -eq 0 ]; then
  echo "All WASM sources passed the syntax check."
fi
exit "$status"
