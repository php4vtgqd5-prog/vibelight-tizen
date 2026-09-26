'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const StreamStats = require('../../wasm/platform/stats-core.js');

function sample(overrides) {
  return Object.assign({
    t: 1, w: 1920, h: 1080, fps: 60, codec: 'HEVC', hdr: 0,
    rx: 60, dec: 60, ren: 60, mbps: 20, loss: 0, fail: 0,
    rtt: 3, rttv: 1, host: 4, hostMin: 3, hostMax: 6,
    reasm: 0.5, queue: 0.8, pace: 0, sub: 0.3,
    poor: 0, aDrop: 0, aErr: 0, idr: 0,
  }, overrides);
}

test('parseSample reads a StatsJson payload and fills missing fields', () => {
  const parsed = StreamStats.parseSample('{"t":2.5,"w":1280,"h":720,"fps":60,"codec":"H.264","ren":59.9,"mbps":"10.5"}');
  assert.equal(parsed.t, 2.5);
  assert.equal(parsed.w, 1280);
  assert.equal(parsed.codec, 'H.264');
  assert.equal(parsed.ren, 59.9);
  assert.equal(parsed.mbps, 10.5);
  assert.equal(parsed.loss, 0);
  assert.equal(parsed.poor, 0);
});

test('parseSample keeps the fields the Game Mode watchdog reads', () => {
  const parsed = StreamStats.parseSample('{"t":3,"vErr":4,"pos":2.5,"lat":1}');
  assert.equal(parsed.vErr, 4);
  assert.equal(parsed.pos, 2.5);
  assert.equal(parsed.lat, 1);
  const older = StreamStats.parseSample('{"t":3}');
  assert.equal(older.pos, -1, 'a module that reports no position');
  assert.equal(older.lat, 0);
});

test('parseSample rejects malformed payloads', () => {
  assert.equal(StreamStats.parseSample('not json'), null);
  assert.equal(StreamStats.parseSample('42'), null);
  assert.equal(StreamStats.parseSample(''), null);
});

test('a clean session scores excellent', () => {
  const session = new StreamStats.Session({ hostName: 'PC', appName: 'Game', config: { width: 1920, height: 1080, fps: 60, bitrate: 20000 } });
  for (let second = 1; second <= 30; second++) {
    session.add(sample({ t: second }));
  }
  const summary = session.summary();
  assert.equal(summary.samples, 29, 'the first second of the stream is left out');
  assert.equal(summary.renderedFpsAvg, 60);
  assert.equal(summary.lossAvg, 0);
  assert.equal(summary.grade, 'excellent');
  assert.ok(summary.score >= 95);
  assert.equal(summary.worthKeeping, true);
  assert.equal(summary.requestedBitrate, 20);
});

test('frame loss and a poor connection lower the score', () => {
  const session = new StreamStats.Session({});
  for (let second = 1; second <= 30; second++) {
    session.add(sample({ t: second, loss: 6, ren: 55, rx: 55, poor: 1, rtt: 25, rttv: 9 }));
  }
  const summary = session.summary();
  assert.equal(summary.poorPercent, 100);
  assert.equal(summary.grade, 'poor');
  assert.ok(summary.score < 40, 'score was ' + summary.score);
});

test('a TV that cannot render the frame rate is penalized even on a clean network', () => {
  const session = new StreamStats.Session({});
  for (let second = 1; second <= 20; second++) {
    session.add(sample({ t: second, fps: 120, rx: 120, ren: 80 }));
  }
  const summary = session.summary();
  assert.ok(summary.score <= 80, 'score was ' + summary.score);
});

test('short sessions are not worth a summary', () => {
  const session = new StreamStats.Session({});
  for (let second = 1; second <= 5; second++) {
    session.add(sample({ t: second }));
  }
  assert.equal(session.summary().worthKeeping, false);
});

test('the graph history keeps a bounded number of samples', () => {
  const session = new StreamStats.Session({});
  for (let second = 1; second <= StreamStats.HISTORY_LENGTH + 50; second++) {
    session.add(sample({ t: second, mbps: second }));
  }
  const series = session.series('mbps');
  assert.equal(series.length, StreamStats.HISTORY_LENGTH);
  assert.equal(series[series.length - 1], StreamStats.HISTORY_LENGTH + 50);
});

test('audio and key frame counters are summed over the session', () => {
  const session = new StreamStats.Session({});
  session.add(sample({ t: 1, aDrop: 2, aErr: 1, idr: 1 }));
  session.add(sample({ t: 2, aDrop: 3, aErr: 0, idr: 2 }));
  const summary = session.summary();
  assert.equal(summary.audioDropped, 5);
  assert.equal(summary.audioErrors, 1);
  assert.equal(summary.keyFrames, 3);
});

test('sampleHealth flags the problems the viewer notices', () => {
  assert.equal(StreamStats.sampleHealth(sample()), 'good');
  assert.equal(StreamStats.sampleHealth(sample({ loss: 2 })), 'warn');
  assert.equal(StreamStats.sampleHealth(sample({ loss: 7 })), 'bad');
  assert.equal(StreamStats.sampleHealth(sample({ poor: 1 })), 'bad');
  assert.equal(StreamStats.sampleHealth(sample({ ren: 40 })), 'bad');
  assert.equal(StreamStats.sampleHealth(null), 'unknown');
});

test('addToHistory keeps the newest sessions first and limits the list', () => {
  let history = [];
  for (let index = 0; index < 35; index++) {
    history = StreamStats.addToHistory(history, { id: index }, 30);
  }
  assert.equal(history.length, 30);
  assert.equal(history[0].id, 34);
  assert.equal(history[29].id, 5);
});

test('percentile and formatDuration', () => {
  assert.equal(StreamStats.percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(StreamStats.percentile([5, 1, 3, 2, 4], 0.05), 1);
  assert.equal(StreamStats.percentile([], 0.5), 0);
  assert.equal(StreamStats.formatDuration(59), '0:59');
  assert.equal(StreamStats.formatDuration(61), '1:01');
  assert.equal(StreamStats.formatDuration(3725), '1:02:05');
});
