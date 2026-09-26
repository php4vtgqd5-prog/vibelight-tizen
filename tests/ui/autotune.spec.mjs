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

// Sunshine on Windows gathers its state for /serverinfo, which takes up to about a hundred
// milliseconds, so the latency is measured on a path the host answers at once
test('Auto-Tune measures the network, not the time the host spends on /serverinfo', async ({ app, page }) => {
  await app.open('?network=wifi&signal=0.9&rtt=3&jitter=1&hostWork=110');
  await page.evaluate(() => autoTuneDialog());
  const latency = page.locator('#autoTuneDialog .autotune-row', { hasText: 'Latency to the host' }).locator('.autotune-value');
  await expect(latency).toHaveText(/^[\d.]+ ms ± [\d.]+ ms$/);
  // The timers of the harness run late on a busy machine, so the check leaves room for them while
  // staying far below the 110 ms the host spends on /serverinfo
  const [, median] = (await latency.textContent()).match(/^([\d.]+) ms/);
  expect(Number(median)).toBeLessThan(60);
  await expect(page.locator('#autoTuneDialog .autotune-reasons')).toContainText('Network quality:');
  await expect(page.locator('#autoTuneDialog .autotune-reasons')).not.toContainText('Network quality: Poor');
});

// Some TVs report NaN for the signal strength of Tizen, and the Samsung network API gives its level
test('Auto-Tune shows the Wi-Fi signal of a TV that reports NaN for it', async ({ app, page }) => {
  await app.open('?network=wifi&signal=0.8&tizenSignal=0');
  await page.evaluate(() => autoTuneDialog());
  const connection = page.locator('#autoTuneDialog .autotune-row', { hasText: 'Connection' }).locator('.autotune-value');
  await expect(connection).toHaveText('Wi-Fi (signal 80%)');
});
