import { test, expect } from "@playwright/test";

test("themes switch the supplied artwork and video together and persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "See the ripple, reach, and signal. Before you post.",
    }),
  ).toBeVisible();
  await expect(page.locator(".hero-rotating-word")).toHaveText("reach.", {
    timeout: 5000,
  });
  await expect(page.locator(".hero-rotating-word")).toHaveCSS("text-decoration-line", "underline");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("video")).toHaveAttribute(
    "src",
    "/videos/ripple-demo-dark.mp4",
  );
  expect(
    await page
      .locator(".sky-night")
      .evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain("dark_background.png");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("video")).toHaveAttribute(
    "src",
    "/videos/ripple-demo-light.mp4",
  );
  expect(
    await page
      .locator(".sky-day")
      .evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain("liight_background.png");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".video-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("real video plays and pauses without a timeline bar", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#demo");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => ({
        ready: (v as HTMLVideoElement).readyState,
        duration: (v as HTMLVideoElement).duration,
      })),
    )
    .toMatchObject({ ready: 4 });
  expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).duration)).toBeGreaterThan(30);
  await expect(page.getByRole("slider", { name: "Demo video progress" })).toHaveCount(0);
  await expect(page.locator(".player-controls")).toHaveCount(0);
  await expect(page.locator("video")).not.toHaveAttribute("controls", "");
  await expect(page.getByRole("button", { name: "Play demo" })).toBeVisible();
  await page.getByRole("button", { name: "Play demo" }).click();
  await expect(page.getByRole("button", { name: "Pause demo" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause demo" }).click();
  const paused = await page
    .locator("video")
    .evaluate((v) => (v as HTMLVideoElement).paused);
  expect(paused).toBe(true);
  await expect(page.getByRole("button", { name: "Restart demo" })).toHaveCount(0);
  expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).loop)).toBe(true);
});

test("reduced motion stops background animation and automatic playback", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#demo");
  expect(
    await page
      .locator(".sky-night")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => (v as HTMLVideoElement).paused),
    )
    .toBe(true);
});

test("mobile navigation works without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByText("Product", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "How it works" })
    .click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("animated feature illustrations, short FAQ and creator credit work in both themes", async ({ page }) => {
  await page.goto('/#how-it-works');
  const pictures = page.locator('.feature-visual svg');
  await expect(pictures).toHaveCount(3);
  await expect(page.locator('.feature-visual img')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Connected audience interests' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'An idea becomes an image and a video' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Two drafts compared through engagement signals' })).toBeVisible();
  const faq = page.getByRole('region', { name: 'Frequently asked questions' });
  await faq.locator('summary').filter({ hasText: 'Can Ripple create campaign media?' }).click();
  await expect(faq.getByText('Yes. Generate campaign ideas, images and videos, or bring your own drafts.')).toBeVisible();
  await expect(page.locator('footer.ripple-footer')).toContainText('Made with ♥ by Irfan & Ansh');
  await expect(page.locator('a[href^="/research/"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.feature-card-float').first()).toHaveCSS('animation-name', 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("public planning links resolve", async ({ request }) => {
  for (const path of [
    "/research/ripple-design.md",
    "/research/ripple-fact-check.md",
  ]) {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toContain("Ripple");
  }
});

test("failed video offers recovery rather than a broken player", async ({
  page,
}) => {
  await page.route("**/videos/*.mp4", (route) => route.abort());
  await page.goto("/#demo");
  await expect(page.getByText("The preview could not load.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
});

test("Get started opens the separate responsive auth page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/?(?:#.*)?$/);
  await expect(page.getByRole("link", { name: "Ripple home", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Ripple landscape" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "Ripple landscape" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Back to Ripple", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/auth/sign-in");
  await expect(page).toHaveTitle("Ripple");
  await expect(page.locator(".auth-page")).toBeVisible();
});
