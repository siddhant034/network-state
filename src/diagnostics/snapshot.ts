import type { NetworkEvent, NetworkState, RequestFailure } from "../core/types";
import type { LatencySample } from "../analytics/latency";
import { buildIncidentTimeline, type IncidentSignal, type NetworkIncident } from "../analytics/incidents";
import type { ReliabilityObservation } from "../analytics/reliability";
import type { InstrumentedRequestEvent } from "../adapters/request-instrumentation";
import type { ReachabilityProbeResult } from "../adapters/reachability-probe";
import type { NetworkLabResult } from "../adapters/network-test-lab";

export const DIAGNOSTICS_FORMAT = "network-state-diagnostics" as const;
export const DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
export const MAX_DIAGNOSTICS_IMPORT_BYTES = 1_000_000;

const LIMITS = {
  events: 500,
  failures: 500,
  probes: 100,
  latencySamples: 240,
  reliabilityObservations: 500,
  incidents: 100,
  incidentSignals: 1_000,
  requests: 100,
  networkLabResults: 500
} as const;

export interface DiagnosticsSnapshot {
  format: typeof DIAGNOSTICS_FORMAT;
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION;
  exportedAt: number;
  app: { name: string; version: string };
  environment: { locale: string | null; timezone: string | null };
  configuration: {
    monitoring: boolean;
    requestMonitoring: boolean;
    probeEndpointLabel: string;
    probeIntervalSeconds: number;
    probeTimeoutSeconds: number;
    includePaths: boolean;
  };
  connection: NetworkState["connection"];
  events: NetworkEvent[];
  failures: RequestFailure[];
  probes: ReachabilityProbeResult[];
  latencySamples: LatencySample[];
  reliabilityObservations: ReliabilityObservation[];
  incidents: NetworkIncident[];
  standaloneSignals: IncidentSignal[];
  requests: InstrumentedRequestEvent[];
  networkLabResults: NetworkLabResult[];
}

export interface DiagnosticsSnapshotInput {
  state: NetworkState;
  monitoring: boolean;
  requestMonitoring: boolean;
  probeEndpoint: string;
  probeIntervalSeconds: number;
  probeTimeoutSeconds: number;
  probeHistory: ReachabilityProbeResult[];
  latencySamples: LatencySample[];
  reliabilityObservations: ReliabilityObservation[];
  requestEvents: InstrumentedRequestEvent[];
  networkLabResults: NetworkLabResult[];
  locale?: string | null;
  timezone?: string | null;
  exportedAt?: number;
  includePaths?: boolean;
}

function sanitizeUrl(value: string, includePaths: boolean): string {
  try {
    const url = new URL(value, typeof location === "undefined" ? "http://localhost/" : location.href);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname) {
      return "[redacted]";
    }
    return includePaths ? url.origin + url.pathname : url.host;
  } catch {
    return "[redacted]";
  }
}

function redactText(value: string, includePaths: boolean): string {
  return value.replace(/https?:\/\/[^\s<>"']+/gi, (match) => sanitizeUrl(match, includePaths));
}

/**
 * Creates a portable, bounded diagnostic report. URL paths are omitted by
 * default because applications sometimes put identifiers in path segments.
 * Even with includePaths enabled, credentials, query strings, and fragments
 * are always removed.
 */
export function createDiagnosticsSnapshot(input: DiagnosticsSnapshotInput): DiagnosticsSnapshot {
  const exportedAt = Number.isFinite(input.exportedAt) ? input.exportedAt as number : Date.now();
  const includePaths = input.includePaths === true;
  const timeline = buildIncidentTimeline(input.reliabilityObservations, input.state.events, {
    now: exportedAt,
    windowMs: 24 * 60 * 60 * 1_000
  });

  return {
    format: DIAGNOSTICS_FORMAT,
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    exportedAt,
    app: { name: "Network State", version: "0.1.0" },
    environment: {
      locale: input.locale ?? null,
      timezone: input.timezone ?? null
    },
    configuration: {
      monitoring: input.monitoring,
      requestMonitoring: input.requestMonitoring,
      probeEndpointLabel: sanitizeUrl(input.probeEndpoint, includePaths),
      probeIntervalSeconds: input.probeIntervalSeconds,
      probeTimeoutSeconds: input.probeTimeoutSeconds,
      includePaths
    },
    connection: { ...input.state.connection },
    events: input.state.events.slice(0, LIMITS.events).map((event) => ({
      ...event,
      title: redactText(event.title, includePaths),
      detail: redactText(event.detail, includePaths)
    })),
    failures: input.state.failures.slice(0, LIMITS.failures).map((failure) => ({
      ...failure,
      url: sanitizeUrl(failure.url, includePaths),
      reason: redactText(failure.reason, includePaths)
    })),
    probes: input.probeHistory.slice(0, LIMITS.probes).map((probe) => ({
      ...probe,
      detail: redactText(probe.detail, includePaths)
    })),
    latencySamples: input.latencySamples.slice(-LIMITS.latencySamples).map((sample) => ({ ...sample })),
    reliabilityObservations: input.reliabilityObservations.slice(-LIMITS.reliabilityObservations).map((observation) => ({ ...observation })),
    incidents: timeline.incidents.slice(0, LIMITS.incidents).map((incident) => ({
      ...incident,
      summary: redactText(incident.summary, includePaths),
      signals: incident.signals.slice(0, LIMITS.incidentSignals).map((signal) => ({
        ...signal,
        title: redactText(signal.title, includePaths),
        detail: redactText(signal.detail, includePaths)
      }))
    })),
    standaloneSignals: timeline.standaloneSignals.slice(0, LIMITS.incidentSignals).map((signal) => ({
      ...signal,
      title: redactText(signal.title, includePaths),
      detail: redactText(signal.detail, includePaths)
    })),
    requests: input.requestEvents.slice(0, LIMITS.requests).map((event) => ({
      ...event,
      url: sanitizeUrl(event.url, includePaths)
    })),
    networkLabResults: input.networkLabResults.slice(-LIMITS.networkLabResults).map((result) => ({
      ...result,
      endpointLabel: result.endpointLabel.slice(0, 255),
      detail: redactText(result.detail, includePaths)
    }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maximum = 2_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isNullableString(value: unknown, maximum = 200): value is string | null {
  return value === null || isString(value, maximum);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isArrayOf<T>(
  value: unknown,
  maximum: number,
  guard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.length <= maximum && value.every(guard);
}

function isConnection(value: unknown): value is DiagnosticsSnapshot["connection"] {
  if (!isRecord(value)) return false;
  return isOneOf(value.status, ["online", "offline", "unstable", "unknown"])
    && isNullableString(value.effectiveType, 80)
    && isNullableNumber(value.downlinkMbps)
    && isNullableNumber(value.rttMs)
    && (value.saveData === null || isBoolean(value.saveData))
    && isFiniteNumber(value.since);
}

function isEvent(value: unknown): value is NetworkEvent {
  return isRecord(value)
    && isString(value.id, 160)
    && isOneOf(value.kind, ["status", "latency", "request", "info", "warning", "error"])
    && isString(value.title)
    && isString(value.detail)
    && isFiniteNumber(value.timestamp);
}

function isFailure(value: unknown): value is RequestFailure {
  return isRecord(value)
    && isString(value.id, 160)
    && isString(value.url, 300)
    && isString(value.method, 16)
    && isString(value.reason)
    && isFiniteNumber(value.timestamp);
}

function isProbe(value: unknown): value is ReachabilityProbeResult {
  return isRecord(value)
    && isOneOf(value.status, ["reachable", "http-error", "timeout", "network-error", "aborted", "invalid-endpoint"])
    && isFiniteNumber(value.timestamp)
    && isFiniteNumber(value.durationMs)
    && value.durationMs >= 0
    && isNullableNumber(value.httpStatus)
    && isString(value.detail);
}

function isLatencySample(value: unknown): value is LatencySample {
  return isRecord(value)
    && isFiniteNumber(value.timestamp)
    && isFiniteNumber(value.durationMs)
    && value.durationMs >= 0
    && isOneOf(value.source, ["probe", "fetch", "xhr"]);
}

function isReliabilityObservation(value: unknown): value is ReliabilityObservation {
  return isRecord(value)
    && isFiniteNumber(value.timestamp)
    && isOneOf(value.source, ["probe", "fetch", "xhr"])
    && isOneOf(value.outcome, ["success", "http-error", "network-error", "timeout", "aborted", "invalid-endpoint"]);
}

function isIncidentSignal(value: unknown): value is IncidentSignal {
  return isRecord(value)
    && isString(value.id, 200)
    && isFiniteNumber(value.timestamp)
    && isOneOf(value.source, ["browser", "probe", "fetch", "xhr"])
    && isOneOf(value.type, ["failure", "recovery", "response", "configuration", "ignored", "context"])
    && isOneOf(value.severity, ["critical", "error", "warning", "info"])
    && isString(value.title)
    && isString(value.detail);
}

function isIncident(value: unknown): value is NetworkIncident {
  return isRecord(value)
    && isString(value.id, 300)
    && isString(value.summary)
    && isOneOf(value.status, ["ongoing", "recovered"])
    && isOneOf(value.severity, ["critical", "error", "warning"])
    && isFiniteNumber(value.startAt)
    && isFiniteNumber(value.endAt)
    && isFiniteNumber(value.durationMs)
    && value.durationMs >= 0
    && Number.isInteger(value.failureCount)
    && Array.isArray(value.sources)
    && value.sources.every((source) => isOneOf(source, ["browser", "probe", "fetch", "xhr"]))
    && isArrayOf(value.signals, LIMITS.incidentSignals, isIncidentSignal);
}

function isRequest(value: unknown): value is InstrumentedRequestEvent {
  return isRecord(value)
    && isString(value.id, 200)
    && isOneOf(value.transport, ["fetch", "xhr"])
    && isString(value.method, 16)
    && isString(value.url, 300)
    && isOneOf(value.outcome, ["success", "http-error", "network-error", "timeout", "aborted"])
    && isNullableNumber(value.status)
    && isFiniteNumber(value.durationMs)
    && value.durationMs >= 0
    && isFiniteNumber(value.timestamp);
}

function isNetworkLabResult(value: unknown): value is NetworkLabResult {
  return isRecord(value)
    && isString(value.id, 200)
    && isString(value.endpointLabel, 255)
    && Number.isInteger(value.sequence)
    && isOneOf(value.status, ["reachable", "http-error", "timeout", "network-error", "simulated-failure", "aborted"])
    && isNullableNumber(value.httpStatus)
    && isFiniteNumber(value.durationMs)
    && value.durationMs >= 0
    && isFiniteNumber(value.timestamp)
    && Number.isInteger(value.attempts)
    && isFiniteNumber(value.simulatedLatencyMs)
    && isBoolean(value.simulatedFailure)
    && isBoolean(value.simulationApplied)
    && isString(value.detail);
}

function validateSnapshot(value: unknown): value is DiagnosticsSnapshot {
  if (!isRecord(value) || value.format !== DIAGNOSTICS_FORMAT || value.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION) return false;
  if (!isFiniteNumber(value.exportedAt) || !isRecord(value.app) || !isString(value.app.name, 100) || !isString(value.app.version, 40)) return false;
  if (!isRecord(value.environment) || !isNullableString(value.environment.locale) || !isNullableString(value.environment.timezone)) return false;

  const config = value.configuration;
  if (!isRecord(config)
    || !isBoolean(config.monitoring)
    || !isBoolean(config.requestMonitoring)
    || !isString(config.probeEndpointLabel, 300)
    || !Number.isInteger(config.probeIntervalSeconds) || (config.probeIntervalSeconds as number) < 1 || (config.probeIntervalSeconds as number) > 3_600
    || !Number.isInteger(config.probeTimeoutSeconds) || (config.probeTimeoutSeconds as number) < 1 || (config.probeTimeoutSeconds as number) > 60
    || !isBoolean(config.includePaths)) return false;

  return isConnection(value.connection)
    && isArrayOf(value.events, LIMITS.events, isEvent)
    && isArrayOf(value.failures, LIMITS.failures, isFailure)
    && isArrayOf(value.probes, LIMITS.probes, isProbe)
    && isArrayOf(value.latencySamples, LIMITS.latencySamples, isLatencySample)
    && isArrayOf(value.reliabilityObservations, LIMITS.reliabilityObservations, isReliabilityObservation)
    && isArrayOf(value.incidents, LIMITS.incidents, isIncident)
    && isArrayOf(value.standaloneSignals, LIMITS.incidentSignals, isIncidentSignal)
    && isArrayOf(value.requests, LIMITS.requests, isRequest)
    && isArrayOf(value.networkLabResults, LIMITS.networkLabResults, isNetworkLabResult);
}

/** Parse and validate an imported report before it is shown in the UI. */
export function parseDiagnosticsSnapshot(input: string): { ok: true; snapshot: DiagnosticsSnapshot } | { ok: false; error: string } {
  if (input.length > MAX_DIAGNOSTICS_IMPORT_BYTES) {
    return { ok: false, error: "This snapshot is larger than the 1 MB import limit." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { ok: false, error: "The selected file is not valid JSON." };
  }

  if (!isRecord(parsed) || parsed.format !== DIAGNOSTICS_FORMAT) {
    return { ok: false, error: "This file is not a Network State diagnostics snapshot." };
  }
  if (parsed.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION) {
    return { ok: false, error: "This snapshot uses an unsupported schema version." };
  }
  if (!validateSnapshot(parsed)) {
    return { ok: false, error: "The snapshot is incomplete or contains invalid diagnostic records." };
  }

  return { ok: true, snapshot: parsed };
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** Build one spreadsheet-safe CSV covering events, requests, probes, and incidents. */
export function buildDiagnosticsCsv(snapshot: DiagnosticsSnapshot): string {
  const rows: unknown[][] = [[
    "record_type", "timestamp", "source", "outcome", "title", "detail",
    "duration_ms", "http_status", "method", "url_or_host", "sequence", "attempts", "simulated"
  ]];

  for (const event of snapshot.events) {
    rows.push(["event", event.timestamp, "browser", event.kind, event.title, event.detail]);
  }
  for (const failure of snapshot.failures) {
    rows.push(["failure", failure.timestamp, "request", "failure", "", failure.reason, "", "", failure.method, failure.url]);
  }
  for (const probe of snapshot.probes) {
    rows.push(["probe", probe.timestamp, "probe", probe.status, "", probe.detail, probe.durationMs, probe.httpStatus]);
  }
  for (const sample of snapshot.latencySamples) {
    rows.push(["latency", sample.timestamp, sample.source, "response", "", "", sample.durationMs]);
  }
  for (const observation of snapshot.reliabilityObservations) {
    rows.push(["reliability", observation.timestamp, observation.source, observation.outcome]);
  }
  for (const request of snapshot.requests) {
    rows.push(["request", request.timestamp, request.transport, request.outcome, "", "", request.durationMs, request.status, request.method, request.url]);
  }
  for (const incident of snapshot.incidents) {
    for (const signal of incident.signals) {
      rows.push(["incident-signal", signal.timestamp, signal.source, signal.type, signal.title, signal.detail, "", "", "", "", "", "", signal.severity]);
    }
  }
  for (const signal of snapshot.standaloneSignals) {
    rows.push(["standalone-signal", signal.timestamp, signal.source, signal.type, signal.title, signal.detail, "", "", "", "", "", "", signal.severity]);
  }
  for (const result of snapshot.networkLabResults) {
    rows.push(["network-lab", result.timestamp, "network-lab", result.status, "", result.detail, result.durationMs, result.httpStatus, "", result.endpointLabel, result.sequence, result.attempts, result.simulationApplied]);
  }

  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
