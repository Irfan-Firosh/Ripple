import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: '/private/tmp/ripple-studio-failure.png', fullPage: true }).catch(() => {});
});

// Explicit opt-in: this test uses real Grok calls (~$0.13 plus text) and a seeded local database.
test('live audience → edited brief → Grok takes → approval → draft context', async ({ page }) => {
  test.skip(process.env.RIPPLE_LIVE_CREATIVE_TEST !== '1', 'Requires the local campaign database and paid Grok opt-in.');
  test.setTimeout(360_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const backend = path.resolve(process.cwd(), '../backend');
  const worker = async (campaignId: string) => {
    const result = await promisify(execFile)(path.join(backend, '.venv/bin/python'),
      ['-m', 'creative', 'worker', '--once', '--campaign-id', campaignId], {
        cwd: backend, timeout: 180_000,
        env: { ...process.env, STDB_URL: 'http://127.0.0.1:3100', STDB_DATABASE: 'ripple-campaign-test' },
      });
    const stats = JSON.parse(result.stdout.trim());
    expect(stats.claimed).toBeGreaterThan(0);
    expect(stats.failed).toBe(0);
  };
  await page.goto('/campaigns?brand=raycast.com');
  await page.getByRole('button', { name: 'New campaign', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.campaign-segments input').first()).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Campaign goal').fill('Introduce Raycast AI to people building useful tools.');
  await dialog.getByRole('button', { name: 'Create brief' }).click();
  await expect(page).toHaveURL(/campaign=/);
  const campaignId = new URL(page.url()).searchParams.get('campaign');
  expect(campaignId).toBeTruthy();
  await worker(campaignId!);
  const brief = page.locator('.campaign-brief');
  await expect(brief).toHaveCount(1);
  await brief.getByRole('button', { name: 'Edit brief' }).click();
  await page.getByRole('dialog').getByLabel('Message', { exact: true }).fill('Keep your tools close and make room for the work that matters.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save brief' }).click();
  await expect(brief).toContainText('Keep your tools close');
  await brief.getByRole('button', { name: 'Generate concepts' }).click();
  await worker(campaignId!);
  const concepts = page.locator('.campaign-concept');
  await expect(concepts).toHaveCount(2);
  await expect(page.locator('.campaign-image img')).toHaveCount(2);
  await concepts.first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Headline', { exact: true }).fill('Your next idea, one shortcut away');
  await page.getByRole('dialog').getByRole('button', { name: 'Save copy' }).click();
  await expect(concepts.first()).toContainText('Your next idea, one shortcut away');
  await concepts.first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Image edit', { exact: true }).fill('Make the composition bolder.');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply edit' }).click();
  await worker(campaignId!);
  await expect(concepts).toHaveCount(2);
  await expect(concepts.first()).toContainText('Your next idea, one shortcut away');
  await expect(concepts.first().getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
  await concepts.first().getByRole('button', { name: 'Select', exact: true }).click();
  await concepts.nth(1).getByRole('button', { name: 'Select', exact: true }).click();
  await page.screenshot({ path: '/private/tmp/ripple-studio-live.png', fullPage: true });
  await page.getByRole('button', { name: 'Open in Lab v2' }).click();
  await expect(page.getByLabel('Draft A', { exact: true })).toHaveValue(/Your next idea, one shortcut away/);
  await expect(page.locator('.v2-image')).toHaveCount(2);
  await page.getByText('Sample tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Compare sample', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sample', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('ripple-sample-comparison.json');
  expect(pageErrors).toEqual([]);
});
