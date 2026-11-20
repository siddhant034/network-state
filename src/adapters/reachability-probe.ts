export type ReachabilityProbeStatus =
  | "reachable"
  | "http-error"
  | "timeout"
  | "network-error"
  | "aborted"
  | "invalid-endpoint";

export interface ReachabilityProbeResult {
  status: ReachabilityProbeStatus;
  timestamp: number;
  durationMs: number;
  httpStatus: number | null;
  detail: string;
}

export interface ReachabilityProbeOptions {
  timeoutMs?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  baseUrl?: string;
  now?: () => number;
}

const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();

function resolveEndpoint(endpoint: string, baseUrl?: string): URL {
  const base = baseUrl ?? (typeof location !== "undefined" ? location.href : undefined);
  const url = base ? new URL(endpoint, base) : new URL(endpoint);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Only HTTP and HTTPS endpoints are supported.");
  }

  if (url.username || url.password) {
    throw new TypeError("Endpoints must not contain embedded credentials.");
  }

  return url;
}

/**
 * Performs one bounded, credential-free GET request to a configurable endpoint.
 * Any HTTP response proves that the endpoint responded; non-2xx responses are
 * reported separately from transport failures so server errors are not mistaken
 * for a disconnected network.
 */
export async function runReachabilityProbe(
  endpoint: string,
  options: ReachabilityProbeOptions = {}
): Promise<ReachabilityProbeResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive finite number.");
  }

  const now = options.now ?? defaultNow;
  const started = now();
  const invalidResult = (detail: string): ReachabilityProbeResult => ({
    status: "invalid-endpoint",
    timestamp: Date.now(),
    durationMs: 0,
    httpStatus: null,
    detail
  });

  let target: URL;
  try {
    target = resolveEndpoint(endpoint, options.baseUrl);
  } catch {
    return invalidResult("Enter a valid HTTP or HTTPS endpoint without embedded credentials.");
  }

  if (options.signal?.aborted) {
    return {
      status: "aborted",
      timestamp: Date.now(),
      durationMs: 0,
      httpStatus: null,
      detail: "The probe was cancelled before it started."
    };
  }

  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return {
      status: "network-error",
      timestamp: Date.now(),
      durationMs: Math.max(0, Math.round(now() - started)),
      httpStatus: null,
      detail: "Fetch is not available in this environment."
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason?: unknown) => void) | undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const handleAbort = () => rejectAbort?.(new Error("Probe aborted."));
  const handleCallerAbort = () => {
    callerAborted = true;
    controller.abort();
  };

  controller.signal.addEventListener("abort", handleAbort, { once: true });
  options.signal?.addEventListener("abort", handleCallerAbort, { once: true });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("Probe timed out."));
    }, timeoutMs);
  });

  try {
    const request = Promise.resolve().then(() =>
      fetcher(target.toString(), {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      })
    );

    const response = await Promise.race([request, timeoutPromise, abortPromise]);
    const durationMs = Math.max(0, Math.round(now() - started));

    if (response.status === 0) {
      return {
        status: "network-error",
        timestamp: Date.now(),
        durationMs,
        httpStatus: null,
        detail: "The endpoint returned an opaque response. Configure CORS on the endpoint and allow this page's origin."
      };
    }

    if (response.ok) {
      return {
        status: "reachable",
        timestamp: Date.now(),
        durationMs,
        httpStatus: response.status,
        detail: "The endpoint responded successfully with HTTP " + response.status + "."
      };
    }

    return {
      status: "http-error",
      timestamp: Date.now(),
      durationMs,
      httpStatus: response.status,
      detail: "The endpoint responded with HTTP " + response.status + ". The host is reachable, but the response was not successful."
    };
  } catch {
    const durationMs = Math.max(0, Math.round(now() - started));
    if (timedOut) {
      return {
        status: "timeout",
        timestamp: Date.now(),
        durationMs,
        httpStatus: null,
        detail: "No response arrived within " + timeoutMs + " ms."
      };
    }

    if (callerAborted || options.signal?.aborted) {
      return {
        status: "aborted",
        timestamp: Date.now(),
        durationMs,
        httpStatus: null,
        detail: "The probe was cancelled."
      };
    }

    return {
      status: "network-error",
      timestamp: Date.now(),
      durationMs,
      httpStatus: null,
      detail: "No HTTP response was received. Check the endpoint, DNS, TLS, and CORS configuration."
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    controller.signal.removeEventListener("abort", handleAbort);
    options.signal?.removeEventListener("abort", handleCallerAbort);
  }
}
