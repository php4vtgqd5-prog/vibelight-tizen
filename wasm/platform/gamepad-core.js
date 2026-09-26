// Decisions of the gamepad navigation of the menus, without any dependency on the TV, so that they
// can be unit tested.
//
// The analog sticks report a slightly different value on almost every poll, even at rest. Only the
// direction of an axis matters to the menus, so a change of an axis moves the focus when it pushes
// the axis in a new direction, and stops the repeat when it brings the axis back to the center.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GamepadCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Share of the full travel an axis must be pushed to move the focus
  var AXIS_THRESHOLD = 0.5;
  // Smallest change of an axis worth reporting to the interface. The noise of a stick at rest
  // stays below it, so it no longer wakes the interface on every poll.
  var AXIS_EPSILON = 0.02;

  // Direction of an axis: -1 (left or up), 1 (right or down) or 0 (near the center)
  function axisDirection(value, threshold) {
    var limit = threshold === undefined ? AXIS_THRESHOLD : threshold;
    if (value < -limit) {
      return -1;
    }
    if (value > limit) {
      return 1;
    }
    return 0;
  }

  // What a new value of an axis does to the navigation, from the direction the axis held before:
  // 'move' when it is pushed in a new direction, 'release' when it comes back to the center, and
  // 'none' while it stays in the same direction
  function axisStep(previousDirection, value, threshold) {
    var direction = axisDirection(value, threshold);
    var previous = previousDirection || 0;
    if (direction === previous) {
      return { direction: direction, action: 'none' };
    }
    return { direction: direction, action: direction === 0 ? 'release' : 'move' };
  }

  // Whether a new value of an axis differs enough from the last reported one to be reported. The
  // extremes and the center are always reported, so a stick released slowly still ends at rest.
  function axisChanged(previous, value) {
    if (previous === value) {
      return false;
    }
    if (value === 0 || value === 1 || value === -1) {
      return true;
    }
    return Math.abs(value - previous) >= AXIS_EPSILON;
  }

  return {
    AXIS_THRESHOLD: AXIS_THRESHOLD,
    AXIS_EPSILON: AXIS_EPSILON,
    axisDirection: axisDirection,
    axisStep: axisStep,
    axisChanged: axisChanged,
  };
});
