import { chromium } from "playwright-core";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "public/videos");
const duration = 28,
  fps = 24;
const base = process.env.DEMO_URL || "http://127.0.0.1:5173";
const encode = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const themes = process.env.DEMO_THEME ? [process.env.DEMO_THEME] : ["dark", "light"];
  if (themes.some(theme => !["dark", "light"].includes(theme))) throw new Error("DEMO_THEME must be dark or light");
  for (const theme of themes) {
    const temp = await mkdtemp(join(tmpdir(), "ripple-demo-"));
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto(`${base}/?film=1&theme=${theme}`, {
        waitUntil: "networkidle",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => typeof window.__setDemoTime === "function",
      );
      await page.evaluate(() => window.__setDemoTime(18));
      await page.screenshot({ path: join(temp, "poster.png") });
      await copyFile(
        join(temp, "poster.png"),
        join(output, `ripple-demo-${theme}.png`),
      );
      for (let frame = 0; frame < duration * fps; frame++) {
        await page.evaluate((time) => window.__setDemoTime(time), frame / fps);
        // Wait for React's commit and a paint; every screenshot is a deterministic frame.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => resolve(null)),
            ),
        );
        await page.screenshot({
          path: join(temp, `${String(frame).padStart(5, "0")}.png`),
          animations: "disabled",
        });
        if (frame % (fps * 4) === 0)
          console.log(`${theme}: ${frame / fps}s / ${duration}s`);
      }
      await encode([
        "-framerate",
        String(fps),
        "-i",
        join(temp, "%05d.png"),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        join(output, `ripple-demo-${theme}.mp4`),
      ]);
      console.log(`Rendered ${theme} walkthrough.`);
    } finally {
      await page.close();
      await rm(temp, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
