// Syntax-check stub of <emscripten/val.h>. Declarations only, see ../../README.md.
#pragma once

#include <string>

namespace emscripten {

class val {
 public:
  val() = default;
  template <typename T>
  explicit val(T&&) {}

  static val null() { return val(); }
  static val undefined() { return val(); }
  static val object() { return val(); }
  static val array() { return val(); }
  static val global(const char* = nullptr) { return val(); }

  template <typename K, typename V>
  void set(const K&, const V&) {}

  template <typename T>
  T as() const { return T(); }

  bool isNull() const { return true; }
  bool isUndefined() const { return false; }

  bool operator==(const val&) const { return true; }
  bool operator!=(const val& other) const { return !(*this == other); }
};

}  // namespace emscripten
