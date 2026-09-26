import { test, expect } from './fixtures.mjs';

// Moves the focus from the Add PC card to the host card and presses OK, as with the remote control
async function openHostWithRemote(app, page) {
  const hostCard = page.locator('#host-grid .host-container').first();
  await page.waitForFunction(() => document.querySelectorAll('#host-grid .host-container').length > 0);
  while (!(await page.evaluate(() => {
    const current = Views.Hosts.view.current();
    return !!current && current.id !== 'addHostContainer';
  }))) {
    await app.pressRemoteKey('KEY_RIGHT');
  }
  await expect(hostCard).toHaveClass(/hovered/);
  await app.pressRemoteKey('KEY_ENTER');
}

test('the remote control opens the apps of a paired host', async ({ app, page }) => {
  await app.open();
  await openHostWithRemote(app, page);
  await expect(page.locator('#game-grid .game-container')).toHaveCount(8);
});

test('a host can be opened again after its pairing was canceled', async ({ app, page }) => {
  // The PIN is typed on the host 4 seconds after each pairing starts, long after BACK is pressed
  await app.open('?scenario=fresh&pinDelay=4000');
  await openHostWithRemote(app, page);
  await expect(page.locator('#pairingDialog')).toBeVisible();

  // BACK closes the dialog before the PIN was typed on the host
  await app.pressRemoteKey('KEY_RETURN');
  await expect(page.locator('#pairingDialog')).toBeHidden();
  expect(await page.evaluate(() => isHostOpening)).toBe(false);

  // Once the PIN is typed on the host, the second attempt opens the apps. A card ignores a second
  // click within 2 seconds, as a user coming back to it takes longer.
  await page.waitForFunction(() => !isClickPrevented);
  await app.pressRemoteKey('KEY_ENTER');
  await expect(page.locator('#pairingDialog')).toBeVisible();
  await expect(page.locator('#game-grid .game-container')).toHaveCount(8);
});

test('a pairing the host refuses is reported, and the host can be tried again', async ({ app, page }) => {
  await app.open('?scenario=fresh&pinDelay=100&pairAccepted=0');
  app.allowError(/\[index\.js, pairingDialog\].*Failed API object/);
  await openHostWithRemote(app, page);
  await expect(page.locator('#pairingDialogText')).toContainText('Failed to pair');
  await expect(page.locator('#game-grid .game-container')).toHaveCount(0);
  expect(await page.evaluate(() => isHostOpening)).toBe(false);

  await app.pressRemoteKey('KEY_RETURN');
  await expect(page.locator('#pairingDialog')).toBeHidden();
  await page.waitForFunction(() => !isClickPrevented);
  await app.pressRemoteKey('KEY_ENTER');
  await expect(page.locator('#pairingDialog')).toBeVisible();
});
