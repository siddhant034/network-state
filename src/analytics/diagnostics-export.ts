import type { ReachabilityProbeResult } from "../adapters/reachability-probe";
import type { LatencySample } from "./latency";
import type { ReliabilityObservation } from "./reliability";
import type { NetworkState } from "../core/types";

export interface DiagnosticsSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  connection: NetworkState["connection"];
  monitoring: {
    consecutiveFailures: number;
    eventCount: number;
    failureCount: number;
    probeCount: number;
    latencySampleCount: number;
    reliabilityObservationCount: number;
  };
  events: Array<Pick<NetworkState["events"][number], "id" | "kind" | "title" | "timestamp">>;
  requestFailures: Array<{ timestamp: number; method: string }>;
  probes: Array<Pick<ReachabilityProbeResult, "status" | "timestamp" | "durationMs" | "httpStatus">>;
  latencySamples: LatencySample[];
  reliabilityObservations: ReliabilityObservation[];
  privacy: {
    omitted: string[];
  };
}

/**
 * Creates a portable, bounded report without copying request destinations or
 * free-form event details. URL paths and query strings can contain identifiers,
 * so they are intentionally excluded from exports even when monitoring is opted in.
 */
export function createDiagnosticsSnapshot(input: {
  state: NetworkState;
  probeHistory: ReachabilityProbeResult[];
  latencySamples: LatencySample[];
  reliabilityObservations: ReliabilityObservation[];
  generatedAt?: number;
}): DiagnosticsSnapshot {
  const generatedAt = input.generatedAt ?? Date.now();
  if (!Number.isFinite(generatedAt)) throw new RangeError("generatedAt must be a finite timestamp.");

  const events = input.state.events.slice(0, 80).map(({ id, kind, title, timestamp }) => ({
    id,
    kind,
    title,
    timestamp
  }));
  const requestFailures = input.state.failures.slice(0, 30).map(({ timestamp, method }) => ({
    timestamp,
    method
  }));
  const probes = input.probeHistory.slice(0, 20).map(({ status, timestamp, durationMs, httpStatus }) => ({
    status,
    timestamp,
    durationMs,
    httpStatus
  }));
  const latencySamples = input.latencySamples.slice(-240).map(({ timestamp, durationMs, source }) => ({
    timestamp,
    durationMs,
    source
  }));
  const reliabilityObservations = input.reliabilityObservations.slice(-500).map(({ timestamp, source, outcome }) => ({
    timestamp,
    source,
    outcome
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    connection: { ...input.state.connection },
    monitoring: {
      consecutiveFailures: input.state.consecutiveFailures,
      eventCount: events.length,
      failureCount: requestFailures.length,
      probeCount: probes.length,
      latencySampleCount: latencySamples.length,
      reliabilityObservationCount: reliabilityObservations.length
    },
    events,
    requestFailures,
    probes,
    latencySamples,
    reliabilityObservations,
    privacy: {
      omitted: [
        "request URLs and URL paths",
        "query strings and fragments",
        "request and response headers or bodies",
        "free-form event and failure details",
        "network testing lab endpoint configurations and run results"
      ]
    }
  };
}
