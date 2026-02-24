const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

test('Forkline electron UI smoke flow', async () => {
  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await expect(window.getByText(/sessions/i)).toBeVisible();

  const skipButton = window.getByRole('button', { name: /skip/i });
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click();
  }

  await expect(window.getByText(/workspace/i).first()).toBeVisible();
  const spawnButton = window.getByRole('button', { name: /spawn agent/i }).first();
  await expect(spawnButton).toBeVisible();

  await spawnButton.click();
  const spawnHeading = window.getByRole('heading', { name: /spawn agent/i });
  const spawnVisible = await spawnHeading.isVisible().catch(() => false);
  if (spawnVisible) {
    const agentSelect = window.locator('form select').first();
    const optionCount = await agentSelect.locator('option').count();
    if (optionCount > 1) {
      await agentSelect.selectOption({ index: 1 });
      await expect(window.getByText(/spawn agent/i).first()).toBeVisible();
    }

    await window.getByRole('button', { name: /^cancel$/i }).first().click();
    await expect(spawnHeading).toHaveCount(0);
  }

  await window.getByTitle('Workspace Settings').click();
  await expect(window.getByText(/workspace settings/i).first()).toBeVisible();
  await window.getByRole('button', { name: /^cancel$/i }).first().click();
  await expect(window.getByText(/workspace settings/i)).toHaveCount(0);

  await electronApp.close();
});
