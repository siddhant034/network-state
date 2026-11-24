import {
  MAX_SAVED_NETWORK_LAB_CONFIGS,
  validateSavedNetworkLabConfig,
  type SavedNetworkLabConfig
} from "./network-lab-configs";

export const NETWORK_LAB_CONFIG_EXPORT_FORMAT = "network-state-network-lab-configs" as const;
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

function cloneConfig(config: SavedNetworkLabConfig): SavedNetworkLabConfig {
  return { ...config };
}

/** Build a versioned portable file from explicitly saved configs only. */
export function createNetworkLabConfigExport(
  configs: SavedNetworkLabConfig[],
  exportedAt = Date.now()
): string {
  if (!Number.isSafeInteger(exportedAt) || exportedAt < 0) {
    throw new RangeError("Export timestamp must be a non-negative integer.");
  }
  if (configs.length < 1 || configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    throw new RangeError("Export requires between one and ten saved configs.");
  }
  const normalized = configs.map(validateSavedNetworkLabConfig);
  if (normalized.some((config) => config === null)) {
    throw new TypeError("A saved config is invalid and cannot be exported.");
  }
  const payload: NetworkLabConfigExport = {
    format: NETWORK_LAB_CONFIG_EXPORT_FORMAT,
    schemaVersion: NETWORK_LAB_CONFIG_EXPORT_VERSION,
    exportedAt,
    configs: normalized.map((config) => cloneConfig(config!))
  };
  const serialized = JSON.stringify(payload, null, 2);
  const parsed = parseNetworkLabConfigExport(serialized);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return serialized;
}

/** Parse a bounded file and validate every config before it can touch storage. */
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
    return { ok: false, error: "The selected file is not valid JSON." };
  }
  if (!isRecord(parsed) || parsed.format !== NETWORK_LAB_CONFIG_EXPORT_FORMAT) {
    return { ok: false, error: "This file is not a Network State saved-config export." };
  }
  if (parsed.schemaVersion !== NETWORK_LAB_CONFIG_EXPORT_VERSION) {
    return { ok: false, error: "This config file uses an unsupported schema version." };
  }
  if (!Number.isSafeInteger(parsed.exportedAt) || (parsed.exportedAt as number) < 0 ||
      !Array.isArray(parsed.configs) || parsed.configs.length < 1 ||
      parsed.configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    return { ok: false, error: "The config file is incomplete or contains too many saved configs." };
  }

  const configs: SavedNetworkLabConfig[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of parsed.configs) {
    const config = validateSavedNetworkLabConfig(item);
    if (!config) {
      return { ok: false, error: "A saved config contains an invalid name, endpoint, or workload setting." };
    }
    const name = config.name.toLowerCase();
    if (ids.has(config.id) || names.has(name)) {
      return { ok: false, error: "The config file contains duplicate names or identifiers." };
    }
    ids.add(config.id);
    names.add(name);
    configs.push(config);
  }
  return { ok: true, configs };
}

/**
 * Merge by case-insensitive name or stable id. Matching local ids are preserved;
 * the whole operation fails before persistence if the ten-config limit or
 * uniqueness constraints would be violated.
 */
export function mergeImportedNetworkLabConfigs(
  existing: SavedNetworkLabConfig[],
  imported: SavedNetworkLabConfig[],
  now = Date.now()
): SavedNetworkLabConfig[] {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError("Import timestamp must be a positive integer.");
  }
  const next = existing.map(cloneConfig);
  for (const raw of imported) {
    const incoming = validateSavedNetworkLabConfig(raw);
    if (!incoming) throw new TypeError("An imported config is invalid.");
    const name = incoming.name.toLowerCase();
    const index = next.findIndex((config) =>
      config.name.toLowerCase() === name || config.id === incoming.id
    );
    if (index >= 0) {
      next[index] = { ...incoming, id: next[index].id, updatedAt: now };
    } else {
      next.unshift({ ...incoming, updatedAt: now });
    }
  }

  if (next.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    throw new RangeError("Import would exceed the ten-config limit. Delete a saved config or import fewer configs.");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const config of next) {
    const name = config.name.toLowerCase();
    if (ids.has(config.id) || names.has(name)) {
      throw new TypeError("Import would create duplicate saved config names or identifiers.");
    }
    ids.add(config.id);
    names.add(name);
  }
  return next;
}
