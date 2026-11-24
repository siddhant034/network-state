import { expect, test } from "@playwright/test";

const storageKey = "network-state:network-lab-configs:v1";

test("iPhone WebKit touch viewport can save and reload a config without running it", async ({ page }) => {
  const endpoint = "https://api.example.test/ios/health?token=ios-private";
  let endpointRequests = 0;
  page.context().on("request", (request) => {
    if (request.url().startsWith(endpoint)) endpointRequests += 1;
  });

  await page.goto("/");
  const environment = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    touchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches
  }));

  expect(environment.viewportWidth).toBe(390);
  expect(environment.viewportHeight).toBe(844);
  expect(environment.documentWidth).toBeLessThanOrEqual(environment.viewportWidth);
  expect(environment.touchPoints).toBeGreaterThan(0);
  expect(environment.coarsePointer).toBe(true);

  const panel = page.locator(".network-lab-panel");
  const transfer = page.locator(".network-lab-config-transfer");
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("Test endpoints")).toBeVisible();
  await expect(page.getByLabel("Config name")).toBeVisible();
  await expect(page.getByLabel("Import saved configs")).toBeVisible();

  const bounds = await page.evaluate(() => {
    const read = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    };
    return {
      panel: read(".network-lab-panel"),
      transfer: read(".network-lab-config-transfer")
    };
  });
  for (const rect of [bounds.panel, bounds.transfer]) {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(environment.viewportWidth);
  }

  await page.getByLabel("Test endpoints").fill(endpoint);
  await page.getByLabel("Config name").fill("iPhone touch config");
  await page.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(page.getByText("Config saved in this browser only.", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "iPhone touch config" })).toBeAttached();

  const saved = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: Array<{ endpoints: string[] }> } : null;
  }, storageKey);
  expect(saved?.configs[0]?.endpoints).toContain(endpoint);

  await page.getByLabel("Saved configs", { exact: true }).selectOption({ label: "iPhone touch config" });
  await page.getByRole("button", { name: "Load", exact: true }).tap();
  await expect(page.getByLabel("Test endpoints")).toHaveValue(endpoint);
  await expect(page.getByRole("button", { name: "Run test" })).toBeEnabled();

  // Touch-only smoke coverage saves and loads browser-local data; it never starts a probe.
  expect(endpointRequests).toBe(0);
});
