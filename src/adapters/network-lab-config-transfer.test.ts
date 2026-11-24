import { describe, expect, it } from "vitest";
import {
  saveNetworkLabConfig,
  type SavedNetworkLabConfig
} from "./network-lab-configs";
import {
  createNetworkLabConfigExport,
  MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES,
  mergeImportedNetworkLabConfigs,
  parseNetworkLabConfigExport
} from "./network-lab-config-transfer";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function config(id: string, name: string, endpoint = "https://api.example.test/health?region=office", updatedAt = 100): SavedNetworkLabConfig {
  const storage = new MemoryStorage();
  const result = saveNetworkLabConfig({
    id,
    name,
    endpointInput: endpoint,
    requestsPerEndpoint: 3,
    concurrency: 2,
    timeoutSeconds: 5,
    retries: 1,
    simulatedLatencyMs: 0,
    simulatedFailureRate: 0,
    updatedAt
  }, storage);
  if (!result.ok) throw new Error(result.error);
  return result.configs[0];
}

describe("portable saved network lab configs", () => {
  it("round-trips a versioned export without losing replay settings", () => {
    const saved = config("local-id", "Office checks");
    const parsed = parseNetworkLabConfigExport(createNetworkLabConfigExport([saved], 200));
    expect(parsed).toEqual({ ok: true, configs: [saved] });
  });

  it("rejects malformed, unsupported, empty, oversized, and incomplete files", () => {
    const serialized = createNetworkLabConfigExport([config("one", "One")], 200);
    expect(parseNetworkLabConfigExport("{broken").ok).toBe(false);
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-network-lab-configs", schemaVersion: 9, exportedAt: 1, configs: []
    }))).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported schema/) });
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-network-lab-configs", schemaVersion: 1, exportedAt: 1, configs: []
    }))).toMatchObject({ ok: false, error: expect.stringMatching(/incomplete/) });
    expect(parseNetworkLabConfigExport(" ".repeat(MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES + 1)))
      .toMatchObject({ ok: false, error: expect.stringMatching(/1 MB/) });
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("rejects credentials, query data, invalid workload values, and duplicate names or ids", () => {
    const valid = config("one", "One");
    const envelope = (configs: unknown[]) => JSON.stringify({
      format: "network-state-network-lab-configs", schemaVersion: 1, exportedAt: 200, configs
    });
    expect(parseNetworkLabConfigExport(envelope([
      { ...valid, endpointInput: "https://user:secret@example.test/health" }
    ])).ok).toBe(false);
    expect(parseNetworkLabConfigExport(envelope([
      { ...valid, endpointInput: "https://api.example.test/health?token=secret" }
    ])).ok).toBe(false);
    expect(parseNetworkLabConfigExport(envelope([
      { ...valid, concurrency: 999 }
    ])).ok).toBe(false);
    expect(parseNetworkLabConfigExport(envelope([valid, { ...valid, id: "two" }])).ok).toBe(false);
    expect(parseNetworkLabConfigExport(envelope([valid, { ...valid, name: "one" }])).ok).toBe(false);
  });

  it("merges by name, preserves local identity, updates timestamps, and adds new configs", () => {
    const local = config("local-id", "Office checks", "https://old.example.test/health", 10);
    const incoming = config("export-id", "office CHECKS", "https://new.example.test/health", 20);
    const added = config("remote-id", "Remote checks", "https://remote.example.test/health", 30);
    const merged = mergeImportedNetworkLabConfigs([local], [incoming, added], 500);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "remote-id", name: "Remote checks", updatedAt: 500 });
    expect(merged[1]).toMatchObject({ id: "local-id", name: "office CHECKS", endpointInput: "https://new.example.test/health", updatedAt: 500 });
  });

  it("fails atomically when import would exceed the ten-config limit", () => {
    const existing = Array.from({ length: 10 }, (_, index) => config("local-" + index, "Local " + index));
    expect(() => mergeImportedNetworkLabConfigs(existing, [config("new-id", "New")], 500))
      .toThrow(/ten-config limit/);
    expect(existing).toHaveLength(10);
    expect(existing[0].name).toBe("Local 0");
  });
});
