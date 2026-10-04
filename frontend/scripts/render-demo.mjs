import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'public/videos');
const base = process.env.DEMO_URL || 'http://127.0.0.1:5173';
const brand = process.env.DEMO_BRAND || 'trycua';
const themes = process.env.DEMO_THEME ? [process.env.DEMO_THEME] : ['dark', 'light'];
if (themes.some(theme => !['dark', 'light'].includes(theme))) throw new Error('DEMO_THEME must be dark or light');
const encode = args => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
});
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const scout = await browser.newPage();
  await scout.goto(`${base}/`);
  // Select a saved generated campaign with completed media and Lab results.
  const saved = await scout.evaluate(async brand => {
    const { sql } = await import('/src/audience/liveAudience.ts');
    const [flows, experiments, videos] = await Promise.all([sql('SELECT * FROM campaign_flow'), sql('SELECT * FROM lab_experiment'), sql('SELECT * FROM campaign_video')]);
    const flow = flows.filter(row => row.brand === brand && row.source === 'generate'
      && experiments.some(exp => Number(exp.experiment_id) === Number(row.experiment_id) && exp.status === 'done')
      && videos.some(video => video.campaign_id === row.campaign_id && video.status === 'done')).sort((a, b) => Number(b.updated_at) - Number(a.updated_at))[0];
    if (!flow) throw new Error(`No completed generated campaign for @${brand}.`);
    return { campaign: flow.campaign_id, experiment: String(flow.experiment_id) };
  }, brand);
  await scout.close();
  for (const theme of themes) {
    const temp = await mkdtemp(join(tmpdir(), 'ripple-product-demo-'));
    const chapters = ['audience', 'campaign', 'lab', 'spread', 'analysis'];
    try {
      for (const scene of chapters) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: temp, size: { width: 1280, height: 800 } } });
        // Guard captures against reducer submissions: only read existing results.
        const writes = [];
        await context.route('**/call/**', route => { writes.push(route.request().url().split('/call/')[1]); return route.abort(); });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const query = new URLSearchParams({ film: '1', theme, brand, exp: saved.experiment, id: saved.campaign });
        await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.__setDemoTime === 'function');
        let seconds = 8;
        if (scene === 'audience') {
          await page.locator('.nt-stage>canvas[data-sprite-count]').waitFor({ timeout: 60000 });
          await page.waitForTimeout(1000);
          await page.getByLabel('Interest index').getByRole('button', { name: /^01 / }).click();
          await page.waitForTimeout(3500);
          await page.getByRole('button', { name: 'All interests', exact: true }).click();
          await page.waitForTimeout(4500);
        } else if (scene === 'campaign') {
          await page.evaluate(() => window.__setDemoTime(12));
          await page.locator('.flow-pair video').first().waitFor({ timeout: 60000 });
          await page.locator('.flow-pair').scrollIntoViewIfNeeded();
          await page.waitForFunction(() => [...document.querySelectorAll('.flow-pair video')].every(video => video.readyState >= 2));
          await page.locator('.flow-pair video').evaluateAll(videos => videos.forEach(video => { video.controls = false; video.muted = true; }));
          await page.locator('.flow-pair video').first().evaluate(video => video.play());
          await page.waitForFunction(() => document.querySelector('.flow-pair video').currentTime > 1);
          await page.waitForFunction(() => [...document.querySelectorAll('.flow-pair img')].every(image => image.complete && image.naturalWidth > 0));
          await page.waitForTimeout(8000);
        } else {
          await page.evaluate(() => window.__setDemoTime(20));
          await page.locator('.lab-columns').waitFor({ timeout: 60000 });
          await page.locator('.lab-tweet-media').first().waitFor({ timeout: 60000 });
          await page.locator('.lab-tweet-media video').evaluateAll(videos => videos.forEach(video => { video.controls = false; }));
          if (scene === 'lab') {
            await page.getByRole('region', { name: 'Draft A reactions' }).getByRole('tab', { name: 'Reposts', exact: true }).click();
            await page.waitForTimeout(3000);
            await page.locator('.lab-tweet .magic-tweet-scroll').first().evaluate(node => node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' }));
            await page.waitForTimeout(5000);
            await page.screenshot({ path: join(output, `ripple-demo-${theme}.png`) });
          } else {
            await page.getByRole('button', { name: 'Side-by-side analysis' }).click();
            const dialog = page.getByRole('dialog', { name: 'Side-by-side analysis' });
            await dialog.locator('.spread-person').first().waitFor({ timeout: 60000 });
            if (scene === 'spread') {
              seconds = 10;
              await page.waitForTimeout(10000);
            } else {
              await dialog.getByRole('region', { name: 'Engagement over time' }).scrollIntoViewIfNeeded();
              await page.waitForTimeout(8000);
            }
          }
        }
        const video = page.video(); await context.close();
        if (writes.length) throw new Error(`Capture attempted a reducer: ${writes.join(', ')}`);
        if (errors.length) throw new Error(errors.join('\n'));
        await encode(['-sseof', `-${seconds}`, '-i', await video.path(), '-vf', 'fps=24', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', join(temp, `${scene}.mp4`)]);
        console.log(`${theme}: captured ${scene}`);
      }
      const fade = .65, lengths = [8, 8, 8, 10, 8];
      const filters = chapters.map((_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
      let length = lengths[0];
      for (let i = 1; i < chapters.length; i++) {
        filters.push(`[${i === 1 ? 'v0' : `fade${i - 1}`}][v${i}]xfade=transition=fade:duration=${fade}:offset=${(length - fade).toFixed(2)}[fade${i}]`);
        length += lengths[i] - fade;
      }
      await encode([...chapters.flatMap(scene => ['-i', join(temp, `${scene}.mp4`)]), '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[fade4]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, `ripple-demo-${theme}.next.mp4`)]);
      await rename(join(output, `ripple-demo-${theme}.next.mp4`), join(output, `ripple-demo-${theme}.mp4`));
      console.log(`Rendered ${theme}: @${brand}, campaign ${saved.campaign}, experiment ${saved.experiment}.`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
