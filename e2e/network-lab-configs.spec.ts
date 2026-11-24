import { expect, test } from "@playwright/test";

const storageKey = "network-state:network-lab-configs:v1";

test("saved configs persist across reload and deletion requires confirmation", async ({ page }) => {
  const endpoint = "https://api.example.test/private/health?token=browser-smoke";

  await page.goto("/");
  await page.getByLabel("Test endpoints").fill(endpoint);
  await page.getByLabel("Config name").fill("Browser smoke config");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Config saved in this browser only.");
  await expect(page.getByRole("option", { name: "Browser smoke config" })).toBeAttached();

  const savedBeforeReload = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: Array<{ endpoints: string[] }> } : null;
  }, storageKey);
  expect(savedBeforeReload?.configs[0]?.endpoints).toContain(endpoint);

  await page.reload();
  const savedConfigs = page.getByLabel("Saved configs");
  await expect(page.getByRole("option", { name: "Browser smoke config" })).toBeAttached();
  await savedConfigs.selectOption({ label: "Browser smoke config" });
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByLabel("Test endpoints")).toHaveValue(endpoint);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("group", { name: "Delete saved config?" });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();

  const afterCancel = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(afterCancel).toBe(savedBeforeReload ? JSON.stringify({
    schemaVersion: 1,
    configs: savedBeforeReload.configs
  }) : null);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete saved config" }).click();
  await expect(page.getByRole("status")).toContainText("Saved config deleted from this browser.");
  const afterDelete = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: unknown[] } : null;
  }, storageKey);
  expect(afterDelete?.configs).toHaveLength(0);
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

  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();

  await input.setInputFiles(file);
  await expect(page.getByRole("region", { name: "Review import" })).toBeVisible();
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.getByRole("status")).toContainText("Import complete");
  const imported = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { configs: Array<{ name: string }> } : null;
  }, storageKey);
  expect(imported?.configs.map((config) => config.name)).toContain("Imported browser config");
  await expect(page.getByRole("button", { name: "Run test" })).toBeEnabled();
  await expect(page.getByRole("progressbar", { name: "Network test progress" })).toHaveCount(0);
});
