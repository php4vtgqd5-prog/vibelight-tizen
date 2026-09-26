'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GameMode = require('../../wasm/platform/gamemode-core.js');

const supported = { known: true, ultraLowLatency: true };
const unknown = { known: false, ultraLowLatency: false };

function sample(overrides) {
  return Object.assign({ rx: 60, dec: 60, ren: 60, fail: 0, vErr: 0, pos: -1 }, overrides);
}

test('Auto uses the Ultra Low latency mode where it is known to work', () => {
  assert.equal(GameMode.useUltraLowLatency('auto', { platform: 6.5, player: supported }), true);
  assert.equal(GameMode.useUltraLowLatency('auto', { platform: 8.0, player: unknown }), true);
  assert.equal(GameMode.autoBlocker({ platform: 7.0, player: unknown }), null);
});

test('Auto keeps the Low latency mode where the Ultra Low latency mode fails', () => {
  assert.equal(GameMode.autoBlocker({ platform: 5.5, player: unknown }), 'unsupported');
  assert.equal(GameMode.autoBlocker({ platform: 6.5, player: { known: true, ultraLowLatency: false } }), 'unsupported');
  assert.equal(GameMode.autoBlocker({ platform: 9.0, player: supported }), 'incompatible');
  assert.equal(GameMode.autoBlocker({ platform: 10.0, player: unknown }), 'incompatible');
  assert.equal(GameMode.autoBlocker({ platform: 6.5, player: supported, edition: true }), 'edition');
  assert.equal(GameMode.autoBlocker({ platform: 6.5, player: supported, failure: { platform: '6.5' } }), 'froze');
});

test('a freeze learned on an older firmware no longer applies', () => {
  assert.equal(GameMode.autoBlocker({ platform: 7.0, player: supported, failure: { platform: '6.5' } }), null);
});

test('On forces the Ultra Low latency mode wherever the player has it, Off never uses it', () => {
  assert.equal(GameMode.useUltraLowLatency('on', { platform: 9.0, player: supported }), true);
  assert.equal(GameMode.useUltraLowLatency('on', { platform: 6.5, player: supported, failure: { platform: '6.5' } }), true);
  assert.equal(GameMode.useUltraLowLatency('on', { platform: 5.5, player: unknown }), false);
  assert.equal(GameMode.useUltraLowLatency('off', { platform: 6.5, player: supported }), false);
});

test('the watchdog ignores a healthy stream and samples without video', () => {
  let state = null;
  for (let second = 0; second < 10; second++) {
    const step = GameMode.watchdogStep(state, sample({ pos: second * 1.0 }));
    assert.equal(step.frozen, false);
    state = step.state;
  }
  const noVideo = GameMode.watchdogStep(state, sample({ rx: 0, dec: 0, ren: 0, fail: 0 }));
  assert.equal(noVideo.frozen, false);
  assert.equal(noVideo.state.frozenSamples, 0);
});

test('the watchdog detects a player that rejects the frames', () => {
  let state = null;
  let frozen = false;
  for (let second = 0; second < GameMode.FROZEN_SAMPLES; second++) {
    const step = GameMode.watchdogStep(state, sample({ ren: 2, fail: 96 }));
    state = step.state;
    frozen = step.frozen;
  }
  assert.equal(frozen, true);
});

test('the watchdog detects decoding errors reported by the player', () => {
  let state = null;
  let frozen = false;
  for (let second = 0; second < GameMode.FROZEN_SAMPLES; second++) {
    ({ state, frozen } = GameMode.watchdogStep(state, sample({ vErr: 20 })));
  }
  assert.equal(frozen, true);
});

test('a playback position that stops after moving means the video froze', () => {
  let state = null;
  let frozen = false;
  const positions = [0.5, 1.5, 2.5, 2.5, 2.5, 2.5];
  for (const pos of positions) {
    ({ state, frozen } = GameMode.watchdogStep(state, sample({ pos })));
  }
  assert.equal(frozen, true);
});

test('a position that never moves is not taken as a freeze, as some players never update it', () => {
  let state = null;
  let frozen = false;
  for (let second = 0; second < 8; second++) {
    ({ state, frozen } = GameMode.watchdogStep(state, sample({ pos: 0 })));
  }
  assert.equal(frozen, false);
});

test('one bad second does not trigger the watchdog', () => {
  let { state } = GameMode.watchdogStep(null, sample({ fail: 100, ren: 0 }));
  let step = GameMode.watchdogStep(state, sample());
  step = GameMode.watchdogStep(step.state, sample({ fail: 100, ren: 0 }));
  assert.equal(step.frozen, false);
});

test('the user is asked about a freeze after a short Game Mode stream only', () => {
  const stream = { ultraLowLatency: true, connected: true, errorCode: 0, duration: 12 };
  assert.equal(GameMode.shouldAskAfterStream(stream), true);
  assert.equal(GameMode.shouldAskAfterStream(Object.assign({}, stream, { duration: 300 })), false);
  assert.equal(GameMode.shouldAskAfterStream(Object.assign({}, stream, { ultraLowLatency: false })), false);
  assert.equal(GameMode.shouldAskAfterStream(Object.assign({}, stream, { errorCode: -101 })), false);
  assert.equal(GameMode.shouldAskAfterStream(Object.assign({}, stream, { alreadyAsked: true })), false);
  assert.equal(GameMode.shouldAskAfterStream(Object.assign({}, stream, { fellBack: true })), false);
});
