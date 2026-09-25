'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AutoTune = require('../../wasm/platform/autotune-core.js');

const ALL_HOST_CODECS = AutoTune.SCM.H264 | AutoTune.SCM.HEVC | AutoTune.SCM.HEVC_MAIN10 |
  AutoTune.SCM.AV1_MAIN8 | AutoTune.SCM.AV1_MAIN10;

function input(overrides) {
  return Object.assign({
    device: {
      maxWidth: 3840,
      maxHeight: 2160,
      hdr: true,
      decoders: { h264: true, hevc: true, hevc10: true, av1: false, av110: false },
      highFrameRate: false,
    },
    host: { codecSupport: ALL_HOST_CODECS },
    network: { type: 'ethernet', probe: { rttMedian: 2, rttJitter: 0.5, loss: 0, samples: 7 } },
    profile: null,
    goal: 'balanced',
    hdr: false,
    now: 1700000000000,
  }, overrides);
}

test('a wired 4K TV streams 4K HEVC at 60 FPS', () => {
  const result = AutoTune.recommend(input());
  assert.equal(result.networkClass, 'excellent');
  assert.equal(result.codec, 'HEVC');
  assert.equal(result.width, 3840);
  assert.equal(result.height, 2160);
  assert.equal(result.fps, 60);
  assert.ok(result.bitrate >= 40000 && result.bitrate <= 50000, 'bitrate ' + result.bitrate);
});

test('a 1080p TV never streams above its panel', () => {
  const result = AutoTune.recommend(input({ device: { maxWidth: 1920, maxHeight: 1080, decoders: { hevc: true } } }));
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
});

test('weak Wi-Fi lowers the resolution and the bitrate', () => {
  const result = AutoTune.recommend(input({
    network: { type: 'wifi', wifiSignal: 0.35, probe: { rttMedian: 25, rttJitter: 10, loss: 0, samples: 7 } },
  }));
  assert.equal(result.networkClass, 'weak');
  assert.ok(result.width <= 1920);
  assert.ok(result.bitrate <= AutoTune.NETWORK_BITRATE_CAPS.weak);
});

test('good Wi-Fi keeps 4K within the Wi-Fi budget', () => {
  const result = AutoTune.recommend(input({
    network: { type: 'wifi', wifiSignal: 0.85, probe: { rttMedian: 6, rttJitter: 2, loss: 0, samples: 7 } },
  }));
  assert.equal(result.networkClass, 'good');
  assert.ok(result.bitrate <= AutoTune.NETWORK_BITRATE_CAPS.good);
});

test('Wi-Fi never ranks as excellent, even with a fast probe', () => {
  assert.equal(AutoTune.classifyNetwork({ type: 'wifi', wifiSignal: 1, probe: { rttMedian: 1, rttJitter: 0.2, loss: 0, samples: 7 } }), 'good');
});

test('lost probe requests downgrade the network class', () => {
  assert.equal(AutoTune.classifyNetwork({ type: 'ethernet', probe: { rttMedian: 2, rttJitter: 0.5, loss: 0.2, samples: 6 } }), 'good');
});

test('H.264 is used when the TV has no HEVC decoder, and stays at 1080p', () => {
  const result = AutoTune.recommend(input({
    device: { maxWidth: 3840, maxHeight: 2160, decoders: { h264: true, hevc: false } },
  }));
  assert.equal(result.codec, 'H264');
  assert.equal(result.width, 1920);
});

test('H.264 is used when the host only encodes H.264', () => {
  const result = AutoTune.recommend(input({ host: { codecSupport: AutoTune.SCM.H264 } }));
  assert.equal(result.codec, 'H264');
});

test('the quality goal prefers AV1 when both sides support it', () => {
  const result = AutoTune.recommend(input({
    goal: 'quality',
    device: { maxWidth: 3840, maxHeight: 2160, hdr: true, decoders: { h264: true, hevc: true, hevc10: true, av1: true, av110: true } },
  }));
  assert.equal(result.codec, 'AV1');
  assert.equal(result.width, 3840);
});

test('the latency goal favors 120 FPS at 1080p when high frame rates are unlocked', () => {
  const result = AutoTune.recommend(input({
    goal: 'latency',
    device: { maxWidth: 3840, maxHeight: 2160, decoders: { hevc: true }, highFrameRate: true },
  }));
  assert.equal(result.fps, 120);
  assert.equal(result.width, 1920);
});

test('HDR is only enabled when the whole chain supports 10-bit video', () => {
  assert.equal(AutoTune.recommend(input({ hdr: true })).hdr, true);
  assert.equal(AutoTune.recommend(input({ hdr: true, host: { codecSupport: AutoTune.SCM.H264 | AutoTune.SCM.HEVC } })).hdr, false);
  assert.equal(AutoTune.recommend(input({ hdr: true, device: { maxWidth: 3840, maxHeight: 2160, hdr: false, decoders: { hevc: true, hevc10: true } } })).hdr, false);
  assert.equal(AutoTune.recommend(input({ hdr: false })).hdr, false);
});

test('HDR raises the bitrate', () => {
  const sdr = AutoTune.targetBitrate(3840, 2160, 60, 'HEVC', false, 'balanced');
  const hdr = AutoTune.targetBitrate(3840, 2160, 60, 'HEVC', true, 'balanced');
  assert.ok(hdr > sdr);
});

test('the bitrate model matches the usual H.264 bitrates', () => {
  assert.equal(AutoTune.targetBitrate(1920, 1080, 60, 'H264', false, 'balanced'), 20000);
  const uhd = AutoTune.targetBitrate(3840, 2160, 60, 'H264', false, 'balanced');
  assert.ok(uhd >= 65000 && uhd <= 75000, '4K bitrate ' + uhd);
  const hd = AutoTune.targetBitrate(1280, 720, 60, 'H264', false, 'balanced');
  assert.ok(hd >= 9000 && hd <= 11000, '720p bitrate ' + hd);
});

test('a bad session lowers the bitrate of the next one', () => {
  const summary = { connected: true, duration: 120, requestedBitrate: 45, lossAvg: 4, poorPercent: 30, rttP95: 20,
    targetFps: 60, renderedFpsAvg: 57, width: 3840, height: 2160, score: 30 };
  const learned = AutoTune.learnFromSession(null, summary, { now: 1700000000000, networkType: 'ethernet' });
  assert.equal(learned.verdict, 'bad');
  assert.equal(learned.profile.knownBadKbps, 45000);
  const next = AutoTune.recommend(input({ profile: learned.profile }));
  assert.ok(next.bitrate < 45000, 'bitrate ' + next.bitrate);
  assert.ok(next.bitrateCap <= 36000);
});

test('clean sessions let the bitrate grow above the class guess', () => {
  let profile = null;
  const summary = { connected: true, duration: 600, requestedBitrate: 60, lossAvg: 0, poorPercent: 0, rttP95: 8,
    targetFps: 60, renderedFpsAvg: 60, width: 3840, height: 2160, score: 98 };
  const wifi = { type: 'wifi', wifiSignal: 0.9, probe: { rttMedian: 5, rttJitter: 1.5, loss: 0, samples: 7 } };
  profile = AutoTune.learnFromSession(profile, summary, { now: 1700000000000, networkType: 'wifi' }).profile;
  const next = AutoTune.recommend(input({ network: wifi, profile: profile }));
  assert.ok(next.bitrateCap >= 66000, 'cap ' + next.bitrateCap);
});

test('a clean session clears an older failure below its bitrate', () => {
  const profile = { knownBadKbps: 30000, networkType: 'ethernet', updatedAt: 1700000000000 };
  const summary = { connected: true, duration: 300, requestedBitrate: 40, lossAvg: 0.1, poorPercent: 0, rttP95: 5,
    targetFps: 60, renderedFpsAvg: 60, width: 1920, height: 1080, score: 97 };
  const learned = AutoTune.learnFromSession(profile, summary, { now: 1700000100000, networkType: 'ethernet' });
  assert.equal(learned.verdict, 'clean');
  assert.equal(learned.profile.knownBadKbps, undefined);
  assert.equal(learned.profile.knownGoodKbps, 40000);
});

test('short or failed sessions do not teach anything', () => {
  const summary = { connected: true, duration: 10, requestedBitrate: 40, lossAvg: 10, poorPercent: 100 };
  assert.equal(AutoTune.learnFromSession(null, summary, {}).verdict, 'ignored');
  assert.equal(AutoTune.learnFromSession(null, Object.assign({}, summary, { duration: 100, connected: false }), {}).verdict, 'ignored');
});

test('a TV that cannot render a mode is steered away from it', () => {
  const summary = { connected: true, duration: 300, requestedBitrate: 45, lossAvg: 0, poorPercent: 0, rttP95: 4,
    targetFps: 60, renderedFpsAvg: 41, width: 3840, height: 2160, score: 70 };
  const learned = AutoTune.learnFromSession(null, summary, { now: 1700000000000, networkType: 'ethernet' });
  assert.equal(learned.verdict, 'decoder-limited');
  const next = AutoTune.recommend(input({ profile: learned.profile }));
  assert.notEqual(next.width, 3840);
});

test('a failed codec is not chosen again', () => {
  const profile = AutoTune.recordCodecFailure(null, 'HEVC', 1700000000000);
  const next = AutoTune.recommend(input({ profile: profile }));
  assert.equal(next.codec, 'H264');
});

test('what was learned on another connection type is ignored', () => {
  const profile = { knownBadKbps: 5000, networkType: 'wifi', updatedAt: 1700000000000 };
  const next = AutoTune.recommend(input({ profile: profile }));
  assert.ok(next.bitrate > 5000);
});

test('old profiles expire', () => {
  const profile = { knownBadKbps: 5000, networkType: 'ethernet', updatedAt: 1600000000000 };
  const next = AutoTune.recommend(input({ profile: profile, now: 1700000000000 }));
  assert.ok(next.bitrate > 5000);
});

test('adaptive reconnect needs a sustained problem and respects its limits', () => {
  const poor = Array.from({ length: 10 }, (_, index) => ({ t: 20 + index, loss: 8, poor: 1 }));
  const fine = Array.from({ length: 10 }, (_, index) => ({ t: 20 + index, loss: 0.1, poor: 0 }));
  assert.equal(AutoTune.adaptiveReconnectBitrate(poor, 40000, { sessionSeconds: 30, now: 1000000 }), 24000);
  assert.equal(AutoTune.adaptiveReconnectBitrate(fine, 40000, { sessionSeconds: 30 }), 0);
  assert.equal(AutoTune.adaptiveReconnectBitrate(poor.slice(0, 5), 40000, { sessionSeconds: 30 }), 0);
  assert.equal(AutoTune.adaptiveReconnectBitrate(poor, 40000, { sessionSeconds: 10 }), 0);
  assert.equal(AutoTune.adaptiveReconnectBitrate(poor, 40000, { sessionSeconds: 30, reconnects: 2 }), 0);
  assert.equal(AutoTune.adaptiveReconnectBitrate(poor, 40000, { sessionSeconds: 30, lastReconnectAt: 990000, now: 1000000 }), 0);
  assert.equal(AutoTune.adaptiveReconnectBitrate(poor, 4000, { sessionSeconds: 30 }), 0);
});

test('summarizeProbe drops the warm-up request and measures the jitter', () => {
  const probe = AutoTune.summarizeProbe([40, 3, 4, 3, 5, 3, 4], 0);
  assert.equal(probe.samples, 6);
  assert.equal(probe.rttMedian, 4);
  assert.ok(probe.rttJitter > 0 && probe.rttJitter < 1);
  assert.equal(probe.loss, 0);
  assert.deepEqual(AutoTune.summarizeProbe([], 3), { rttMedian: 0, rttJitter: 0, loss: 1, samples: 0 });
});

test('an adaptive reconnect remembers the bitrate that struggled', () => {
  const profile = AutoTune.recordPoorBitrate({ knownGoodKbps: 50000, networkType: 'wifi' }, 45000, { now: 1700000000000, networkType: 'wifi' });
  assert.equal(profile.knownBadKbps, 45000);
  assert.equal(profile.knownGoodKbps, 31500);
  const next = AutoTune.recommend(input({ network: { type: 'wifi', wifiSignal: 0.9 }, profile: profile }));
  assert.ok(next.bitrate <= 36000, 'bitrate ' + next.bitrate);
});
