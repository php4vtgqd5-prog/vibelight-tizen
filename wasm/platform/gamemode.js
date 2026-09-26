// Game Mode: streams with the Ultra Low latency mode of the WASM player, which the TV pairs with its
// own Game Mode. The setting offers Auto (the default), Always on and Off. Auto only uses the Ultra
// Low latency mode where it works (see gamemode-core.js), a watchdog restarts a stream in the Low
// latency mode when its video freezes, and a short stream stopped by the user leads to a question.

var GAME_MODE_PREFERENCE_KEY = 'gameModePreference';
var GAME_MODE_FAILURE_KEY = 'gameModeFailure';
var GAME_MODE_ASKED_KEY = 'gameModeAsked';

var GameMode = (function() {
  // Metadata of the Game Mode edition (VibeLight-GameMode.wgt), see the Dockerfile
  var METADATA_KEY = 'http://samsung.com/tv/metadata/use.game.mode';

  var preference = 'auto';
  var failure = null;
  var asked = false;
  var player = null;
  var edition = null;
  // State of the watchdog of the running stream, null when it does not use the Ultra Low latency mode
  var watchdog = null;
  // Whether the watchdog moved the streams of the current launch to the Low latency mode
  var fellBack = false;
  var pendingQuestion = false;

  function platformVersion() {
    return parseFloat(platformVer) || 0;
  }

  // Features of the WASM player, cached once the module can report them
  function playerCapabilities() {
    if (player) {
      return player;
    }
    if (typeof Module === 'undefined' || typeof Module.getPlatformCapabilities !== 'function') {
      return { known: false, ultraLowLatency: false };
    }
    try {
      var reported = Module.getPlatformCapabilities();
      player = { known: !!reported.known, ultraLowLatency: !!reported.ultraLowLatency };
    } catch (error) {
      console.warn('%c[gamemode.js, playerCapabilities]', 'color: teal;', 'Unable to read the capabilities of the WASM player: ' + error);
      player = { known: false, ultraLowLatency: false };
    }
    console.log('%c[gamemode.js, playerCapabilities]', 'color: teal;', 'WASM player capabilities: ' + JSON.stringify(player));
    return player;
  }

  // Whether this package declares Game Mode, so that the TV enters it when the app starts
  function isGameModeEdition() {
    if (edition === null) {
      edition = false;
      try {
        var appId = tizen.application.getCurrentApplication().appInfo.id;
        edition = tizen.application.getAppMetaData(appId).some(function(item) {
          return item.key === METADATA_KEY && String(item.value).toLowerCase() === 'true';
        });
      } catch (error) {
        console.warn('%c[gamemode.js, isGameModeEdition]', 'color: teal;', 'Unable to read the metadata of the app: ' + error);
      }
    }
    return edition;
  }

  function environment() {
    return {
      platform: platformVersion(),
      player: playerCapabilities(),
      edition: isGameModeEdition(),
      failure: failure,
    };
  }

  function useUltraLowLatency() {
    return GameModeCore.useUltraLowLatency(preference, environment());
  }

  // What Game Mode does on this TV, shown under the setting
  function statusText() {
    var env = environment();
    if (preference === 'off') {
      return t('Game Mode is off: streams use the low latency mode, with the picture settings of the TV.');
    }
    if (!GameModeCore.isSupported(env)) {
      return t('The WASM player of this TV has no Ultra Low latency mode, so streams use the low latency mode.');
    }
    if (preference === 'on') {
      return t('Streams always use the Ultra Low latency mode, even where it may freeze the video.');
    }
    switch (GameModeCore.autoBlocker(env)) {
      case 'edition':
        return t('This is the Game Mode edition of VibeLight: the TV switches to Game Mode when VibeLight starts, and streams use the low latency mode.');
      case 'froze':
        return t('The Ultra Low latency mode froze the video on this TV, so streams use the low latency mode.');
      case 'incompatible':
        return t('Tizen %1$s freezes the video in the Ultra Low latency mode, so streams use the low latency mode. Install VibeLight-GameMode.wgt to have the TV switch to Game Mode.', platformVer);
      default:
        return t('Streams use the Ultra Low latency mode of Game Mode on this TV.');
    }
  }

  function render() {
    setSelectMenuValue('selectGameMode', 'gameModeMenu', preference);
    $('#gameModeStatusText').text(statusText());
    $('#gameModeStatus').toggleClass('is-active', useUltraLowLatency());
    $('#retryGameModeMenu').toggle(!!failure);
  }

  function setPreference(value) {
    preference = value === 'on' || value === 'off' ? value : 'auto';
    render();
  }

  // The user picked another value of the setting
  function choose(value) {
    setPreference(value);
    storeData(GAME_MODE_PREFERENCE_KEY, preference, null);
    var env = environment();
    if (preference === 'on' && !GameModeCore.isSupported(env)) {
      setTimeout(() => {
        warningDialog(t('Unsupported Feature'),
          t('Game Mode (Ultra Low Latency) is not supported on Tizen %1$s due to platform limitations and lack of support from the WASM player.', platformVer) +
          t('Attempting to enable this option will have no effect, as the decoder will force a fallback to standard Low Latency mode to maintain streaming stability.<br><br>') +
          t('Since the Game Mode cannot be enabled, you may experience slightly higher latency while streaming. To further reduce latency, it is highly recommended to open your TV\'s Picture Settings menu and disable post-processing features such as <b>Picture Clarity</b>, <b>Contrast Enhancer</b>, and other video enhancements.')
        );
      }, 250);
    } else if (preference === 'on' && env.platform >= GameModeCore.FIRST_INCOMPATIBLE_PLATFORM) {
      setTimeout(() => {
        warningDialog(t('Compatibility Warning'),
          t('Game Mode (Ultra Low Latency) is not compatible with Tizen %1$s due to platform changes introduced by Samsung.', platformVer) +
          t('Enabling this option may result in video freezing on the first rendered frame, black screen, unstable performance, and other streaming issues.<br><br>') +
          t('If the video freezes, VibeLight restarts the stream in low latency mode. Install VibeLight-GameMode.wgt to have the TV switch to Game Mode instead.')
        );
      }, 250);
    } else if (preference === 'off') {
      snackbarLogLong('Warning: Disabling game mode may increase latency and affect your game streaming performance!');
    }
  }

  function recordFailure(reason) {
    failure = { platform: String(platformVer), model: typeof modelName !== 'undefined' ? modelName : '', reason: reason, at: Date.now() };
    storeData(GAME_MODE_FAILURE_KEY, failure, null);
    render();
  }

  // Forget a freeze, so that Auto tries the Ultra Low latency mode again
  function retry() {
    failure = null;
    asked = false;
    storeData(GAME_MODE_FAILURE_KEY, null, null);
    storeData(GAME_MODE_ASKED_KEY, false, null);
    render();
    snackbarLog('VibeLight will try Game Mode again on the next stream.');
  }

  // Choose the latency mode of a stream. A restart keeps the Low latency mode once the watchdog
  // switched to it, while a stream the user starts follows the setting again.
  function applyToConfig(config, overrides) {
    if (!overrides) {
      fellBack = false;
    }
    config.gameMode = useUltraLowLatency() && !fellBack && !(overrides && overrides.latencyMode === 'low') ? 1 : 0;
    return config;
  }

  function beginStream(config) {
    watchdog = config && config.gameMode ? { state: null } : null;
  }

  // Restart the running stream in the Low latency mode, and remember that this TV froze
  function fallBack() {
    watchdog = null;
    fellBack = true;
    recordFailure('watchdog');
    pendingStreamRestart = {
      host: api,
      appId: currentStreamConfig.appId,
      overrides: { latencyMode: 'low' },
      message: t('Game Mode froze the video on this TV. Restarting the stream in low latency mode...'),
    };
    console.warn('%c[gamemode.js, fallBack]', 'color: teal;', 'The video froze in the Ultra Low latency mode, restarting in the Low latency mode');
    snackbarLogLong('Game Mode froze the video on this TV. Restarting the stream in low latency mode...');
    // Keep the audio output of the Web Audio backend, as a new one could not start without a key press
    _audPreserveContext = true;
    sendMessage('stopRequest', []);
  }

  // Watch every statistics sample of a stream in the Ultra Low latency mode
  function onStatsSample(sample) {
    if (!watchdog || pendingStreamRestart || !currentStreamConfig || !api) {
      return;
    }
    var step = GameModeCore.watchdogStep(watchdog.state, sample);
    watchdog.state = step.state;
    if (step.frozen) {
      fallBack();
    }
  }

  // Called with the summary of a stream when it ends, see finishStreamStatistics()
  function onStreamEnded(summary, errorCode, config, isRestart) {
    watchdog = null;
    pendingQuestion = !isRestart && GameModeCore.shouldAskAfterStream({
      ultraLowLatency: !!(config && config.gameMode),
      connected: !!(summary && summary.connected),
      errorCode: errorCode,
      duration: summary ? summary.duration : 0,
      fellBack: fellBack,
      failureKnown: !!failure,
      alreadyAsked: asked,
    });
  }

  // Ask whether the video froze after a short stream in the Ultra Low latency mode, once per TV.
  // Returns whether the question was shown.
  function showPendingQuestion() {
    if (!pendingQuestion || isDialogOpen) {
      return false;
    }
    pendingQuestion = false;
    asked = true;
    storeData(GAME_MODE_ASKED_KEY, true, null);
    choiceDialog(t('Did the video freeze?'),
      t('On some TVs, the Ultra Low latency mode of Game Mode freezes the video on its first frame or leaves it black. If this happened, VibeLight can stream in low latency mode on this TV instead.'),
      t('Use low latency mode'), t('Keep Game Mode'),
      function() {
        recordFailure('user');
        if (preference === 'on') {
          setPreference('auto');
          storeData(GAME_MODE_PREFERENCE_KEY, preference, null);
        }
        snackbarLog('VibeLight will stream in low latency mode on this TV.');
      });
    return true;
  }

  return {
    render: render,
    choose: choose,
    retry: retry,
    setPreference: setPreference,
    setFailure: function(value) {
      failure = value && value.at ? value : null;
      render();
    },
    setAsked: function(value) {
      asked = !!value;
    },
    useUltraLowLatency: useUltraLowLatency,
    applyToConfig: applyToConfig,
    beginStream: beginStream,
    onStatsSample: onStatsSample,
    onStreamEnded: onStreamEnded,
    showPendingQuestion: showPendingQuestion,
  };
})();

function loadGameModeSettings() {
  getData(GAME_MODE_PREFERENCE_KEY, function(stored) {
    GameMode.setPreference(stored[GAME_MODE_PREFERENCE_KEY]);
  });
  getData(GAME_MODE_FAILURE_KEY, function(stored) {
    GameMode.setFailure(stored[GAME_MODE_FAILURE_KEY]);
  });
  getData(GAME_MODE_ASKED_KEY, function(stored) {
    GameMode.setAsked(stored[GAME_MODE_ASKED_KEY]);
  });
}

function restoreGameModeDefaults() {
  GameMode.setPreference('auto');
  storeData(GAME_MODE_PREFERENCE_KEY, 'auto', null);
}

function attachGameModeListeners() {
  $('.gameModeMenu li').on('click', function() {
    GameMode.choose($(this).data('value'));
  });
  $('#retryGameModeBtn').on('click', function() {
    GameMode.retry();
  });
}
