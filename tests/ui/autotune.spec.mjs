import { test, expect } from './fixtures.mjs';

test('Auto-Tune recommends settings for the TV, the host and the network', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await page.evaluate(() => autoTuneDialog());
  // The resolution and the bitrate depend on the latency measured to the simulated host, the codec
  // is the best one the TV and the host share
  const recommendation = page.locator('#autoTuneDialog .autotune-recommendation');
  await expect(recommendation).toHaveText(/^(\d+)×(\d+) · 60 FPS · HEVC · [\d.]+ Mbps$/);
  const [, width, height] = (await recommendation.textContent()).match(/^(\d+)×(\d+)/);

  // The recommendation can be copied to the manual settings
  await page.locator('#applyAutoTune').click();
  expect(await page.evaluate(() => $('#selectResolution').data('value'))).toBe(width + ':' + height);
  expect(await page.evaluate(() => $('#selectCodec').data('value'))).toBe('HEVC');
});

// Make the simulated network carry half of the bitrate of the stream, so that it loses frames
async function congestNetwork(page, bitrate) {
  await page.evaluate((mbps) => {
    __harness.network.capacity = mbps;
  }, bitrate / 1000 / 2);
}

test('Auto-Tune lowers the bitrate when the connection stays poor and remembers it', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await app.openHost();
  await app.startApp(20002);
  await app.waitForStream();
  const first = await app.streamConfig();

  await congestNetwork(page, first.bitrate);
  await page.waitForFunction((bitrate) => isStreamSessionActive && currentStreamConfig && currentStreamConfig.bitrate < bitrate,
    first.bitrate, { timeout: 90000 });
  const second = await app.streamConfig();
  expect(second.bitrate).toBeLessThan(first.bitrate);

  const profile = await page.evaluate(() => AutoTune.profileFor(Object.keys(hosts)[0]));
  expect(profile.knownBadKbps).toBe(first.bitrate);
});

test('the RED key during an adaptive restart returns to the Apps view', async ({ app, page }) => {
  await app.open('?network=ethernet');
  await app.openHost();
  await app.startApp(20002);
  await app.waitForStream();
  await congestNetwork(page, (await app.streamConfig()).bitrate);
  // Wait for the restart: the stream ends and the loading screen comes back
  await page.waitForFunction(() => !isStreamSessionActive && isInGame, null, { timeout: 90000 });
  await app.pressRemoteKey('KEY_RED');
  await page.waitForFunction(() => !isInGame && $('#game-grid').is(':visible'));
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => isStreamSessionActive)).toBe(false);
});
