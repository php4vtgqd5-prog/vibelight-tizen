// Syntax-check stub of <emscripten/bind.h>. Declarations only, see ../../README.md.
#pragma once

#include <emscripten/val.h>

namespace emscripten {

template <typename Func>
void function(const char*, Func) {}

template <typename ClassType>
class value_object {
 public:
  explicit value_object(const char*) {}

  template <typename FieldType>
  value_object& field(const char*, FieldType ClassType::*) { return *this; }
};

}  // namespace emscripten

#define EMSCRIPTEN_BINDINGS(name)                                          \
  static void embind_init_##name();                                        \
  static struct EmbindInit_##name {                                        \
    EmbindInit_##name() { embind_init_##name(); }                          \
  } embind_init_instance_##name;                                           \
  static void embind_init_##name()
