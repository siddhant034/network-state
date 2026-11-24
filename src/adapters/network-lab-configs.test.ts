import { describe, expect, it } from "vitest";
import {
  deleteNetworkLabConfig,
  inspectSavedNetworkLabConfigs,
  loadSavedNetworkLabConfigs,
  MAX_SAVED_NETWORK_LAB_CONFIGS,
  NETWORK_LAB_CONFIG_STORAGE_KEY,
  saveNetworkLabConfig,
  type SaveNetworkLabConfigInput
} from "./network-lab-configs";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const makeConfig = (overrides: Partial<SaveNetworkLabConfigInput> = {}): SaveNetworkLabConfigInput => ({
  id: "config-1",
  name: "Production API",
  endpointInput: "https://api.example.test/health?token=private#section",
  requestsPerEndpoint: 3,
  concurrency: 2,
  timeoutSeconds: 5,
  retries: 1,
  simulatedLatencyMs: 0,
  simulatedFailureRate: 0,
  updatedAt: 1_800_000_000_000,
  ...overrides
});

describe("saved network lab configurations", () => {
  it("stores a bounded configuration locally and strips query strings and fragments", () => {
    const storage = new MemoryStorage();
    const result = saveNetworkLabConfig(makeConfig(), storage);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removedQueryData).toBe(true);
    expect(result.saved.endpointInput).toBe("https://api.example.test/health");
    expect(storage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY)).not.toContain("private");
    expect(loadSavedNetworkLabConfigs(storage)).toEqual([result.saved]);
  });

  it("rejects credentials, invalid URLs, and duplicate endpoints after query redaction", () => {
    const storage = new MemoryStorage();
    expect(saveNetworkLabConfig(makeConfig({
      endpointInput: "https://user:secret@example.test/health"
    }), storage).ok).toBe(false);
    expect(saveNetworkLabConfig(makeConfig({
      endpointInput: "https://api.example.test/health?one=1\nhttps://api.example.test/health?two=2"
    }), storage).ok).toBe(false);
    expect(loadSavedNetworkLabConfigs(storage)).toEqual([]);
  });

  it("validates supported workload values and configuration names", () => {
    const storage = new MemoryStorage();
    expect(saveNetworkLabConfig(makeConfig({ name: "   " }), storage).ok).toBe(false);
    expect(saveNetworkLabConfig(makeConfig({ requestsPerEndpoint: 99 }), storage).ok).toBe(false);
    expect(saveNetworkLabConfig(makeConfig({ name: "x".repeat(49) }), storage).ok).toBe(false);
  });

  it("prevents duplicate names and enforces the saved-configuration limit", () => {
    const storage = new MemoryStorage();
    expect(saveNetworkLabConfig(makeConfig(), storage).ok).toBe(true);
    expect(saveNetworkLabConfig(makeConfig({ id: "config-2", name: "production API" }), storage).ok).toBe(false);

    for (let index = 2; index <= MAX_SAVED_NETWORK_LAB_CONFIGS; index += 1) {
      const result = saveNetworkLabConfig(makeConfig({ id: "config-" + index, name: "Config " + index }), storage);
      expect(result.ok).toBe(true);
    }
    expect(saveNetworkLabConfig(makeConfig({ id: "config-overflow", name: "Overflow" }), storage)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/up to ten/)
    });
  });

  it("updates and deletes configurations by id", () => {
    const storage = new MemoryStorage();
    saveNetworkLabConfig(makeConfig(), storage);
    const updated = saveNetworkLabConfig(makeConfig({ name: "Production API v2", retries: 2 }), storage);
    expect(updated.ok).toBe(true);
    expect(loadSavedNetworkLabConfigs(storage)).toHaveLength(1);
    expect(loadSavedNetworkLabConfigs(storage)[0].retries).toBe(2);

    const deleted = deleteNetworkLabConfig("config-1", storage);
    expect(deleted).toMatchObject({ ok: true, configs: [] });
  });

  it("ignores malformed, oversized, and unsupported stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "{");
    expect(loadSavedNetworkLabConfigs(storage)).toEqual([]);
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, JSON.stringify([{
      ...makeConfig(),
      endpointInput: "https://api.example.test/health?token=must-not-load"
    }]));
    expect(loadSavedNetworkLabConfigs(storage)).toEqual([]);
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "x".repeat(70_000));
    expect(loadSavedNetworkLabConfigs(storage)).toEqual([]);
  });

  it("distinguishes missing, valid, invalid, and unavailable saved-config records", () => {
    const storage = new MemoryStorage();
    expect(inspectSavedNetworkLabConfigs(storage)).toMatchObject({ status: "missing", configs: [] });

    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "[]");
    expect(inspectSavedNetworkLabConfigs(storage)).toMatchObject({ status: "ok", configs: [] });

    saveNetworkLabConfig(makeConfig(), storage);
    expect(inspectSavedNetworkLabConfigs(storage)).toMatchObject({ status: "ok", configs: [{ id: "config-1" }] });

    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "{broken");
    expect(inspectSavedNetworkLabConfigs(storage)).toMatchObject({ status: "invalid", configs: [] });
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "x".repeat(70_000));
    expect(inspectSavedNetworkLabConfigs(storage)).toMatchObject({ status: "invalid", configs: [] });

    expect(inspectSavedNetworkLabConfigs(null)).toMatchObject({ status: "unavailable", configs: [] });
    expect(inspectSavedNetworkLabConfigs({ getItem: () => { throw new Error("blocked"); } }))
      .toMatchObject({ status: "unavailable", configs: [] });
  });

  it("reports unavailable or throwing storage without throwing into the UI", () => {
    const unavailable = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(saveNetworkLabConfig(makeConfig(), unavailable).ok).toBe(false);
    expect(deleteNetworkLabConfig("config-1", unavailable).ok).toBe(false);
    expect(loadSavedNetworkLabConfigs(null)).toEqual([]);
  });
});
