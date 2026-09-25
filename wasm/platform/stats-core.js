// Stream statistics: parsing, aggregation and quality scoring.
//
// The WASM module reports the statistics of the stream about once per second as a StatsJson
// message (see ReportStreamStats in wasmplayer.cpp). This file turns those samples into the
// numbers shown by the statistics overlay, the session summary and the session history, and into
// the quality verdict that Auto-Tune learns from. It has no dependency on the DOM, so it can be
// unit tested with Node.
(function(root, factory) {
  var StreamStats = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = StreamStats;
  } else {
    root.StreamStats = StreamStats;
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Number of samples kept for the graphs of the overlay, which is two minutes of stream
  var HISTORY_LENGTH = 120;

  // Shortest session that is worth a summary and a place in the history, in seconds
  var MIN_SUMMARY_SECONDS = 10;

  // Fields of a StatsJson sample and their default values
  var SAMPLE_FIELDS = {
    t: 0, w: 0, h: 0, fps: 0, codec: '', hdr: 0,
    rx: 0, dec: 0, ren: 0, mbps: 0, loss: 0, fail: 0,
    rtt: 0, rttv: 0, host: 0, hostMin: 0, hostMax: 0,
    reasm: 0, queue: 0, pace: 0, sub: 0,
    poor: 0, aDrop: 0, aErr: 0, idr: 0,
  };

  function toNumber(value, fallback) {
    var number = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(number) ? number : fallback;
  }

  // Parse the payload of a StatsJson message, returning null when it is not a valid sample
  function parseSample(text) {
    var raw;
    try {
      raw = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (error) {
      return null;
    }
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    var sample = {};
    Object.keys(SAMPLE_FIELDS).forEach(function(key) {
      var fallback = SAMPLE_FIELDS[key];
      sample[key] = typeof fallback === 'string'
        ? (raw[key] === undefined || raw[key] === null ? fallback : String(raw[key]))
        : toNumber(raw[key], fallback);
    });
    return sample;
  }

  function average(values) {
    if (values.length === 0) {
      return 0;
    }
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
    }
    return sum / values.length;
  }

  // Value below which the given fraction of the values lie, using the nearest rank
  function percentile(values, fraction) {
    if (values.length === 0) {
      return 0;
    }
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index];
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Scores a session from 0 to 100, from what the viewer experienced: lost frames, frames the TV
  // did not render, time spent with a poor connection, network latency and its variance.
  function qualityScore(summary) {
    if (!summary || summary.samples === 0) {
      return 0;
    }
    var score = 100;
    // Every lost percent of the frames is a visible stutter or a smeared picture
    score -= clamp(summary.lossAvg * 8, 0, 40);
    // Frames that arrived but were not rendered show the TV decoder could not keep up
    var renderRatio = summary.targetFps > 0 ? summary.renderedFpsAvg / summary.targetFps : 1;
    score -= clamp((0.97 - renderRatio) * 150, 0, 30);
    // Time spent with the connection reported as poor
    score -= clamp(summary.poorPercent * 0.5, 0, 25);
    // Network latency and jitter on top of the few milliseconds of a good local network
    score -= clamp((summary.rttP95 - 12) * 0.6, 0, 15);
    score -= clamp((summary.rttVarianceAvg - 4) * 1.2, 0, 10);
    // Frames rejected by the decoder freeze the picture until the next key frame
    score -= clamp(summary.failAvg * 5, 0, 15);
    return Math.round(clamp(score, 0, 100));
  }

  function qualityGrade(score) {
    if (score >= 90) {
      return 'excellent';
    } else if (score >= 75) {
      return 'good';
    } else if (score >= 55) {
      return 'fair';
    }
    return 'poor';
  }

  // Classifies a single sample for the colored indicator of the overlay
  function sampleHealth(sample) {
    if (!sample) {
      return 'unknown';
    }
    var renderRatio = sample.fps > 0 ? sample.ren / sample.fps : 1;
    if (sample.poor || sample.loss >= 5 || renderRatio < 0.8) {
      return 'bad';
    }
    if (sample.loss >= 1 || renderRatio < 0.95 || sample.rtt >= 20 || sample.rttv >= 8) {
      return 'warn';
    }
    return 'good';
  }

  // Statistics of one streaming session
  function Session(meta) {
    this.meta = meta || {};
    this.startedAt = this.meta.startedAt || Date.now();
    this.samples = [];
    this.history = [];
    this.last = null;
    this.totals = { audioDropped: 0, audioErrors: 0, keyFrames: 0 };
  }

  Session.prototype.add = function(sample) {
    if (!sample) {
      return;
    }
    this.last = sample;
    this.samples.push(sample);
    this.history.push(sample);
    if (this.history.length > HISTORY_LENGTH) {
      this.history.shift();
    }
    this.totals.audioDropped += sample.aDrop;
    this.totals.audioErrors += sample.aErr;
    this.totals.keyFrames += sample.idr;
  };

  // Values of one field over the samples kept for the graphs
  Session.prototype.series = function(field) {
    return this.history.map(function(sample) { return sample[field]; });
  };

  Session.prototype.summary = function() {
    var samples = this.samples;
    // The first second of a stream includes the start of the video pipeline, which is not
    // representative of the session, so leave it out once there is enough data
    var steady = samples.length > 3 ? samples.slice(1) : samples;
    var pick = function(field) {
      return steady.map(function(sample) { return sample[field]; });
    };
    var last = this.last || {};
    var rtts = pick('rtt').filter(function(value) { return value > 0; });
    var hostLatencies = pick('host').filter(function(value) { return value > 0; });
    var config = this.meta.config || {};

    var summary = {
      hostName: this.meta.hostName || '',
      hostUid: this.meta.hostUid || '',
      appName: this.meta.appName || '',
      startedAt: this.startedAt,
      endedAt: this.meta.endedAt || Date.now(),
      duration: last.t || 0,
      samples: steady.length,
      width: last.w || config.width || 0,
      height: last.h || config.height || 0,
      targetFps: last.fps || config.fps || 0,
      codec: last.codec || '',
      hdr: !!last.hdr,
      requestedBitrate: config.bitrate ? config.bitrate / 1000 : 0,
      autoTuned: !!config.autoTuned,
      receivedFpsAvg: round(average(pick('rx')), 1),
      renderedFpsAvg: round(average(pick('ren')), 1),
      renderedFpsLow: round(percentile(pick('ren'), 0.05), 1),
      bitrateAvg: round(average(pick('mbps')), 1),
      bitrateMax: round(steady.length ? Math.max.apply(null, pick('mbps')) : 0, 1),
      lossAvg: round(average(pick('loss')), 2),
      lossMax: round(steady.length ? Math.max.apply(null, pick('loss')) : 0, 2),
      failAvg: round(average(pick('fail')), 2),
      poorPercent: round(steady.length ? pick('poor').filter(Boolean).length * 100 / steady.length : 0, 1),
      rttAvg: round(average(rtts), 1),
      rttP95: round(percentile(rtts, 0.95), 1),
      rttVarianceAvg: round(average(pick('rttv')), 1),
      hostLatencyAvg: round(average(hostLatencies), 1),
      queueAvg: round(average(pick('queue')), 2),
      audioDropped: this.totals.audioDropped,
      audioErrors: this.totals.audioErrors,
      keyFrames: this.totals.keyFrames,
    };
    summary.score = qualityScore(summary);
    summary.grade = qualityGrade(summary.score);
    summary.worthKeeping = summary.duration >= MIN_SUMMARY_SECONDS && summary.samples > 0;
    return summary;
  };

  // Keep the most recent sessions of the history, newest first
  function addToHistory(history, summary, limit) {
    var list = Array.isArray(history) ? history.slice() : [];
    list.unshift(summary);
    return list.slice(0, limit || 30);
  }

  function formatDuration(seconds) {
    var total = Math.max(0, Math.round(seconds));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    var pad = function(value) { return value < 10 ? '0' + value : String(value); };
    return hours > 0 ? hours + ':' + pad(minutes) + ':' + pad(secs) : minutes + ':' + pad(secs);
  }

  return {
    HISTORY_LENGTH: HISTORY_LENGTH,
    MIN_SUMMARY_SECONDS: MIN_SUMMARY_SECONDS,
    parseSample: parseSample,
    Session: Session,
    qualityScore: qualityScore,
    qualityGrade: qualityGrade,
    sampleHealth: sampleHealth,
    addToHistory: addToHistory,
    formatDuration: formatDuration,
    percentile: percentile,
    average: average,
  };
});
