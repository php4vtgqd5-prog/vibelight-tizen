#include "moonlight_wasm.hpp"

#include <algorithm>
#include <cstring>
#include <iostream>
#include <array>
#include <limits>
#include <utility>
#include <sstream>
#include <chrono>
#include <thread>
#include <cmath>
#include <map>

#include <Limelight.h>
#include <emscripten/emscripten.h>

// Bitmask for gamepad combo buttons to stop the streaming session
const short STOP_STREAM_BUTTONS = BACK_FLAG | PLAY_FLAG | LB_FLAG | RB_FLAG;

// Bitmask for gamepad combo buttons to toggle the performance stats overlay
const short PERF_STATS_BUTTONS = BACK_FLAG | LB_FLAG | RB_FLAG | X_FLAG;

// Flag for gamepad to track controller rumble state
bool rumbleFeedbackSwitch = false;

// Flags for gamepad to track mouse emulation state
bool mouseEmulationSwitch = false;
bool mouseEmulationActive = false;

// Flags for gamepad to track face buttons state
bool flipABfaceButtonsSwitch = false;
bool flipXYfaceButtonsSwitch = false;

// For explanation on ordering, see: https://www.w3.org/TR/gamepad/#remapping
// Enumeration for gamepad buttons
enum GamepadButton {
  A, B, X, Y,
  LeftBumper, RightBumper,
  LeftTrigger, RightTrigger,
  Back, Play,
  LeftStick, RightStick,
  Up, Down, Left, Right,
  Special,
  Count,
};

// For explanation on ordering, see: https://www.w3.org/TR/gamepad/#remapping
// Enumeration for gamepad axis
enum GamepadAxis {
  LeftX = 0,
  LeftY = 1,
  RightX = 2,
  RightY = 3,
};

// Function to create a mask for active gamepads
static short GetActiveGamepadMask(int numGamepads) {
  short result = 0;
  
  for (int i = 0; i < numGamepads; ++i) {
    result |= (1 << i);
  }
  
  return result;
}

// Function to map gamepad buttons to flags
static short GetButtonFlags(const EmscriptenGamepadEvent& gamepad) {
  // Triggers are considered analog buttons in the "Emscripten API", however they need
  // to be passed in separate arguments for "Limelight" (it even lacks flags for them).

  const int* buttonMasks = nullptr;
  int buttonMasksSize = 0;

  // Define button mapping with A/B and X/Y swapped
  static const int buttonMasksABXY[] = {
    B_FLAG, A_FLAG, Y_FLAG, X_FLAG,
    LB_FLAG, RB_FLAG,
    0 /* LT_FLAG */, 0 /* RT_FLAG */,
    BACK_FLAG, PLAY_FLAG,
    LS_CLK_FLAG, RS_CLK_FLAG,
    UP_FLAG, DOWN_FLAG, LEFT_FLAG, RIGHT_FLAG,
    SPECIAL_FLAG,
  };
  // Define button mapping with A/B swapped
  static const int buttonMasksAB[] = {
    B_FLAG, A_FLAG, X_FLAG, Y_FLAG,
    LB_FLAG, RB_FLAG,
    0 /* LT_FLAG */, 0 /* RT_FLAG */,
    BACK_FLAG, PLAY_FLAG,
    LS_CLK_FLAG, RS_CLK_FLAG,
    UP_FLAG, DOWN_FLAG, LEFT_FLAG, RIGHT_FLAG,
    SPECIAL_FLAG,
  };
  // Define button mapping with X/Y swapped
  static const int buttonMasksXY[] = {
    A_FLAG, B_FLAG, Y_FLAG, X_FLAG,
    LB_FLAG, RB_FLAG,
    0 /* LT_FLAG */, 0 /* RT_FLAG */,
    BACK_FLAG, PLAY_FLAG,
    LS_CLK_FLAG, RS_CLK_FLAG,
    UP_FLAG, DOWN_FLAG, LEFT_FLAG, RIGHT_FLAG,
    SPECIAL_FLAG,
  };
  // Define default button mapping
  static const int buttonMasksDefault[] = {
    A_FLAG, B_FLAG, X_FLAG, Y_FLAG,
    LB_FLAG, RB_FLAG,
    0 /* LT_FLAG */, 0 /* RT_FLAG */,
    BACK_FLAG, PLAY_FLAG,
    LS_CLK_FLAG, RS_CLK_FLAG,
    UP_FLAG, DOWN_FLAG, LEFT_FLAG, RIGHT_FLAG,
    SPECIAL_FLAG,
  };

  // Check if the A/B or X/Y face buttons switches are checked
  if (flipABfaceButtonsSwitch && flipXYfaceButtonsSwitch) {
    // Swap both A/B and X/Y buttons
    buttonMasks = buttonMasksABXY;
    buttonMasksSize = sizeof(buttonMasksABXY) / sizeof(buttonMasksABXY[0]);
  } else if (flipABfaceButtonsSwitch) { // Check if the A/B face buttons switch is checked
    // Swap A and B buttons
    buttonMasks = buttonMasksAB;
    buttonMasksSize = sizeof(buttonMasksAB) / sizeof(buttonMasksAB[0]);
  } else if (flipXYfaceButtonsSwitch) { // Check if the X/Y face buttons switch is checked
    // Swap X and Y buttons
    buttonMasks = buttonMasksXY;
    buttonMasksSize = sizeof(buttonMasksXY) / sizeof(buttonMasksXY[0]);
  } else {
    // Default buttons layout
    buttonMasks = buttonMasksDefault;
    buttonMasksSize = sizeof(buttonMasksDefault) / sizeof(buttonMasksDefault[0]);
  }

  short result = 0;
  
  for (int i = 0; i < gamepad.numButtons && i < buttonMasksSize; ++i) {
    if (gamepad.digitalButton[i] == EM_TRUE) {
      result |= buttonMasks[i];
    }
  }

  return result;
}

// Largest number of gamepads whose state is tracked between two polls
static constexpr int kMaxTrackedGamepads = 16;

// Last controller state sent to the host for each gamepad. The gamepads are polled every 5 ms, so
// sending only the states that changed avoids flooding the host with identical input packets.
struct SentControllerState {
  bool valid;
  short activeMask;
  short buttonFlags;
  unsigned char leftTrigger;
  unsigned char rightTrigger;
  short leftStickX;
  short leftStickY;
  short rightStickX;
  short rightStickY;
};
static SentControllerState s_LastSentState[kMaxTrackedGamepads];

// Mouse buttons held down by each gamepad while it emulates a mouse
static int s_EmulatedMouseButtons[kMaxTrackedGamepads];

// Converts an analog value in the -1.0 to 1.0 range (or 0.0 to 1.0 for triggers) to the integer
// range the host expects, clamping the values some controllers report slightly out of range
static short AxisToShort(double value) {
  const double scaled = value * std::numeric_limits<short>::max();
  return static_cast<short>(std::max<double>(-std::numeric_limits<short>::max(),
    std::min<double>(std::numeric_limits<short>::max(), scaled)));
}

static unsigned char TriggerToByte(double value) {
  const double scaled = value * std::numeric_limits<unsigned char>::max();
  return static_cast<unsigned char>(std::max<double>(0.0,
    std::min<double>(std::numeric_limits<unsigned char>::max(), scaled)));
}

// Presses or releases the emulated mouse buttons whose state changed since the last poll
static void UpdateEmulatedMouseButtons(int gamepadID, int pressedButtons) {
  static const int kMouseButtons[] = { BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT };
  int& previousButtons = s_EmulatedMouseButtons[gamepadID];

  for (int button : kMouseButtons) {
    const int mask = 1 << button;
    if ((pressedButtons & mask) && !(previousButtons & mask)) {
      LiSendMouseButtonEvent(BUTTON_ACTION_PRESS, button);
    } else if (!(pressedButtons & mask) && (previousButtons & mask)) {
      LiSendMouseButtonEvent(BUTTON_ACTION_RELEASE, button);
    }
  }

  previousButtons = pressedButtons;
}

// Function to handle the gamepad input state
void MoonlightInstance::HandleGamepadInputState(bool rumbleFeedback, bool mouseEmulation, bool flipABfaceButtons, bool flipXYfaceButtons) {
  rumbleFeedbackSwitch = rumbleFeedback;
  mouseEmulationSwitch = mouseEmulation;
  flipABfaceButtonsSwitch = flipABfaceButtons;
  flipXYfaceButtonsSwitch = flipXYfaceButtons;

  // Every stream starts without mouse emulation and sends the first state of each gamepad
  mouseEmulationActive = false;
  memset(s_LastSentState, 0, sizeof(s_LastSentState));
  memset(s_EmulatedMouseButtons, 0, sizeof(s_EmulatedMouseButtons));
}

// Function to poll gamepad input
void MoonlightInstance::PollGamepads() {
  // Take one snapshot of every gamepad per poll. Each sample is a synchronous call to the main
  // thread, which used to be repeated for every gamepad in the loop below.
  if (emscripten_sample_gamepad_data() != EMSCRIPTEN_RESULT_SUCCESS) {
    std::cerr << "Sample gamepad data failed!\n";
    return;
  }

  const auto numGamepads = emscripten_get_num_gamepads();
  if (numGamepads == EMSCRIPTEN_RESULT_NOT_SUPPORTED) {
    std::cerr << "Get num gamepads failed!\n";
    return;
  }

  // Create a mask for active gamepads
  const auto activeGamepadMask = GetActiveGamepadMask(numGamepads);

  // Prevent repeated trigger while the button combo is held down
  static std::map<int, bool> comboTriggered;

  // Track valid gamepads that had a non-zero timestamp at least once
  static bool isRealGamepad[32] = { false };

  // Iterate through connected gamepads and process their input
  for (int gamepadID = 0; gamepadID < numGamepads; ++gamepadID) {
    EmscriptenGamepadEvent gamepad;
    // See logic in getConnectedGamepadMask() (utils.js)
    // These must stay in sync!

    const auto result = emscripten_get_gamepad_status(gamepadID, &gamepad);
    if (result != EMSCRIPTEN_RESULT_SUCCESS || !gamepad.connected) {
      // Not connected
      if (gamepadID < 32) {
        isRealGamepad[gamepadID] = false;
      }
      if (gamepadID < kMaxTrackedGamepads) {
        s_LastSentState[gamepadID].valid = false;
      }
      continue;
    }

    if (gamepadID < 32 && gamepad.timestamp != 0) {
      isRealGamepad[gamepadID] = true;
    }

    if (gamepad.timestamp == 0 && (gamepadID >= 32 || !isRealGamepad[gamepadID])) {
      // On some platforms, Tizen returns "connected" gamepads that really 
      // aren't, so timestamp stays at zero. To work around this, we'll only
      // count gamepads that have a non-zero timestamp in our controller index.
      continue;
    }

    // Process input for active gamepad
    const short buttonFlags = GetButtonFlags(gamepad);
    const unsigned char leftTrigger = TriggerToByte(gamepad.analogButton[GamepadButton::LeftTrigger]);
    const unsigned char rightTrigger = TriggerToByte(gamepad.analogButton[GamepadButton::RightTrigger]);
    const short leftStickX = AxisToShort(gamepad.axis[GamepadAxis::LeftX]);
    const short leftStickY = AxisToShort(-gamepad.axis[GamepadAxis::LeftY]);
    const short rightStickX = AxisToShort(gamepad.axis[GamepadAxis::RightX]);
    const short rightStickY = AxisToShort(-gamepad.axis[GamepadAxis::RightY]);

    // Check if the current button flags match the defined button combination on the gamepad
    if (buttonFlags == STOP_STREAM_BUTTONS) {
      // Terminate the connection
      stopStream();
      return;
    } else if (buttonFlags == PERF_STATS_BUTTONS) {
      if (!comboTriggered[gamepadID]) {
        // Toggle performance stats overlay
        toggleStats();
        // Mark combo as triggered until buttons are released
        comboTriggered[gamepadID] = true;
      }
    } else {
      // Reset when buttons are released
      comboTriggered[gamepadID] = false;
    }

    // Check if the mouse emulation switch is checked
    if (mouseEmulationSwitch) {
      static std::map<int, std::chrono::time_point<std::chrono::steady_clock>> activatePressTimes;
      // Toggle mouse emulation on and off based on how long the PLAY/START button is pressed
      if (buttonFlags & PLAY_FLAG) {
        if (activatePressTimes.find(gamepadID) == activatePressTimes.end()) {
          activatePressTimes[gamepadID] = std::chrono::steady_clock::now();
        }
        auto currentTime = std::chrono::steady_clock::now();
        // Calculate the duration in milliseconds since the PLAY/START button was pressed
        auto durationTime = std::chrono::duration_cast<std::chrono::milliseconds>(currentTime - activatePressTimes[gamepadID]).count();
        // If the button has been pressed for at least 1000 milliseconds (1 second)
        if (durationTime >= 1000) {
          // Toggle mouse emulation state
          if (!mouseEmulationActive) {
            // Activate mouse emulation and notify the user
            mouseEmulationActive = true;
            PostToJs(std::string("mouseEmulationOn"));
          } else {
            // Deactivate mouse emulation and notify the user
            mouseEmulationActive = false;
            PostToJs(std::string("mouseEmulationOff"));
          }
          // Reset the PLAY/START press time to the current time after toggling
          activatePressTimes[gamepadID] = std::chrono::steady_clock::now();
        }
      } else {
        // If the PLAY/START button is not pressed, reset PLAY/START press time to the current time
        activatePressTimes[gamepadID] = std::chrono::steady_clock::now();
      }
    } else {
      // Deactivate mouse emulation if the mouse emulation switch is unchecked
      mouseEmulationActive = false;
    }

    // If mouse emulation is active, then send mouse input to the desired handler (acts as a mouse)
    if (mouseEmulationActive) {
      // Left Stick values are mapped to horizontal and vertical mouse movements
      const float baseMouseSpeed = 10.0f;
      const float leftStickMagnitude = std::sqrt(static_cast<float>(leftStickX) * leftStickX + static_cast<float>(leftStickY) * leftStickY) / std::numeric_limits<short>::max();
      const float mouseSpeed = baseMouseSpeed * leftStickMagnitude;
      const float mouseXDelta = static_cast<float>(leftStickX) / std::numeric_limits<short>::max() * mouseSpeed;
      const float mouseYDelta = -static_cast<float>(leftStickY) / std::numeric_limits<short>::max() * mouseSpeed;

      // Send a mouse move event with the specified delta values for both horizontal (X-axis) and
      // vertical (Y-axis) coordinates, skipping the empty moves of a stick at rest
      if (static_cast<int>(mouseXDelta) != 0 || static_cast<int>(mouseYDelta) != 0) {
        LiSendMouseMoveEvent(static_cast<int>(mouseXDelta), static_cast<int>(mouseYDelta));
      }

      // Right Stick values are mapped to horizontal and vertical mouse scrolls
      const float baseScrollSpeed = 1.0f;
      const float rightStickMagnitude = std::sqrt(static_cast<float>(rightStickX) * rightStickX + static_cast<float>(rightStickY) * rightStickY) / std::numeric_limits<short>::max();
      const float scrollSpeed = baseScrollSpeed * rightStickMagnitude;
      const float scrollXDelta = static_cast<float>(rightStickX) / std::numeric_limits<short>::max() * scrollSpeed;
      const float scrollYDelta = static_cast<float>(rightStickY) / std::numeric_limits<short>::max() * scrollSpeed;

      // Send mouse scroll events with the specified delta values for both horizontal (X-axis) and
      // vertical (Y-axis) coordinates, skipping the empty scrolls of a stick at rest
      if (static_cast<int>(scrollXDelta) != 0) {
        LiSendHScrollEvent(static_cast<int>(scrollXDelta));
      }
      if (static_cast<int>(scrollYDelta) != 0) {
        LiSendScrollEvent(static_cast<int>(scrollYDelta));
      }

      // Face Buttons values are mapped to control mouse buttons, which are only sent when their
      // state changes instead of pressing or releasing all of them on every poll
      if (gamepadID < kMaxTrackedGamepads) {
        int pressedButtons = 0;
        if (buttonFlags & (A_FLAG | LB_FLAG)) {
          pressedButtons |= 1 << BUTTON_LEFT;
        }
        if (buttonFlags & (X_FLAG | Y_FLAG)) {
          pressedButtons |= 1 << BUTTON_MIDDLE;
        }
        if (buttonFlags & (B_FLAG | RB_FLAG)) {
          pressedButtons |= 1 << BUTTON_RIGHT;
        }
        UpdateEmulatedMouseButtons(gamepadID, pressedButtons);

        // Release the gamepad on the host when the emulation starts, so the buttons held while
        // toggling it (such as START) do not stay pressed there, and send the full gamepad state
        // again once the emulation ends
        if (s_LastSentState[gamepadID].valid) {
          LiSendMultiControllerEvent(gamepadID, activeGamepadMask, 0, 0, 0, 0, 0, 0, 0);
          s_LastSentState[gamepadID].valid = false;
        }
      }
    } else {
      // Release the mouse buttons this gamepad held down when the emulation was turned off
      if (gamepadID < kMaxTrackedGamepads && s_EmulatedMouseButtons[gamepadID] != 0) {
        UpdateEmulatedMouseButtons(gamepadID, 0);
      }

      // Only send the gamepad state when it changed since the last packet sent for this gamepad
      if (gamepadID < kMaxTrackedGamepads) {
        SentControllerState& last = s_LastSentState[gamepadID];
        if (last.valid && last.activeMask == activeGamepadMask && last.buttonFlags == buttonFlags &&
            last.leftTrigger == leftTrigger && last.rightTrigger == rightTrigger &&
            last.leftStickX == leftStickX && last.leftStickY == leftStickY &&
            last.rightStickX == rightStickX && last.rightStickY == rightStickY) {
          continue;
        }
        last = { true, activeGamepadMask, buttonFlags, leftTrigger, rightTrigger,
                 leftStickX, leftStickY, rightStickX, rightStickY };
      }

      // If mouse emulation is inactive, then send gamepad input to the desired handler (acts as a gamepad)
      LiSendMultiControllerEvent(
        gamepadID, activeGamepadMask, buttonFlags, leftTrigger,
        rightTrigger, leftStickX, leftStickY, rightStickX, rightStickY);
    }
  }
}

// Function to send controller rumble feedback for gamepad
void MoonlightInstance::ClControllerRumble(unsigned short controllerNumber, unsigned short lowFreqMotor, unsigned short highFreqMotor) {
  const float weakMagnitude = static_cast<float>(highFreqMotor) / static_cast<float>(UINT16_MAX);
  const float strongMagnitude = static_cast<float>(lowFreqMotor) / static_cast<float>(UINT16_MAX);
  
  // Check if the rumble feedback switch is checked
  if (rumbleFeedbackSwitch) {
    std::ostringstream ss;
    ss << controllerNumber << "," << weakMagnitude << "," << strongMagnitude;
    PostToJs(std::string("controllerRumble: ") + ss.str());
  }
}
