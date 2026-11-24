import { describe, expect, it } from "vitest";
import {
  inspectNetworkLabConfigs,
  loadNetworkLabConfigs,
  MAX_SAVED_NETWORK_LAB_CONFIGS,
  NETWORK_LAB_CONFIG_STORAGE_KEY,
  persistNetworkLabConfigs,
  removeNetworkLabConfig,
  saveNetworkLabConfig,
  type SavedNetworkLabConfig
} from "./network-lab-configs";

const draft = {
  id: "config-one",
  name: "Office checks",
  endpoints: ["https://api.example.test/health?region=office"],
  options: {
    requestsPerEndpoint: 3,
    concurrency: 2,
    timeoutMs: 5_000,
    retries: 1,
    simulatedLatencyMs: 0,
    simulatedFailureRate: 0
  }
};

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value
  };
}

describe("named network lab configs", () => {
  it("saves a validated config and updates an existing name without duplicating it", () => {
    const first = saveNetworkLabConfig([], draft, 100);
    expect(first).toHaveLength(1);
    expect(first[0].endpoints[0]).toContain("?region=office");
    const updated = saveNetworkLabConfig(first, { ...draft, name: " office checks ", options: { ...draft.options, retries: 2 } }, 200);
    expect(updated).toHaveLength(1);
    expect(updated[0].createdAt).toBe(100);
    expect(updated[0].updatedAt).toBe(200);
    expect(updated[0].options.retries).toBe(2);
  });

  it("rejects credentials, duplicate endpoints, invalid settings, and empty names", () => {
    expect(() => saveNetworkLabConfig([], { ...draft, endpoints: ["https://user:secret@example.test/"] }, 1)).toThrow(/without embedded credentials/);
    expect(() => saveNetworkLabConfig([], { ...draft, endpoints: ["https://example.test", "https://example.test/"] }, 1)).toThrow(/unique/);
    expect(() => saveNetworkLabConfig([], { ...draft, name: "  " }, 1)).toThrow(/config name/);
    expect(() => saveNetworkLabConfig([], { ...draft, options: { ...draft.options, concurrency: 99 } }, 1)).toThrow(/concurrency/);
  });

  it("limits saved configs and removes only the selected config", () => {
    let configs: SavedNetworkLabConfig[] = [];
    for (let index = 0; index < MAX_SAVED_NETWORK_LAB_CONFIGS; index += 1) {
      configs = saveNetworkLabConfig(configs, { ...draft, id: "config-" + index, name: "Config " + index }, index + 1);
    }
    expect(configs).toHaveLength(MAX_SAVED_NETWORK_LAB_CONFIGS);
    expect(() => saveNetworkLabConfig(configs, { ...draft, id: "extra", name: "Extra" }, 20)).toThrow(/up to ten/);
    expect(removeNetworkLabConfig(configs, "config-3")).toHaveLength(9);
    expect(removeNetworkLabConfig(configs, "missing")).toEqual(configs);
  });

  it("round-trips a versioned local record and ignores malformed or unsafe entries", () => {
    const configs = saveNetworkLabConfig([], draft, 100);
    const storage = memoryStorage();
    expect(persistNetworkLabConfigs(configs, storage)).toBe(true);
    expect(loadNetworkLabConfigs(storage)).toEqual(configs);

    const corrupt = memoryStorage(JSON.stringify({
      schemaVersion: 1,
      configs: [
        configs[0],
        { ...configs[0], id: "bad", endpoints: ["javascript:alert(1)"] },
        { ...configs[0], id: "duplicate-name" }
      ]
    }));
    expect(loadNetworkLabConfigs(corrupt)).toHaveLength(1);
    expect(loadNetworkLabConfigs(memoryStorage("{broken"))).toEqual([]);
    expect(loadNetworkLabConfigs(memoryStorage(JSON.stringify({ schemaVersion: 9, configs })))).toEqual([]);
  });

  it("distinguishes a missing record from invalid data and unavailable storage", () => {
    expect(inspectNetworkLabConfigs(memoryStorage()).status).toBe("missing");
    expect(inspectNetworkLabConfigs(memoryStorage("{broken")).status).toBe("invalid");
    expect(inspectNetworkLabConfigs(memoryStorage(JSON.stringify({ schemaVersion: 9, configs: [] }))).status).toBe("invalid");
    expect(inspectNetworkLabConfigs({ getItem: () => { throw new Error("blocked"); } }).status).toBe("unavailable");
  });

  it("reports storage failures without throwing", () => {
    expect(persistNetworkLabConfigs([], { setItem: () => { throw new Error("quota"); } })).toBe(false);
    expect(loadNetworkLabConfigs({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
    expect(NETWORK_LAB_CONFIG_STORAGE_KEY).toContain("network-lab-configs");
  });
});
