import { describe, expect, it } from "vitest";
import { saveNetworkLabConfig, type SavedNetworkLabConfig } from "./network-lab-configs";
import {
  createNetworkLabConfigExport,
  MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES,
  mergeImportedNetworkLabConfigs,
  parseNetworkLabConfigExport
} from "./network-lab-config-transfer";

const options = {
  requestsPerEndpoint: 3,
  concurrency: 2,
  timeoutMs: 5_000,
  retries: 1,
  simulatedLatencyMs: 0,
  simulatedFailureRate: 0
};

function config(id: string, name: string, endpoint = "https://api.example.test/health?region=office", now = 100): SavedNetworkLabConfig {
  return saveNetworkLabConfig([], { id, name, endpoints: [endpoint], options }, now)[0];
}

describe("portable saved network lab configs", () => {
  it("round-trips a versioned export without losing replay settings", () => {
    const saved = config("local-id", "Office checks");
    const parsed = parseNetworkLabConfigExport(createNetworkLabConfigExport([saved], 200));

    expect(parsed).toEqual({ ok: true, configs: [saved] });
  });

  it("rejects unsupported versions, malformed JSON, oversized files, and empty imports", () => {
    const serialized = createNetworkLabConfigExport([config("one", "One")], 200);
    expect(parseNetworkLabConfigExport("{broken").ok).toBe(false);
    expect(parseNetworkLabConfigExport(JSON.stringify({ format: "network-state-network-lab-configs", schemaVersion: 9 })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/unsupported schema/) });
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-network-lab-configs", schemaVersion: 1, exportedAt: 1, configs: []
    }))).toMatchObject({ ok: false, error: expect.stringMatching(/incomplete/) });
    expect(parseNetworkLabConfigExport(" ".repeat(MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES + 1)))
      .toMatchObject({ ok: false, error: expect.stringMatching(/1 MB/) });
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("rejects credential-bearing endpoints and duplicate config names", () => {
    const valid = config("one", "One");
    const credentialed = { ...valid, endpoints: ["https://user:secret@example.test/health"] };
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-network-lab-configs", schemaVersion: 1, exportedAt: 200,
      configs: [credentialed]
    })).ok).toBe(false);

    const duplicate = config("two", "one");
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-network-lab-configs", schemaVersion: 1, exportedAt: 200,
      configs: [valid, duplicate]
    })).ok).toBe(false);
  });

  it("merges by name, preserves local identity, and adds new configs", () => {
    const local = config("local-id", "Office checks", "https://old.example.test/", 10);
    const incoming = config("export-id", "office CHECKS", "https://new.example.test/", 20);
    const added = config("new-id", "Remote checks", "https://remote.example.test/", 20);

    const merged = mergeImportedNetworkLabConfigs([local], [incoming, added], 300);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "new-id", name: "Remote checks", createdAt: 300, updatedAt: 300 });
    expect(merged[1]).toMatchObject({
      id: "local-id", name: "office CHECKS", createdAt: 10, updatedAt: 300,
      endpoints: ["https://new.example.test/"]
    });
  });

  it("does not partially merge when the saved-config limit would be exceeded", () => {
    const existing = Array.from({ length: 10 }, (_, index) => config("local-" + index, "Local " + index));
    const imported = [config("incoming", "New config")];
    expect(() => mergeImportedNetworkLabConfigs(existing, imported, 500)).toThrow(/ten-config limit/);
    expect(existing).toHaveLength(10);
  });
});
