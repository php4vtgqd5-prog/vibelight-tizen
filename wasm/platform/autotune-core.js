// Auto-Tune: picks the stream settings from the capabilities of the TV, the host and the network,
// and learns from the statistics of the previous sessions with each host.
//
// This file holds the decisions only, without any dependency on the DOM or the Tizen APIs, so it can
// be unit tested with Node. autotune.js gathers the inputs on the TV and applies the results.
(function(root, factory) {
  var AutoTuneCore = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = AutoTuneCore;
  } else {
    root.AutoTuneCore = AutoTuneCore;
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Codec support bits of the ServerCodecModeSupport field reported by the host
  var SCM = {
    H264: 0x00001,
    HEVC: 0x00100,
    HEVC_MAIN10: 0x00200,
    AV1_MAIN8: 0x10000,
    AV1_MAIN10: 0x20000,
  };

  // Resolutions Auto-Tune chooses from, from the largest to the smallest
  var RESOLUTIONS = [
    { width: 3840, height: 2160, label: '4K' },
    { width: 2560, height: 1440, label: '1440p' },
    { width: 1920, height: 1080, label: '1080p' },
    { width: 1280, height: 720, label: '720p' },
  ];

  // Highest bitrate each network class is trusted with before the sessions prove otherwise, in
  // Kbps. Many TVs only have a Fast Ethernet port, so even a wired TV keeps headroom below 100 Mbps.
  var NETWORK_BITRATE_CAPS = {
    excellent: 80000,
    good: 60000,
    fair: 30000,
    weak: 16000,
  };

  var MIN_BITRATE = 3000;
  var MAX_BITRATE = 150000;

  // Bitrate of a clean 1080p stream at 60 FPS with H.264 in low latency mode, in Kbps. The other
  // resolutions scale from it with the number of pixels to the power of 0.9, which matches the usual
  // 10, 20, 34 and 70 Mbps of the 720p, 1080p, 1440p and 4K streams.
  var H264_1080P60_BITRATE = 20000;
  var PIXELS_1080P = 1920 * 1080;

  // Bitrate a codec needs compared to H.264 for the same picture quality
  var CODEC_EFFICIENCY = { H264: 1.0, HEVC: 0.65, AV1: 0.5 };

  // How much of the bitrate budget each goal spends on the picture
  var GOAL_QUALITY_FACTOR = { balanced: 1.0, quality: 1.3, latency: 0.85 };

  // Learned bitrates are forgotten after this long, as networks change, in milliseconds
  var PROFILE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

  // Shortest session the learning trusts, in seconds
  var MIN_LEARNING_SECONDS = 30;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundBitrate(kbps) {
    // Keep the half-megabit steps of the bitrate slider
    return Math.round(kbps / 500) * 500;
  }

  // Classify the network between the TV and the host from the connection type, the Wi-Fi signal and
  // the round trip time measured to the host
  function classifyNetwork(network) {
    network = network || {};
    var probe = network.probe;
    var classes = ['weak', 'fair', 'good', 'excellent'];
    var level;

    if (network.type === 'ethernet') {
      level = 3;
    } else if (network.type === 'wifi') {
      var signal = typeof network.wifiSignal === 'number' ? network.wifiSignal : 0.6;
      level = signal >= 0.75 ? 2 : (signal >= 0.5 ? 1 : 0);
    } else {
      level = 1;
    }

    if (probe && probe.samples > 0) {
      // The latency of the path to the host overrides what the link type suggests
      var probeLevel = probe.rttMedian <= 5 && probe.rttJitter <= 2 ? 3
        : (probe.rttMedian <= 10 && probe.rttJitter <= 4 ? 2
        : (probe.rttMedian <= 20 && probe.rttJitter <= 8 ? 1 : 0));
      level = Math.min(level === 3 ? 3 : level + 1, probeLevel);
      if (network.type === 'wifi') {
        // A Wi-Fi link never ranks as excellent, its latency spikes are not visible in a short probe
        level = Math.min(level, 2);
      }
      if (probe.loss > 0) {
        level = Math.max(0, level - 1);
      }
    }
    return classes[level];
  }

  function hostSupports(codecSupport, codec, tenBit) {
    if (!codecSupport) {
      // Hosts that do not report their codecs (older GameStream) always support H.264
      return codec === 'H264';
    }
    switch (codec) {
      case 'H264':
        // Every GameStream and Sunshine host encodes H.264, even when it omits the bit
        return true;
      case 'HEVC':
        return (codecSupport & (tenBit ? SCM.HEVC_MAIN10 : SCM.HEVC)) !== 0;
      case 'AV1':
        return (codecSupport & (tenBit ? SCM.AV1_MAIN10 : SCM.AV1_MAIN8)) !== 0;
      default:
        return false;
    }
  }

  function deviceDecodes(decoders, codec, tenBit) {
    decoders = decoders || {};
    switch (codec) {
      case 'H264':
        return decoders.h264 !== false;
      case 'HEVC':
        return tenBit ? decoders.hevc10 !== false && decoders.hevc !== false : decoders.hevc !== false;
      case 'AV1':
        return tenBit ? !!decoders.av110 : !!decoders.av1;
      default:
        return false;
    }
  }

  // Bitrate that gives a clean picture for the given stream, in Kbps
  function targetBitrate(width, height, fps, codec, hdr, goal) {
    var kbps = H264_1080P60_BITRATE * Math.pow((width * height) / PIXELS_1080P, 0.9);
    // Frames at a higher rate differ less from each other, so the bitrate grows slower than the rate
    kbps *= Math.pow(fps / 60, 0.75);
    kbps *= CODEC_EFFICIENCY[codec] || 1;
    kbps *= GOAL_QUALITY_FACTOR[goal] || 1;
    if (hdr) {
      kbps *= 1.2;
    }
    return clamp(roundBitrate(kbps), MIN_BITRATE, MAX_BITRATE);
  }

  function resolutionKey(width, height, fps) {
    return width + 'x' + height + 'x' + fps;
  }

  // Whether a learned profile still applies to the current network
  function profileApplies(profile, network, now) {
    if (!profile) {
      return false;
    }
    if (profile.updatedAt && now - profile.updatedAt > PROFILE_MAX_AGE) {
      return false;
    }
    return !profile.networkType || !network || !network.type || profile.networkType === network.type;
  }

  // Highest bitrate the network is trusted with, from its class and from the learned sessions
  function bitrateCap(networkClass, profile) {
    var cap = NETWORK_BITRATE_CAPS[networkClass] || NETWORK_BITRATE_CAPS.fair;
    if (profile) {
      var upper = profile.knownBadKbps ? profile.knownBadKbps * 0.8 : Infinity;
      var lower = profile.knownGoodKbps || 0;
      if (lower >= cap * 0.95) {
        // Sessions proved the network sustains the bitrate its class allows, so probe a step above
        cap = Math.min(Math.max(cap, lower * 1.1), upper);
      }
      cap = Math.min(cap, upper);
      cap = Math.max(cap, Math.min(lower, upper));
    }
    return clamp(roundBitrate(cap), MIN_BITRATE, MAX_BITRATE);
  }

  function chooseCodec(input, goal, failedCodecs) {
    var preferences = {
      quality: ['AV1', 'HEVC', 'H264'],
      balanced: ['HEVC', 'AV1', 'H264'],
      latency: ['HEVC', 'H264'],
    }[goal] || ['HEVC', 'H264'];

    for (var i = 0; i < preferences.length; i++) {
      var codec = preferences[i];
      if (failedCodecs[codec]) {
        continue;
      }
      if (hostSupports(input.host && input.host.codecSupport, codec, false) &&
          deviceDecodes(input.device && input.device.decoders, codec, false)) {
        return codec;
      }
    }
    return 'H264';
  }

  // Recommend the settings of a stream
  //
  //   input.device  { maxWidth, maxHeight, hdr, decoders: { h264, hevc, hevc10, av1, av110 }, highFrameRate }
  //   input.host    { codecSupport }
  //   input.network { type: 'ethernet' | 'wifi' | 'unknown', wifiSignal, probe: { rttMedian, rttJitter, loss, samples } }
  //   input.profile what learnFromSession() learned from the previous sessions with this host
  //   input.goal    'balanced' | 'quality' | 'latency'
  //   input.hdr     whether the user asked for HDR
  //   input.now     current time in milliseconds
  function recommend(input) {
    input = input || {};
    var device = input.device || {};
    var goal = GOAL_QUALITY_FACTOR[input.goal] ? input.goal : 'balanced';
    var now = input.now || Date.now();
    var profile = profileApplies(input.profile, input.network, now) ? input.profile : null;
    var reasons = [];

    var networkClass = classifyNetwork(input.network);
    reasons.push({ key: 'network', params: [networkClass] });

    var failedCodecs = (profile && profile.failedCodecs) || {};
    var codec = chooseCodec(input, goal, failedCodecs);
    reasons.push({ key: 'codec', params: [codec] });

    // HDR follows the choice of the user, when the whole chain supports it
    var hdr = false;
    if (input.hdr) {
      hdr = codec !== 'H264' && !!device.hdr &&
        hostSupports(input.host && input.host.codecSupport, codec, true) &&
        deviceDecodes(device.decoders, codec, true);
      reasons.push({ key: hdr ? 'hdr-on' : 'hdr-unsupported', params: [] });
    }

    var cap = bitrateCap(networkClass, profile);
    if (profile && (profile.knownGoodKbps || profile.knownBadKbps)) {
      reasons.push({ key: 'learned', params: [cap / 1000] });
    }

    // Frame rate: 60, or 120 for the lowest latency when the user unlocked the higher frame rates
    var fps = goal === 'latency' && device.highFrameRate ? 120 : 60;

    // Resolution: the largest one the panel shows, the codec handles, the TV decoder kept up with
    // and the bitrate budget of the network affords
    var maxWidth = device.maxWidth || 1920;
    var maxHeight = device.maxHeight || 1080;
    var decoderLimited = (profile && profile.decoderLimited) || {};
    var budget = goal === 'quality' ? cap : cap * 0.85;
    var candidates = RESOLUTIONS.filter(function(resolution) {
      if (resolution.width > maxWidth || resolution.height > maxHeight) {
        return false;
      }
      // The H.264 profile of the TV decoder is only guaranteed up to 1080p
      if (codec === 'H264' && resolution.width > 1920) {
        return false;
      }
      // The lowest latency favors the frame rate over the resolution
      if (goal === 'latency' && resolution.width > 1920) {
        return false;
      }
      return true;
    });
    if (candidates.length === 0) {
      candidates = [RESOLUTIONS[RESOLUTIONS.length - 1]];
    }

    var chosen = null;
    for (var i = 0; i < candidates.length && !chosen; i++) {
      var candidate = candidates[i];
      var rates = fps > 60 ? [fps, 60] : [60];
      for (var r = 0; r < rates.length; r++) {
        if (decoderLimited[resolutionKey(candidate.width, candidate.height, rates[r])]) {
          continue;
        }
        var needed = targetBitrate(candidate.width, candidate.height, rates[r], codec, hdr, goal);
        // The smallest resolution is always acceptable, the bitrate is then capped to the budget
        if (needed <= budget || i === candidates.length - 1) {
          chosen = { width: candidate.width, height: candidate.height, fps: rates[r], label: candidate.label, needed: needed };
          break;
        }
      }
    }
    if (!chosen) {
      var smallest = candidates[candidates.length - 1];
      chosen = { width: smallest.width, height: smallest.height, fps: 60, label: smallest.label,
        needed: targetBitrate(smallest.width, smallest.height, 60, codec, hdr, goal) };
    }
    if (maxWidth >= 3840 && chosen.width < 3840) {
      reasons.push({ key: 'resolution-limited', params: [chosen.label] });
    }

    var bitrate = roundBitrate(Math.min(chosen.needed, cap));
    bitrate = clamp(bitrate, MIN_BITRATE, MAX_BITRATE);

    return {
      width: chosen.width,
      height: chosen.height,
      fps: chosen.fps,
      bitrate: bitrate,
      codec: codec,
      hdr: hdr,
      goal: goal,
      networkClass: networkClass,
      bitrateCap: cap,
      reasons: reasons,
    };
  }

  // Update the learned profile of a host with the summary of a session (see stats-core.js). The
  // learning brackets the bitrate the network sustains: clean sessions raise the highest bitrate
  // known to work, sessions with lost frames or a poor connection lower the bitrate known to fail.
  function learnFromSession(profile, summary, context) {
    context = context || {};
    var now = context.now || Date.now();
    var next = JSON.parse(JSON.stringify(profile || {}));
    next.failedCodecs = next.failedCodecs || {};
    next.decoderLimited = next.decoderLimited || {};

    if (context.networkType && next.networkType && next.networkType !== context.networkType) {
      // The TV moved to another kind of connection, what was learned no longer applies
      delete next.knownGoodKbps;
      delete next.knownBadKbps;
      next.decoderLimited = {};
    }
    if (next.updatedAt && now - next.updatedAt > PROFILE_MAX_AGE) {
      delete next.knownGoodKbps;
      delete next.knownBadKbps;
    }
    next.networkType = context.networkType || next.networkType || 'unknown';

    if (!summary || !summary.connected || summary.duration < MIN_LEARNING_SECONDS || !summary.requestedBitrate) {
      return { profile: next, verdict: 'ignored' };
    }

    var bitrate = summary.requestedBitrate * 1000;
    var verdict;
    var clean = summary.lossAvg < 0.3 && summary.poorPercent < 2 && summary.rttP95 < 30;
    var bad = summary.lossAvg >= 1.5 || summary.poorPercent >= 10;

    if (bad) {
      verdict = 'bad';
      next.knownBadKbps = next.knownBadKbps ? Math.min(next.knownBadKbps, bitrate) : bitrate;
      if (next.knownGoodKbps && next.knownGoodKbps >= bitrate) {
        // The network got worse than it used to be
        next.knownGoodKbps = roundBitrate(bitrate * 0.7);
      }
    } else if (clean) {
      verdict = 'clean';
      next.knownGoodKbps = Math.max(next.knownGoodKbps || 0, bitrate);
      if (next.knownBadKbps && next.knownBadKbps <= bitrate * 1.1) {
        // The network got better, the old failure no longer bounds the bitrate
        delete next.knownBadKbps;
      }
    } else {
      verdict = 'mixed';
      var mixedUpper = roundBitrate(bitrate * 1.2);
      next.knownBadKbps = next.knownBadKbps ? Math.min(next.knownBadKbps, mixedUpper) : mixedUpper;
    }

    // The network delivered the frames, but the TV did not render them all
    var decoderLimited = summary.lossAvg < 0.5 && summary.targetFps > 0 &&
      summary.renderedFpsAvg < summary.targetFps * 0.9;
    if (decoderLimited) {
      next.decoderLimited[resolutionKey(summary.width, summary.height, summary.targetFps)] = true;
      verdict = verdict === 'clean' ? 'decoder-limited' : verdict;
    }

    next.sessions = (next.sessions || 0) + 1;
    next.lastScore = summary.score;
    next.lastBitrateKbps = bitrate;
    next.updatedAt = now;
    return { profile: next, verdict: verdict };
  }

  // Remember a bitrate the network could not sustain, such as the one an adaptive reconnect left
  function recordPoorBitrate(profile, bitrateKbps, context) {
    context = context || {};
    var next = JSON.parse(JSON.stringify(profile || {}));
    if (context.networkType && next.networkType && next.networkType !== context.networkType) {
      delete next.knownGoodKbps;
      delete next.knownBadKbps;
    }
    next.networkType = context.networkType || next.networkType || 'unknown';
    next.knownBadKbps = next.knownBadKbps ? Math.min(next.knownBadKbps, bitrateKbps) : bitrateKbps;
    if (next.knownGoodKbps && next.knownGoodKbps >= bitrateKbps) {
      next.knownGoodKbps = roundBitrate(bitrateKbps * 0.7);
    }
    next.updatedAt = context.now || Date.now();
    return next;
  }

  // Remember a codec the TV failed to decode, so Auto-Tune stops choosing it for the host
  function recordCodecFailure(profile, codec, now) {
    var next = JSON.parse(JSON.stringify(profile || {}));
    next.failedCodecs = next.failedCodecs || {};
    next.failedCodecs[codec] = true;
    next.updatedAt = now || Date.now();
    return next;
  }

  // Bitrate for an adaptive reconnect after a poor stretch of the stream, or 0 when it should not
  // reconnect. Reconnects when most of the last samples lost frames or had a poor connection.
  function adaptiveReconnectBitrate(recentSamples, currentBitrate, state) {
    state = state || {};
    var WINDOW = 10;
    if (!recentSamples || recentSamples.length < WINDOW) {
      return 0;
    }
    if ((state.reconnects || 0) >= 2 || (state.sessionSeconds || 0) < 15) {
      return 0;
    }
    if (state.lastReconnectAt && (state.now || Date.now()) - state.lastReconnectAt < 60000) {
      return 0;
    }
    var window = recentSamples.slice(-WINDOW);
    var poor = window.filter(function(sample) {
      return sample.poor || sample.loss >= 5;
    }).length;
    if (poor < 7 || currentBitrate <= MIN_BITRATE * 1.5) {
      return 0;
    }
    return clamp(roundBitrate(currentBitrate * 0.6), MIN_BITRATE, MAX_BITRATE);
  }

  // Round trip statistics of a series of probe times, in milliseconds
  function summarizeProbe(times, failures) {
    var valid = times.filter(function(time) { return isFinite(time) && time >= 0; });
    // The first request also pays for the connection setup, so leave it out when there are more
    if (valid.length > 3) {
      valid = valid.slice(1);
    }
    if (valid.length === 0) {
      return { rttMedian: 0, rttJitter: 0, loss: failures > 0 ? 1 : 0, samples: 0 };
    }
    var sorted = valid.slice().sort(function(a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var deviation = valid.reduce(function(sum, time) { return sum + Math.abs(time - median); }, 0) / valid.length;
    return {
      rttMedian: Math.round(median * 10) / 10,
      rttJitter: Math.round(deviation * 10) / 10,
      loss: failures / (valid.length + failures),
      samples: valid.length,
    };
  }

  return {
    SCM: SCM,
    RESOLUTIONS: RESOLUTIONS,
    NETWORK_BITRATE_CAPS: NETWORK_BITRATE_CAPS,
    classifyNetwork: classifyNetwork,
    targetBitrate: targetBitrate,
    bitrateCap: bitrateCap,
    recommend: recommend,
    learnFromSession: learnFromSession,
    recordPoorBitrate: recordPoorBitrate,
    recordCodecFailure: recordCodecFailure,
    adaptiveReconnectBitrate: adaptiveReconnectBitrate,
    summarizeProbe: summarizeProbe,
    hostSupports: hostSupports,
    deviceDecodes: deviceDecodes,
  };
});
