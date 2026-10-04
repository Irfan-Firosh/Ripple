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
  expect(
    await page
      .locator(".hero-rotating-word")
      .evaluate((el) => getComputedStyle(el).textDecorationLine),
  ).toBe("underline");
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

test("real video decodes, plays, pauses, seeks and restarts", async ({
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
    .toMatchObject({ duration: 28 });
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
  await page.getByRole("slider", { name: "Demo video progress" }).fill("19");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => Math.floor((v as HTMLVideoElement).currentTime)),
    )
    .toBe(19);
  await page.getByRole("button", { name: "Restart demo" }).click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeLessThan(3);
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

test("walkthrough uses the actual live audience and Lab screens", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/?film=1&theme=light&brand=spacetimedb");
  await page.waitForFunction(() => typeof window.__setDemoTime === "function");
  await expect(page.locator(".nt-stage>canvas")).toBeVisible({ timeout: 45000 });
  await expect(page.getByLabel("Niche index")).toBeVisible();
  expect(Number(await page.locator(".nt-stage>canvas").getAttribute("data-node-count"))).toBeGreaterThan(50);
  await page.evaluate(() => window.__setDemoTime(12));
  await expect(page.locator(".lab-post-column, .lab-column")).toHaveCount(2, { timeout: 45000 });
  await expect(page.locator(".lab-summary, .lab-verdict").first()).toContainText(/A wins|B wins|Too close to call/);
  await expect(page.locator(".lab-post-column article, .lab-column>article")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText(/Illustrative data|counterfactual|New comparison queued/);
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
  await expect(page).toHaveTitle("Sign in — Ripple");
  await expect(page.locator(".auth-page")).toBeVisible();
});
