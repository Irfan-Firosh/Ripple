import { test, expect } from '@playwright/test';

test('/test renders the same live audience as the dashboard', async ({ page }) => {
  await page.goto('/test');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toBeVisible({ timeout: 20000 });
  expect(Number(await canvas.getAttribute('data-node-count'))).toBeGreaterThan(50);
  await expect(page.getByRole('link', { name: 'Back to workspace' })).toHaveAttribute('href', '/dashboard');
});
