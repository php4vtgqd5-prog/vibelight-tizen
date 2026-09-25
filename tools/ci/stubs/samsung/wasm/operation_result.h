// Syntax-check stub of <samsung/wasm/operation_result.h>. Declarations only.
#pragma once

namespace samsung {
namespace wasm {

enum class OperationResult {
  kSuccess,
  kWrongState,
  kInvalidArgument,
  kAlreadyInProgress,
  kNotAllowed,
  kNotSupported,
  kFailed,
};

}  // namespace wasm
}  // namespace samsung
