import { test, expect } from '@playwright/test';

test('/test renders the same live audience as the dashboard', async ({ page }) => {
  await page.goto('/test');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toBeVisible({ timeout: 20000 });
  expect(Number(await canvas.getAttribute('data-node-count'))).toBeGreaterThan(50);
  await expect(page.getByRole('link', { name: 'Back to workspace' })).toHaveAttribute('href', '/dashboard');
  // A short viewport previously exposed page scrolling beneath wheel zoom.
  await page.setViewportSize({ width: 1100, height: 550 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await canvas.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-zoom'))).toBeLessThan(1);
  await page.mouse.wheel(0, -800);
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-zoom'))).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator('.network-test').evaluate(el => el.getBoundingClientRect().top)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
