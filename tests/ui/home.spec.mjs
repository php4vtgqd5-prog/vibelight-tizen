import { test, expect } from './fixtures.mjs';

test('the home screen shows the paired host as online under the VibeLight header', async ({ app, page }) => {
  await app.open();
  await expect(page.locator('#header-title')).toHaveText('VibeLight');
  await expect(page.locator('#header-title')).toHaveClass(/vl-brand/);
  const hostCard = page.locator('#host-grid .host-container').first();
  await expect(hostCard).toHaveAttribute('data-status', 'online');
  await expect(hostCard.locator('.host-status-label')).toHaveText('Online');
  // Nothing was played yet, so there is nothing to continue
  await expect(page.locator('#continue-banner')).toBeHidden();
});

// The app fixture only checks the errors of the page here, as the test opens it before the first poll
test('the home screen greets and counts the hosts online once their first poll answers', async ({ app, harness, page }) => {
  // A slow network keeps the first poll of the host waiting, as on a TV that just woke up
  await page.goto(harness.url('?rtt=2000&jitter=0'));
  await page.waitForFunction(() => typeof isHostsLoaded !== 'undefined' && isHostsLoaded && $('#host-grid').is(':visible'));
  const hostCard = page.locator('#host-grid .host-container').first();
  await expect(page.locator('#homeGreeting')).toHaveText(/^Good (morning|afternoon|evening)$/);
  await expect(page.locator('#homeSubtitleText')).toHaveText('Looking for your PCs...');
  await expect(hostCard).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('#homeSubtitle')).not.toHaveClass(/is-offline/);

  await expect(page.locator('#homeSubtitleText')).toHaveText('PCs online: 1 of 1');
  await expect(hostCard).toHaveAttribute('data-status', 'online');
});

test('a host found on a fresh TV must be paired first', async ({ app, page }) => {
  await app.open('?scenario=fresh');
  const hostCard = page.locator('#host-grid .host-container').first();
  await expect(hostCard).toHaveAttribute('data-status', 'unpaired');
  await expect(hostCard.locator('.host-status-label')).toHaveText('Not paired');
});

test('the remote control moves between the hosts, their menu and the header', async ({ app, page }) => {
  await app.open();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await app.currentView()).toBe('Hosts');
  await page.keyboard.press('ArrowUp');
  expect(await app.currentView()).toBe('HostsMenuHighlight');
  await page.keyboard.press('ArrowUp');
  expect(await app.currentView()).toBe('HostsNav');
  await page.keyboard.press('ArrowDown');
  expect(await app.currentView()).toBe('Hosts');
});

test('the Apps view marks the running app and offers to quit it before starting another', async ({ app, page }) => {
  await app.open('?running=20002');
  await app.openHost();
  await expect(page.locator('#header-title')).toContainText('Apps');
  await expect(page.locator('#header-title .header-subtitle')).toHaveText('GAMING-PC');
  const running = page.locator('#game-container-20002');
  await expect(running).toHaveClass(/current-game-active/);
  await expect(running).toHaveAttribute('data-status-label', 'Running');

  await app.startApp(20003);
  await expect(page.locator('#quitAppDialog')).toBeVisible();
  await expect(page.locator('#quitAppDialogText')).toContainText('Elden Ring');
  await expect(page.locator('#quitAppDialogText')).toContainText('Forza Horizon 5');
  await page.locator('#cancelQuitApp').click();
  await expect(page.locator('#quitAppDialog')).toBeHidden();
});

test('the interface follows a TV set to Polish', async ({ app, page }) => {
  await app.open('?locale=pl-PL');
  await expect(page.locator('#host-grid .host-status-label').first()).toHaveText('Online');
  await expect(page.locator('#addHostContainer .host-text')).toHaveText('Dodaj hosta');
  await page.evaluate(() => showSettings());
  await expect(page.locator('#header-title')).toHaveText('Ustawienia');
  await expect(page.locator('.settings-category[data-category="autoTuneSettings"] label')).toHaveText('Auto-Tune');
  await expect(page.locator('.settings-category[data-category="videoSettings"] label')).toHaveText('Ustawienia obrazu');
});
