import { test, expect } from './fixtures.mjs';

// Plays gamepad changes the way gamepad.js reports them, one list every 16 ms like its polling, and
// counts the moves of the focus in each direction
async function playGamepad(page, frames, { settle = 0 } = {}) {
  return page.evaluate(async ({ frames, settle }) => {
    const moves = { up: 0, down: 0, left: 0, right: 0 };
    const original = {};
    Object.keys(moves).forEach((direction) => {
      original[direction] = Navigation[direction];
      Navigation[direction] = () => {
        moves[direction]++;
      };
    });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      for (const changes of frames) {
        if (changes.length > 0) {
          window.dispatchEvent(new CustomEvent('gamepadinputchanged', { detail: { changes } }));
        }
        await wait(16);
      }
      await wait(settle);
      return moves;
    } finally {
      stopRepeat();
      Object.assign(Navigation, original);
    }
  }, { frames, settle });
}

const button = (index, pressed) => ({ type: 'button', index, pressed });
const axis = (index, value) => ({ type: 'axis', index, value });

test('the noise of a stick at rest does not stop the repeat of a held D-pad direction', async ({ app, page }) => {
  await app.open();
  // DOWN held for about a second, while the left stick at rest reports tiny values on every poll
  const frames = [[button(13, true)]];
  for (let i = 0; i < 60; i++) {
    frames.push([axis(0, i % 2 ? 0.0039 : -0.0078)]);
  }
  frames.push([button(13, false)]);
  const moves = await playGamepad(page, frames);
  // One move at once, then a move every 100 ms after the delay of 350 ms
  expect(moves.down).toBeGreaterThanOrEqual(4);
  expect(moves.left + moves.right).toBe(0);
});

test('a stick held half way moves once, then repeats, though its value keeps changing', async ({ app, page }) => {
  await app.open();
  const frames = [];
  for (let i = 0; i < 60; i++) {
    frames.push([axis(0, 0.6 + (i % 3) * 0.03)]);
  }
  frames.push([axis(0, 0)]);
  const moves = await playGamepad(page, frames, { settle: 300 });
  expect(moves.right).toBeGreaterThanOrEqual(4);
  expect(moves.left).toBe(0);
});

test('a stick flicked once moves the focus once', async ({ app, page }) => {
  await app.open();
  const moves = await playGamepad(page, [[axis(1, 0.9)], [axis(1, 1)], [], [], [axis(1, 0.2)], [axis(1, 0)]], { settle: 500 });
  expect(moves).toEqual({ up: 0, down: 1, left: 0, right: 0 });
});
