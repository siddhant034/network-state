import { parseNetworkLabEndpoints } from "./network-test-lab";

export const NETWORK_LAB_CONFIG_STORAGE_KEY = "network-state:network-lab-configs:v1";
export const MAX_SAVED_NETWORK_LAB_CONFIGS = 10;

export interface SavedNetworkLabOptions {
  requestsPerEndpoint: number;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  simulatedLatencyMs: number;
  simulatedFailureRate: number;
}

export interface SavedNetworkLabConfig {
  id: string;
  name: string;
  endpoints: string[];
  options: SavedNetworkLabOptions;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkLabConfigDraft {
  id?: string;
  name: string;
  endpoints: string[];
  options: SavedNetworkLabOptions;
}

function validateOptions(options: SavedNetworkLabOptions): void {
  const rules: Array<[keyof SavedNetworkLabOptions, number, number]> = [
    ["requestsPerEndpoint", 1, 10],
    ["concurrency", 1, 6],
    ["timeoutMs", 1_000, 30_000],
    ["retries", 0, 2],
    ["simulatedLatencyMs", 0, 2_000],
    ["simulatedFailureRate", 0, 100]
  ];
  for (const [key, minimum, maximum] of rules) {
    const value = options[key];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new RangeError(key + " must be an integer between " + minimum + " and " + maximum + ".");
    }
  }
}

function validateDraft(draft: NetworkLabConfigDraft): Omit<SavedNetworkLabConfig, "createdAt" | "updatedAt"> {
  const name = draft.name.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TypeError("Choose a config name between 1 and 40 characters without control characters.");
  }
  if (!Array.isArray(draft.endpoints) || draft.endpoints.length < 1 || draft.endpoints.length > 5) {
    throw new RangeError("A saved config must contain between one and five endpoints.");
  }
  const parsed = parseNetworkLabEndpoints(draft.endpoints.join("\n"));
  if (parsed.errors.length || parsed.endpoints.length !== draft.endpoints.length) {
    throw new TypeError("Saved endpoints must be unique absolute HTTP(S) URLs without embedded credentials.");
  }
  validateOptions(draft.options);
  const id = draft.id?.trim();
  if (!id || id.length > 100) throw new TypeError("A valid config identifier is required.");
  return {
    id,
    name,
    endpoints: parsed.endpoints.map((endpoint) => endpoint.url),
    options: { ...draft.options }
  };
}

export function saveNetworkLabConfig(
  existing: SavedNetworkLabConfig[],
  draft: NetworkLabConfigDraft,
  now = Date.now()
): SavedNetworkLabConfig[] {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("Config timestamp must be finite and non-negative.");
  const validated = validateDraft(draft);
  const matching = existing.find((config) => config.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase());
  const existingById = existing.find((config) => config.id === validated.id);
  const prior = matching ?? existingById;
  if (!prior && existing.length >= MAX_SAVED_NETWORK_LAB_CONFIGS) {
    throw new RangeError("You can save up to ten configs. Delete one before saving another.");
  }
  const next: SavedNetworkLabConfig = {
    ...validated,
    id: prior?.id ?? validated.id,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now
  };
  return [next, ...existing.filter((config) => config.id !== next.id && config.id !== prior?.id)]
    .slice(0, MAX_SAVED_NETWORK_LAB_CONFIGS);
}

function parseStoredConfig(value: unknown): SavedNetworkLabConfig | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SavedNetworkLabConfig>;
  if (typeof item.id !== "string" || typeof item.name !== "string" ||
      !Array.isArray(item.endpoints) || !item.options ||
      typeof item.createdAt !== "number" || typeof item.updatedAt !== "number") return null;
  try {
    const validated = validateDraft({
      id: item.id,
      name: item.name,
      endpoints: item.endpoints as string[],
      options: item.options as SavedNetworkLabOptions
    });
    if (!Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) ||
        item.createdAt < 0 || item.updatedAt < item.createdAt) return null;
    return { ...validated, createdAt: item.createdAt, updatedAt: item.updatedAt };
  } catch {
    return null;
  }
}

export function loadNetworkLabConfigs(storage: Pick<Storage, "getItem">): SavedNetworkLabConfig[] {
  try {
    const raw = storage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
        !Array.isArray((parsed as { configs?: unknown }).configs)) return [];
    const configs = ((parsed as { configs: unknown[] }).configs)
      .map(parseStoredConfig)
      .filter((config): config is SavedNetworkLabConfig => config !== null);
    const uniqueNames = new Set<string>();
    const uniqueIds = new Set<string>();
    return configs.filter((config) => {
      const name = config.name.toLocaleLowerCase();
      if (uniqueNames.has(name) || uniqueIds.has(config.id)) return false;
      uniqueNames.add(name);
      uniqueIds.add(config.id);
      return true;
    }).slice(0, MAX_SAVED_NETWORK_LAB_CONFIGS);
  } catch {
    return [];
  }
}

export function persistNetworkLabConfigs(
  configs: SavedNetworkLabConfig[],
  storage: Pick<Storage, "setItem">
): boolean {
  try {
    storage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, configs: configs.slice(0, MAX_SAVED_NETWORK_LAB_CONFIGS) }));
    return true;
  } catch {
    return false;
  }
}

export function removeNetworkLabConfig(
  configs: SavedNetworkLabConfig[],
  id: string
): SavedNetworkLabConfig[] {
  return configs.filter((config) => config.id !== id);
}
