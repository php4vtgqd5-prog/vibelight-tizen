import { test, expect } from './fixtures.mjs';

async function openVideoSettings(page) {
  await page.evaluate(() => {
    showSettings();
  });
  await page.waitForFunction(() => $('#settings-list').is(':visible'));
  await page.evaluate(() => handleSettingsView('videoSettings'));
}

test('Auto streams with Game Mode on a TV where it works', async ({ app, page }) => {
  await app.open('?platform=7.0');
  await openVideoSettings(page);
  await expect(page.locator('#selectGameMode')).toHaveText('Auto (recommended)');
  await expect(page.locator('#gameModeStatus')).toHaveClass(/is-active/);
  await expect(page.locator('#retryGameModeBtn')).toBeHidden();

  await page.evaluate(() => showHosts());
  await app.openHost();
  await app.startApp(20002);
  await expect(page.locator('#loadingSpinnerDetail')).toContainText('Game Mode');
  await app.waitForStream();
  expect(await page.evaluate(() => currentStreamConfig.gameMode)).toBe(1);
});

test('Auto keeps the low latency mode on Tizen 9 and explains why', async ({ app, page }) => {
  await app.open('?platform=9.0');
  await openVideoSettings(page);
  await expect(page.locator('#gameModeStatusText')).toContainText('Tizen 9.0');
  await expect(page.locator('#gameModeStatusText')).toContainText('VibeLight-GameMode.wgt');
  await expect(page.locator('#gameModeStatus')).not.toHaveClass(/is-active/);

  await page.evaluate(() => showHosts());
  await app.openHost();
  await app.startApp(20002);
  await app.waitForStream();
  expect(await page.evaluate(() => currentStreamConfig.gameMode)).toBe(0);
});

test('the Game Mode edition leaves Game Mode to the TV', async ({ app, page }) => {
  await app.open('?platform=7.0&edition=gamemode');
  await openVideoSettings(page);
  await expect(page.locator('#gameModeStatusText')).toContainText('Game Mode edition');
  expect(await page.evaluate(() => GameMode.useUltraLowLatency())).toBe(false);
});

test('a player without the Ultra Low latency mode cannot be forced into it', async ({ app, page }) => {
  await app.open('?platform=7.0&ultraLow=0');
  await openVideoSettings(page);
  await page.evaluate(() => GameMode.choose('on'));
  await expect(page.locator('#warningDialog')).toBeVisible();
  await expect(page.locator('#warningDialogTitle')).toHaveText('Unsupported Feature');
  expect(await page.evaluate(() => GameMode.useUltraLowLatency())).toBe(false);
});

test('a video that freezes in Game Mode restarts in low latency mode, and Auto remembers it', async ({ app, page }) => {
  await app.open('?platform=7.0&freeze=1');
  await app.openHost();
  await app.startApp(20002);
  await app.waitForStream();
  expect(await page.evaluate(() => currentStreamConfig.gameMode)).toBe(1);

  // The watchdog notices the rejected frames and restarts the stream in the Low latency mode
  await page.waitForFunction(() => isStreamSessionActive && currentStreamConfig && currentStreamConfig.gameMode === 0,
    null, { timeout: 30000 });
  await app.waitForStream();

  // Auto no longer uses Game Mode on this TV, until the user asks to try again
  await app.stopStream();
  expect(await page.evaluate(() => GameMode.useUltraLowLatency())).toBe(false);
  await page.evaluate(() => $('#closeSessionSummary').click());
  await openVideoSettings(page);
  await expect(page.locator('#gameModeStatusText')).toContainText('froze the video');
  await expect(page.locator('#retryGameModeBtn')).toBeVisible();
  await page.locator('#retryGameModeBtn').click();
  expect(await page.evaluate(() => GameMode.useUltraLowLatency())).toBe(true);
  await expect(page.locator('#retryGameModeBtn')).toBeHidden();
});

test('after a short Game Mode stream, VibeLight asks once whether the video froze', async ({ app, page }) => {
  await app.open('?platform=7.0', { gameModeQuestion: true });
  await app.openHost();
  await app.startApp(20002);
  await app.waitForStream();
  await app.waitForSamples(3);
  await app.stopStream();

  await expect(page.locator('#warningDialog')).toBeVisible();
  await expect(page.locator('#warningDialogTitle')).toHaveText('Did the video freeze?');
  await expect(page.locator('#continueWarning')).toHaveText('Use low latency mode');
  await page.locator('#continueWarning').click();
  await expect(page.locator('#warningDialog')).toBeHidden();
  expect(await page.evaluate(() => GameMode.useUltraLowLatency())).toBe(false);
  // The buttons of the other warnings are back to normal
  await expect(page.locator('#closeWarning')).toHaveText('Close');

  // The question is not asked again
  await app.startApp(20002);
  await app.waitForStream();
  await app.waitForSamples(3);
  await app.stopStream();
  await page.waitForTimeout(1000);
  await expect(page.locator('#warningDialog')).toBeHidden();
});
