import { parseNetworkLabEndpoints } from "./network-test-lab";

export const NETWORK_LAB_CONFIG_STORAGE_KEY = "network-state:network-lab-configs:v1";
export const MAX_SAVED_NETWORK_LAB_CONFIGS = 10;
export const MAX_NETWORK_LAB_CONFIG_NAME_LENGTH = 48;
export const MAX_NETWORK_LAB_CONFIG_STORAGE_CHARS = 64_000;

export interface SavedNetworkLabConfig {
  id: string;
  name: string;
  endpointInput: string;
  requestsPerEndpoint: number;
  concurrency: number;
  timeoutSeconds: number;
  retries: number;
  simulatedLatencyMs: number;
  simulatedFailureRate: number;
  updatedAt: number;
}

export interface SaveNetworkLabConfigInput extends Omit<SavedNetworkLabConfig, "name"> {
  name: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type SaveResult =
  | { ok: true; configs: SavedNetworkLabConfig[]; saved: SavedNetworkLabConfig; removedQueryData: boolean }
  | { ok: false; error: string };

type DeleteResult =
  | { ok: true; configs: SavedNetworkLabConfig[] }
  | { ok: false; error: string };

const allowedValues = {
  requestsPerEndpoint: [1, 3, 5, 10],
  concurrency: [1, 2, 4, 6],
  timeoutSeconds: [3, 5, 10, 30],
  retries: [0, 1, 2],
  simulatedLatencyMs: [0, 100, 250, 500, 1_000, 2_000],
  simulatedFailureRate: [0, 10, 25, 50, 100]
} as const;

function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowed<K extends keyof typeof allowedValues>(
  key: K,
  value: unknown
): value is (typeof allowedValues)[K][number] {
  return typeof value === "number" && (allowedValues[key] as readonly number[]).includes(value);
}

interface NormalizedConfigResult {
  config: SavedNetworkLabConfig;
  removedQueryData: boolean;
}

function normalizeConfig(value: unknown, stripQueryData: boolean): NormalizedConfigResult | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const endpointInput = typeof value.endpointInput === "string" ? value.endpointInput : "";
  const updatedAt = value.updatedAt;

  if (!id || id.length > 80 || !name || name.length > MAX_NETWORK_LAB_CONFIG_NAME_LENGTH) return null;
  if (endpointInput.length > 2_048 || typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return null;

  if (!isAllowed("requestsPerEndpoint", value.requestsPerEndpoint)
    || !isAllowed("concurrency", value.concurrency)
    || !isAllowed("timeoutSeconds", value.timeoutSeconds)
    || !isAllowed("retries", value.retries)
    || !isAllowed("simulatedLatencyMs", value.simulatedLatencyMs)
    || !isAllowed("simulatedFailureRate", value.simulatedFailureRate)) return null;

  const parsed = parseNetworkLabEndpoints(endpointInput);
  if (parsed.errors.length > 0 || parsed.endpoints.length === 0) return null;

  let removedQueryData = false;
  const originalLines = endpointInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedEndpoints = parsed.endpoints.map((endpoint, index) => {
    const url = new URL(endpoint.url);
    const originalUrl = new URL(originalLines[index]);
    if (originalUrl.search || originalUrl.hash) {
      if (!stripQueryData) return null;
      removedQueryData = true;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  });
  if (normalizedEndpoints.some((endpoint) => endpoint === null)) return null;

  const normalized = parseNetworkLabEndpoints(normalizedEndpoints.join("\n"));
  if (normalized.errors.length > 0 || normalized.endpoints.length !== parsed.endpoints.length) return null;

  return {
    config: {
      id,
      name,
      endpointInput: normalized.endpoints.map((endpoint) => endpoint.url).join("\n"),
      requestsPerEndpoint: value.requestsPerEndpoint,
      concurrency: value.concurrency,
      timeoutSeconds: value.timeoutSeconds,
      retries: value.retries,
      simulatedLatencyMs: value.simulatedLatencyMs,
      simulatedFailureRate: value.simulatedFailureRate,
      updatedAt
    },
    removedQueryData
  };
}

export type SavedNetworkLabConfigReadStatus = "ok" | "missing" | "invalid" | "unavailable";

export interface SavedNetworkLabConfigReadResult {
  status: SavedNetworkLabConfigReadStatus;
  configs: SavedNetworkLabConfig[];
}

/**
 * Read the current local record without confusing malformed data or blocked
 * storage with an intentionally empty configuration list. The UI uses this
 * when processing cross-tab storage events so corruption never erases its
 * last known-good in-memory list.
 */
export function inspectSavedNetworkLabConfigs(
  storage: Pick<Storage, "getItem"> | null = getBrowserStorage()
): SavedNetworkLabConfigReadResult {
  if (!storage) return { status: "unavailable", configs: [] };

  let raw: string | null;
  try {
    raw = storage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
  } catch {
    return { status: "unavailable", configs: [] };
  }
  if (raw === null) return { status: "missing", configs: [] };
  if (raw.length > MAX_NETWORK_LAB_CONFIG_STORAGE_CHARS) return { status: "invalid", configs: [] };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", configs: [] };
  }
  if (!Array.isArray(value)) return { status: "invalid", configs: [] };

  const configs: SavedNetworkLabConfig[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  let invalid = value.length > MAX_SAVED_NETWORK_LAB_CONFIGS;
  for (const item of value.slice(0, MAX_SAVED_NETWORK_LAB_CONFIGS)) {
    const normalized = normalizeConfig(item, false)?.config;
    if (!normalized) {
      invalid = true;
      continue;
    }
    const nameKey = normalized.name.toLowerCase();
    if (ids.has(normalized.id) || names.has(nameKey)) {
      invalid = true;
      continue;
    }
    ids.add(normalized.id);
    names.add(nameKey);
    configs.push(normalized);
  }

  return { status: invalid ? "invalid" : "ok", configs };
}

export function validateSavedNetworkLabConfig(value: unknown): SavedNetworkLabConfig | null {
  return normalizeConfig(value, false)?.config ?? null;
}

export type PersistSavedNetworkLabConfigsResult =
  | { ok: true; configs: SavedNetworkLabConfig[] }
  | { ok: false; error: string };

/** Persist a fully validated config list in one storage write (used by import). */
export function persistSavedNetworkLabConfigs(
  configs: SavedNetworkLabConfig[],
  storage: StorageLike | null = getBrowserStorage()
): PersistSavedNetworkLabConfigsResult {
  if (!storage) return { ok: false, error: "Local storage is unavailable in this browser context." };
  if (configs.length > MAX_SAVED_NETWORK_LAB_CONFIGS) {
    return { ok: false, error: "You can save up to ten configurations." };
  }

  const normalized: SavedNetworkLabConfig[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of configs) {
    const config = validateSavedNetworkLabConfig(item);
    if (!config) return { ok: false, error: "A saved configuration is invalid and could not be imported." };
    const name = config.name.toLowerCase();
    if (ids.has(config.id) || names.has(name)) {
      return { ok: false, error: "Saved configurations must have unique names and identifiers." };
    }
    ids.add(config.id);
    names.add(name);
    normalized.push(config);
  }

  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_NETWORK_LAB_CONFIG_STORAGE_CHARS) {
    return { ok: false, error: "These configurations exceed the local storage limit." };
  }
  try {
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, serialized);
    return { ok: true, configs: normalized };
  } catch {
    return { ok: false, error: "The browser could not save imported configurations." };
  }
}

function readConfigs(storage: StorageLike | null): SavedNetworkLabConfig[] {
  return inspectSavedNetworkLabConfigs(storage).configs;
}

/** Load only validated, bounded configurations from this browser's local storage. */
export function loadSavedNetworkLabConfigs(storage: StorageLike | null = getBrowserStorage()): SavedNetworkLabConfig[] {
  return readConfigs(storage);
}

/**
 * Save an explicitly named configuration locally. Query strings and fragments are
 * removed before persistence; endpoint paths are retained and may contain identifiers.
 */
export function saveNetworkLabConfig(
  input: SaveNetworkLabConfigInput,
  storage: StorageLike | null = getBrowserStorage()
): SaveResult {
  if (!storage) return { ok: false, error: "Local storage is unavailable in this browser context." };

  const normalized = normalizeConfig(input, true);
  if (!normalized) {
    return { ok: false, error: "Check the name, HTTP(S) endpoints, and supported workload settings before saving." };
  }

  const configs = readConfigs(storage);
  const duplicateName = configs.find((config) =>
    config.id !== normalized.config.id && config.name.toLowerCase() === normalized.config.name.toLowerCase()
  );
  if (duplicateName) return { ok: false, error: "A saved configuration already uses that name." };

  const existingIndex = configs.findIndex((config) => config.id === normalized.config.id);
  if (existingIndex === -1 && configs.length >= MAX_SAVED_NETWORK_LAB_CONFIGS) {
    return { ok: false, error: "You can save up to ten configurations. Delete one before saving another." };
  }

  const next = configs.slice();
  if (existingIndex === -1) next.unshift(normalized.config);
  else next[existingIndex] = normalized.config;

  const serialized = JSON.stringify(next);
  if (serialized.length > MAX_NETWORK_LAB_CONFIG_STORAGE_CHARS) {
    return { ok: false, error: "These configurations exceed the local storage limit. Remove an endpoint or delete an older configuration." };
  }

  try {
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, serialized);
    return { ok: true, configs: next, saved: normalized.config, removedQueryData: normalized.removedQueryData };
  } catch {
    return { ok: false, error: "The browser could not save this configuration. Check local storage availability and space." };
  }
}

/** Delete one saved configuration without touching test results or diagnostic history. */
export function deleteNetworkLabConfig(
  id: string,
  storage: StorageLike | null = getBrowserStorage()
): DeleteResult {
  if (!storage) return { ok: false, error: "Local storage is unavailable in this browser context." };
  const configs = readConfigs(storage).filter((config) => config.id !== id);
  try {
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, JSON.stringify(configs));
    return { ok: true, configs };
  } catch {
    return { ok: false, error: "The browser could not update saved configurations." };
  }
}
