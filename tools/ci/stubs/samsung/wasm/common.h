// Syntax-check stub of the Samsung Tizen WASM Player common types.
// Declarations only, see ../../../README.md.
#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "operation_result.h"

namespace samsung {
namespace wasm {

using Seconds = std::chrono::duration<double>;
using SessionId = uint32_t;

template <typename T>
struct Result {
  OperationResult operation_result = OperationResult::kSuccess;
  T value;

  explicit operator bool() const { return operation_result == OperationResult::kSuccess; }
  T& operator*() { return value; }
  T* operator->() { return &value; }
};

template <>
struct Result<void> {
  OperationResult operation_result = OperationResult::kSuccess;

  explicit operator bool() const { return operation_result == OperationResult::kSuccess; }
};

enum class DecodingMode {
  kHardware,
  kHardwareWithFallback,
  kSoftware,
};

enum class SampleFormat {
  kUnknown,
  kU8,
  kS16,
  kS32,
  kF32,
  kPlanarU8,
  kPlanarS16,
  kPlanarS32,
  kPlanarF32,
};

enum class ChannelLayout {
  kUnsupported,
  kMono,
  kStereo,
  k2_1,
  kSurround,
  k4_0,
  k2_2,
  kQuad,
  k5_0,
  k5_1,
  k5_0Back,
  k5_1Back,
  k7_0,
  k7_1,
  k7_1Wide,
};

}  // namespace wasm
}  // namespace samsung
