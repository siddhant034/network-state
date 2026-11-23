import {
  MAX_SAVED_NETWORK_LAB_CONFIGS,
  saveNetworkLabConfig,
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

function validateImportedConfig(value: unknown): SavedNetworkLabConfig | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" ||
      !Array.isArray(value.endpoints) || !value.endpoints.every((endpoint) => typeof endpoint === "string") || !isRecord(value.options) ||
      typeof value.createdAt !== "number" || typeof value.updatedAt !== "number" ||
      !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) ||
      value.createdAt < 0 || value.updatedAt < value.createdAt) return null;

  try {
    const validated = saveNetworkLabConfig([], {
      id: value.id,
      name: value.name,
      endpoints: value.endpoints as string[],
      options: value.options as unknown as SavedNetworkLabConfig["options"]
    }, value.updatedAt)[0];
    return { ...validated, createdAt: value.createdAt, updatedAt: value.updatedAt };
  } catch {
    return null;
  }
}

/** Build a portable file from the user's explicitly saved configs. */
export function createNetworkLabConfigExport(
  configs: SavedNetworkLabConfig[],
  exportedAt = Date.now()
): string {
  if (!Number.isFinite(exportedAt) || exportedAt < 0) throw new RangeError("Export timestamp must be finite and non-negative.");
  if (configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) throw new RangeError("Too many saved configs to export.");
  const payload: NetworkLabConfigExport = {
    format: NETWORK_LAB_CONFIG_EXPORT_FORMAT,
    schemaVersion: NETWORK_LAB_CONFIG_EXPORT_VERSION,
    exportedAt,
    configs: configs.map((config) => ({ ...config, endpoints: [...config.endpoints], options: { ...config.options } }))
  };
  const serialized = JSON.stringify(payload, null, 2);
  const validated = parseNetworkLabConfigExport(serialized);
  if (!validated.ok) throw new TypeError(validated.error);
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
    return { ok: false, error: "The selected file is not valid JSON." };
  }

  if (!isRecord(parsed) || parsed.format !== NETWORK_LAB_CONFIG_EXPORT_FORMAT) {
    return { ok: false, error: "This file is not a Network State saved-config export." };
  }
  if (parsed.schemaVersion !== NETWORK_LAB_CONFIG_EXPORT_VERSION) {
    return { ok: false, error: "This config file uses an unsupported schema version." };
  }
  if (typeof parsed.exportedAt !== "number" || !Number.isFinite(parsed.exportedAt) ||
      parsed.exportedAt < 0 || !Array.isArray(parsed.configs) ||
      parsed.configs.length < 1 || parsed.configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    return { ok: false, error: "The config file is incomplete or contains too many saved configs." };
  }

  const configs: SavedNetworkLabConfig[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const item of parsed.configs) {
    const config = validateImportedConfig(item);
    if (!config) return { ok: false, error: "A saved config contains an invalid name, endpoint, option, or timestamp." };
    const normalizedName = config.name.toLocaleLowerCase();
    if (names.has(normalizedName) || ids.has(config.id)) {
      return { ok: false, error: "The config file contains duplicate names or identifiers." };
    }
    names.add(normalizedName);
    ids.add(config.id);
    configs.push(config);
  }

  return { ok: true, configs };
}

/**
 * Merge imported configs by case-insensitive name (or stable id). Existing
 * local identifiers and creation times are preserved for matched configs.
 * The operation is all-or-nothing when the ten-config limit would be exceeded.
 */
export function mergeImportedNetworkLabConfigs(
  existing: SavedNetworkLabConfig[],
  imported: SavedNetworkLabConfig[],
  now = Date.now()
): SavedNetworkLabConfig[] {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("Import timestamp must be finite and non-negative.");
  const next = existing.map((config) => ({ ...config, endpoints: [...config.endpoints], options: { ...config.options } }));

  for (const incoming of imported) {
    const normalizedName = incoming.name.toLocaleLowerCase();
    const index = next.findIndex((config) =>
      config.name.toLocaleLowerCase() === normalizedName || config.id === incoming.id
    );
    if (index >= 0) {
      const prior = next[index];
      next[index] = {
        ...incoming,
        id: prior.id,
        createdAt: prior.createdAt,
        updatedAt: now
      };
    } else {
      next.unshift({ ...incoming, createdAt: now, updatedAt: now });
    }
  }

  if (next.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    throw new RangeError("Import would exceed the ten-config limit. Delete a saved config or import fewer configs.");
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const config of next) {
    const name = config.name.toLocaleLowerCase();
    if (names.has(name) || ids.has(config.id)) {
      throw new TypeError("Import would create duplicate saved config names or identifiers.");
    }
    names.add(name);
    ids.add(config.id);
  }
  return next;
}
