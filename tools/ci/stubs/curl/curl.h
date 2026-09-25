// Syntax-check stub of <curl/curl.h>. Declarations only, see ../README.md.
//
// The headers in ports/include describe the 32-bit wasm target and refuse to
// compile on a 64-bit host, so the host check uses this reduced declaration.
#pragma once

typedef int CURLcode;

#define CURL_GLOBAL_SSL (1 << 0)
#define CURL_GLOBAL_WIN32 (1 << 1)
#define CURL_GLOBAL_ALL (CURL_GLOBAL_SSL | CURL_GLOBAL_WIN32)
#define CURL_GLOBAL_DEFAULT CURL_GLOBAL_ALL

#ifdef __cplusplus
extern "C" {
#endif

CURLcode curl_global_init(long flags);

#ifdef __cplusplus
}
#endif
