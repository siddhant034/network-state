import type { NetworkEvent } from "../core/types";
import type { ReliabilityObservation } from "./reliability";

export type IncidentSource = "browser" | "probe" | "fetch" | "xhr";
export type IncidentSeverity = "critical" | "error" | "warning" | "info";
export type IncidentStatus = "ongoing" | "recovered";
export type IncidentSignalType = "failure" | "recovery" | "response" | "configuration" | "ignored" | "context";

export interface IncidentSignal {
  id: string;
  timestamp: number;
  source: IncidentSource;
  type: IncidentSignalType;
  severity: IncidentSeverity;
  title: string;
  detail: string;
}

export interface NetworkIncident {
  id: string;
  summary: string;
  status: IncidentStatus;
  severity: Exclude<IncidentSeverity, "info">;
  startAt: number;
  endAt: number;
  durationMs: number;
  failureCount: number;
  sources: IncidentSource[];
  signals: IncidentSignal[];
}

export interface IncidentTimeline {
  incidents: NetworkIncident[];
  standaloneSignals: IncidentSignal[];
  signals: IncidentSignal[];
}

export interface IncidentTimelineOptions {
  now?: number;
  windowMs?: number;
  correlationWindowMs?: number;
}

interface SourceEpisode {
  source: IncidentSource;
  startAt: number;
  endAt: number;
  recoveredAt: number | null;
  signals: IncidentSignal[];
}

interface MutableIncidentGroup {
  episodes: SourceEpisode[];
  startAt: number;
  lastActivityAt: number;
}

const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_CORRELATION_WINDOW_MS = 30 * 1_000;

function observationSignal(observation: ReliabilityObservation, index: number): IncidentSignal {
  const base = {
    id: "observation-" + observation.source + "-" + observation.timestamp + "-" + index,
    timestamp: observation.timestamp,
    source: observation.source,
    severity: "info" as IncidentSeverity
  };

  switch (observation.outcome) {
    case "network-error":
      return { ...base, type: "failure", severity: "error", title: "No HTTP response", detail: "A transport-level request failure was observed." };
    case "timeout":
      return { ...base, type: "failure", severity: "error", title: "Request timed out", detail: "No HTTP response arrived before the configured deadline." };
    case "success":
      return { ...base, type: "response", title: "HTTP response received", detail: "A 2xx response confirmed transport and application success." };
    case "http-error":
      return { ...base, type: "response", severity: "warning", title: "HTTP error response", detail: "The endpoint responded, but returned a non-2xx status." };
    case "aborted":
      return { ...base, type: "ignored", title: "Request aborted", detail: "An aborted request is excluded from reliability rates." };
    case "invalid-endpoint":
      return { ...base, type: "configuration", severity: "warning", title: "Invalid reachability endpoint", detail: "The probe URL is invalid or uses an unsupported protocol or embedded credentials." };
  }
}

function browserSignal(event: NetworkEvent): IncidentSignal | null {
  if (!Number.isFinite(event.timestamp)) return null;

  if (event.title === "Connection lost") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      source: "browser",
      type: "failure",
      severity: "critical",
      title: event.title,
      detail: event.detail
    };
  }

  if (event.title === "Connection restored") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      source: "browser",
      type: "recovery",
      severity: "info",
      title: event.title,
      detail: event.detail
    };
  }

  if (event.title === "Connection characteristics changed") {
    return {
      id: event.id,
      timestamp: event.timestamp,
      source: "browser",
      type: "context",
      severity: "info",
      title: event.title,
      detail: event.detail
    };
  }

  return null;
}

function signalOrder(signal: IncidentSignal): number {
  if (signal.type === "failure") return 0;
  if (signal.type === "recovery" || signal.type === "response") return 1;
  return 2;
}

function sourceSummary(sources: IncidentSource[]): string {
  if (sources.includes("browser")) return "Browser connectivity interruption";
  if (sources.length > 1) return "Correlated network failures";
  const source = sources[0];
  return source === "probe" ? "Reachability probe outage"
    : source === "fetch" ? "Fetch transport outage"
      : "XHR transport outage";
}

function buildIncident(episodes: SourceEpisode[], now: number): NetworkIncident {
  const signals = episodes.flatMap((episode) => episode.signals)
    .sort((left, right) => left.timestamp - right.timestamp || signalOrder(left) - signalOrder(right));
  const sources = Array.from(new Set(episodes.map((episode) => episode.source))).sort();
  const startAt = Math.min(...episodes.map((episode) => episode.startAt));
  const endAt = Math.max(...episodes.map((episode) => episode.endAt));
  const ongoing = episodes.some((episode) => episode.recoveredAt === null);
  const failureCount = signals.filter((signal) => signal.type === "failure").length;
  const severity: Exclude<IncidentSeverity, "info"> = sources.includes("browser")
    ? "critical"
    : sources.length > 1 || failureCount >= 3
      ? "error"
      : "warning";

  return {
    id: "incident-" + startAt + "-" + signals[0].id,
    summary: sourceSummary(sources),
    status: ongoing ? "ongoing" : "recovered",
    severity,
    startAt,
    endAt,
    durationMs: Math.max(0, (ongoing ? now : endAt) - startAt),
    failureCount,
    sources,
    signals
  };
}

/**
 * Correlate independent transport outages into investigation incidents.
 * Browser online/offline events are kept separate from Fetch, XHR, and probe
 * recovery, so success from one source never closes another source's outage.
 */
export function buildIncidentTimeline(
  observations: ReliabilityObservation[],
  events: NetworkEvent[],
  options: IncidentTimelineOptions = {}
): IncidentTimeline {
  const now = Number.isFinite(options.now) ? options.now as number : Date.now();
  const windowMs = Number.isFinite(options.windowMs) && (options.windowMs as number) > 0
    ? options.windowMs as number
    : DEFAULT_WINDOW_MS;
  const correlationWindowMs = Number.isFinite(options.correlationWindowMs) && (options.correlationWindowMs as number) >= 0
    ? options.correlationWindowMs as number
    : DEFAULT_CORRELATION_WINDOW_MS;
  const cutoff = now - windowMs;

  const signals = [
    ...observations.map(observationSignal),
    ...events.map(browserSignal).filter((signal): signal is IncidentSignal => signal !== null)
  ].filter((signal) => Number.isFinite(signal.timestamp) && signal.timestamp <= now)
    .sort((left, right) => left.timestamp - right.timestamp || signalOrder(left) - signalOrder(right));

  const activeEpisodes = new Map<IncidentSource, SourceEpisode>();
  const episodes: SourceEpisode[] = [];
  const standaloneSignals: IncidentSignal[] = [];

  for (const signal of signals) {
    if (signal.type === "failure") {
      let episode = activeEpisodes.get(signal.source);
      if (!episode) {
        episode = {
          source: signal.source,
          startAt: signal.timestamp,
          endAt: signal.timestamp,
          recoveredAt: null,
          signals: []
        };
        activeEpisodes.set(signal.source, episode);
        episodes.push(episode);
      }
      episode.signals.push(signal);
      episode.endAt = signal.timestamp;
      continue;
    }

    if (signal.type === "recovery" || signal.type === "response") {
      const episode = activeEpisodes.get(signal.source);
      if (episode) {
        const recoverySignal = signal.type === "response" ? { ...signal, type: "recovery" as const } : signal;
        episode.signals.push(recoverySignal);
        episode.endAt = signal.timestamp;
        episode.recoveredAt = signal.timestamp;
        activeEpisodes.delete(signal.source);
      } else {
        standaloneSignals.push(signal);
      }
      continue;
    }

    standaloneSignals.push(signal);
  }

  const groups: MutableIncidentGroup[] = [];
  for (const episode of episodes.sort((left, right) => left.startAt - right.startAt)) {
    const current = groups[groups.length - 1];
    if (current && episode.startAt <= current.lastActivityAt + correlationWindowMs) {
      current.episodes.push(episode);
      current.lastActivityAt = Math.max(current.lastActivityAt, episode.endAt);
    } else {
      groups.push({
        episodes: [episode],
        startAt: episode.startAt,
        lastActivityAt: episode.endAt
      });
    }
  }

  const incidents = groups
    .map((group) => buildIncident(group.episodes, now))
    .filter((incident) => incident.endAt >= cutoff || incident.status === "ongoing")
    .sort((left, right) => right.startAt - left.startAt);

  const visibleStandalone = standaloneSignals
    .filter((signal) => signal.timestamp >= cutoff)
    .sort((left, right) => right.timestamp - left.timestamp);

  const incidentSignals = incidents.flatMap((incident) => incident.signals);
  const visibleSignals = [...incidentSignals, ...visibleStandalone]
    .sort((left, right) => right.timestamp - left.timestamp);

  return {
    incidents,
    standaloneSignals: visibleStandalone,
    signals: visibleSignals
  };
}
