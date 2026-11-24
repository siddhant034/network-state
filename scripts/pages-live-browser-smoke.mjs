import { chromium, expect } from "@playwright/test";

const configuredUrl = process.env.PAGES_URL;
if (!configuredUrl) throw new Error("PAGES_URL must be set to the deployed GitHub Pages URL.");

const baseUrl = new URL(configuredUrl);
if (baseUrl.protocol !== "https:") throw new Error("The published Pages URL must use HTTPS.");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const externalRequests = [];
const pageErrors = [];

page.on("request", (request) => {
  const requestUrl = new URL(request.url());
  if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:") && requestUrl.origin !== baseUrl.origin) {
    externalRequests.push(requestUrl.href);
  }
});
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  const response = await page.goto(baseUrl.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!response || !response.ok()) throw new Error("The deployed page did not return a successful HTTP response.");
  await expect(page.getByRole("heading", { name: /Know when your/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Network testing lab" })).toBeVisible();

  // Refresh the project-base URL to verify the deployed app remains loadable.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /Know when your/i })).toBeVisible({ timeout: 30_000 });
  const lab = page.getByRole("region", { name: "Network testing lab" });
  await expect(lab).toBeVisible();

  const fileInput = lab.getByLabel("Import saved configs");
  const now = Date.now();
  const payload = {
    format: "network-state-saved-lab-configs",
    schemaVersion: 1,
    exportedAt: now,
    configs: [{
      id: "live-pages-smoke-" + now.toString(36),
      name: "Live site smoke",
      endpointInput: "https://api.example.test/private/live-smoke/health",
      requestsPerEndpoint: 2,
      concurrency: 1,
      timeoutSeconds: 3,
      retries: 0,
      simulatedLatencyMs: 0,
      simulatedFailureRate: 0,
      updatedAt: now
    }]
  };
  const file = {
    name: "network-state-live-smoke.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload))
  };

  await fileInput.setInputFiles(file);
  const preview = lab.getByRole("region", { name: "Review import" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Live site smoke");
  await expect(preview).not.toContainText("/private/live-smoke/health");
  await expect(preview.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(fileInput).toBeFocused();
  const beforeApply = await page.evaluate(() => localStorage.getItem("network-state:network-lab-configs:v1"));
  if (beforeApply !== null) throw new Error("Cancelling the import changed local saved configs.");

  await fileInput.setInputFiles(file);
  await preview.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(lab.locator(".network-lab-transfer-status")).toContainText("nothing was run");
  let saved = await page.evaluate(() => {
    const raw = localStorage.getItem("network-state:network-lab-configs:v1");
    return raw ? JSON.parse(raw) : [];
  });
  if (saved.length !== 1 || saved[0].endpointInput !== payload.configs[0].endpointInput) {
    throw new Error("Applying the import did not persist the validated config as expected.");
  }

  // The saved config survives a refresh but does not run until the user presses Run.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  const reloadedLab = page.getByRole("region", { name: "Network testing lab" });
  await expect(reloadedLab).toBeVisible();
  await reloadedLab.getByLabel("Saved configurations").selectOption({ label: "Live site smoke" });
  await reloadedLab.getByRole("button", { name: "Load", exact: true }).click();
  await expect(reloadedLab.getByLabel("Test endpoints")).toHaveValue(payload.configs[0].endpointInput);

  const downloadPromise = page.waitForEvent("download");
  await reloadedLab.getByRole("button", { name: "Export saved configs", exact: true }).click();
  const download = await downloadPromise;
  if (download.suggestedFilename() !== "network-state-saved-lab-configs.json") {
    throw new Error("Saved-config export produced an unexpected filename.");
  }

  const deleteTrigger = reloadedLab.getByRole("button", { name: "Delete", exact: true });
  await deleteTrigger.click();
  const deleteConfirmation = reloadedLab.getByRole("group", { name: "Delete saved config?" });
  await expect(deleteConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteConfirmation).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  await deleteTrigger.click();
  await deleteConfirmation.getByRole("button", { name: "Delete saved config", exact: true }).click();
  await expect(reloadedLab.locator(".network-lab-message")).toContainText("deleted from this device");

  // Verify Clear all has the same explicit-confirmation and keyboard-cancel behavior.
  await fileInput.setInputFiles(file);
  const secondPreview = reloadedLab.getByRole("region", { name: "Review import" });
  await secondPreview.getByRole("button", { name: "Apply import", exact: true }).click();
  const clearTrigger = reloadedLab.getByRole("button", { name: "Clear all", exact: true });
  await clearTrigger.click();
  const clearConfirmation = reloadedLab.getByRole("group", { name: "Clear all saved configs?" });
  await expect(clearConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(clearConfirmation).toBeHidden();
  await expect(clearTrigger).toBeFocused();
  await clearTrigger.click();
  await clearConfirmation.getByRole("button", { name: "Delete all saved configs", exact: true }).click();
  await expect(reloadedLab.locator(".network-lab-message")).toContainText("All saved configurations cleared");

  saved = await page.evaluate(() => {
    const raw = localStorage.getItem("network-state:network-lab-configs:v1");
    return raw ? JSON.parse(raw) : [];
  });
  if (saved.length !== 0) throw new Error("Clear all did not remove saved configs.");
  if (externalRequests.length) throw new Error("The live app made unexpected third-party requests: " + externalRequests.join(", "));
  if (pageErrors.length) throw new Error("The live app raised page errors: " + pageErrors.join(" | "));

  process.stdout.write("Live Pages browser smoke passed: " + baseUrl.href + " (refresh, import preview/apply, export, delete, clear, no external requests)\n");
} finally {
  await context.close();
  await browser.close();
}
