'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Gamepad = require('../../wasm/platform/gamepad-core.js');

test('an axis has a direction only past the threshold', () => {
  assert.equal(Gamepad.axisDirection(0), 0);
  assert.equal(Gamepad.axisDirection(0.5), 0);
  assert.equal(Gamepad.axisDirection(-0.5), 0);
  assert.equal(Gamepad.axisDirection(0.51), 1);
  assert.equal(Gamepad.axisDirection(-0.51), -1);
  assert.equal(Gamepad.axisDirection(0.3, 0.2), 1);
});

test('pushing a stick moves the focus once, however much its value changes', () => {
  let direction = 0;
  const actions = [0.2, 0.6, 0.63, 0.61, 0.7, 1, 0.98].map((value) => {
    const step = Gamepad.axisStep(direction, value);
    direction = step.direction;
    return step.action;
  });
  assert.deepEqual(actions, ['none', 'move', 'none', 'none', 'none', 'none', 'none']);
});

test('the noise of a stick at rest does nothing', () => {
  let direction = 0;
  for (const value of [0.0039, -0.0078, 0.0118, 0, -0.0039, 0.03]) {
    const step = Gamepad.axisStep(direction, value);
    assert.equal(step.action, 'none');
    direction = step.direction;
  }
});

test('a stick back at the center releases, and pushed the other way moves again', () => {
  assert.deepEqual(Gamepad.axisStep(1, 0.1), { direction: 0, action: 'release' });
  assert.deepEqual(Gamepad.axisStep(1, -0.9), { direction: -1, action: 'move' });
  assert.deepEqual(Gamepad.axisStep(undefined, -0.9), { direction: -1, action: 'move' });
});

test('only changes of an axis larger than the noise are reported', () => {
  assert.equal(Gamepad.axisChanged(0.0039, 0.0078), false);
  assert.equal(Gamepad.axisChanged(0.5, 0.51), false);
  assert.equal(Gamepad.axisChanged(0.5, 0.53), true);
  assert.equal(Gamepad.axisChanged(0.3, 0.3), false);
});

test('the center and the extremes of an axis are always reported', () => {
  assert.equal(Gamepad.axisChanged(0.01, 0), true);
  assert.equal(Gamepad.axisChanged(0.99, 1), true);
  assert.equal(Gamepad.axisChanged(-0.995, -1), true);
});
