/* eslint-disable */

const SyncFunctions = {
  // no parameters
  'makeCert': (...args) => Module.makeCert(...args),
  // cert, privateKey, myUniqueid
  'httpInit': (...args) => Module.httpInit(...args),
  /* host, httpPort, width, height, fps, bitrate, rikey, rikeyid, appversion, gfeversion, rtspurl, serverCodecModeSupport,
  framePacing, optimizeGames, rumbleFeedback, mouseEmulation, flipABfaceButtons, flipXYfaceButtons, audioBackend,
  audioConfig, audioSync, audioJitter, playHostAudio, videoCodec, hdrMode, fullRange, gameMode, disableWarnings,
  performanceStats */
  'startRequest': (...args) => Module.startStream(...args),
  // no parameters
  'stopRequest': (...args) => Module.stopStream(...args),
  // no parameters
  'cancelRequest': (...args) => Module.cancelRequest(...args),
  // no parameters, the module answers with a StatsToggle message
  'toggleStats': (...args) => Module.toggleStats(...args),
};

const AsyncFunctions = {
  // url, ppk, binaryResponse
  'openUrl': (id, url, ppk, binary) => Module.openUrl(id, url, ppk, binary),
  // no parameters
  'STUN': (...args) => Module.stun(...args),
  // serverMajorVersion, address, httpPort, randomNumber
  'pair': (...args) => Module.pair(...args),
  // macAddress
  'wakeOnLan': (...args) => Module.wakeOnLan(...args),
};

var callbacks = {}
var callbacks_ids = 1;

function normalizeBackendMessageText(text) {
  return String(text || '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function replaceKnownStageLabels(text) {
  const stageLabels = [
    'none',
    'platform initialization',
    'name resolution',
    'audio stream initialization',
    'RTSP handshake',
    'control stream initialization',
    'video stream initialization',
    'input stream initialization',
    'control stream establishment',
    'video stream establishment',
    'audio stream establishment',
    'input stream establishment',
  ];

  const translatedStageLabels = [
    t('none'),
    t('platform initialization'),
    t('name resolution'),
    t('audio stream initialization'),
    t('RTSP handshake'),
    t('control stream initialization'),
    t('video stream initialization'),
    t('input stream initialization'),
    t('control stream establishment'),
    t('video stream establishment'),
    t('audio stream establishment'),
    t('input stream establishment'),
  ];

  let translated = text.replace(/\bStarting\b/g, t('Starting'));
  stageLabels.forEach((label, i) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    translated = translated.replace(new RegExp(escapedLabel, 'gi'), translatedStageLabels[i]);
  });

  return translated;
}

function replaceKnownStatsLabels(text) {
  return text
    .replace(/Slow connection to PC\.\nReduce your bitrate!/g, t('Slow connection to PC.\nReduce your bitrate!'));
}

function replaceKnownWolErrorLabels(text) {
  const wolErrorLabels = [
    'Invalid MAC address format',
    'Invalid MAC address: default zero MAC address not allowed',
    'Failed to create socket',
    'Failed to enable broadcast',
    'Failed to send magic packet to MAC address',
    'Failed to send IPv6 magic packet to MAC address',
    'Unknown error'
  ];

  const translatedWolErrorLabels = [
    t('Invalid MAC address format'),
    t('Invalid MAC address: default zero MAC address not allowed'),
    t('Failed to create socket'),
    t('Failed to enable broadcast'),
    t('Failed to send magic packet to MAC address'),
    t('Failed to send IPv6 magic packet to MAC address'),
    t('Unknown error')
  ];

  let translated = text;
  wolErrorLabels.forEach((label, i) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    translated = translated.replace(new RegExp(escapedLabel, 'gi'), translatedWolErrorLabels[i]);
  });

  return translated;
}

function translateBackendMessage(text) {
  const normalized = normalizeBackendMessageText(text);

  let translated = t(normalized);
  translated = replaceKnownStageLabels(translated);
  translated = replaceKnownStatsLabels(translated);

  return translated;
}

/**
 * var sendMessage - Sends a message with arguments to the Wasm module
 *
 * @param  {String} method A named method
 * @param  {(String|Array)} params An array of options or a single string
 * @return {void}        The Wasm module calls back through the handleMessage method
 */
var _httpLock = Promise.resolve();

var sendMessage = function(method, params) {
  if (SyncFunctions[method]) {
    return new Promise(function(resolve, reject) {
      const ret = SyncFunctions[method](...params);
      // Functions without a result (such as toggleStats) simply resolve
      if (!ret || ret.type === "resolve") {
        resolve(ret ? ret.ret : undefined);
      } else {
        reject(ret.ret);
      }
    });
  } else if (method === 'openUrl') {
    // We MUST enforce the timeout in JavaScript because Emscripten's libcurl wrapper
    // completely ignores native timeouts (e.g., CURLOPT_CONNECTTIMEOUT) and relies on
    // the browser's native XHR timeout, which can take up to 1 minute.
    var timeout_ms = params[3] || 0;

    return new Promise(function(resolve, reject) {
      _httpLock = _httpLock.catch(function() {}).then(function() {
        return new Promise(function(innerResolve, innerReject) {
          var isFinished = false;
          var timeoutId = null;
          var url = params[0];

          if (timeout_ms > 0) {
            timeoutId = setTimeout(function() {
              if (!isFinished) {
                isFinished = true;
                console.warn('%c[messages.js, sendMessage]', 'color: gray;', 'Warning: HTTPS request timed out, canceling C++ HTTP request for URL:', url);
                SyncFunctions['cancelRequest']();
                reject(-1); // GS_FAILED
                innerResolve(); // Unlock the JS queue!
              }
            }, timeout_ms);
          }

          const id = callbacks_ids++;
          callbacks[id] = {
            'resolve': function(msg) {
              if (!isFinished) {
                isFinished = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve(msg);
                innerResolve(); // Unlock the JS queue
              }
            },
            'reject': function(err) {
              if (!isFinished) {
                isFinished = true;
                if (timeoutId) clearTimeout(timeoutId);
                reject(err);
                innerResolve(); // Unlock the JS queue
              }
            }
          };

          AsyncFunctions['openUrl'](id, ...params);
        });
      });
    });
  } else {
    return new Promise(function(resolve, reject) {
      const id = callbacks_ids++;
      callbacks[id] = {
        'resolve': resolve,
        'reject': reject
      };

      AsyncFunctions[method](id, ...params);
    });
  }
}

var handlePromiseMessage = function(callbackId, type, msg) {
  if (!callbacks[callbackId]) {
    console.warn('%c[messages.js, handlePromiseMessage]', 'color: gray;', 'Warning: No pending request for callback ' + callbackId);
    return;
  }
  callbacks[callbackId][type](msg);
  delete callbacks[callbackId];
}

// Whether a streaming session is waiting for its termination to be handled. The WASM module can
// report the end of a session more than once (for example when a stop request races a connection
// failure), and handling it twice would return to the app list twice.
var isStreamSessionActive = false;

// Whether the WASM module is still closing the media pipeline of the previous session
var isStreamTeardownPending = false;

// Set when the decoder setup reported a specific error, so that the generic stage failure the
// WASM module reports right after it does not open a second dialog
var decoderSetupErrorShown = false;

// Describes a decoder setup failure reported by the WASM module in terms the user can act on
function describeDecoderSetupFailure(detail) {
  var kind = detail.split(':')[0];
  var info = detail.substring(kind.length + 1);
  if (kind === 'audio') {
    return t('Your TV could not open an audio output with %1$s channels. Select Stereo in the audio settings and try again.', info);
  }
  var codec = /av01/.test(info) ? 'AV1' : (/hev1|hvc1/.test(info) ? 'HEVC' : 'H.264');
  var hdr = /\.10|hev1\.2/.test(info);
  return t('Your TV has no hardware decoder for %1$s%2$s video. Select another video codec or disable HDR, then try again.', codec, hdr ? ' 10-bit' : '');
}

/**
 * handleMessage - Handles messages from the Wasm module
 *
 * @param  {Object} msg An object given by the Wasm module
 * @return {void}
 */
function handleMessage(msg) {
  // The statistics arrive every second, so they are not logged like the other messages
  if (msg.indexOf('StatsJson: ') !== 0) {
    console.log('%c[messages.js, handleMessage]', 'color: gray;', 'Message data: ', msg);
  }
  // If it's a recognized event, notify the appropriate function
  if (msg.indexOf('streamTerminated: ') === 0) {
    // The WASM module closes the media pipeline in the background after reporting the end of the
    // session, and a new stream can only start once it confirms with StreamCleanupDone
    isStreamTeardownPending = true;
    // Handle the end of each session once, even if the WASM module reports it more than once
    if (!isStreamSessionActive) {
      console.log('%c[messages.js, handleMessage]', 'color: gray;', 'Ignoring a repeated stream termination.');
      return;
    }
    isStreamSessionActive = false;
    // Show a termination snackbar message if the termination was unexpected
    var errorCode = parseInt(msg.replace('streamTerminated: ', ''));
    // A stream Auto-Tune ended to start it again, with a lower bitrate or another codec
    var restart = pendingStreamRestart;
    pendingStreamRestart = null;
    // Close the statistics of the session, which keeps it in the session history
    finishStreamStatistics(errorCode, !!restart);
    currentStreamConfig = null;
    // Release the audio scheduler of the Web Audio backend, which is a no-op for the EMSS backend
    stopAudioScheduler();
    // Remove the on-screen overlays
    $('#connection-warnings').css('display', 'none');
    if (restart) {
      // Stay on the stream screen and start the stream again once the WASM module is ready
      $('#wasm_module').css('display', 'none');
      $('body').removeClass('vl-streaming');
      showStreamLoading(restart.appId);
      $('#loadingSpinnerMessage').text(restart.message);
      $('#loadingSpinnerDetail').text('');
      var restartToken = streamStartToken;
      setTimeout(function() {
        // Unless the user cancelled the restart with the RED key in the meantime
        if (restartToken === streamStartToken) {
          startGame(restart.host, restart.appId, restart.overrides || {});
        }
      }, 500);
      return;
    }
    AutoTune.endReconnectSequence();
    // Remove the video stream now
    $('#listener').removeClass('fullscreen');
    hideStreamLoading();
    $('body').removeClass('vl-streaming');
    $('#wasm_module').css('display', 'none');
    switch (errorCode) {
      case 0: // ML_ERROR_GRACEFUL_TERMINATION
        break;
      case -100: // ML_ERROR_NO_VIDEO_TRAFFIC
        snackbarLogLong('No video received from host. Check the host PC\'s firewall and port forwarding rules.');
        break;
      case -101: // ML_ERROR_NO_VIDEO_FRAME
        snackbarLogLong('Your network connection isn\'t performing well. Reduce your video bitrate setting or try a faster connection.');
        break;
      case -102: // ML_ERROR_UNEXPECTED_EARLY_TERMINATION
        snackbarLogLong('Something went wrong on your host PC when starting the stream. Restart your host PC and try again.');
        break;
      case -103: // ML_ERROR_PROTECTED_CONTENT
        snackbarLogLong('An issue occurred on your host PC while starting the stream. Make sure you don\'t have any DRM-protected content open on your host PC.');
        break;
      case -104: // ML_ERROR_FRAME_CONVERSION
        snackbarLogLong('The host PC reported a fatal video encoding error. Try disabling HDR mode, changing the streaming resolution, or changing your host PC\'s display resolution.');
        break;
      default:
        snackbarLogLong('Connection terminated');
        break;
    }
    // Return to the app list, then show the summary of the session that just ended
    var returnToApps = function() {
      showApps(api).then(() => {
        // Scroll to the current game row
        Navigation.switch();
        // Switch to Apps view
        if (!window.isDialogOpen) {
          Navigation.change(Views.Apps);
        }
        setTimeout(showPendingSessionSummary, 400);
      });
    };
    // Refresh the server info to update the current game and app list
    api.refreshServerInfo().then(function(ret) {
      // Return to the app list with new current game
      returnToApps();
    }, function(failedRefreshInfo) {
      console.error('%c[messages.js, handleMessage]', 'color: gray;', 'Error: Failed to refresh server info! Returned error was: ' + failedRefreshInfo + '!');
      // Return to the app list anyway
      returnToApps();
    });
  } else if (msg === 'StreamCleanupDone') {
    // The media pipeline of the previous session is closed, so a new stream can start
    isStreamTeardownPending = false;
  } else if (msg.indexOf('DecoderSetupFailed: ') === 0) {
    // Explain which decoder the TV could not open instead of the generic stage failure
    decoderSetupErrorShown = true;
    var failure = msg.replace('DecoderSetupFailed: ', '');
    // Auto-Tune picks another codec by itself when the one it chose cannot be decoded
    if (handleAutoTuneDecoderFailure(failure)) {
      return;
    }
    warningDialog(t('Unsupported Stream Format'), describeDecoderSetupFailure(failure));
  } else if (msg.indexOf('StatsJson: ') === 0) {
    // Statistics of the last second of the stream
    StreamSessionStats.onSample(StreamStats.parseSample(msg.substring('StatsJson: '.length)));
    return;
  } else if (msg === 'StatsToggle') {
    // The stats shortcut of the keyboard or a gamepad was pressed
    cycleStatsOverlayMode();
  } else if (msg === 'Connection Established') {
    StreamSessionStats.connected();
    // Offer this app on the home screen next time
    var statsSession = StreamSessionStats.current();
    ContinuePlaying.remember(statsSession ? statsSession.meta : null);
    // Prepare the screen for video stream
    hideStreamLoading();
    $('body').addClass('vl-streaming');
    $('#wasm_module').css('display', '');
    $('#wasm_module').focus();
  } else if (msg.indexOf('ProgressMsg: ') === 0) {
    // Show progress message under loading spinner
    $('#loadingSpinnerMessage').text(translateBackendMessage(msg.replace('ProgressMsg: ', '')));
  } else if (msg.indexOf('TransientMsg: ') === 0) {
    // Show transient message as notification
    snackbarLogLong(translateBackendMessage(msg.replace('TransientMsg: ', '')));
  } else if (msg.indexOf('DialogMsg: ') === 0) {
    // The stage failure that follows a decoder setup error was already explained to the user
    if (decoderSetupErrorShown) {
      decoderSetupErrorShown = false;
      console.warn('%c[messages.js, handleMessage]', 'color: gray;', msg);
      return;
    }
    // Show dialog message using the warning dialog
    warningDialog(t('Connection Error'), escapeHtml(translateBackendMessage(msg.replace('DialogMsg: ', ''))));
  } else if (msg === 'displayVideo') {
    // Show the video stream now
    $('#listener').addClass('fullscreen');
  } else if (msg.indexOf('NoWarningMsg: ') === 0) {
    // Hide the connection warnings overlay
    $('#connection-warnings').removeClass('is-active').text('');
  } else if (msg.indexOf('WarningMsg: ') === 0) {
    // Show the connection warnings overlay
    $('#connection-warnings').addClass('is-active').text(translateBackendMessage(msg.replace('WarningMsg: ', '')));
  } else if (msg.indexOf('controllerRumble: ') === 0) {
    const eventData = msg.substring('controllerRumble: '.length).split(',');
    const gamepadIdx = parseInt(eventData[0]);
    const weakMagnitude = parseFloat(eventData[1]);
    const strongMagnitude = parseFloat(eventData[2]);
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[gamepadIdx];
    // Check if the gamepad exists and if it has a vibrationActuator associated with it
    if (gamepad && gamepad.vibrationActuator) {
      console.log('%c[messages.js, handleMessage]', 'color: gray;', 'Playing rumble on gamepad ' + gamepadIdx + ' with weak magnitude ' + weakMagnitude + ' and strong magnitude ' + strongMagnitude + '...');
      gamepad.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: 5000, // Moonlight should be sending another rumble event when stopping
        weakMagnitude: weakMagnitude,
        strongMagnitude: strongMagnitude,
      });
    } else {
      console.warn('%c[messages.js, handleMessage]', 'color: gray;', 'Warning: Gamepad ' + gamepadIdx + ' does not support the rumble feature!');
    }
  } else if (msg.indexOf('mouseEmulationOn') === 0) {
    // Show mouse emulation enable status as a notification
    snackbarLogLong('Mouse emulation is activated');
  } else if (msg.indexOf('mouseEmulationOff') === 0) {
    // Show mouse emulation disable status as notification
    snackbarLogLong('Mouse emulation is deactivated');
  }
}
