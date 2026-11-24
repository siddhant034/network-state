import { describe, expect, it } from "vitest";
import { replaceSavedNetworkLabConfigs, saveNetworkLabConfig, type SavedNetworkLabConfig } from "./network-lab-configs";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function config(id: string, name: string, endpointInput = "https://api.example.test/health", updatedAt = 100): SavedNetworkLabConfig {
  const saved = saveNetworkLabConfig({
    id, name, endpointInput,
    requestsPerEndpoint: 3, concurrency: 2, timeoutSeconds: 5, retries: 1,
    simulatedLatencyMs: 0, simulatedFailureRate: 0, updatedAt
  }, new MemoryStorage());
  if (!saved.ok) throw new Error(saved.error);
  return saved.saved;
}

describe("replaceSavedNetworkLabConfigs", () => {
  it("validates the entire list and writes it atomically", () => {
    const storage = new MemoryStorage();
    const one = config("one", "One");
    const two = config("two", "Two", "https://two.example.test/");
    expect(replaceSavedNetworkLabConfigs([one, two], storage)).toMatchObject({ ok: true, configs: [one, two] });
    const invalid = { ...two, endpointInput: "https://user:secret@example.test/" };
    expect(replaceSavedNetworkLabConfigs([one, invalid], storage).ok).toBe(false);
    expect(JSON.parse(storage.getItem("network-state:network-lab-configs:v1") ?? "[]")).toEqual([one, two]);
  });

  it("rejects duplicate names and over-limit lists without writing", () => {
    const storage = new MemoryStorage();
    const one = config("one", "One");
    storage.setItem("network-state:network-lab-configs:v1", JSON.stringify([one]));
    const duplicate = config("two", "one");
    expect(replaceSavedNetworkLabConfigs([one, duplicate], storage).ok).toBe(false);
    const ten = Array.from({ length: 10 }, (_, index) => config("id-" + index, "Config " + index));
    expect(replaceSavedNetworkLabConfigs(ten, storage).ok).toBe(true);
    expect(replaceSavedNetworkLabConfigs([...ten, config("overflow", "Overflow")], storage).ok).toBe(false);
    expect(JSON.parse(storage.getItem("network-state:network-lab-configs:v1") ?? "[]")).toHaveLength(10);
  });
});
