import { test, expect } from './fixtures.mjs';

test('a stream shows its statistics and ends with a session summary', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await app.openHost();
  await app.startApp(20002);

  // The loading screen shows the app and the settings Auto-Tune chose
  await expect(page.locator('#loadingSpinnerMessage')).toContainText('Elden Ring');
  await expect(page.locator('#loadingSpinnerDetail')).toContainText('Auto-Tune:');
  await app.waitForStream();

  // The YELLOW key switches the statistics overlay to its next mode
  const mode = () => page.evaluate(() => StatsOverlay.getMode());
  const before = await mode();
  await app.pressRemoteKey('KEY_YELLOW');
  expect(await mode()).not.toBe(before);

  // A session of more than 10 seconds is summarized and kept in the history
  await app.waitForSamples(12);
  await app.stopStream();
  await expect(page.locator('#sessionSummaryDialog')).toBeVisible();
  await expect(page.locator('.summary-app')).toHaveText('Elden Ring');
  const score = Number(await page.locator('.summary-score-value').textContent());
  expect(score).toBeGreaterThanOrEqual(80);
  await page.locator('#closeSessionSummary').click();

  await page.evaluate(() => sessionHistoryDialog());
  await expect(page.locator('#sessionHistoryDialog .history-entry')).toHaveCount(1);
  await expect(page.locator('#sessionHistoryDialog .history-title')).toContainText('Elden Ring');
});

test('the RED key cancels a stream that is still starting', async ({ app, page }) => {
  await app.open();
  await app.openHost();
  await app.startApp(20001);
  await expect(page.locator('#loadingSpinner')).toBeVisible();
  await app.pressRemoteKey('KEY_RED');
  await page.waitForFunction(() => !isInGame && $('#game-grid').is(':visible'));
  // The stream does not start later on
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => isStreamSessionActive)).toBe(false);
  expect(await app.currentView()).toBe('Apps');
});
