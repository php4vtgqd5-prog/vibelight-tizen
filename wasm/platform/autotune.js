// Auto-Tune: gathers the capabilities of the TV, the host and the network, asks autotune-core.js
// for the settings of each stream, and learns from the statistics of every session.
//
// - When a stream starts with Auto-Tune enabled, the resolution, frame rate, bitrate and codec are
//   chosen for the host being streamed, instead of the values of the Basic and Video settings.
// - When a session ends, its statistics teach Auto-Tune the bitrate the network sustains.
// - With adaptive reconnect, a stream that stays poor is reconnected with a lower bitrate.
// - When the TV cannot open the decoder Auto-Tune chose, the stream restarts with another codec.

var AUTOTUNE_PROFILES_KEY = 'autoTuneProfiles';

// Network probes are reused for a few minutes, so starting streams back to back stays fast
var AUTOTUNE_PROBE_CACHE_MS = 3 * 60 * 1000;
var AUTOTUNE_PROBE_REQUESTS = 7;
var AUTOTUNE_PROBE_TIMEOUT_MS = 800;
var AUTOTUNE_PROBE_BUDGET_MS = 2000;
// Path the probes request from the HTTP server of the host, which it answers at once with a 404.
// Its /serverinfo also gathers the state of the host, such as the MAC address of its network
// adapter, which takes Sunshine on Windows up to about a hundred milliseconds: measured on it, a
// network with a round trip of a few milliseconds looked slow and got the bitrate of a weak one.
var AUTOTUNE_PROBE_PATH = '/vibelight-probe';
// Path requested instead by hosts that do not answer the probe path
var AUTOTUNE_PROBE_FALLBACK_PATH = '/serverinfo';

var AutoTune = (function() {
  var profiles = {};
  var probeCache = {};
  var decoders = null;
  var reconnectState = null;

  function isChecked(switchId) {
    return $('#' + switchId).parent().hasClass('is-checked');
  }

  function isEnabled() {
    return isChecked('autoTuneSwitch');
  }

  function goal() {
    return $('#selectAutoTuneGoal').data('value') || 'balanced';
  }

  // Codecs the decoder of the TV supports. Every TV this application runs on decodes H.264 and
  // HEVC, so only the 10-bit and AV1 profiles are checked through the media source extensions.
  function detectDecoders() {
    if (decoders) {
      return decoders;
    }
    var mediaSource = window.MediaSource;
    var check = function(types) {
      if (!mediaSource || typeof mediaSource.isTypeSupported !== 'function') {
        return null;
      }
      try {
        return types.some(function(type) { return mediaSource.isTypeSupported(type); });
      } catch (error) {
        return null;
      }
    };
    var hevc10 = check(['video/mp4; codecs="hev1.2.4.L153.B0"', 'video/mp4; codecs="hvc1.2.4.L153.B0"']);
    var av1 = check(['video/mp4; codecs="av01.0.13M.08"', 'video/mp4; codecs="av01.0.12M.08"']);
    var av110 = check(['video/mp4; codecs="av01.0.13M.10"', 'video/mp4; codecs="av01.0.12M.10"']);
    decoders = {
      h264: true,
      hevc: true,
      // An HDR TV plays HDR10, which is HEVC Main 10, even when the check is inconclusive
      hevc10: hevc10 === null ? !!isHdrCapable : (hevc10 || !!isHdrCapable),
      av1: !!av1,
      av110: !!av110,
    };
    return decoders;
  }

  function deviceCapabilities() {
    return {
      maxWidth: maxSupportedWidth,
      maxHeight: maxSupportedHeight,
      hdr: !!isHdrCapable,
      decoders: detectDecoders(),
      highFrameRate: isChecked('unlockAllFpsSwitch'),
      platform: parseFloat(platformVer) || 0,
    };
  }

  // Connection type of the TV and the strength of its Wi-Fi signal
  function networkInfo() {
    return new Promise(function(resolve) {
      var info = { type: 'unknown', wifiSignal: null };
      try {
        var type = webapis.network.getActiveConnectionType();
        info.type = type === 3 ? 'ethernet' : (type === 1 ? 'wifi' : 'unknown');
      } catch (error) {
        console.warn('%c[autotune.js, networkInfo]', 'color: purple;', 'Unable to read the connection type: ' + error);
      }
      if (info.type !== 'wifi' || typeof tizen === 'undefined' || !tizen.systeminfo) {
        resolve(info);
        return;
      }
      var settled = false;
      var finish = function() {
        if (!settled) {
          settled = true;
          resolve(info);
        }
      };
      setTimeout(finish, 500);
      try {
        tizen.systeminfo.getPropertyValue('WIFI_NETWORK', function(wifi) {
          if (wifi && typeof wifi.signalStrength === 'number') {
            info.wifiSignal = wifi.signalStrength;
          }
          finish();
        }, finish);
      } catch (error) {
        finish();
      }
    });
  }

  // Measure the round trip time to the HTTP server of the host, which answers from the local
  // network in a few milliseconds when the path to it is healthy
  function probeHost(host) {
    var cached = probeCache[host.serverUid];
    if (cached && Date.now() - cached.at < AUTOTUNE_PROBE_CACHE_MS) {
      return Promise.resolve(cached.probe);
    }
    var base = 'http://' + formatAddressForUrl(host.address) + ':' + (host.httpPort || 47989);
    var url = base + AUTOTUNE_PROBE_PATH;
    var times = [];
    var failures = 0;
    var startedAt = Date.now();
    var now = function() {
      return window.performance && performance.now ? performance.now() : Date.now();
    };

    var probeOnce = function() {
      var abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function() {
        if (abortController) {
          abortController.abort();
        }
      }, AUTOTUNE_PROBE_TIMEOUT_MS);
      var begin = now();
      return fetch(url + '?probe=' + Date.now(), abortController ? { signal: abortController.signal, cache: 'no-store' } : { cache: 'no-store' })
        .then(function() {
          times.push(now() - begin);
        }, function() {
          if (times.length === 0 && url !== base + AUTOTUNE_PROBE_FALLBACK_PATH) {
            // A host that does not answer the probe path is measured with the slower /serverinfo,
            // and this request tells nothing about the network
            url = base + AUTOTUNE_PROBE_FALLBACK_PATH;
            return;
          }
          failures++;
        })
        .then(function() {
          clearTimeout(timer);
        });
    };

    var run = function(remaining) {
      if (remaining === 0 || Date.now() - startedAt > AUTOTUNE_PROBE_BUDGET_MS) {
        return Promise.resolve();
      }
      return probeOnce().then(function() {
        return run(remaining - 1);
      });
    };

    return run(AUTOTUNE_PROBE_REQUESTS).then(function() {
      var probe = AutoTuneCore.summarizeProbe(times, failures);
      probeCache[host.serverUid] = { at: Date.now(), probe: probe };
      console.log('%c[autotune.js, probeHost]', 'color: purple;', 'Probe of ' + host.hostname + ': ' + JSON.stringify(probe));
      return probe;
    });
  }

  // Recommend the settings of a stream to the given host
  function recommendFor(host) {
    return Promise.all([networkInfo(), probeHost(host)]).then(function(results) {
      var network = results[0];
      network.probe = results[1];
      var recommendation = AutoTuneCore.recommend({
        device: deviceCapabilities(),
        host: { codecSupport: host.serverCodecModeSupport },
        network: network,
        profile: profiles[host.serverUid] || null,
        goal: goal(),
        hdr: isChecked('hdrModeSwitch'),
        now: Date.now(),
      });
      recommendation.network = network;
      console.log('%c[autotune.js, recommendFor]', 'color: purple;', 'Recommendation for ' + host.hostname + ': ' + JSON.stringify(recommendation));
      return recommendation;
    });
  }

  function applyToConfig(config, recommendation) {
    config.width = recommendation.width;
    config.height = recommendation.height;
    config.fps = recommendation.fps;
    config.bitrate = recommendation.bitrate;
    config.videoCodec = recommendation.codec;
    config.hdrMode = recommendation.hdr ? 1 : 0;
    config.autoTuned = true;
    config.autoTune = {
      networkClass: recommendation.networkClass,
      networkType: recommendation.network ? recommendation.network.type : 'unknown',
      bitrateCap: recommendation.bitrateCap,
      goal: recommendation.goal,
    };
    return config;
  }

  function saveProfiles() {
    storeData(AUTOTUNE_PROFILES_KEY, profiles, null);
  }

  // Learn from a finished session and describe what changes for the next one
  function learn(summary, config) {
    if (!summary || !summary.hostUid || !isChecked('autoTuneLearnSwitch')) {
      return null;
    }
    var networkType = config && config.autoTune ? config.autoTune.networkType : null;
    var learned = AutoTuneCore.learnFromSession(profiles[summary.hostUid], summary, {
      now: Date.now(),
      networkType: networkType,
    });
    profiles[summary.hostUid] = learned.profile;
    saveProfiles();

    var networkClass = config && config.autoTune ? config.autoTune.networkClass : 'fair';
    var nextCap = AutoTuneCore.bitrateCap(networkClass, learned.profile) / 1000;
    switch (learned.verdict) {
      case 'bad':
        return t('Auto-Tune lowered the bitrate for %1$s to about %2$s Mbps for the next session.', summary.hostName, Math.round(nextCap));
      case 'mixed':
        return t('The connection had a few hiccups. Auto-Tune will stay at or below %1$s Mbps with %2$s.', Math.round(nextCap), summary.hostName);
      case 'decoder-limited':
        return t('Your TV could not render every frame at %1$s. Auto-Tune will choose a lighter mode next time.', summary.width + '×' + summary.height + ' ' + summary.targetFps + ' FPS');
      case 'clean':
        return summary.autoTuned
          ? t('The connection was stable. Auto-Tune will allow up to %1$s Mbps with %2$s.', Math.round(nextCap), summary.hostName)
          : t('The connection was stable at %1$s Mbps.', summary.requestedBitrate);
      default:
        return null;
    }
  }

  function resetProfiles() {
    profiles = {};
    probeCache = {};
    saveProfiles();
  }

  function load() {
    getData(AUTOTUNE_PROFILES_KEY, function(stored) {
      profiles = stored[AUTOTUNE_PROFILES_KEY] || {};
    });
  }

  function recordPoorBitrate(hostUid, bitrateKbps, networkType) {
    if (!hostUid || !isChecked('autoTuneLearnSwitch')) {
      return;
    }
    profiles[hostUid] = AutoTuneCore.recordPoorBitrate(profiles[hostUid], bitrateKbps, { now: Date.now(), networkType: networkType });
    saveProfiles();
  }

  function recordCodecFailure(hostUid, codec) {
    if (!hostUid || !codec) {
      return;
    }
    profiles[hostUid] = AutoTuneCore.recordCodecFailure(profiles[hostUid], codec, Date.now());
    saveProfiles();
  }

  // A reconnect started by Auto-Tune carries its count over to the stream that replaces the old
  // one, so a network that stays poor cannot trigger a reconnect loop
  function beginSession() {
    var carry = reconnectState && reconnectState.carryOver;
    reconnectState = {
      reconnects: carry ? reconnectState.reconnects : 0,
      lastReconnectAt: carry ? reconnectState.lastReconnectAt : 0,
      carryOver: false,
    };
  }

  // Bitrate to reconnect with after a poor stretch of the stream, or 0 to keep streaming
  function adaptiveReconnectBitrate(session, config) {
    if (!session || !config || !isEnabled() || !isChecked('adaptiveReconnectSwitch')) {
      return 0;
    }
    var state = reconnectState || { reconnects: 0 };
    return AutoTuneCore.adaptiveReconnectBitrate(session.history, config.bitrate, {
      reconnects: state.reconnects,
      lastReconnectAt: state.lastReconnectAt,
      sessionSeconds: session.last ? session.last.t : 0,
      now: Date.now(),
    });
  }

  function noteReconnect() {
    reconnectState = reconnectState || { reconnects: 0 };
    reconnectState.reconnects++;
    reconnectState.lastReconnectAt = Date.now();
    // The count carries over to the stream that replaces this one
    reconnectState.carryOver = true;
  }

  function endReconnectSequence() {
    reconnectState = null;
  }

  return {
    isEnabled: isEnabled,
    goal: goal,
    deviceCapabilities: deviceCapabilities,
    networkInfo: networkInfo,
    probeHost: probeHost,
    recommendFor: recommendFor,
    applyToConfig: applyToConfig,
    learn: learn,
    load: load,
    resetProfiles: resetProfiles,
    recordPoorBitrate: recordPoorBitrate,
    recordCodecFailure: recordCodecFailure,
    beginSession: beginSession,
    adaptiveReconnectBitrate: adaptiveReconnectBitrate,
    noteReconnect: noteReconnect,
    endReconnectSequence: endReconnectSequence,
    profileFor: function(hostUid) { return profiles[hostUid] || null; },
  };
})();

// Resolve the configuration of a stream: the settings of the user, or the choice of Auto-Tune
function prepareStreamConfig(host, overrides) {
  var config = buildStreamConfig();
  var applyOverrides = function() {
    if (overrides && overrides.bitrate) {
      config.bitrate = Math.min(config.bitrate, overrides.bitrate);
    }
    if (overrides && overrides.videoCodec) {
      config.videoCodec = overrides.videoCodec;
    }
    // The latency mode, Low or Ultra Low (Game Mode)
    GameMode.applyToConfig(config, overrides);
    return config;
  };
  if (!AutoTune.isEnabled()) {
    return Promise.resolve(applyOverrides());
  }
  return AutoTune.recommendFor(host).then(function(recommendation) {
    AutoTune.applyToConfig(config, recommendation);
    return applyOverrides();
  }, function(error) {
    console.warn('%c[autotune.js, prepareStreamConfig]', 'color: purple;', 'Auto-Tune failed, using the settings instead: ' + error);
    return applyOverrides();
  });
}

function codecLabel(codec) {
  return codec === 'H264' ? 'H.264' : codec;
}

// Short description of a stream configuration, shown while the stream starts
function describeStreamConfig(config) {
  return config.width + '×' + config.height + ' · ' + config.fps + ' FPS · ' + codecLabel(config.videoCodec) +
    (config.hdrMode ? ' HDR' : '') + ' · ' + (Math.round(config.bitrate / 100) / 10) + ' Mbps' +
    (config.gameMode ? ' · ' + t('Game Mode') : '');
}

// Hooks called by stats.js ----------------------------------------------------------------------

// A stream that should be started again once the current one has ended, see messages.js
var pendingStreamRestart = null;

function onStreamStatsSample(sample, session) {
  if (pendingStreamRestart || !currentStreamConfig || !api) {
    return;
  }
  var bitrate = AutoTune.adaptiveReconnectBitrate(session, currentStreamConfig);
  if (bitrate > 0) {
    AutoTune.noteReconnect();
    // The next streams with this host start below the bitrate that struggled
    AutoTune.recordPoorBitrate(api.serverUid, currentStreamConfig.bitrate,
      currentStreamConfig.autoTune ? currentStreamConfig.autoTune.networkType : null);
    pendingStreamRestart = {
      host: api,
      appId: currentStreamConfig.appId,
      overrides: { bitrate: bitrate },
      message: t('Auto-Tune: the connection is poor, reconnecting with a lower bitrate...'),
    };
    console.warn('%c[autotune.js, onStreamStatsSample]', 'color: purple;', 'Adaptive reconnect at ' + bitrate + ' Kbps at most');
    // The restart asks Auto-Tune again, which may also lower the resolution: the loading screen shows the result
    snackbarLogLong('Auto-Tune: the connection is poor, reconnecting with a lower bitrate...');
    // Keep the audio output of the Web Audio backend, as a new one could not start without a key press
    _audPreserveContext = true;
    sendMessage('stopRequest', []);
  }
}

function onStreamSessionFinished(summary) {
  var config = currentStreamConfig;
  var note = AutoTune.learn(summary, config);
  if (note) {
    summary.autoTuneNote = note;
  }
}

// The TV could not open the decoder of an automatically chosen codec: remember it and start again
function handleAutoTuneDecoderFailure(detail) {
  var config = currentStreamConfig;
  if (!config || !config.autoTuned || !api || detail.indexOf('video:') !== 0 || pendingStreamRestart) {
    return false;
  }
  AutoTune.recordCodecFailure(api.serverUid, config.videoCodec);
  if (config.videoCodec === 'H264') {
    // There is nothing left to fall back to
    return false;
  }
  pendingStreamRestart = {
    host: api,
    appId: config.appId,
    overrides: null,
    message: t('Auto-Tune: your TV cannot decode %1$s, switching to another codec...', codecLabel(config.videoCodec)),
  };
  snackbarLogLong('Auto-Tune: your TV cannot decode %1$s, switching to another codec...', codecLabel(config.videoCodec));
  return true;
}

// Settings --------------------------------------------------------------------------------------

function saveAutoTuneSwitch(switchId, storageKey, onChange) {
  return function() {
    setTimeout(() => {
      const value = $('#' + switchId).parent().hasClass('is-checked');
      console.log('%c[autotune.js, saveAutoTuneSwitch]', 'color: purple;', 'Saving ' + storageKey + ' state: ' + value);
      storeData(storageKey, value, null);
      if (onChange) {
        onChange(value);
      }
    }, 100);
  };
}

// Show whether the stream settings are managed by Auto-Tune
function updateAutoTuneIndicators() {
  var enabled = AutoTune.isEnabled();
  $('.autotune-notice').css('display', enabled ? 'flex' : 'none');
  $('#autoTuneGoalOption, #autoTuneLearnOption, #adaptiveReconnectOption').toggleClass('setting-option-dimmed', !enabled);
}

function loadAutoTuneSettings() {
  var loadSwitch = function(key, buttonId, fallback, callback) {
    getData(key, function(stored) {
      var value = stored[key] == null ? fallback : !!stored[key];
      var toggle = document.querySelector('#' + buttonId).MaterialSwitch;
      if (value) {
        toggle.on();
      } else {
        toggle.off();
      }
      if (callback) {
        callback();
      }
    });
  };
  loadSwitch('autoTune', 'autoTuneBtn', true, updateAutoTuneIndicators);
  loadSwitch('autoTuneLearn', 'autoTuneLearnBtn', true);
  loadSwitch('adaptiveReconnect', 'adaptiveReconnectBtn', true);
  getData('autoTuneGoal', function(stored) {
    setSelectMenuValue('selectAutoTuneGoal', 'autoTuneGoalMenu', stored.autoTuneGoal || 'balanced');
  });
  AutoTune.load();
}

function restoreAutoTuneDefaults() {
  document.querySelector('#autoTuneBtn').MaterialSwitch.on();
  storeData('autoTune', true, null);
  document.querySelector('#autoTuneLearnBtn').MaterialSwitch.on();
  storeData('autoTuneLearn', true, null);
  document.querySelector('#adaptiveReconnectBtn').MaterialSwitch.on();
  storeData('adaptiveReconnect', true, null);
  setSelectMenuValue('selectAutoTuneGoal', 'autoTuneGoalMenu', 'balanced');
  storeData('autoTuneGoal', 'balanced', null);
  updateAutoTuneIndicators();
}

function attachAutoTuneListeners() {
  $('#autoTuneSwitch').on('click', saveAutoTuneSwitch('autoTuneSwitch', 'autoTune', function(enabled) {
    updateAutoTuneIndicators();
    if (enabled) {
      snackbarLog('Auto-Tune will choose the stream settings for each host.');
    } else {
      snackbarLog('The stream settings of the Basic and Video settings will be used.');
    }
  }));
  $('#autoTuneLearnSwitch').on('click', saveAutoTuneSwitch('autoTuneLearnSwitch', 'autoTuneLearn'));
  $('#adaptiveReconnectSwitch').on('click', saveAutoTuneSwitch('adaptiveReconnectSwitch', 'adaptiveReconnect'));
  $('.autoTuneGoalMenu li').on('click', function() {
    var value = $(this).data('value');
    setSelectMenuValue('selectAutoTuneGoal', 'autoTuneGoalMenu', value);
    storeData('autoTuneGoal', value, null);
  });
  $('#runAutoTuneBtn').on('click', autoTuneDialog);
  $('#resetAutoTuneBtn').on('click', function() {
    AutoTune.resetProfiles();
    snackbarLog('Auto-Tune forgot what it learned about your hosts.');
  });
}

// Test my setup dialog --------------------------------------------------------------------------

function autoTuneReasonText(reason) {
  switch (reason.key) {
    case 'network':
      return t('Network quality: %1$s', networkClassLabel(reason.params[0]));
    case 'codec':
      return t('Codec supported by the TV and the host: %1$s', codecLabel(reason.params[0]));
    case 'hdr-on':
      return t('HDR is enabled, the TV and the host support 10-bit video.');
    case 'hdr-unsupported':
      return t('HDR is off, as the TV, the host or the codec does not support 10-bit video.');
    case 'learned':
      return t('Bitrate limit learned from your sessions: %1$s Mbps', reason.params[0]);
    case 'resolution-limited':
      return t('The resolution is lowered to %1$s to fit the bandwidth of the network.', reason.params[0]);
    default:
      return '';
  }
}

function networkClassLabel(networkClass) {
  switch (networkClass) {
    case 'excellent':
      return t('Excellent');
    case 'good':
      return t('Good');
    case 'fair':
      return t('Fair');
    default:
      return t('Poor');
  }
}

function yesNo(value) {
  return value ? t('Yes') : t('No');
}

function autoTuneRow(label, value) {
  return '<div class="autotune-row"><span class="autotune-label">' + escapeHtml(label) + '</span>' +
    '<span class="autotune-value">' + escapeHtml(value) + '</span></div>';
}

function renderAutoTuneDevice(device, network) {
  var decoderList = [
    'H.264 ' + (device.decoders.h264 ? '✓' : '✗'),
    'HEVC ' + (device.decoders.hevc ? '✓' : '✗'),
    'HEVC 10-bit ' + (device.decoders.hevc10 ? '✓' : '✗'),
    'AV1 ' + (device.decoders.av1 ? '✓' : '✗'),
  ].join('   ');
  var panel = device.maxWidth >= 7680 ? '8K' : (device.maxWidth >= 3840 ? '4K' : (device.maxWidth >= 2560 ? '1440p' : '1080p'));
  var connection = network.type === 'ethernet' ? t('Ethernet')
    : (network.type === 'wifi' ? t('Wi-Fi') + (network.wifiSignal != null ? ' (' + t('signal %1$s%', Math.round(network.wifiSignal * 100)) + ')' : '') : t('Unknown'));
  return '<div class="autotune-section"><div class="autotune-section-title"><i class="material-icons">tv</i>' + escapeHtml(t('Your TV')) + '</div>' +
    autoTuneRow(t('Model'), (modelName || modelSeries || t('Unknown')) + ' · Tizen ' + (platformVer || '?')) +
    autoTuneRow(t('Panel'), panel + ' · HDR: ' + yesNo(device.hdr)) +
    autoTuneRow(t('Video decoders'), decoderList) +
    autoTuneRow(t('Connection'), connection) +
    '</div>';
}

function renderAutoTuneHost(host, recommendation, error) {
  var html = '<div class="autotune-section"><div class="autotune-section-title"><i class="material-icons">computer</i>' + escapeHtml(host.hostname) + '</div>';
  if (error) {
    return html + '<p class="autotune-error">' + escapeHtml(t('The host could not be measured: %1$s', error)) + '</p></div>';
  }
  if (!recommendation) {
    return html + '<p class="autotune-pending">' + escapeHtml(t('Measuring the connection to the host...')) + '</p></div>';
  }
  var probe = recommendation.network && recommendation.network.probe;
  html += autoTuneRow(t('Latency to the host'), probe && probe.samples > 0
    ? probe.rttMedian + ' ms ± ' + probe.rttJitter + ' ms'
    : t('N/A'));
  html += '<div class="autotune-recommendation">' + escapeHtml(describeStreamConfig({
    width: recommendation.width, height: recommendation.height, fps: recommendation.fps,
    videoCodec: recommendation.codec, hdrMode: recommendation.hdr, bitrate: recommendation.bitrate,
  })) + '</div><ul class="autotune-reasons">';
  recommendation.reasons.forEach(function(reason) {
    var text = autoTuneReasonText(reason);
    if (text) {
      html += '<li>' + escapeHtml(text) + '</li>';
    }
  });
  return html + '</ul></div>';
}

function applyRecommendationToSettings(recommendation) {
  // Codec and HDR first, as changing them may recalculate the bitrate preset
  var codecItem = $('.videoCodecMenu li[data-value="' + recommendation.codec + '"]');
  if (codecItem.length) {
    updateVideoCodec(codecItem[0], recommendation.codec);
  }
  var hdrToggle = document.querySelector('#hdrModeBtn').MaterialSwitch;
  if (recommendation.hdr) {
    hdrToggle.on();
  } else {
    hdrToggle.off();
  }
  updateHdrMode();

  var resolution = recommendation.width + ':' + recommendation.height;
  var resolutionItem = $('.videoResolutionMenu li[data-value="' + resolution + '"]');
  if (resolutionItem.length) {
    $('#selectResolution').text(resolutionItem.text()).attr('data-value', resolution).data('value', resolution);
    storeData('resolution', resolution, null);
  }
  var framerateItem = $('.videoFramerateMenu li[data-value="' + recommendation.fps + '"]');
  if (framerateItem.length) {
    $('#selectFramerate').text(framerateItem.text()).attr('data-value', String(recommendation.fps)).data('value', String(recommendation.fps));
    storeData('frameRate', String(recommendation.fps), null);
  }
  // The bitrate goes last, after the delayed HDR update that may apply a bitrate preset
  setTimeout(function() {
    $('#bitrateSlider')[0].MaterialSlider.change(String(recommendation.bitrate / 1000));
    saveBitrate();
  }, 300);
}

function autoTuneDialog() {
  var overlay = document.querySelector('#autoTuneDialogOverlay');
  var dialog = document.querySelector('#autoTuneDialog');
  var content = document.getElementById('autoTuneContent');
  var device = AutoTune.deviceCapabilities();
  var candidates = Object.keys(hosts).map(function(uid) { return hosts[uid]; })
    .filter(function(host) { return host.online && host.paired; }).slice(0, 3);
  var results = {};
  var firstRecommendation = null;
  var network = { type: 'unknown' };

  var render = function() {
    var html = renderAutoTuneDevice(device, network);
    if (candidates.length === 0) {
      html += '<p class="autotune-pending">' + escapeHtml(t('Pair and wake a host to get a recommendation for it.')) + '</p>';
    }
    candidates.forEach(function(host) {
      var result = results[host.serverUid] || {};
      html += renderAutoTuneHost(host, result.recommendation, result.error);
    });
    content.innerHTML = html;
    $('#applyAutoTune').prop('disabled', !firstRecommendation);
  };

  overlay.style.display = 'flex';
  dialog.showModal();
  isDialogOpen = true;
  Navigation.push(Views.AutoTuneDialog);
  render();

  AutoTune.networkInfo().then(function(info) {
    network = info;
    render();
  });
  candidates.forEach(function(host) {
    AutoTune.recommendFor(host).then(function(recommendation) {
      results[host.serverUid] = { recommendation: recommendation };
      firstRecommendation = firstRecommendation || recommendation;
      network = recommendation.network || network;
      render();
    }, function(error) {
      results[host.serverUid] = { error: String(error) };
      render();
    });
  });

  var close = function() {
    overlay.style.display = 'none';
    dialog.close();
    isDialogOpen = false;
    Navigation.pop();
    Navigation.switch();
  };
  $('#closeAutoTune').off('click').on('click', close);
  $('#applyAutoTune').off('click').on('click', function() {
    if (!firstRecommendation) {
      return;
    }
    applyRecommendationToSettings(firstRecommendation);
    snackbarLog('The recommended settings were applied to the Basic and Video settings.');
    close();
  });
}
