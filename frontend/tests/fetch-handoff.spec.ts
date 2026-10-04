import { test, expect } from '@playwright/test';

// Campaign handoffs are covered by fetch-workflow.spec.ts; this retains the new-company check.
test.skip(process.env.RIPPLE_FETCH_LIVE_TEST !== '1', 'Requires scripts/fetch_demo_check.py --onboard resend.');
test.setTimeout(360_000);

test('fresh-company onboarding opens its live graph with the correct handle', async ({ page }) => {
  await page.goto('/onboarding?brand=resend');
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'See your audience' })).toBeEnabled({ timeout: 300_000 });
  await page.getByRole('button', { name: 'See your audience' }).click();
  await expect(page).toHaveURL(/\/dashboard\?brand=resend$/);
  await expect(page.locator('canvas[data-node-count]')).toHaveAttribute('data-node-count', /^[1-9]\d*$/, { timeout: 60_000 });
});
