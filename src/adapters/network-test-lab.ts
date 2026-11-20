import { runReachabilityProbe, type ReachabilityProbeResult } from "./reachability-probe";

export type NetworkLabStatus =
  | "reachable"
  | "http-error"
  | "timeout"
  | "network-error"
  | "simulated-failure"
  | "aborted";

export interface NetworkLabEndpoint {
  id: string;
  url: string;
  label: string;
}

export interface NetworkLabParseResult {
  endpoints: NetworkLabEndpoint[];
  errors: string[];
}

export interface NetworkLabResult {
  id: string;
  endpointLabel: string;
  sequence: number;
  status: NetworkLabStatus;
  httpStatus: number | null;
  durationMs: number;
  timestamp: number;
  attempts: number;
  simulatedLatencyMs: number;
  simulatedFailure: boolean;
  simulationApplied: boolean;
  detail: string;
}

export type NetworkLabDelay = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface NetworkLabOptions {
  requestsPerEndpoint?: number;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  simulatedLatencyMs?: number;
  simulatedFailureRate?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  random?: () => number;
  now?: () => number;
  delay?: NetworkLabDelay;
}

export const MAX_NETWORK_LAB_ENDPOINTS = 5;
export const MAX_NETWORK_LAB_REQUESTS_PER_ENDPOINT = 10;
export const MAX_NETWORK_LAB_CONCURRENCY = 6;

function abortError(): Error {
  const error = new Error("The network test was cancelled.");
  error.name = "AbortError";
  return error;
}

function defaultDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(abortError());
    };
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function isHttpEndpoint(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

/** Parse one absolute HTTP(S) endpoint per line without echoing sensitive input in errors. */
export function parseNetworkLabEndpoints(input: string): NetworkLabParseResult {
  const lines = input.split(/\r?\n/).map((line, index) => ({ value: line.trim(), line: index + 1 }))
    .filter((entry) => entry.value.length > 0);
  const errors: string[] = [];
  const endpoints: NetworkLabEndpoint[] = [];
  const seen = new Set<string>();

  if (lines.length === 0) {
    return { endpoints, errors: ["Add at least one absolute HTTP or HTTPS endpoint."] };
  }

  if (lines.length > MAX_NETWORK_LAB_ENDPOINTS) {
    errors.push("A run is limited to five endpoints. Remove the extra lines and try again.");
  }

  for (const entry of lines.slice(0, MAX_NETWORK_LAB_ENDPOINTS)) {
    try {
      const url = new URL(entry.value);
      if (!isHttpEndpoint(url) || url.username || url.password || !url.hostname) {
        throw new TypeError("Unsupported endpoint.");
      }

      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) {
        errors.push("Line " + entry.line + ": duplicate endpoint; each endpoint should appear once.");
        continue;
      }

      seen.add(normalized);
      endpoints.push({
        id: "endpoint-" + entry.line,
        url: normalized,
        label: url.host
      });
    } catch {
      errors.push("Line " + entry.line + ": enter an absolute HTTP or HTTPS URL without embedded credentials.");
    }
  }

  return { endpoints, errors };
}

function validateInteger(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(name + " must be an integer between " + minimum + " and " + maximum + ".");
  }
}

function validateOptions(options: NetworkLabOptions) {
  const requestsPerEndpoint = options.requestsPerEndpoint ?? 3;
  const concurrency = options.concurrency ?? 2;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const retries = options.retries ?? 0;
  const simulatedLatencyMs = options.simulatedLatencyMs ?? 0;
  const simulatedFailureRate = options.simulatedFailureRate ?? 0;

  validateInteger("requestsPerEndpoint", requestsPerEndpoint, 1, MAX_NETWORK_LAB_REQUESTS_PER_ENDPOINT);
  validateInteger("concurrency", concurrency, 1, MAX_NETWORK_LAB_CONCURRENCY);
  validateInteger("timeoutMs", timeoutMs, 1_000, 30_000);
  validateInteger("retries", retries, 0, 2);
  validateInteger("simulatedLatencyMs", simulatedLatencyMs, 0, 2_000);
  validateInteger("simulatedFailureRate", simulatedFailureRate, 0, 100);

  return {
    requestsPerEndpoint,
    concurrency,
    timeoutMs,
    retries,
    simulatedLatencyMs,
    simulatedFailureRate
  };
}

function makeResult(
  endpoint: NetworkLabEndpoint,
  sequence: number,
  status: NetworkLabStatus,
  httpStatus: number | null,
  durationMs: number,
  attempts: number,
  simulatedLatencyMs: number,
  simulatedFailure: boolean,
  simulationApplied: boolean,
  detail: string
): NetworkLabResult {
  return {
    id: endpoint.id + "-" + sequence,
    endpointLabel: endpoint.label,
    sequence,
    status,
    httpStatus,
    durationMs,
    timestamp: Date.now(),
    attempts,
    simulatedLatencyMs,
    simulatedFailure,
    simulationApplied,
    detail
  };
}

async function runOne(
  endpoint: NetworkLabEndpoint,
  sequence: number,
  options: ReturnType<typeof validateOptions>,
  dependencies: Required<Pick<NetworkLabOptions, "random" | "now" | "delay">> & Pick<NetworkLabOptions, "fetcher" | "signal">
): Promise<NetworkLabResult> {
  const startedAt = dependencies.now();
  let lastStatus: NetworkLabStatus = "network-error";
  let lastHttpStatus: number | null = null;
  let lastDetail = "No HTTP response was received.";
  let attempts = 0;
  let simulatedFailure = false;
  let simulationApplied = false;

  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    if (dependencies.signal?.aborted) {
      return makeResult(endpoint, sequence, "aborted", null, Math.max(0, Math.round(dependencies.now() - startedAt)), attempts, options.simulatedLatencyMs, false, simulationApplied, "The test was cancelled.");
    }

    attempts = attempt;
    const injectFailure = dependencies.random() < options.simulatedFailureRate / 100;

    if (injectFailure) {
      simulationApplied = true;
      try {
        await dependencies.delay(options.simulatedLatencyMs, dependencies.signal);
      } catch {
        return makeResult(endpoint, sequence, "aborted", null, Math.max(0, Math.round(dependencies.now() - startedAt)), attempts, options.simulatedLatencyMs, false, "The test was cancelled.");
      }
      lastStatus = "simulated-failure";
      lastHttpStatus = null;
      lastDetail = "A client-side failure was injected for this test attempt; no request was sent.";
      simulatedFailure = true;
    } else {
      if (options.simulatedLatencyMs > 0) simulationApplied = true;
      const baseFetcher = dependencies.fetcher ?? globalThis.fetch;
      const delayedFetcher: typeof fetch = async (input, init) => {
        await dependencies.delay(options.simulatedLatencyMs, init?.signal ?? dependencies.signal);
        return baseFetcher(input, init);
      };
      const probe: ReachabilityProbeResult = await runReachabilityProbe(endpoint.url, {
        timeoutMs: options.timeoutMs,
        fetcher: delayedFetcher,
        signal: dependencies.signal,
        now: dependencies.now
      });

      lastStatus = probe.status === "invalid-endpoint" ? "network-error" : probe.status;
      lastHttpStatus = probe.httpStatus;
      lastDetail = probe.detail;
      simulatedFailure = false;
    }

    const retryable = lastStatus === "timeout" || lastStatus === "network-error" || lastStatus === "simulated-failure";
    if (!retryable || attempt > options.retries) break;
  }

  return makeResult(
    endpoint,
    sequence,
    lastStatus,
    lastHttpStatus,
    Math.max(0, Math.round(dependencies.now() - startedAt)),
    attempts,
    options.simulatedLatencyMs,
    simulatedFailure,
    simulationApplied,
    lastDetail
  );
}

function normalizeEndpoints(endpoints: NetworkLabEndpoint[]): NetworkLabEndpoint[] {
  const seen = new Set<string>();
  return endpoints.map((endpoint, index) => {
    let url: URL;
    try {
      url = new URL(endpoint.url);
    } catch {
      throw new TypeError("Every endpoint must be an absolute HTTP or HTTPS URL without embedded credentials.");
    }

    if (!isHttpEndpoint(url) || url.username || url.password || !url.hostname) {
      throw new TypeError("Every endpoint must be an absolute HTTP or HTTPS URL without embedded credentials.");
    }

    url.hash = "";
    const normalized = url.toString();
    if (seen.has(normalized)) throw new TypeError("Each endpoint must be unique.");
    seen.add(normalized);

    return {
      id: "endpoint-" + (index + 1),
      url: normalized,
      label: url.host
    };
  });
}

/**
 * Runs a bounded comparison matrix. Simulation is applied only to these lab
 * requests and is never installed as a browser-wide network throttle.
 */
export async function runNetworkLab(
  endpoints: NetworkLabEndpoint[],
  suppliedOptions: NetworkLabOptions = {},
  onResult?: (result: NetworkLabResult) => void
): Promise<NetworkLabResult[]> {
  if (endpoints.length < 1 || endpoints.length > MAX_NETWORK_LAB_ENDPOINTS) {
    throw new RangeError("Provide between one and five endpoints.");
  }

  const options = validateOptions(suppliedOptions);
  const safeEndpoints = normalizeEndpoints(endpoints);
  const dependencies = {
    random: suppliedOptions.random ?? Math.random,
    now: suppliedOptions.now ?? (() => globalThis.performance?.now?.() ?? Date.now()),
    delay: suppliedOptions.delay ?? defaultDelay,
    fetcher: suppliedOptions.fetcher,
    signal: suppliedOptions.signal
  };

  const jobs = safeEndpoints.flatMap((endpoint) =>
    Array.from({ length: options.requestsPerEndpoint }, (_, index) => ({
      endpoint,
      sequence: index + 1
    }))
  );
  const results: NetworkLabResult[] = [];
  let nextJob = 0;

  const worker = async () => {
    while (nextJob < jobs.length && !dependencies.signal?.aborted) {
      const job = jobs[nextJob];
      nextJob += 1;
      const result = await runOne(job.endpoint, job.sequence, options, dependencies);
      results.push(result);
      try {
        onResult?.(result);
      } catch {
        // A presentation callback must not interrupt the diagnostic run.
      }
      if (result.status === "aborted") break;
    }
  };

  const workerCount = Math.min(options.concurrency, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
