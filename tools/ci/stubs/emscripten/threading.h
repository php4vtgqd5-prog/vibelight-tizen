// Syntax-check stub of <emscripten/threading.h>. Declarations only, see ../../README.md.
#pragma once

typedef int EM_FUNC_SIGNATURE;

#define EM_FUNC_SIG_V 0
#define EM_FUNC_SIG_VI 1
#define EM_FUNC_SIG_VII 2
#define EM_FUNC_SIG_I 3

#ifdef __cplusplus
extern "C" {
#endif

int emscripten_sync_run_in_main_runtime_thread_(EM_FUNC_SIGNATURE sig, void* func_ptr, ...);
void emscripten_async_run_in_main_runtime_thread_(EM_FUNC_SIGNATURE sig, void* func_ptr, ...);
int emscripten_is_main_runtime_thread(void);
int emscripten_is_main_browser_thread(void);

#ifdef __cplusplus
}
#endif

#define emscripten_sync_run_in_main_runtime_thread(sig, func_ptr, ...) \
  emscripten_sync_run_in_main_runtime_thread_((sig), (void*)(func_ptr), ##__VA_ARGS__)
#define emscripten_async_run_in_main_runtime_thread(sig, func_ptr, ...) \
  emscripten_async_run_in_main_runtime_thread_((sig), (void*)(func_ptr), ##__VA_ARGS__)
