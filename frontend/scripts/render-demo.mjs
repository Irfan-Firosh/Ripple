import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, rm, copyFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'public/videos');
const base = process.env.DEMO_URL || 'http://127.0.0.1:5173';
const encode = args => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
});
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
// Choose the newest completed experiment through the real product controls.
const scout = await browser.newPage();
await scout.goto(`${base}/lab?brand=raycast.com`, { waitUntil: 'domcontentloaded' });
await scout.locator('.lab-dock-done, .lab-experiment-tile[data-status="done"]').first().waitFor({ timeout: 60000 });
await scout.locator('.lab-dock-done, .lab-experiment-tile[data-status="done"]').first().click();
await scout.locator('.lab-column, .lab-post-column').first().waitFor({ timeout: 60000 });
const demoExperiment = new URL(scout.url()).searchParams.get('exp');
await scout.close();
if (!demoExperiment) { await browser.close(); throw new Error('No completed A/B experiment is available.'); }
try {
  const themes = process.env.DEMO_THEME ? [process.env.DEMO_THEME] : ['dark', 'light'];
  if (themes.some(t => !['dark', 'light'].includes(t))) throw new Error('DEMO_THEME must be dark or light');
  for (const theme of themes) {
    const temp = await mkdtemp(join(tmpdir(), 'ripple-real-demo-'));
    try {
      for (const scene of ['audience', 'lab']) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, recordVideo: { dir: temp, size: { width: 1280, height: 800 } } });
        const page = await context.newPage();
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(`${base}/?film=1&theme=${theme}&brand=${scene === 'lab' ? 'raycast.com' : 'spacetimedb'}${scene === 'lab' ? `&exp=${demoExperiment}` : ''}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.__setDemoTime === 'function');
        if (scene === 'lab') {
          await page.evaluate(() => window.__setDemoTime(12));
          await page.waitForSelector('.lab-post-column, .lab-column', { timeout: 60000 });
          await page.waitForSelector('.lab-summary, .lab-verdict', { timeout: 60000 });
          await page.evaluate(() => { document.documentElement.style.zoom = '.85'; });
          await page.getByRole('button', { name: /^Replay(?: reactions)?$/, exact: true }).click();
          await page.waitForTimeout(12000);
          await page.evaluate(() => window.scrollTo({ top: document.querySelector('.lab-verdict') ? 0 : document.documentElement.scrollHeight, behavior: 'smooth' }));
          await page.waitForTimeout(4000);
          await page.screenshot({ path: join(temp, 'poster.png') });
          await copyFile(join(temp, 'poster.png'), join(output, `ripple-demo-${theme}.next.png`));
          await rename(join(output, `ripple-demo-${theme}.next.png`), join(output, `ripple-demo-${theme}.png`));
        } else {
          await page.waitForSelector('.nt-stage>canvas[data-sprite-count]', { timeout: 60000 });
          await page.getByRole('button', { name: 'Replay', exact: true }).click();
          await page.waitForTimeout(4000);
          await page.getByLabel('Niche index').getByRole('button', { name: /^01 / }).click();
          await page.waitForTimeout(4000);
          await page.getByRole('button', { name: 'All niches', exact: true }).click();
          await page.waitForTimeout(4000);
        }
        const video = page.video();
        await context.close();
        if (errors.length) throw new Error(errors.join('\n'));
        const recorded = await video.path();
        // Trim loading and navigation: keep only the actual interaction chapter.
        await encode(['-sseof', scene === 'lab' ? '-16' : '-12', '-i', recorded, '-vf', 'fps=24', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', join(temp, `${scene}.mp4`)]);
        console.log(`${theme}: captured real ${scene} screen`);
      }
      await writeFile(join(temp, 'chapters.txt'), "file 'audience.mp4'\nfile 'lab.mp4'\n");
      await encode(['-f', 'concat', '-safe', '0', '-i', join(temp, 'chapters.txt'), '-c', 'copy', '-movflags', '+faststart', join(output, `ripple-demo-${theme}.next.mp4`)]);
      await rename(join(output, `ripple-demo-${theme}.next.mp4`), join(output, `ripple-demo-${theme}.mp4`));
      console.log(`Rendered ${theme} product walkthrough.`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
