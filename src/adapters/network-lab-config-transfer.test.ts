import { describe, expect, it } from "vitest";
import { saveNetworkLabConfig, type SavedNetworkLabConfig } from "./network-lab-configs";
import {
  createNetworkLabConfigExport,
  MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES,
  mergeImportedNetworkLabConfigs,
  parseNetworkLabConfigExport
} from "./network-lab-config-transfer";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function config(id: string, name: string, endpointInput = "https://api.example.test/health?region=office", now = 100): SavedNetworkLabConfig {
  const saved = saveNetworkLabConfig({
    id, name, endpointInput,
    requestsPerEndpoint: 3, concurrency: 2, timeoutSeconds: 5, retries: 1,
    simulatedLatencyMs: 0, simulatedFailureRate: 0, updatedAt: now
  }, new MemoryStorage());
  if (!saved.ok) throw new Error(saved.error);
  return saved.saved;
}

describe("portable saved network lab configs", () => {
  it("round-trips a versioned export and preserves sanitized replay settings", () => {
    const saved = config("local-id", "Office checks");
    const parsed = parseNetworkLabConfigExport(createNetworkLabConfigExport([saved], 200));
    expect(parsed).toEqual({ ok: true, configs: [saved] });
    expect(parsed.ok && parsed.configs[0].endpointInput).toBe("https://api.example.test/health");
  });

  it("rejects malformed JSON, unsupported versions, empty imports, and oversized files", () => {
    const serialized = createNetworkLabConfigExport([config("one", "One")], 200);
    expect(parseNetworkLabConfigExport("{broken").ok).toBe(false);
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-saved-lab-configs", schemaVersion: 9, exportedAt: 200, configs: []
    })).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported schema/) });
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-saved-lab-configs", schemaVersion: 1, exportedAt: 200, configs: []
    })).toMatchObject({ ok: false, error: expect.stringMatching(/between one and ten/) });
    expect(parseNetworkLabConfigExport(" ".repeat(MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES + 1)))
      .toMatchObject({ ok: false, error: expect.stringMatching(/1 MB/) });
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("rejects credential-bearing endpoints and duplicate names", () => {
    const valid = config("one", "One");
    const credentialed = { ...valid, endpointInput: "https://user:secret@example.test/health" };
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-saved-lab-configs", schemaVersion: 1, exportedAt: 200, configs: [credentialed]
    })).ok).toBe(false);
    const duplicate = config("two", "one");
    expect(parseNetworkLabConfigExport(JSON.stringify({
      format: "network-state-saved-lab-configs", schemaVersion: 1, exportedAt: 200, configs: [valid, duplicate]
    })).ok).toBe(false);
  });

  it("merges by name, preserves local identity, and adds new configs", () => {
    const local = config("local-id", "Office checks", "https://old.example.test/", 10);
    const incoming = config("export-id", "office CHECKS", "https://new.example.test/", 20);
    const added = config("new-id", "Remote checks", "https://remote.example.test/", 20);
    const merged = mergeImportedNetworkLabConfigs([local], [incoming, added], 300);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "new-id", name: "Remote checks", updatedAt: 300 });
    expect(merged[1]).toMatchObject({
      id: "local-id", name: "office CHECKS", updatedAt: 300,
      endpointInput: "https://new.example.test/"
    });
  });

  it("fails atomically when importing would exceed ten configs", () => {
    const existing = Array.from({ length: 10 }, (_, index) => config("local-" + index, "Local " + index));
    const incoming = [config("incoming", "New config")];
    expect(() => mergeImportedNetworkLabConfigs(existing, incoming, 500)).toThrow(/ten saved-config limit/);
    expect(existing).toHaveLength(10);
  });
});
