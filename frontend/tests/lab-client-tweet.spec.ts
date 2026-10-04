import { test, expect } from '@playwright/test';

test('Magic UI draft card shows generated image and video, then clears media on experiment change', async ({ page }) => {
  let text = '', ready = false;
  await page.route('**/v1/database/ripple-mhacks/sql', route => {
    const query = route.request().postData() ?? '';
    let rows: Record<string, unknown>[] | null = null;
    if (query.includes('FROM lab_draft_media')) rows = query.includes("'7:A'") ? [{ video_id: 'video-7' }] : [];
    if (query.includes('FROM campaign_flow')) rows = query.includes('experiment_id = 7') ? [{ campaign_id: 'campaign-7', video_id: '', source: 'generate' }] : [];
    if (query.includes('FROM ad_variant')) rows = [{ variant_id: 'image-A', image_url: '/login-dark.png', headline: text, cta: '', status: 'ready' }];
    if (query.includes('FROM campaign_video')) rows = [{ video_url: '/videos/ripple-demo-dark.mp4', thumbnail_url: '/login-dark.png', title: 'Generated campaign video', status: ready ? 'done' : 'brief' }];
    if (rows === null) return route.continue();
    const keys = Object.keys(rows[0] ?? {});
    return route.fulfill({ json: [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }] });
  });
  await page.goto('/lab?brand=raycast.com&exp=7');
  const card = page.getByRole('article', { name: 'Draft A', exact: true });
  await expect(card).toHaveClass(/magic-client-tweet/);
  text = await card.locator('.tweet-body').innerText();
  await expect(card.locator('.lab-tweet-media img')).toBeVisible({ timeout: 15000 });
  await card.getByRole('button', { name: 'Video', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Generating campaign video…');
  ready = true;
  const video = card.getByLabel('Generated campaign video');
  await expect(video).toBeVisible({ timeout: 15000 });
  await expect(video).toHaveAttribute('controls', '');
  expect(await video.evaluate(node => (node as HTMLVideoElement).autoplay)).toBe(false);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  await card.getByRole('button', { name: 'Image', exact: true }).click();
  await expect(card.locator('.lab-tweet-media img')).toBeVisible();
  await page.screenshot({ path: '/tmp/ripple-magic-tweet-media.png', fullPage: true });
  await page.getByRole('navigation', { name: 'Experiments' }).getByRole('button', { name: /Local AI launch/ }).first().click();
  await expect(page).toHaveURL(/exp=3/);
  await expect(page.locator('.lab-generated-media')).toHaveCount(0);
});
