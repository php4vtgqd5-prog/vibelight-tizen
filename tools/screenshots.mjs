// Screenshots of the interface for the documentation (npm run screenshots), taken in Chromium
// against the development harness and saved as 1280x720 JPEG images to docs/screenshots/<language>.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE selects a Chromium that is already installed.
//
//   node tools/screenshots.mjs            English and Polish
//   node tools/screenshots.mjs pl-PL      One language
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startHarnessServer } from './dev-harness/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = { 'en-US': 'en', 'pl-PL': 'pl' };
// The widget lays itself out for a 1920x1080 TV, the images are two thirds of that
const SCALE = 2 / 3;
const HOST = 'hosts[Object.keys(hosts)[0]]';

// Open the widget like a TV starting VibeLight, and wait until the first poll of the hosts answered
async function launch(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => typeof isHostsLoaded !== 'undefined' && isHostsLoaded && $('#host-grid').is(':visible') &&
    Object.keys(hosts).every((uid) => hostStatus(hosts[uid]) !== 'unknown'));
  // The harness has no internet access, so its toasts about updates would cover the screenshots
  await page.addStyleTag({ content: '#snackbar { visibility: hidden !important; }' });
  await page.evaluate(() => {
    storeData(GAME_MODE_ASKED_KEY, true, null);
    GameMode.setAsked(true);
  });
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page, directory, name) {
  // Let the entrance animations of the cards and dialogs finish
  await page.waitForTimeout(1200);
  const file = path.join(directory, name + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  console.log('Saved ' + path.relative(ROOT, file));
}

async function waitForStream(page) {
  await page.waitForFunction(() => isStreamSessionActive && $('body').hasClass('vl-streaming'));
}

// Stop the stream, whose summary appears when it lasted at least MIN_SUMMARY_SECONDS
async function stopStream(page, { summary = false } = {}) {
  await page.evaluate(() => Module.stopStream());
  await page.waitForFunction(() => !isInGame && $('#game-grid').is(':visible'));
  if (summary) {
    await page.waitForFunction(() => $('#sessionSummaryDialog').is('[open]'));
  }
}

async function closeSummary(page) {
  await page.evaluate(() => $('#closeSessionSummary').click());
  await page.waitForFunction(() => !isDialogOpen);
}

async function shoot(browser, baseUrl, locale, directory) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const url = (query) => baseUrl + '?' + query + '&locale=' + locale;

  // Home screen: after a first stream, the next launch offers to continue playing it
  await launch(page, url('network=ethernet'));
  await page.evaluate('hostChosen(' + HOST + ')');
  await page.waitForSelector('#game-grid .game-container');
  await page.evaluate('startGame(' + HOST + ', 20005)');
  await waitForStream(page);
  await page.waitForTimeout(3000);
  await stopStream(page);
  await launch(page, url('network=ethernet'));
  await page.waitForFunction(() => $('#continue-banner').is(':visible') && Navigation.current() === Views.ContinueBanner);
  await capture(page, directory, 'home');

  // Apps of the host, with the backdrop of the focused app and the app that runs on the host
  await launch(page, url('network=ethernet&running=20002'));
  await page.evaluate('hostChosen(' + HOST + ')');
  await page.waitForSelector('#game-grid .game-container');
  await page.waitForTimeout(800);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => $('#ambientBackdrop .ambient-layer.is-visible').length > 0);
  await capture(page, directory, 'apps');

  // Loading screen of a stream, then the stream with the detailed statistics overlay
  await page.evaluate(() => {
    StatsOverlay.setMode('detailed');
    StatsOverlay.setPosition('tr');
  });
  await page.evaluate('startGame(' + HOST + ', 20002)');
  await page.waitForFunction(() => $('#loadingSpinner').is(':visible') || $('#streamLoadingBackdrop').is(':visible'));
  await page.screenshot({ path: path.join(directory, 'loading.jpg'), type: 'jpeg', quality: 82 });
  console.log('Saved ' + path.relative(ROOT, path.join(directory, 'loading.jpg')));
  await waitForStream(page);
  await page.waitForTimeout(12000);
  await capture(page, directory, 'stream-statistics');

  // Summary of the session
  await stopStream(page, { summary: true });
  await capture(page, directory, 'session-summary');
  await closeSummary(page);

  // Auto-Tune settings and the test of the setup
  await page.evaluate(() => showSettings());
  await page.waitForFunction(() => $('#settings-list').is(':visible') || $('.settings-category').is(':visible'));
  await page.evaluate(() => handleSettingsView('autoTuneSettings'));
  await capture(page, directory, 'auto-tune');
  await page.evaluate(() => autoTuneDialog());
  await page.waitForFunction(() => !$('#applyAutoTune').prop('disabled'));
  await capture(page, directory, 'auto-tune-test');
  await page.evaluate(() => $('#closeAutoTune').click());

  // Game Mode in the video settings
  await page.evaluate(() => handleSettingsView('videoSettings'));
  await capture(page, directory, 'game-mode');

  await context.close();
  if (errors.length > 0) {
    throw new Error('Errors of the page in ' + locale + ':\n' + errors.join('\n'));
  }
}

const requested = process.argv.slice(2);
const locales = requested.length > 0 ? requested : Object.keys(LOCALES);
const server = await startHarnessServer(0);
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const locale of locales) {
    if (!LOCALES[locale]) {
      throw new Error('Unknown language ' + locale + ', expected one of ' + Object.keys(LOCALES).join(', '));
    }
    const directory = path.join(ROOT, 'docs', 'screenshots', LOCALES[locale]);
    await mkdir(directory, { recursive: true });
    await shoot(browser, baseUrl, locale, directory);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
