const Controller = (function() {
  let pollingInterval = null;
  const gamepads = {};

  class Button {
    constructor(button) {
      this.value = button.value;
      this.pressed = button.pressed;
    }
  }

  class Gamepad {
    constructor(gamepad) {
      this.buttons = gamepad.buttons.map((button) => new Button(button));
      this.axes = gamepad.axes.slice(); // Store initial axis values
    }

    analyzeButtonsAndAxes(newButtons, newAxes) {
      if (this.buttons.length !== newButtons.length || this.axes.length !== newAxes.length) {
        console.error('%c[gamepad.js, analyzeButtonsAndAxes]', 'color: gray;', 'Error: New buttons or axes layout does not match the saved one!');
        return;
      }

      const changes = [];

      for (let i = 0; i < newButtons.length; ++i) {
        if (this.buttons[i].pressed !== newButtons[i].pressed) {
          changes.push({
            type: 'button',
            index: i,
            pressed: newButtons[i].pressed,
          });
        }
      }

      for (let i = 0; i < newAxes.length; i++) {
        if (this.axes[i] !== newAxes[i]) {
          changes.push({
            type: 'axis',
            index: i,
            value: newAxes[i]
          });
        }
      }

      // Without changes the stored state is already the current one
      if (changes.length === 0) {
        return;
      }

      window.dispatchEvent(new CustomEvent('gamepadinputchanged', {
          detail: { changes },
        })
      );

      this.buttons = newButtons.map((button) => new Button(button));
      this.axes = newAxes.slice(); // Update stored axis values
    }
  }

  function gamepadConnected(gamepad) {
    gamepads[gamepad.index] = new Gamepad(gamepad);
    updatePolling();
  }

  function gamepadDisconnected(gamepad) {
    delete gamepads[gamepad.index];
    updatePolling();
  }

  function analyzeGamepad(gamepad) {
    const index = gamepad.index;
    const pGamepad = gamepads[index];

    if (pGamepad) {
      pGamepad.analyzeButtonsAndAxes(gamepad.buttons, gamepad.axes);
    }
  }

  function pollGamepads() {
    const gamepads = navigator.getGamepads
      ? navigator.getGamepads()
      : navigator.webkitGetGamepads
      ? navigator.webkitGetGamepads()
      : [];
    for (const gamepad of gamepads) {
      if (gamepad) {
        analyzeGamepad(gamepad);
      }
    }
  }

  // Interval between two polls of the gamepads for the user interface, in milliseconds. One poll
  // per frame is plenty for navigating menus, polling faster only kept the main thread busy.
  const POLLING_INTERVAL_MS = 16;

  let listenersAttached = false;
  let watching = false;

  // Only the gamepads reported by a gamepadconnected event are analyzed, so the gamepads are polled
  // only while one is connected, instead of waking the main thread of the TV 60 times per second
  function updatePolling() {
    const needed = watching && Object.keys(gamepads).length > 0;
    if (needed && !pollingInterval) {
      pollingInterval = setInterval(pollGamepads, POLLING_INTERVAL_MS);
    } else if (!needed && pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function startWatching() {
    // Attach the connection listeners once, even when watching is stopped and started again
    if (!listenersAttached) {
      listenersAttached = true;
      window.addEventListener('gamepadconnected', function(e) {
        gamepadConnected(e.gamepad);
      });
      window.addEventListener('gamepaddisconnected', function(e) {
        gamepadDisconnected(e.gamepad);
      });
    }
    watching = true;
    updatePolling();
  }

  function stopWatching() {
    watching = false;
    updatePolling();
  }

  // The WASM module polls the gamepads by itself while streaming, so the user interface stops
  // polling them to leave the main thread to the video and audio of the stream
  function pause() {
    stopWatching();
  }

  function resume() {
    if (!listenersAttached) {
      return;
    }
    // Take a fresh snapshot of the gamepads, so the buttons held while the stream ended are not
    // reported as new presses to the user interface
    const current = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gamepad of current) {
      if (gamepad && gamepads[gamepad.index]) {
        gamepads[gamepad.index] = new Gamepad(gamepad);
      }
    }
    startWatching();
  }

  return {
    startWatching,
    stopWatching,
    pause,
    resume
  };
})();
