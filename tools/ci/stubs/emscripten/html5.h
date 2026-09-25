// Syntax-check stub of <emscripten/html5.h>. Declarations only, see ../../README.md.
#pragma once

#include <stdint.h>

typedef int EM_BOOL;
typedef int EMSCRIPTEN_RESULT;

#define EM_TRUE 1
#define EM_FALSE 0

#define EMSCRIPTEN_RESULT_SUCCESS 0
#define EMSCRIPTEN_RESULT_DEFERRED 1
#define EMSCRIPTEN_RESULT_NOT_SUPPORTED -1
#define EMSCRIPTEN_RESULT_FAILED_NOT_DEFERRED -2
#define EMSCRIPTEN_RESULT_INVALID_TARGET -3
#define EMSCRIPTEN_RESULT_UNKNOWN_TARGET -4
#define EMSCRIPTEN_RESULT_INVALID_PARAM -5
#define EMSCRIPTEN_RESULT_FAILED -6
#define EMSCRIPTEN_RESULT_NO_DATA -7

typedef struct EmscriptenKeyboardEvent {
  char key[32];
  char code[32];
  unsigned long location;
  EM_BOOL ctrlKey;
  EM_BOOL shiftKey;
  EM_BOOL altKey;
  EM_BOOL metaKey;
  EM_BOOL repeat;
  char locale[32];
  char charValue[32];
  unsigned long charCode;
  unsigned long keyCode;
  unsigned long which;
} EmscriptenKeyboardEvent;

typedef struct EmscriptenMouseEvent {
  double timestamp;
  long screenX;
  long screenY;
  long clientX;
  long clientY;
  EM_BOOL ctrlKey;
  EM_BOOL shiftKey;
  EM_BOOL altKey;
  EM_BOOL metaKey;
  unsigned short button;
  unsigned short buttons;
  long movementX;
  long movementY;
  long targetX;
  long targetY;
  long canvasX;
  long canvasY;
  long padding;
} EmscriptenMouseEvent;

typedef struct EmscriptenWheelEvent {
  EmscriptenMouseEvent mouse;
  double deltaX;
  double deltaY;
  double deltaZ;
  unsigned long deltaMode;
} EmscriptenWheelEvent;

typedef struct EmscriptenGamepadEvent {
  double timestamp;
  int numAxes;
  int numButtons;
  double axis[64];
  double analogButton[64];
  EM_BOOL digitalButton[64];
  EM_BOOL connected;
  long index;
  char id[64];
  char mapping[64];
} EmscriptenGamepadEvent;

typedef struct EmscriptenPointerlockChangeEvent {
  EM_BOOL isActive;
  char nodeName[128];
  char id[128];
} EmscriptenPointerlockChangeEvent;

typedef EM_BOOL (*em_key_callback_func)(int eventType, const EmscriptenKeyboardEvent* keyEvent, void* userData);
typedef EM_BOOL (*em_mouse_callback_func)(int eventType, const EmscriptenMouseEvent* mouseEvent, void* userData);
typedef EM_BOOL (*em_wheel_callback_func)(int eventType, const EmscriptenWheelEvent* wheelEvent, void* userData);
typedef EM_BOOL (*em_pointerlockchange_callback_func)(int eventType, const EmscriptenPointerlockChangeEvent* pointerlockChangeEvent, void* userData);
typedef EM_BOOL (*em_pointerlockerror_callback_func)(int eventType, const void* reserved, void* userData);

#ifdef __cplusplus
extern "C" {
#endif

EMSCRIPTEN_RESULT emscripten_set_keydown_callback(const char* target, void* userData, EM_BOOL useCapture, em_key_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_keyup_callback(const char* target, void* userData, EM_BOOL useCapture, em_key_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_mousedown_callback(const char* target, void* userData, EM_BOOL useCapture, em_mouse_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_mouseup_callback(const char* target, void* userData, EM_BOOL useCapture, em_mouse_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_mousemove_callback(const char* target, void* userData, EM_BOOL useCapture, em_mouse_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_wheel_callback(const char* target, void* userData, EM_BOOL useCapture, em_wheel_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_pointerlockchange_callback(const char* target, void* userData, EM_BOOL useCapture, em_pointerlockchange_callback_func callback);
EMSCRIPTEN_RESULT emscripten_set_pointerlockerror_callback(const char* target, void* userData, EM_BOOL useCapture, em_pointerlockerror_callback_func callback);
EMSCRIPTEN_RESULT emscripten_request_pointerlock(const char* target, EM_BOOL deferUntilInEventHandler);
EMSCRIPTEN_RESULT emscripten_exit_pointerlock(void);
EMSCRIPTEN_RESULT emscripten_sample_gamepad_data(void);
int emscripten_get_num_gamepads(void);
EMSCRIPTEN_RESULT emscripten_get_gamepad_status(int index, EmscriptenGamepadEvent* gamepadState);

#ifdef __cplusplus
}
#endif
