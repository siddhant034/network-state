import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Keep diagnostics deterministic and offline: every app-owned fetch/XHR gets
  // a successful HTTP response without contacting an external service.
  await page.route("**/*", async (route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === "fetch" || resourceType === "xhr") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }
      });
      return;
    }
    await route.continue();
  });

  await page.goto("./");
  await expect(page.locator(".probe-state")).toContainText("Reachable");
});

test("renders the diagnostic dashboard and core investigation panels", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Latency history" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Availability & recovery" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Correlated incident timeline" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Network testing lab" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Export diagnostics" })).toBeVisible();
});

test("supports pausing and resuming monitoring", async ({ page }) => {
  await page.getByRole("button", { name: "Pause monitoring" }).click();
  await expect(page.getByRole("button", { name: "Resume monitoring" })).toBeVisible();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resume monitoring" }).click();
  await expect(page.getByRole("button", { name: "Pause monitoring" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test("saves, reloads, and deletes a redacted lab configuration", async ({ page }) => {
  const lab = page.getByRole("region", { name: "Network testing lab" });
  const endpoint = new URL("health?token=private-value#session", page.url()).toString();

  await lab.getByLabel("Test endpoints").fill(endpoint);
  await lab.getByLabel("Configuration name").fill("Cross-browser smoke");
  await lab.getByRole("button", { name: "Save configuration" }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("Query strings and fragments were removed");

  const stored = await page.evaluate(() => {
    const value = localStorage.getItem("network-state:network-lab-configs:v1");
    return value ? JSON.parse(value) as Array<{ name: string; endpointInput: string }> : [];
  });
  expect(stored).toHaveLength(1);
  expect(stored[0].name).toBe("Cross-browser smoke");
  expect(stored[0].endpointInput).not.toContain("private-value");
  expect(stored[0].endpointInput).not.toContain("#session");

  await lab.getByLabel("Saved configurations").selectOption({ label: "Cross-browser smoke" });
  await lab.getByRole("button", { name: "Load", exact: true }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("Loaded");
  await lab.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("deleted from this device");
  await expect(lab.getByLabel("Saved configurations")).toHaveValue("");
});

test("runs a bounded lab request and reports the HTTP response", async ({ page }) => {
  const lab = page.getByRole("region", { name: "Network testing lab" });
  await lab.getByLabel("Requests / endpoint").selectOption("1");
  await lab.getByLabel("Retries").selectOption("0");
  await lab.getByRole("button", { name: "Run test" }).click();

  await expect(lab.getByRole("status")).toContainText("Run complete");
  await expect(lab.locator(".network-lab-results")).toContainText("Reachable");
});

test("provides a keyboard skip link and a visible focus target", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("passes the automated WCAG A and AA accessibility smoke audit", async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice"
    ])
    .analyze();

  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("downloads a JSON diagnostics snapshot", async ({ page }) => {
  const diagnostics = page.getByRole("region", { name: "Export diagnostics" });
  const downloadPromise = page.waitForEvent("download");
  await diagnostics.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^network-state-.*\.json$/);
});

test("does not contact third-party origins", async ({ page }) => {
  const appOrigin = new URL(page.url()).origin;
  const externalRequests: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.reload();
  await expect(page.locator(".probe-state")).toContainText("Reachable");
  expect(externalRequests).toEqual([]);
});

test("keeps request telemetry bounded during a burst", async ({ page }) => {
  await page.getByRole("button", { name: "Enable monitoring" }).click();
  await expect(page.getByRole("button", { name: "Stop monitoring" })).toBeVisible();

  await page.evaluate(async () => {
    await Promise.all(
      Array.from({ length: 120 }, (_, index) => fetch(`/__network-state-stress/${index}`))
    );
  });

  await expect(page.locator(".request-summary")).toContainText("100 requests observed");
});
