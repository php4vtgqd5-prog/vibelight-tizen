// Fixtures of the UI tests: a development harness server for each test, and helpers that drive the
// widget the way the remote control and the WebAssembly module do.
import { test as base, expect } from '@playwright/test';
import { startHarnessServer } from '../../tools/dev-harness/server.mjs';

// Errors the widget logs on purpose in the harness, which has no internet access
const EXPECTED_CONSOLE_ERRORS = [/release data/, /Offline in the harness/, /box art/i];

export const test = base.extend({
  harness: async ({}, use) => {
    const server = await startHarnessServer(0);
    const { port } = server.address();
    await use({ url: (query = '') => `http://127.0.0.1:${port}/${query}` });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  },

  app: async ({ page, harness }, use) => {
    const errors = [];
    const expectedErrors = [...EXPECTED_CONSOLE_ERRORS];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !expectedErrors.some((pattern) => pattern.test(message.text()))) {
        errors.push(message.text());
      }
    });

    const app = {
      page,

      // Accept an error the widget logs on purpose in this test, such as a failed pairing
      allowError(pattern) {
        expectedErrors.push(pattern);
      },

      // Open the widget and wait for the saved hosts. Short streams in Game Mode lead to a question
      // about a frozen video once per TV, which only the tests of that question keep.
      async open(query = '', { gameModeQuestion = false } = {}) {
        await page.goto(harness.url(query));
        await page.waitForFunction(() => typeof isHostsLoaded !== 'undefined' && isHostsLoaded && $('#host-grid').is(':visible'));
        // The first poll of the hosts tells whether they are online
        await page.waitForFunction(() => Object.keys(hosts).every((uid) => hostStatus(hosts[uid]) !== 'unknown'));
        if (!gameModeQuestion) {
          await page.evaluate(() => {
            storeData(GAME_MODE_ASKED_KEY, true, null);
            GameMode.setAsked(true);
          });
        }
      },

      // Reload the widget, keeping its stored data like a TV restarting the app
      async relaunch(query = '', options = {}) {
        await app.open(query, options);
      },

      // Name of the navigation view that has the focus
      currentView() {
        return page.evaluate(() => Object.keys(Views).find((name) => Views[name] === Navigation.current()));
      },

      // Press a key of the remote control
      async pressRemoteKey(name) {
        await page.evaluate((keyName) => {
          document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: tvKey[keyName], bubbles: true }));
        }, name);
      },

      async openHost() {
        await page.evaluate(() => hostChosen(hosts[Object.keys(hosts)[0]]));
        await page.waitForSelector('#game-grid .game-container');
      },

      async startApp(appId) {
        await page.evaluate((id) => startGame(hosts[Object.keys(hosts)[0]], id), appId);
      },

      // Wait until the stream is connected and shows video
      async waitForStream() {
        await page.waitForFunction(() => isStreamSessionActive && $('body').hasClass('vl-streaming'));
      },

      // Wait until the statistics session collected the given number of samples
      async waitForSamples(count) {
        await page.waitForFunction((samples) => {
          const session = StreamSessionStats.current();
          return !!session && session.history.length >= samples;
        }, count, { timeout: 90000 });
      },

      async stopStream() {
        await page.evaluate(() => Module.stopStream());
        await page.waitForFunction(() => !isInGame && $('#game-grid').is(':visible'));
      },

      streamConfig() {
        return page.evaluate(() => currentStreamConfig && {
          width: currentStreamConfig.width,
          height: currentStreamConfig.height,
          fps: currentStreamConfig.fps,
          bitrate: currentStreamConfig.bitrate,
          codec: currentStreamConfig.videoCodec,
        });
      },
    };

    await use(app);
    expect(errors, 'errors of the page').toEqual([]);
  },
});

export { expect };
