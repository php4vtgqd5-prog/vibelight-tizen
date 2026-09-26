// Decisions of Game Mode, without any dependency on the TV, so that they can be unit tested.
//
// Game Mode streams with the Ultra Low latency mode of the Samsung WASM player, which the TV pairs
// with its own Game Mode. It does not work everywhere: the player of Tizen 5.5 lacks it, and on
// Tizen 9 the video freezes on its first frame or stays black with it. See gamemode.js.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GameModeCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // First platform version whose WASM player offers the Ultra Low latency mode
  var FIRST_SUPPORTED_PLATFORM = 6.0;
  // First platform version on which the Ultra Low latency mode freezes the video
  var FIRST_INCOMPATIBLE_PLATFORM = 9.0;
  // Samples in a row that must look frozen before the watchdog switches to the Low latency mode
  var FROZEN_SAMPLES = 3;
  // Share of the received frames the player must reject for a sample to look frozen
  var REJECTED_SHARE = 0.8;
  // Decoding errors the player reports asynchronously in one sample for it to look frozen
  var DECODING_ERRORS = 3;
  // A stopped stream in the Ultra Low latency mode shorter than this, in seconds, may have frozen
  var SUSPICIOUS_SESSION_SECONDS = 45;

  // Whether the WASM player can use the Ultra Low latency mode at all
  //
  //   env.platform  version of the Tizen platform, 0 when unknown
  //   env.player    { known, ultraLowLatency } as reported by the WASM module
  function isSupported(env) {
    var player = env.player || {};
    if (env.platform > 0 && env.platform < FIRST_SUPPORTED_PLATFORM) {
      return false;
    }
    return !(player.known && !player.ultraLowLatency);
  }

  // Why Auto keeps the Low latency mode on this TV, or null when it uses the Ultra Low latency mode
  //
  //   env.edition   whether the package declares Game Mode, so the TV enters it by itself
  //   env.failure   what the watchdog or the user reported on this TV, or null
  function autoBlocker(env) {
    if (!isSupported(env)) {
      return 'unsupported';
    }
    if (env.edition) {
      return 'edition';
    }
    if (env.failure && (!env.failure.platform || parseFloat(env.failure.platform) === env.platform)) {
      return 'froze';
    }
    if (env.platform >= FIRST_INCOMPATIBLE_PLATFORM) {
      return 'incompatible';
    }
    return null;
  }

  // Whether a stream uses the Ultra Low latency mode, for the preference auto, on or off
  function useUltraLowLatency(preference, env) {
    if (preference === 'off') {
      return false;
    }
    if (preference === 'on') {
      return isSupported(env);
    }
    return autoBlocker(env) === null;
  }

  // One step of the watchdog of a stream in the Ultra Low latency mode, for each statistics sample
  // (see stats-core.js). The video looks frozen when frames keep arriving but the player rejects
  // them, reports errors while decoding them, or stops moving its playback position. Samples
  // without incoming video tell nothing about the player, so they leave the state alone.
  function watchdogStep(state, sample) {
    var next = {
      frozenSamples: state ? state.frozenSamples : 0,
      lastPosition: state ? state.lastPosition : -1,
      positionMoved: state ? state.positionMoved : false,
      stillPositions: state ? state.stillPositions : 0,
    };
    if (!sample || !(sample.rx >= 5)) {
      return { state: next, frozen: false };
    }

    // The position only proves a stall once it was seen moving, as some players never report it
    var position = typeof sample.pos === 'number' ? sample.pos : -1;
    if (position >= 0) {
      if (next.lastPosition >= 0 && position > next.lastPosition) {
        next.positionMoved = true;
        next.stillPositions = 0;
      } else if (next.lastPosition >= 0) {
        next.stillPositions++;
      }
      next.lastPosition = position;
    }

    var rejected = (sample.fail || 0) / 100 >= REJECTED_SHARE;
    var decodingErrors = (sample.vErr || 0) >= DECODING_ERRORS;
    var stalled = next.positionMoved && next.stillPositions > 0 && sample.ren > 0;
    next.frozenSamples = rejected || decodingErrors || stalled ? next.frozenSamples + 1 : 0;
    return { state: next, frozen: next.frozenSamples >= FROZEN_SAMPLES };
  }

  // Whether to ask the user if the video froze, after a stream in the Ultra Low latency mode that
  // the user stopped soon after it connected
  function shouldAskAfterStream(stream) {
    return !!stream.ultraLowLatency && !!stream.connected && stream.errorCode === 0 &&
      !stream.fellBack && !stream.failureKnown && !stream.alreadyAsked &&
      stream.duration < SUSPICIOUS_SESSION_SECONDS;
  }

  return {
    FIRST_SUPPORTED_PLATFORM: FIRST_SUPPORTED_PLATFORM,
    FIRST_INCOMPATIBLE_PLATFORM: FIRST_INCOMPATIBLE_PLATFORM,
    FROZEN_SAMPLES: FROZEN_SAMPLES,
    isSupported: isSupported,
    autoBlocker: autoBlocker,
    useUltraLowLatency: useUltraLowLatency,
    watchdogStep: watchdogStep,
    shouldAskAfterStream: shouldAskAfterStream,
  };
});
