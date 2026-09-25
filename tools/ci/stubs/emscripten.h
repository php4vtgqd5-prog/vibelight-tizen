// Syntax-check stub of <emscripten.h>. Declarations only, see ../README.md.
#pragma once

#include <stdarg.h>
#include <stdint.h>

#ifdef __cplusplus
template <typename... Args>
static inline int em_stub_consume(int, Args&&...) { return 0; }
#define EM_STUB_CONSUME(...) em_stub_consume(0, ##__VA_ARGS__)
#else
#define EM_STUB_CONSUME(...) 0
#endif

#define EMSCRIPTEN_KEEPALIVE __attribute__((used))

// The JavaScript body of an EM_ASM block is dropped, but the arguments are still
// evaluated so their expressions are type-checked.
#define EM_ASM(code, ...) ((void)EM_STUB_CONSUME(__VA_ARGS__))
#define EM_ASM_INT(code, ...) EM_STUB_CONSUME(__VA_ARGS__)
#define EM_ASM_DOUBLE(code, ...) ((double)EM_STUB_CONSUME(__VA_ARGS__))
#define MAIN_THREAD_EM_ASM(code, ...) ((void)EM_STUB_CONSUME(__VA_ARGS__))
#define MAIN_THREAD_EM_ASM_INT(code, ...) EM_STUB_CONSUME(__VA_ARGS__)
#define MAIN_THREAD_EM_ASM_DOUBLE(code, ...) ((double)EM_STUB_CONSUME(__VA_ARGS__))
#define MAIN_THREAD_ASYNC_EM_ASM(code, ...) ((void)EM_STUB_CONSUME(__VA_ARGS__))

#define EM_LOG_CONSOLE 1
#define EM_LOG_WARN 2
#define EM_LOG_ERROR 4

#ifdef __cplusplus
extern "C" {
#endif

void emscripten_log(int flags, const char* format, ...);
double emscripten_get_now(void);
void emscripten_sleep(unsigned int ms);

#ifdef __cplusplus
}
#endif

#include <emscripten/html5.h>
#include <emscripten/threading.h>
