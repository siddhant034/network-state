import { expect, test } from "@playwright/test";

const storageKey = "network-state:network-lab-configs:v1";
const endpoint = "https://api.example.test/ios/health?token=ios-private#mobile-session";

test("iPhone WebKit touch can save and reload a config without running it", async ({ page }) => {
  let fixtureRequests = 0;
  page.context().on("request", (request) => {
    if (new URL(request.url()).origin === "https://api.example.test") fixtureRequests += 1;
  });

  await page.goto("./");
  const environment = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    screenHeight: window.screen.height,
    documentWidth: document.documentElement.scrollWidth,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches
  }));

  expect(environment.viewportWidth).toBe(390);
  expect(environment.screenHeight).toBe(844);
  expect(environment.viewportHeight).toBeGreaterThan(600);
  expect(environment.viewportHeight).toBeLessThanOrEqual(environment.screenHeight);
  expect(environment.documentWidth).toBeLessThanOrEqual(environment.viewportWidth);
  expect(environment.coarsePointer).toBe(true);

  const panel = page.locator(".network-lab-panel");
  const configs = page.locator(".network-lab-configs");
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("Test endpoints")).toBeVisible();
  await expect(page.getByLabel("Configuration name")).toBeVisible();
  await expect(page.getByLabel("Saved configurations")).toBeVisible();

  const bounds = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout element: ${selector}`);
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    };
    return {
      documentWidth: document.documentElement.scrollWidth,
      panel: rect(".network-lab-panel"),
      configs: rect(".network-lab-configs")
    };
  });
  expect(bounds.documentWidth).toBeLessThanOrEqual(environment.viewportWidth);
  for (const box of [bounds.panel, bounds.configs]) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(environment.viewportWidth);
  }

  const save = page.getByRole("button", { name: "Save configuration", exact: true });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.includes("Save configuration")
    );
    if (!button) throw new Error("Save configuration button not found");
    button.dataset.touchSmoke = "pending";
    button.addEventListener("touchstart", () => {
      button.dataset.touchSmoke = "received";
    }, { once: true, passive: true });
  });

  await page.getByLabel("Test endpoints").fill(endpoint);
  await page.getByLabel("Configuration name").fill("iPhone touch smoke");
  await save.tap();
  await expect(save).toHaveAttribute("data-touch-smoke", "received");
  await expect(page.locator(".network-lab-message")).toContainText(
    "Query strings and fragments were removed"
  );

  const saved = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Array<{ name: string; endpointInput: string }> : [];
  }, storageKey);
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe("iPhone touch smoke");
  expect(saved[0].endpointInput).toBe("https://api.example.test/ios/health");
  expect(JSON.stringify(saved)).not.toContain("ios-private");
  expect(JSON.stringify(saved)).not.toContain("mobile-session");

  await page.getByLabel("Saved configurations").selectOption({ label: "iPhone touch smoke" });
  await page.getByRole("button", { name: "Load", exact: true }).tap();
  await expect(page.getByLabel("Test endpoints")).toHaveValue(
    "https://api.example.test/ios/health"
  );
  await expect(page.getByRole("button", { name: "Run test" })).toBeEnabled();

  // This touch smoke saves and loads local data only; it must not run a probe.
  expect(fixtureRequests).toBe(0);
});
