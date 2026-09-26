import { test, expect } from './fixtures.mjs';

// Stream an app long enough to be remembered, then go back to the home screen
async function playOnce(app, page, appId) {
  await app.openHost();
  await app.startApp(appId);
  await app.waitForStream();
  await app.stopStream();
  await page.evaluate(() => {
    $('#closeSessionSummary').click();
    showHosts();
  });
  await page.waitForFunction(() => $('#host-grid').is(':visible') && !$('#wasmSpinner').is(':visible'));
}

test('the last app streamed is offered on the home screen', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await playOnce(app, page, 20005);
  const banner = page.locator('#continue-banner');
  await expect(banner).toBeVisible();
  await expect(page.locator('#continueTitle')).toHaveText('Hades II');
  await expect(page.locator('#continueSubtitle')).toContainText('GAMING-PC');

  // Up from the first host reaches the banner, and OK starts the app
  await page.evaluate(() => {
    Navigation.change(Views.Hosts);
    Navigation.switch();
  });
  await page.keyboard.press('ArrowUp');
  expect(await app.currentView()).toBe('ContinueBanner');
  await page.keyboard.press('Enter');
  await app.waitForStream();
  expect(await page.evaluate(() => currentStreamConfig.appId)).toBe(20005);
});

test('Resume on launch starts the last app after a countdown', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await playOnce(app, page, 20006);
  await page.evaluate(() => storeData('autoResume', true, null));

  await app.relaunch('?network=ethernet');
  await expect(page.locator('#continue-banner')).toHaveClass(/is-counting/);
  expect(await app.currentView()).toBe('ContinueBanner');
  await app.waitForStream();
  expect(await page.evaluate(() => currentStreamConfig.appId)).toBe(20006);
});

test('BACK stops the countdown of Resume on launch', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await playOnce(app, page, 20006);
  await page.evaluate(() => storeData('autoResume', true, null));

  await app.relaunch('?network=ethernet');
  await expect(page.locator('#continue-banner')).toHaveClass(/is-counting/);
  await app.pressRemoteKey('KEY_RETURN');
  await expect(page.locator('#continue-banner')).not.toHaveClass(/is-counting/);
  await page.waitForTimeout(6500);
  expect(await page.evaluate(() => isInGame)).toBe(false);
  await expect(page.locator('#exitAppDialog')).toBeHidden();
});

test('deleting the host of the last app updates the home screen at once', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await playOnce(app, page, 20005);
  await expect(page.locator('#continue-banner')).toBeVisible();
  await expect(page.locator('#homeSubtitleText')).toHaveText('PCs online: 1 of 1');

  await page.evaluate(() => deleteHostDialog(hosts[Object.keys(hosts)[0]]));
  await page.locator('#continueDeleteHost').click();
  // Well before the header refreshes the home screen on its own
  await expect(page.locator('#continue-banner')).toBeHidden({ timeout: 3000 });
  await expect(page.locator('#homeSubtitleText')).toHaveText('Add your PC to start streaming.', { timeout: 3000 });
  expect(await app.currentView()).toBe('Hosts');
});
