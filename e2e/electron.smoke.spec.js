const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

test.setTimeout(120000);

test('Forkline electron UI smoke flow', async () => {
  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  });

  try {
    const window = await electronApp.firstWindow({ timeout: 60000 });
    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await expect(window.locator('body')).toBeVisible();

    const skipButton = window.getByRole('button', { name: /skip/i });
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
    }

    const readyMarkers = [
      window.getByText(/workspace/i).first(),
      window.getByText(/projects/i).first(),
      window.getByRole('button', { name: /spawn agent/i }).first()
    ];
    let isReady = false;
    for (const marker of readyMarkers) {
      if (await marker.isVisible().catch(() => false)) {
        isReady = true;
        break;
      }
    }
    if (!isReady) {
      await expect(window.getByText(/forkline/i).first()).toBeVisible();
    }

    const spawnButton = window.getByRole('button', { name: /spawn agent/i }).first();
    if (await spawnButton.isVisible().catch(() => false)) {
      await spawnButton.click();
      const spawnHeading = window.getByRole('heading', { name: /spawn agent/i }).first();
      if (await spawnHeading.isVisible().catch(() => false)) {
        const cancelButton = window.getByRole('button', { name: /^cancel$/i }).first();
        if (await cancelButton.isVisible().catch(() => false)) {
          await cancelButton.click();
          await expect(spawnHeading).toHaveCount(0);
        }
      }
    }

    const settingsButton = window.getByTitle('Workspace Settings').first();
    if (await settingsButton.isVisible().catch(() => false)) {
      await settingsButton.click();
      const settingsLabel = window.getByText(/workspace settings/i).first();
      await expect(settingsLabel).toBeVisible();
      const cancelButton = window.getByRole('button', { name: /^cancel$/i }).first();
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    }
  } finally {
    await electronApp.close();
  }
});
