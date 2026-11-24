import {
  MAX_SAVED_NETWORK_LAB_CONFIGS,
  replaceSavedNetworkLabConfigs,
  type SavedNetworkLabConfig
} from "./network-lab-configs";

export const NETWORK_LAB_CONFIG_EXPORT_FORMAT = "network-state-saved-lab-configs" as const;
export const NETWORK_LAB_CONFIG_EXPORT_VERSION = 1 as const;
export const MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES = 1_000_000;

export interface NetworkLabConfigExport {
  format: typeof NETWORK_LAB_CONFIG_EXPORT_FORMAT;
  schemaVersion: typeof NETWORK_LAB_CONFIG_EXPORT_VERSION;
  exportedAt: number;
  configs: SavedNetworkLabConfig[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function validateConfigList(configs: unknown): { ok: true; configs: SavedNetworkLabConfig[] } | { ok: false; error: string } {
  if (!Array.isArray(configs) || configs.length < 1 || configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    return { ok: false, error: "The file must contain between one and ten saved configurations." };
  }
  const storage = new MemoryStorage();
  const result = replaceSavedNetworkLabConfigs(configs as SavedNetworkLabConfig[], storage);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, configs: result.configs };
}

/** Export only validated, explicitly saved configs. Endpoint paths remain sensitive. */
export function createNetworkLabConfigExport(
  configs: SavedNetworkLabConfig[],
  exportedAt = Date.now()
): string {
  if (!Number.isSafeInteger(exportedAt) || exportedAt <= 0) {
    throw new RangeError("Export timestamp must be a positive safe integer.");
  }
  if (configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) throw new RangeError("Too many saved configs to export.");
  const payload: NetworkLabConfigExport = {
    format: NETWORK_LAB_CONFIG_EXPORT_FORMAT,
    schemaVersion: NETWORK_LAB_CONFIG_EXPORT_VERSION,
    exportedAt,
    configs: configs.map((config) => ({ ...config }))
  };
  const serialized = JSON.stringify(payload, null, 2);
  const parsed = parseNetworkLabConfigExport(serialized);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return serialized;
}

/** Parse and validate a portable file before it can affect browser storage. */
export function parseNetworkLabConfigExport(
  input: string
): { ok: true; configs: SavedNetworkLabConfig[] } | { ok: false; error: string } {
  if (new TextEncoder().encode(input).byteLength > MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES) {
    return { ok: false, error: "The config file is larger than the 1 MB import limit." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { ok: false, error: "The selected config file is not valid JSON." };
  }

  if (!isRecord(parsed) || parsed.format !== NETWORK_LAB_CONFIG_EXPORT_FORMAT) {
    return { ok: false, error: "This file is not a Network State saved-config export." };
  }
  if (parsed.schemaVersion !== NETWORK_LAB_CONFIG_EXPORT_VERSION) {
    return { ok: false, error: "This config file uses an unsupported schema version." };
  }
  if (!Number.isSafeInteger(parsed.exportedAt) || (parsed.exportedAt as number) <= 0) {
    return { ok: false, error: "The config export timestamp is invalid." };
  }

  return validateConfigList(parsed.configs);
}

function uniqueImportedId(id: string, used: Set<string>, now: number, index: number): string {
  if (!used.has(id)) return id;
  const base = "import-" + now.toString(36) + "-" + index.toString(36);
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

/** Merge by case-insensitive name; preserve local ids and fail atomically at the ten-config cap. */
export function mergeImportedNetworkLabConfigs(
  existing: SavedNetworkLabConfig[],
  imported: SavedNetworkLabConfig[],
  now = Date.now()
): SavedNetworkLabConfig[] {
  if (!Number.isSafeInteger(now) || now <= 0) throw new RangeError("Import timestamp must be a positive safe integer.");
  const currentCheck = replaceSavedNetworkLabConfigs(existing, new MemoryStorage());
  const incomingCheck = replaceSavedNetworkLabConfigs(imported, new MemoryStorage());
  if (!currentCheck.ok) throw new TypeError(currentCheck.error);
  if (!incomingCheck.ok) throw new TypeError(incomingCheck.error);

  const next = currentCheck.configs.map((config) => ({ ...config }));
  const usedIds = new Set(next.map((config) => config.id));
  const additions: SavedNetworkLabConfig[] = [];

  incomingCheck.configs.forEach((incoming, index) => {
    const matchIndex = next.findIndex((local) => local.name.trim().toLocaleLowerCase() === incoming.name.trim().toLocaleLowerCase());
    if (matchIndex >= 0) {
      next[matchIndex] = { ...incoming, id: next[matchIndex].id, updatedAt: now };
      return;
    }
    const id = uniqueImportedId(incoming.id, usedIds, now, index);
    usedIds.add(id);
    additions.push({ ...incoming, id, updatedAt: now });
  });

  const merged = [...additions, ...next];
  if (merged.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    throw new RangeError("Import would exceed the ten saved-config limit; no configs were changed.");
  }
  const validated = replaceSavedNetworkLabConfigs(merged, new MemoryStorage());
  if (!validated.ok) throw new TypeError(validated.error);
  return validated.configs;
}
