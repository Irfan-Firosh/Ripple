import { test, expect } from "@playwright/test";

const snapshot = {
  database: "ripple-test",
  server: "http://127.0.0.1:3100",
  worker: { state: "offline", lastSeen: "2026-10-04T10:00:00Z" },
  sources: [
    { name: "Worker", lines: ["Starting creative job", "Waiting for provider"] },
    { name: "Database", lines: ["Reducer completed"] },
  ],
  updatedAt: "2026-10-04T10:00:03Z",
};

test("logs show both sources, poll, and pause updates", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-04T10:00:00Z") });
  let requests = 0;
  await page.route("**/api/logs", async (route) => {
    requests += 1;
    await route.fulfill({ json: { ...snapshot, sources: [
      { name: "Worker", lines: [`Worker update ${requests}`] },
      snapshot.sources[1],
    ] } });
  });
  await page.goto("/logs");
  await expect(page.getByRole("heading", { name: "Server logs" })).toBeVisible();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await expect(page.getByRole("region", { name: "Database", exact: true })).toContainText("Reducer completed");
  await expect(page.getByText("The worker is offline.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  const initialRequests = requests;
  expect(initialRequests).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("region", { name: "Worker", exact: true })).toContainText(`Worker update ${initialRequests}`);
  await page.clock.fastForward(3000);
  await expect(page.getByRole("region", { name: "Worker", exact: true })).toContainText(`Worker update ${initialRequests + 1}`);
  expect(requests).toBe(initialRequests + 1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const pausedRequests = requests;
  await page.clock.fastForward(6000);
  expect(requests).toBe(pausedRequests);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("region", { name: "Worker", exact: true })).toContainText(`Worker update ${pausedRequests + 1}`);
});

test("a failed refresh retains logs and retry recovers", async ({ page }) => {
  let fail = false;
  await page.route("**/api/logs", (route) => route.fulfill(fail
    ? { status: 503, json: { error: "Log service unavailable" } }
    : { json: snapshot }));
  await page.goto("/logs");
  await expect(page.getByText("Starting creative job", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  fail = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Log service unavailable");
  await expect(page.getByText("Starting creative job", { exact: false })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
