import { redactSensitivePath } from "../privacy/url-redaction";

export type RequestTransport = "fetch" | "xhr";
export type RequestOutcome = "success" | "http-error" | "network-error" | "timeout" | "aborted";

export interface InstrumentedRequestEvent {
  id: string;
  transport: RequestTransport;
  method: string;
  url: string;
  outcome: RequestOutcome;
  status: number | null;
  durationMs: number;
  timestamp: number;
}

export interface RequestInstrumentationOptions {
  onRequest: (event: InstrumentedRequestEvent) => void;
  shouldInstrument?: (url: string, method: string) => boolean;
  now?: () => number;
}

type FetchHost = { fetch: typeof fetch };
type XhrConstructor = { prototype: XMLHttpRequest };

const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? "request-" + Date.now() + "-" + Math.random().toString(36).slice(2);

/**
 * Keep the origin and path for useful diagnostics, but never retain credentials,
 * query parameters, or fragments. Request headers and bodies are never inspected.
 */
function sanitizeUrl(value: string | URL): string {
  try {
    const base = typeof location !== "undefined" ? location.href : "http://localhost/";
    const url = new URL(String(value), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol + "[redacted]";
    return (url.origin + redactSensitivePath(url.pathname)).slice(0, 240);
  } catch {
    return "Unknown URL";
  }
}

function normalizeMethod(value: string | undefined): string {
  return (value || "GET").toUpperCase().slice(0, 16);
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function shouldCapture(options: RequestInstrumentationOptions, url: string, method: string): boolean {
  if (!options.shouldInstrument) return true;
  try {
    return options.shouldInstrument(url, method);
  } catch {
    // A diagnostic filter must never break the application request.
    return false;
  }
}

function emit(options: RequestInstrumentationOptions, event: InstrumentedRequestEvent): void {
  try {
    options.onRequest(event);
  } catch {
    // Observer callbacks are isolated from the request being observed.
  }
}

function createEvent(
  transport: RequestTransport,
  metadata: { method: string; url: string },
  outcome: RequestOutcome,
  status: number | null,
  startedAt: number,
  now: () => number
): InstrumentedRequestEvent {
  return {
    id: makeId(),
    transport,
    method: metadata.method,
    url: metadata.url,
    outcome,
    status,
    durationMs: Math.max(0, Math.round(now() - startedAt)),
    timestamp: Date.now()
  };
}

/**
 * Opt-in Fetch instrumentation. The original response and rejection semantics
 * are preserved; no response body is read or cloned.
 */
export function installFetchInstrumentation(
  options: RequestInstrumentationOptions,
  host: FetchHost = globalThis
): () => void {
  const originalFetch = host.fetch;
  if (typeof originalFetch !== "function") return () => undefined;

  const now = options.now ?? defaultNow;
  let active = true;

  const wrappedFetch: typeof fetch = async (input, init) => {
    const request = typeof input === "object" && input !== null && "url" in input
      ? input as Request
      : undefined;
    const rawUrl = typeof input === "string" || input instanceof URL
      ? String(input)
      : request?.url ?? "Unknown URL";
    const metadata = {
      method: normalizeMethod(init?.method ?? request?.method),
      url: sanitizeUrl(rawUrl)
    };

    if (!active || !isHttpUrl(metadata.url) || !shouldCapture(options, metadata.url, metadata.method)) {
      return originalFetch.call(host, input, init);
    }

    const startedAt = now();
    try {
      const response = await originalFetch.call(host, input, init);
      const outcome: RequestOutcome = response.status === 0
        ? "network-error"
        : response.status < 200 || response.status >= 300
          ? "http-error"
          : "success";
      emit(options, createEvent("fetch", metadata, outcome, response.status || null, startedAt, now));
      return response;
    } catch (error) {
      const name = typeof error === "object" && error !== null && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
      const outcome: RequestOutcome = name === "TimeoutError"
        ? "timeout"
        : name === "AbortError"
          ? "aborted"
          : "network-error";
      emit(options, createEvent("fetch", metadata, outcome, null, startedAt, now));
      throw error;
    }
  };

  host.fetch = wrappedFetch;

  return () => {
    active = false;
    // Do not overwrite a wrapper installed by another library after ours.
    if (host.fetch === wrappedFetch) host.fetch = originalFetch;
  };
}

/**
 * Opt-in XMLHttpRequest instrumentation. Listeners are removed on completion
 * and when instrumentation is uninstalled, including for in-flight requests.
 */
export function installXhrInstrumentation(
  options: RequestInstrumentationOptions,
  XhrCtor: XhrConstructor
): () => void {
  const prototype = XhrCtor.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const now = options.now ?? defaultNow;
  const metadataByRequest = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const pendingCleanups = new Set<() => void>();
  let active = true;

  const patchedOpen: typeof XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    const result = originalOpen.call(this, method, url, async ?? true, username, password);
    metadataByRequest.set(this, {
      method: normalizeMethod(method),
      url: sanitizeUrl(url)
    });
    return result;
  };

  const patchedSend: typeof XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof XMLHttpRequest.prototype.send>
  ) {
    const metadata = metadataByRequest.get(this);
    if (!active || !metadata || !isHttpUrl(metadata.url) || !shouldCapture(options, metadata.url, metadata.method)) {
      return originalSend.apply(this, args);
    }

    const xhr = this;
    const startedAt = now();
    let terminalOutcome: RequestOutcome | null = null;

    const onError: EventListener = () => { terminalOutcome = "network-error"; };
    const onTimeout: EventListener = () => { terminalOutcome = "timeout"; };
    const onAbort: EventListener = () => { terminalOutcome = "aborted"; };
    const cleanup = () => {
      xhr.removeEventListener("error", onError);
      xhr.removeEventListener("timeout", onTimeout);
      xhr.removeEventListener("abort", onAbort);
      xhr.removeEventListener("loadend", onLoadEnd);
      pendingCleanups.delete(cleanup);
      if (metadataByRequest.get(xhr) === metadata) metadataByRequest.delete(xhr);
    };
    const onLoadEnd: EventListener = () => {
      cleanup();
      if (!active) return;

      const status = xhr.status || null;
      const outcome = terminalOutcome ?? (
        status === null
          ? "network-error"
          : status < 200 || status >= 300
            ? "http-error"
            : "success"
      );
      emit(options, createEvent("xhr", metadata, outcome, status, startedAt, now));
    };

    xhr.addEventListener("error", onError);
    xhr.addEventListener("timeout", onTimeout);
    xhr.addEventListener("abort", onAbort);
    xhr.addEventListener("loadend", onLoadEnd);
    pendingCleanups.add(cleanup);

    try {
      return originalSend.apply(xhr, args);
    } catch (error) {
      cleanup();
      throw error;
    }
  };

  prototype.open = patchedOpen;
  prototype.send = patchedSend;

  return () => {
    active = false;
    for (const cleanup of Array.from(pendingCleanups)) cleanup();
    if (prototype.open === patchedOpen) prototype.open = originalOpen;
    if (prototype.send === patchedSend) prototype.send = originalSend;
  };
}

export interface RequestInstrumentationInstallation {
  supported: { fetch: boolean; xhr: boolean };
  stop: () => void;
}

/** Installs whichever browser transports are available and returns one disposer. */
export function installRequestInstrumentation(
  options: RequestInstrumentationOptions
): RequestInstrumentationInstallation {
  const fetchSupported = typeof globalThis.fetch === "function";
  const xhrSupported = typeof XMLHttpRequest !== "undefined";
  const stopFetch = fetchSupported ? installFetchInstrumentation(options) : () => undefined;
  const stopXhr = xhrSupported
    ? installXhrInstrumentation(options, XMLHttpRequest)
    : () => undefined;
  let stopped = false;

  return {
    supported: { fetch: fetchSupported, xhr: xhrSupported },
    stop() {
      if (stopped) return;
      stopped = true;
      stopXhr();
      stopFetch();
    }
  };
}
