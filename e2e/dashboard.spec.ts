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

test("saves, reloads, and confirms saved-config deletion and clearing with keyboard-safe focus", async ({ page }) => {
  const lab = page.getByRole("region", { name: "Network testing lab" });
  const endpoint = new URL("health?token=private-value#session", page.url()).toString();

  await lab.getByLabel("Test endpoints").fill(endpoint);
  await lab.getByLabel("Configuration name").fill("Cross-browser smoke");
  await lab.getByRole("button", { name: "Save configuration" }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("Query strings and fragments were removed");

  const stored = async () => page.evaluate(() => {
    const value = localStorage.getItem("network-state:network-lab-configs:v1");
    return value ? JSON.parse(value) as Array<{ name: string; endpointInput: string }> : [];
  });
  const saved = await stored();
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe("Cross-browser smoke");
  expect(saved[0].endpointInput).not.toContain("private-value");
  expect(saved[0].endpointInput).not.toContain("#session");

  await lab.getByLabel("Saved configurations").selectOption({ label: "Cross-browser smoke" });
  await lab.getByRole("button", { name: "Load", exact: true }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("Loaded");

  const deleteTrigger = lab.getByRole("button", { name: "Delete", exact: true });
  await deleteTrigger.click();
  const deleteConfirmation = lab.getByRole("group", { name: "Delete saved config?" });
  await expect(deleteConfirmation).toBeVisible();
  await expect(deleteConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteConfirmation).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  expect(await stored()).toHaveLength(1);

  await deleteTrigger.click();
  await deleteConfirmation.getByRole("button", { name: "Delete saved config", exact: true }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("deleted from this device");
  await expect(lab.getByLabel("Saved configurations")).toHaveValue("");
  expect(await stored()).toHaveLength(0);
  await expect(lab.getByLabel("Configuration name")).toBeFocused();

  await lab.getByLabel("Configuration name").fill("Clear config");
  await lab.getByRole("button", { name: "Save configuration" }).click();
  const clearTrigger = lab.getByRole("button", { name: "Clear all", exact: true });
  await clearTrigger.click();
  const clearConfirmation = lab.getByRole("group", { name: "Clear all saved configs?" });
  await expect(clearConfirmation).toBeVisible();
  await expect(clearConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(clearConfirmation).toBeHidden();
  await expect(clearTrigger).toBeFocused();
  expect(await stored()).toHaveLength(1);

  await clearTrigger.click();
  await clearConfirmation.getByRole("button", { name: "Delete all saved configs", exact: true }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("All saved configurations cleared");
  await expect(lab.getByLabel("Saved configurations")).toBeDisabled();
  expect(await stored()).toHaveLength(0);
  await expect(lab.getByLabel("Configuration name")).toBeFocused();
  await expect(lab.getByLabel("Configuration name")).toHaveValue("Clear config");
});

test("imports saved configs through a private preview and exports a portable file without running endpoints", async ({ page }) => {
  const lab = page.getByRole("region", { name: "Network testing lab" });
  const input = lab.getByLabel("Import saved configs");
  const endpointInput = lab.getByLabel("Test endpoints");
  const originalEndpoint = await endpointInput.inputValue();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.example.test/")) requests.push(request.url());
  });
  const now = Date.now();
  const payload = {
    format: "network-state-saved-lab-configs",
    schemaVersion: 1,
    exportedAt: now,
    configs: [{
      id: "portable-office",
      name: "Portable office",
      endpointInput: "https://api.example.test/private/health",
      requestsPerEndpoint: 3,
      concurrency: 2,
      timeoutSeconds: 5,
      retries: 1,
      simulatedLatencyMs: 0,
      simulatedFailureRate: 0,
      updatedAt: now
    }]
  };
  const file = {
    name: "network-state-saved-lab-configs.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload))
  };

  await input.setInputFiles(file);
  const preview = lab.getByRole("region", { name: "Review import" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Portable office");
  await expect(preview).not.toContainText("/private/health");
  await expect(preview.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("network-state:network-lab-configs:v1"))).toBeNull();

  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("network-state:network-lab-configs:v1"))).toBeNull();

  await input.setInputFiles(file);
  await preview.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(lab.locator(".network-lab-transfer-status")).toContainText("nothing was run");
  const stored = await page.evaluate(() => {
    const value = localStorage.getItem("network-state:network-lab-configs:v1");
    return value ? JSON.parse(value) as Array<{ id: string; endpointInput: string }> : [];
  });
  expect(stored).toHaveLength(1);
  expect(stored[0].id).toBe("portable-office");
  expect(stored[0].endpointInput).toBe("https://api.example.test/private/health");
  expect(await endpointInput.inputValue()).toBe(originalEndpoint);
  expect(requests).toHaveLength(0);

  await lab.getByRole("button", { name: "Load", exact: true }).click();
  await expect(endpointInput).toHaveValue("https://api.example.test/private/health");
  expect(requests).toHaveLength(0);

  const downloadPromise = page.waitForEvent("download");
  await lab.getByRole("button", { name: "Export saved configs", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("network-state-saved-lab-configs.json");
});

test("synchronizes saved-config changes and corruption recovery across same-origin tabs", async ({ page, context }) => {
  const lab = page.getByRole("region", { name: "Network testing lab" });
  const secondTab = await context.newPage();
  await secondTab.route("**/*", async (route) => {
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
  await secondTab.goto(new URL("./", page.url()).toString());
  const otherLab = secondTab.getByRole("region", { name: "Network testing lab" });
  await expect(otherLab.getByLabel("Saved configurations")).toBeDisabled();

  await lab.getByLabel("Test endpoints").fill("https://api.example.test/health?token=private-value");
  await lab.getByLabel("Configuration name").fill("Shared config");
  await lab.getByRole("button", { name: "Save configuration" }).click();
  await expect(otherLab.getByLabel("Saved configurations")).toContainText("Shared config");

  await lab.getByLabel("Configuration name").fill("Updated in another tab");
  await lab.getByRole("button", { name: "Save configuration" }).click();
  await expect(otherLab.getByLabel("Saved configurations")).toContainText("Updated in another tab");
  await expect(otherLab.locator(".network-lab-message")).toContainText("updated in another tab");

  await page.evaluate(() => {
    localStorage.setItem("network-state:network-lab-configs:v1", "{broken");
  });
  await expect(otherLab.getByRole("option", { name: "Updated in another tab" })).toBeAttached();
  await expect(otherLab.locator(".network-lab-error")).toContainText("last valid list is still shown");
  await expect(otherLab.locator(".network-lab-error")).not.toContainText("private-value");

  await page.evaluate(() => localStorage.clear());
  await expect(otherLab.getByLabel("Saved configurations")).toBeDisabled();
  await expect(otherLab.locator(".network-lab-message")).toContainText("cleared in another tab");
  await expect(otherLab.getByRole("option", { name: "Updated in another tab" })).toHaveCount(0);
  await secondTab.close();
});

test("saved-config controls fit and remain usable at a narrow 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const lab = page.getByRole("region", { name: "Network testing lab" });
  const fixtureRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.example.test/")) fixtureRequests.push(request.url());
  });

  await expect(lab).toBeVisible();
  await expect(lab.getByLabel("Test endpoints")).toBeVisible();
  await expect(lab.getByLabel("Configuration name")).toBeVisible();
  await expect(lab.getByLabel("Saved configurations")).toBeVisible();
  await expect(lab.getByRole("button", { name: "Save configuration" })).toBeVisible();

  const layout = await page.evaluate(() => {
    const selectors = [".network-lab-panel", ".network-lab-configs", ".network-lab-config-save", ".network-lab-config-load"];
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panels: selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error("Missing responsive lab element: " + selector);
        const rect = element.getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right };
      })
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  for (const panel of layout.panels) {
    expect(panel.left, panel.selector).toBeGreaterThanOrEqual(0);
    expect(panel.right, panel.selector).toBeLessThanOrEqual(layout.viewportWidth);
  }

  await lab.getByLabel("Test endpoints").fill("https://api.example.test/mobile/health?token=mobile-private");
  await lab.getByLabel("Configuration name").fill("Narrow mobile config");
  await lab.getByRole("button", { name: "Save configuration" }).click();
  await expect(lab.locator(".network-lab-message")).toContainText("Query strings and fragments were removed");
  await expect(lab.getByRole("option", { name: "Narrow mobile config" })).toBeAttached();

  await lab.getByLabel("Saved configurations").selectOption({ label: "Narrow mobile config" });
  await lab.getByRole("button", { name: "Load", exact: true }).click();
  await expect(lab.getByLabel("Test endpoints")).toHaveValue("https://api.example.test/mobile/health");
  expect(fixtureRequests).toEqual([]);
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
