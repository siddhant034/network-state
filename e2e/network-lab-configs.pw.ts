import { expect, test } from "@playwright/test";

const storageKey = "network-state:network-lab-configs:v1";

test("saved configs persist across reload and deletion requires confirmation", async ({ page }) => {
  const endpoint = "https://api.example.test/private/health?token=browser-smoke";

  await page.goto("/");
  await page.getByLabel("Test endpoints").fill(endpoint);
  await page.getByLabel("Config name").fill("Browser smoke config");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Config saved in this browser only.", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Browser smoke config" })).toBeAttached();

  const savedBeforeReload = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: Array<{ endpoints: string[] }> } : null;
  }, storageKey);
  expect(savedBeforeReload?.configs[0]?.endpoints).toContain(endpoint);

  await page.reload();
  const savedConfigs = page.getByLabel("Saved configs", { exact: true });
  await expect(page.getByRole("option", { name: "Browser smoke config" })).toBeAttached();
  await savedConfigs.selectOption({ label: "Browser smoke config" });
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByLabel("Test endpoints")).toHaveValue(endpoint);

  // Clear-all confirmation starts on the safe action and restores focus when cancelled.
  const clearTrigger = page.getByRole("button", { name: "Clear all", exact: true });
  await clearTrigger.click();
  const clearConfirmation = page.getByRole("group", { name: "Clear all saved configs?" });
  await expect(clearConfirmation).toBeVisible();
  await expect(clearConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(clearConfirmation).toBeHidden();
  await expect(clearTrigger).toBeFocused();

  const afterClearCancel = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(afterClearCancel).toBe(savedBeforeReload ? JSON.stringify({
    schemaVersion: 1,
    configs: savedBeforeReload.configs
  }) : null);

  // Deletion follows the same keyboard-safe confirmation contract.
  const deleteTrigger = page.getByRole("button", { name: "Delete", exact: true });
  await deleteTrigger.click();
  const confirmation = page.getByRole("group", { name: "Delete saved config?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  const afterCancel = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(afterCancel).toBe(afterClearCancel);

  await deleteTrigger.click();
  await page.getByRole("button", { name: "Delete saved config" }).click();
  await expect(page.locator(".network-lab-message")).toContainText("Saved config deleted from this browser.");
  const afterDelete = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: unknown[] } : null;
  }, storageKey);
  expect(afterDelete?.configs).toHaveLength(0);
});

test("saved config changes in one tab update the other tab", async ({ page }) => {
  const endpoint = "https://api.example.test/cross-tab/health?token=private";
  const otherTab = await page.context().newPage();

  await Promise.all([page.goto("/"), otherTab.goto("/")]);
  await expect(otherTab.getByRole("option", { name: "Cross-tab smoke config" })).toHaveCount(0);

  await page.getByLabel("Test endpoints").fill(endpoint);
  await page.getByLabel("Config name").fill("Cross-tab smoke config");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The browser storage event should refresh the other already-open tab.
  const otherTabOption = otherTab.getByRole("option", { name: "Cross-tab smoke config" });
  await expect(otherTabOption).toBeAttached();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("group", { name: "Delete saved config?" });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete saved config" }).click();

  await expect(otherTabOption).toHaveCount(0);
  await expect(otherTab.locator(".network-lab-message")).toContainText(
    "Saved configs updated in another tab."
  );

  // The test never runs the endpoint; it only verifies browser-local storage sync.
  await expect(otherTab.getByRole("button", { name: "Run test" })).toBeEnabled();
  await otherTab.close();
});


test("clearing configs in one tab clears the other tab without exposing endpoints", async ({ page }) => {
  const endpoint = "https://api.example.test/cross-tab/clear?token=clear-private";
  const otherTab = await page.context().newPage();

  await Promise.all([page.goto("/"), otherTab.goto("/")]);
  await page.getByLabel("Test endpoints").fill(endpoint);
  await page.getByLabel("Config name").fill("Cross-tab clear config");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(otherTab.getByRole("option", { name: "Cross-tab clear config" })).toBeAttached();

  const clearTrigger = page.getByRole("button", { name: "Clear all", exact: true });
  await clearTrigger.click();
  const confirmation = page.getByRole("group", { name: "Clear all saved configs?" });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete all saved configs", exact: true }).click();

  await expect(otherTab.getByRole("option", { name: "Cross-tab clear config" })).toHaveCount(0);
  await expect(otherTab.locator(".network-lab-message")).toContainText(
    "Saved configs were cleared in another tab."
  );
  await expect(otherTab.locator(".network-lab-message")).not.toContainText("/cross-tab/clear");
  await expect(otherTab.locator(".network-lab-message")).not.toContainText("clear-private");

  const stored = await otherTab.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(stored).toBeNull();

  // Clearing configs only synchronizes browser-local saved state; it never runs a test.
  await expect(otherTab.getByRole("button", { name: "Run test" })).toBeEnabled();
  await otherTab.close();
});

test("import preview never applies a file until Apply import is selected", async ({ page }) => {
  const sensitiveEndpoint = "https://api.example.test/private/health?token=do-not-display";
  const fixture = {
    format: "network-state-network-lab-configs",
    schemaVersion: 1,
    exportedAt: 1_700_000_000_000,
    configs: [{
      id: "e2e-import-config",
      name: "Imported browser config",
      endpoints: [sensitiveEndpoint],
      options: {
        requestsPerEndpoint: 1,
        concurrency: 1,
        timeoutMs: 5_000,
        retries: 0,
        simulatedLatencyMs: 0,
        simulatedFailureRate: 0
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000
    }]
  };
  const file = {
    name: "network-state-config.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture))
  };

  await page.goto("/");
  const input = page.getByLabel("Import saved configs");
  await input.setInputFiles(file);
  const preview = page.getByRole("region", { name: "Review import" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Imported browser config");
  await expect(preview).not.toContainText("/private/health");
  await expect(preview).not.toContainText("do-not-display");
  await expect(preview.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(input).toBeFocused();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();

  await input.setInputFiles(file);
  const secondPreview = page.getByRole("region", { name: "Review import" });
  await expect(secondPreview).toBeVisible();
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.locator(".network-lab-config-transfer-status")).toContainText("Import complete");
  await expect(input).toBeFocused();
  const imported = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: Array<{ name: string }> } : null;
  }, storageKey);
  expect(imported?.configs.map((config) => config.name)).toContain("Imported browser config");
  await expect(page.getByRole("button", { name: "Run test" })).toBeEnabled();
  await expect(page.getByRole("progressbar", { name: "Network test progress" })).toHaveCount(0);
});
