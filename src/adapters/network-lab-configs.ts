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
  const normalizedEndpoints = parsed.endpoints.map((endpoint) => {
    const url = new URL(endpoint.url);
    if (url.search || url.hash) {
      if (!stripQueryData) throw new TypeError("Saved configuration contains query data.");
      removedQueryData = true;
      url.search = "";
      url.hash = "";
    }
    return url.toString();
  });

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

function readConfigs(storage: StorageLike | null): SavedNetworkLabConfig[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
    if (!raw || raw.length > MAX_NETWORK_LAB_CONFIG_STORAGE_CHARS) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    const configs: SavedNetworkLabConfig[] = [];
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const item of value.slice(0, MAX_SAVED_NETWORK_LAB_CONFIGS)) {
      const normalized = normalizeConfig(item, false)?.config;
      if (!normalized) continue;
      const nameKey = normalized.name.toLowerCase();
      if (ids.has(normalized.id) || names.has(nameKey)) continue;
      ids.add(normalized.id);
      names.add(nameKey);
      configs.push(normalized);
    }
    return configs;
  } catch {
    return [];
  }
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
