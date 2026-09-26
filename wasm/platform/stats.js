// Stream statistics: on-screen overlay, session summary and session history.
//
// The numbers come from the StatsJson messages of the WASM module, which stats-core.js turns into
// samples and session summaries. This file owns the parts shown to the user:
//
// - The statistics overlay, in one of four modes (off, compact, standard and detailed) and in one
//   of the four corners of the screen. The YELLOW key and the stats shortcuts cycle the modes.
// - The session summary, shown after a stream ends, with a quality score for the session.
// - The session history, which keeps the summaries of the last sessions.

var STATS_OVERLAY_MODES = ['off', 'compact', 'standard', 'detailed'];
var STATS_OVERLAY_POSITIONS = ['tl', 'tr', 'bl', 'br'];
var SESSION_HISTORY_KEY = 'sessionHistory';
var SESSION_HISTORY_LIMIT = 30;

// Time without statistics after which the overlay reports that the video stalled, in milliseconds
var STATS_STALE_AFTER_MS = 3000;

var StatsOverlay = (function() {
  var mode = 'off';
  var position = 'tl';
  var builtMode = null;
  var staleTimer = null;
  var lastSampleAt = 0;

  function element() {
    return document.getElementById('performance-stats');
  }

  function formatNumber(value, digits) {
    return isFinite(value) ? Number(value).toFixed(digits) : '-';
  }

  // Color class of a value, from the thresholds at which it becomes noticeable and a problem
  function level(value, warnAt, badAt, lowerIsWorse) {
    if (!isFinite(value)) {
      return '';
    }
    if (lowerIsWorse) {
      return value <= badAt ? 'v-bad' : (value <= warnAt ? 'v-warn' : 'v-good');
    }
    return value >= badAt ? 'v-bad' : (value >= warnAt ? 'v-warn' : 'v-good');
  }

  function row(label, field) {
    return '<div class="stats-row"><span class="stats-label">' + label + '</span>' +
      '<span class="stats-value" data-field="' + field + '">-</span></div>';
  }

  function graph(label, field) {
    return '<div class="stats-graph"><div class="stats-graph-label"><span>' + label + '</span>' +
      '<span class="stats-graph-value" data-graph-value="' + field + '">-</span></div>' +
      '<canvas width="300" height="46" data-graph="' + field + '"></canvas></div>';
  }

  // Build the structure of the overlay for a mode once, the samples then only update the values
  function build(target) {
    builtMode = mode;
    if (mode === 'compact') {
      target.innerHTML = '<div class="stats-pill"><span class="stats-dot" data-field="health"></span>' +
        '<span data-field="compact">' + escapeHtml(t('Waiting for video...')) + '</span></div>';
      return;
    }
    var html = '<div class="stats-card">' +
      '<div class="stats-header"><span class="stats-dot" data-field="health"></span>' +
      '<span data-field="title">' + escapeHtml(t('Waiting for video...')) + '</span></div>' +
      row(escapeHtml(t('Frame rate')), 'fps') +
      row(escapeHtml(t('Bitrate')), 'bitrate') +
      row(escapeHtml(t('Network latency')), 'rtt') +
      row(escapeHtml(t('Host latency')), 'host') +
      row(escapeHtml(t('Decoder queue')), 'queue') +
      row(escapeHtml(t('Frame loss')), 'loss');
    if (mode === 'detailed') {
      html += row(escapeHtml(t('Frames received')), 'received') +
        row(escapeHtml(t('Frames rejected by decoder')), 'fail') +
        row(escapeHtml(t('Frame reassembly')), 'reasm') +
        row(escapeHtml(t('Frame pacing delay')), 'pace') +
        row(escapeHtml(t('Decoder submit time')), 'sub') +
        row(escapeHtml(t('Key frames')), 'idr') +
        row(escapeHtml(t('Audio drops / errors')), 'audio') +
        row(escapeHtml(t('Latency mode')), 'latency') +
        row(escapeHtml(t('Session time')), 'time') +
        graph(escapeHtml(t('Frame rate')), 'ren') +
        graph(escapeHtml(t('Bitrate')), 'mbps') +
        graph(escapeHtml(t('Network latency')), 'rtt');
    }
    html += '<div class="stats-stale" data-field="stale">' + escapeHtml(t('No video received for a few seconds...')) + '</div>';
    html += '</div>';
    target.innerHTML = html;
  }

  function setField(target, field, text, className) {
    var node = target.querySelector('[data-field="' + field + '"]');
    if (!node) {
      return;
    }
    node.textContent = text;
    if (className !== undefined) {
      node.className = 'stats-value ' + className;
    }
  }

  function drawGraph(canvas, values, color, fixedMax) {
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    context.clearRect(0, 0, width, height);
    if (values.length < 2) {
      return;
    }
    var max = fixedMax || Math.max.apply(null, values) * 1.2 || 1;
    // Stretch the first samples over the graph, then scroll once it holds a minute of samples
    var step = width / (Math.max(values.length, 60) - 1);
    var offset = width - (values.length - 1) * step;
    context.beginPath();
    for (var i = 0; i < values.length; i++) {
      var x = offset + i * step;
      var y = height - 2 - Math.min(1, values[i] / max) * (height - 4);
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.lineTo(width, height);
    context.lineTo(offset, height);
    context.closePath();
    context.globalAlpha = 0.18;
    context.fillStyle = color;
    context.fill();
    context.globalAlpha = 1;
  }

  function update(session) {
    var target = element();
    var sample = session ? session.last : null;
    if (!target || mode === 'off') {
      return;
    }
    if (builtMode !== mode) {
      build(target);
    }
    if (!sample) {
      return;
    }
    lastSampleAt = Date.now();

    var health = StreamStats.sampleHealth(sample);
    var healthNode = target.querySelector('[data-field="health"]');
    if (healthNode) {
      healthNode.className = 'stats-dot stats-dot-' + health;
    }
    var staleNode = target.querySelector('[data-field="stale"]');
    if (staleNode) {
      staleNode.style.display = 'none';
    }

    var latency = sample.rtt > 0 ? formatNumber(sample.rtt, 0) + ' ms' : t('N/A');
    if (mode === 'compact') {
      setField(target, 'compact', formatNumber(sample.ren, 0) + ' FPS  ·  ' + latency + '  ·  ' +
        formatNumber(sample.mbps, 1) + ' Mbps  ·  ' + formatNumber(sample.loss, 1) + '% ' + t('loss'));
      return;
    }

    setField(target, 'title', sample.w + '×' + sample.h + '  ·  ' + sample.fps + ' FPS  ·  ' + sample.codec + (sample.hdr ? ' HDR' : ''));
    setField(target, 'fps', formatNumber(sample.ren, 1) + ' / ' + sample.fps,
      level(sample.fps > 0 ? sample.ren / sample.fps : 1, 0.97, 0.85, true));
    setField(target, 'bitrate', formatNumber(sample.mbps, 1) + ' Mbps', '');
    setField(target, 'rtt', sample.rtt > 0 ? latency + ' ± ' + formatNumber(sample.rttv, 0) : t('N/A'),
      level(sample.rtt, 12, 30));
    setField(target, 'host', sample.host > 0 ? formatNumber(sample.host, 1) + ' ms' : t('N/A'), level(sample.host, 10, 20));
    setField(target, 'queue', formatNumber(sample.queue, 1) + ' ms', level(sample.queue, 4, 10));
    setField(target, 'loss', formatNumber(sample.loss, 2) + ' %', level(sample.loss, 0.5, 3));

    if (mode === 'detailed') {
      setField(target, 'received', formatNumber(sample.rx, 1) + ' FPS', '');
      setField(target, 'fail', formatNumber(sample.fail, 2) + ' %', level(sample.fail, 0.1, 1));
      setField(target, 'reasm', formatNumber(sample.reasm, 1) + ' ms', level(sample.reasm, 8, 16));
      setField(target, 'pace', formatNumber(sample.pace, 1) + ' ms', '');
      setField(target, 'sub', formatNumber(sample.sub, 1) + ' ms', level(sample.sub, 4, 10));
      setField(target, 'idr', String(sample.idr), sample.idr > 0 ? 'v-warn' : '');
      setField(target, 'audio', sample.aDrop + ' / ' + sample.aErr, sample.aDrop + sample.aErr > 0 ? 'v-warn' : '');
      setField(target, 'latency', sample.lat ? t('Ultra Low (Game Mode)') : t('Low'), sample.vErr > 0 ? 'v-warn' : '');
      setField(target, 'time', StreamStats.formatDuration(sample.t), '');

      var graphs = [
        { field: 'ren', color: '#7cf29c', max: Math.max(sample.fps, 1) * 1.1, unit: ' FPS', digits: 0 },
        { field: 'mbps', color: '#62d6ff', max: 0, unit: ' Mbps', digits: 1 },
        { field: 'rtt', color: '#ffb86b', max: 0, unit: ' ms', digits: 0 },
      ];
      graphs.forEach(function(entry) {
        var canvas = target.querySelector('canvas[data-graph="' + entry.field + '"]');
        var valueNode = target.querySelector('[data-graph-value="' + entry.field + '"]');
        if (canvas) {
          drawGraph(canvas, session.series(entry.field), entry.color, entry.max);
        }
        if (valueNode) {
          valueNode.textContent = formatNumber(sample[entry.field], entry.digits) + entry.unit;
        }
      });
    }
  }

  function checkStale() {
    var target = element();
    if (!target || mode === 'off' || !lastSampleAt) {
      return;
    }
    if (Date.now() - lastSampleAt > STATS_STALE_AFTER_MS) {
      var staleNode = target.querySelector('[data-field="stale"]');
      if (staleNode) {
        staleNode.style.display = 'block';
      }
      var healthNode = target.querySelector('[data-field="health"]');
      if (healthNode) {
        healthNode.className = 'stats-dot stats-dot-bad';
      }
    }
  }

  function applyClasses() {
    var target = element();
    if (!target) {
      return;
    }
    target.className = 'stats-overlay stats-pos-' + position + ' stats-mode-' + mode;
  }

  return {
    getMode: function() { return mode; },
    getPosition: function() { return position; },
    setMode: function(newMode) {
      mode = STATS_OVERLAY_MODES.indexOf(newMode) !== -1 ? newMode : 'off';
      builtMode = null;
      applyClasses();
      var target = element();
      if (target && mode === 'off') {
        target.innerHTML = '';
      }
    },
    setPosition: function(newPosition) {
      position = STATS_OVERLAY_POSITIONS.indexOf(newPosition) !== -1 ? newPosition : 'tl';
      applyClasses();
    },
    // Show the overlay for a new stream
    start: function() {
      builtMode = null;
      lastSampleAt = 0;
      applyClasses();
      var target = element();
      if (target) {
        target.innerHTML = '';
        target.style.display = mode === 'off' ? 'none' : 'block';
      }
      if (mode !== 'off') {
        build(target);
      }
      clearInterval(staleTimer);
      staleTimer = setInterval(checkStale, 1000);
    },
    stop: function() {
      clearInterval(staleTimer);
      staleTimer = null;
      var target = element();
      if (target) {
        target.style.display = 'none';
        target.innerHTML = '';
      }
      builtMode = null;
    },
    update: update,
    refresh: function(session) {
      var target = element();
      if (!target) {
        return;
      }
      builtMode = null;
      target.style.display = mode === 'off' ? 'none' : 'block';
      if (mode === 'off') {
        target.innerHTML = '';
        return;
      }
      build(target);
      update(session);
    },
  };
})();

// Collects the statistics of the running session and hands its summary over when it ends
var StreamSessionStats = (function() {
  var session = null;
  var connectedAt = 0;

  return {
    begin: function(meta) {
      session = new StreamStats.Session(meta);
      connectedAt = 0;
      StatsOverlay.start();
    },
    connected: function() {
      connectedAt = Date.now();
    },
    onSample: function(sample) {
      if (!session || !sample) {
        return;
      }
      session.add(sample);
      StatsOverlay.update(session);
      if (typeof onStreamStatsSample === 'function') {
        onStreamStatsSample(sample, session);
      }
      GameMode.onStatsSample(sample);
    },
    current: function() {
      return session;
    },
    // End the session and return its summary, or null when no stream was running
    end: function(errorCode) {
      StatsOverlay.stop();
      if (!session) {
        return null;
      }
      session.meta.endedAt = Date.now();
      var summary = session.summary();
      summary.errorCode = errorCode || 0;
      summary.connected = connectedAt > 0;
      session = null;
      return summary;
    },
  };
})();

// Cycle the statistics overlay through its modes, from the YELLOW key or the stats shortcuts
function cycleStatsOverlayMode() {
  var index = STATS_OVERLAY_MODES.indexOf(StatsOverlay.getMode());
  var next = STATS_OVERLAY_MODES[(index + 1) % STATS_OVERLAY_MODES.length];
  applyStatsOverlayMode(next, true);
  StatsOverlay.refresh(StreamSessionStats.current());
  snackbarLog('Statistics overlay: %1$s', statsOverlayModeLabel(next));
}

function statsOverlayModeLabel(mode) {
  switch (mode) {
    case 'compact':
      return t('Compact');
    case 'standard':
      return t('Standard');
    case 'detailed':
      return t('Detailed');
    default:
      return t('Off');
  }
}

// Apply an overlay mode to the overlay and to its setting, and optionally remember it
function applyStatsOverlayMode(mode, persist) {
  StatsOverlay.setMode(mode);
  setSelectMenuValue('selectStatsOverlay', 'statsOverlayMenu', StatsOverlay.getMode());
  if (persist) {
    storeData('statsOverlay', StatsOverlay.getMode(), null);
  }
}

function applyStatsOverlayPosition(position, persist) {
  StatsOverlay.setPosition(position);
  setSelectMenuValue('selectStatsPosition', 'statsPositionMenu', StatsOverlay.getPosition());
  if (persist) {
    storeData('statsPosition', StatsOverlay.getPosition(), null);
  }
}

function isSessionSummaryEnabled() {
  return $('#sessionSummarySwitch').prop('checked');
}

function saveSessionSummary() {
  setTimeout(() => {
    const chosenSessionSummary = $('#sessionSummarySwitch').parent().hasClass('is-checked');
    console.log('%c[stats.js, saveSessionSummary]', 'color: green;', 'Saving session summary state: ' + chosenSessionSummary);
    storeData('sessionSummary', chosenSessionSummary, null);
  }, 100);
}

// Load the statistics settings, migrating the switch of the earlier versions to the overlay modes
function loadStatisticsSettings() {
  getData('statsOverlay', function(storedOverlay) {
    if (storedOverlay.statsOverlay != null) {
      applyStatsOverlayMode(storedOverlay.statsOverlay, false);
      return;
    }
    getData('performanceStats', function(previousValue) {
      applyStatsOverlayMode(previousValue.performanceStats ? 'standard' : 'off', false);
    });
  });
  getData('statsPosition', function(storedPosition) {
    applyStatsOverlayPosition(storedPosition.statsPosition != null ? storedPosition.statsPosition : 'tl', false);
  });
  getData('sessionSummary', function(previousValue) {
    if (previousValue.sessionSummary === false) {
      document.querySelector('#sessionSummaryBtn').MaterialSwitch.off();
    } else {
      document.querySelector('#sessionSummaryBtn').MaterialSwitch.on(); // Enabled by default
    }
  });
}

function restoreStatisticsDefaults() {
  applyStatsOverlayMode('off', true);
  applyStatsOverlayPosition('tl', true);
  document.querySelector('#sessionSummaryBtn').MaterialSwitch.on();
  storeData('sessionSummary', true, null);
}

// Session summary and history --------------------------------------------------------------------

function gradeLabel(grade) {
  switch (grade) {
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

function saveSessionToHistory(summary) {
  getData(SESSION_HISTORY_KEY, function(stored) {
    var history = StreamStats.addToHistory(stored[SESSION_HISTORY_KEY], summary, SESSION_HISTORY_LIMIT);
    storeData(SESSION_HISTORY_KEY, history, null);
  });
}

// Handle the end of a stream: keep the session in the history and remember what to show
var pendingSessionSummary = null;

// A stream that is restarted by the application is kept in the history, but not summarized
function finishStreamStatistics(errorCode, isRestart) {
  var summary = StreamSessionStats.end(errorCode);
  GameMode.onStreamEnded(summary, errorCode, currentStreamConfig, isRestart);
  if (!summary || !summary.worthKeeping) {
    pendingSessionSummary = null;
    return null;
  }
  if (typeof onStreamSessionFinished === 'function') {
    onStreamSessionFinished(summary);
  }
  saveSessionToHistory(summary);
  pendingSessionSummary = isSessionSummaryEnabled() && !isRestart ? summary : null;
  return summary;
}

// Show the summary of the last session once the app list is back on screen
function showPendingSessionSummary() {
  var summary = pendingSessionSummary;
  pendingSessionSummary = null;
  // A short Game Mode stream leads to a question about a frozen video instead of its summary
  if (GameMode.showPendingQuestion()) {
    return;
  }
  if (!summary || isDialogOpen) {
    return;
  }
  sessionSummaryDialog(summary);
}

function summaryMetric(label, value, className) {
  return '<div class="summary-metric"><div class="summary-metric-label">' + escapeHtml(label) + '</div>' +
    '<div class="summary-metric-value ' + (className || '') + '">' + escapeHtml(value) + '</div></div>';
}

function renderSessionSummary(summary) {
  var resolution = summary.width + '×' + summary.height + ' · ' + summary.targetFps + ' FPS';
  var html = '<div class="summary-header">' +
    '<div class="summary-score summary-grade-' + summary.grade + '"><span class="summary-score-value">' + summary.score + '</span>' +
    '<span class="summary-score-label">' + escapeHtml(gradeLabel(summary.grade)) + '</span></div>' +
    '<div class="summary-title"><div class="summary-app">' + escapeHtml(summary.appName || t('Stream')) + '</div>' +
    '<div class="summary-host">' + escapeHtml(summary.hostName) + ' · ' + escapeHtml(StreamStats.formatDuration(summary.duration)) + '</div></div>' +
    '</div><div class="summary-grid">' +
    summaryMetric(t('Resolution'), resolution) +
    summaryMetric(t('Video codec'), (summary.codec || '-') + (summary.hdr ? ' HDR' : '')) +
    summaryMetric(t('Average frame rate'), summary.renderedFpsAvg + ' FPS (' + t('low: %1$s', summary.renderedFpsLow) + ')') +
    summaryMetric(t('Average bitrate'), summary.bitrateAvg + ' Mbps (' + t('max: %1$s', summary.bitrateMax) + ')') +
    summaryMetric(t('Network latency'), summary.rttAvg > 0 ? summary.rttAvg + ' ms (95%: ' + summary.rttP95 + ' ms)' : t('N/A')) +
    summaryMetric(t('Host latency'), summary.hostLatencyAvg > 0 ? summary.hostLatencyAvg + ' ms' : t('N/A')) +
    summaryMetric(t('Frame loss'), summary.lossAvg + ' % (' + t('max: %1$s', summary.lossMax) + ' %)', summary.lossAvg >= 1 ? 'v-bad' : (summary.lossAvg >= 0.3 ? 'v-warn' : 'v-good')) +
    summaryMetric(t('Poor connection'), summary.poorPercent + ' % ' + t('of the time'), summary.poorPercent >= 10 ? 'v-bad' : (summary.poorPercent > 0 ? 'v-warn' : 'v-good')) +
    '</div>';
  if (summary.autoTuneNote) {
    html += '<div class="summary-note"><i class="material-icons">auto_fix_high</i><span>' + escapeHtml(summary.autoTuneNote) + '</span></div>';
  }
  return html;
}

function sessionSummaryDialog(summary) {
  var overlay = document.querySelector('#sessionSummaryDialogOverlay');
  var dialog = document.querySelector('#sessionSummaryDialog');
  document.getElementById('sessionSummaryContent').innerHTML = renderSessionSummary(summary);

  overlay.style.display = 'flex';
  dialog.showModal();
  isDialogOpen = true;
  Navigation.push(Views.SessionSummaryDialog);

  $('#closeSessionSummary').off('click').on('click', function() {
    overlay.style.display = 'none';
    dialog.close();
    isDialogOpen = false;
    Navigation.pop();
    Navigation.switch();
  });
}

function renderSessionHistory(history) {
  if (!history || history.length === 0) {
    return '<p class="history-empty">' + escapeHtml(t('No sessions yet. The statistics of your streams will appear here.')) + '</p>';
  }
  return '<div class="history-list">' + history.map(function(entry) {
    var date = new Date(entry.startedAt);
    var when = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return '<div class="history-entry">' +
      '<div class="history-score summary-grade-' + escapeHtml(entry.grade) + '">' + escapeHtml(entry.score) + '</div>' +
      '<div class="history-main"><div class="history-title">' + escapeHtml(entry.appName || t('Stream')) + ' · ' + escapeHtml(entry.hostName) + '</div>' +
      '<div class="history-details">' + escapeHtml(when) + ' · ' + escapeHtml(StreamStats.formatDuration(entry.duration)) + ' · ' +
      escapeHtml(entry.width + '×' + entry.height + ' ' + entry.targetFps + ' FPS ' + (entry.codec || '')) + '</div></div>' +
      '<div class="history-numbers">' + escapeHtml(entry.renderedFpsAvg + ' FPS') + '<br>' + escapeHtml(entry.bitrateAvg + ' Mbps') + '<br>' +
      escapeHtml((entry.rttAvg > 0 ? entry.rttAvg + ' ms' : '-')) + '</div>' +
      '</div>';
  }).join('') + '</div>';
}

function sessionHistoryDialog() {
  var overlay = document.querySelector('#sessionHistoryDialogOverlay');
  var dialog = document.querySelector('#sessionHistoryDialog');

  getData(SESSION_HISTORY_KEY, function(stored) {
    document.getElementById('sessionHistoryContent').innerHTML = renderSessionHistory(stored[SESSION_HISTORY_KEY]);

    overlay.style.display = 'flex';
    dialog.showModal();
    isDialogOpen = true;
    Navigation.push(Views.SessionHistoryDialog);

    var close = function() {
      overlay.style.display = 'none';
      dialog.close();
      isDialogOpen = false;
      Navigation.pop();
      Navigation.switch();
    };

    $('#closeSessionHistory').off('click').on('click', close);
    $('#clearSessionHistory').off('click').on('click', function() {
      storeData(SESSION_HISTORY_KEY, [], null);
      document.getElementById('sessionHistoryContent').innerHTML = renderSessionHistory([]);
      snackbarLog('The session history has been cleared.');
    });
  });
}
