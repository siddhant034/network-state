import { useMemo, useState } from "react";
import type { NetworkEvent } from "../core/types";
import {
  buildIncidentTimeline,
  type IncidentSeverity,
  type IncidentSource,
  type NetworkIncident,
  type IncidentSignal
} from "../analytics/incidents";
import type { ReliabilityObservation } from "../analytics/reliability";
import type { LatencyWindow } from "../analytics/latency";

interface IncidentTimelineProps {
  observations: ReliabilityObservation[];
  events: NetworkEvent[];
  window: LatencyWindow;
}

type SourceFilter = "all" | IncidentSource;
type SeverityFilter = "all" | IncidentSeverity;
type StatusFilter = "all" | "ongoing" | "recovered";

const WINDOW_MS: Record<LatencyWindow, number> = {
  "5m": 5 * 60 * 1_000,
  "30m": 30 * 60 * 1_000,
  "2h": 2 * 60 * 60 * 1_000
};

const SOURCE_LABELS: Record<IncidentSource, string> = {
  browser: "Browser",
  probe: "Reachability probe",
  fetch: "Fetch",
  xhr: "XHR"
};

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return Math.round(durationMs) + " ms";
  if (durationMs < 60_000) return (durationMs / 1_000).toFixed(1) + " s";
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  return minutes + "m " + seconds + "s";
}

function incidentMatches(
  incident: NetworkIncident,
  source: SourceFilter,
  severity: SeverityFilter,
  status: StatusFilter,
  query: string
): boolean {
  if (source !== "all" && !incident.sources.includes(source)) return false;
  if (severity !== "all" && incident.severity !== severity) return false;
  if (status !== "all" && incident.status !== status) return false;
  if (!query) return true;
  const searchable = [
    incident.summary,
    incident.sources.map((item) => SOURCE_LABELS[item]).join(" "),
    ...incident.signals.map((signal) => signal.title + " " + signal.detail)
  ].join(" ").toLowerCase();
  return searchable.includes(query);
}

function signalMatches(
  signal: IncidentSignal,
  source: SourceFilter,
  severity: SeverityFilter,
  query: string
): boolean {
  if (source !== "all" && signal.source !== source) return false;
  if (severity !== "all" && signal.severity !== severity) return false;
  if (!query) return true;
  return (signal.title + " " + signal.detail + " " + SOURCE_LABELS[signal.source]).toLowerCase().includes(query);
}

function TimelineSignals({ signals }: { signals: IncidentSignal[] }) {
  return (
    <ol className="incident-signal-list">
      {signals.map((signal) => (
        <li key={signal.id} className={"incident-signal " + signal.type}>
          <span className={"incident-signal-dot " + signal.severity} />
          <div>
            <strong>{signal.title}</strong>
            <p>{signal.detail}</p>
            <small>{SOURCE_LABELS[signal.source]}</small>
          </div>
          <time dateTime={new Date(signal.timestamp).toISOString()}>{formatTime(signal.timestamp)}</time>
        </li>
      ))}
    </ol>
  );
}

function IncidentCard({ incident }: { incident: NetworkIncident }) {
  return (
    <article className={"incident-card " + incident.status}>
      <div className="incident-card-heading">
        <div className="incident-card-title">
          <span className={"incident-severity " + incident.severity}>{incident.severity}</span>
          <strong>{incident.summary}</strong>
        </div>
        <div className="incident-card-meta">
          <span className={"incident-status " + incident.status}>{incident.status === "ongoing" ? "Ongoing" : "Recovered"}</span>
          <span>{formatDuration(incident.durationMs)}</span>
          <time dateTime={new Date(incident.startAt).toISOString()}>{formatTime(incident.startAt)}</time>
        </div>
      </div>
      <div className="incident-card-summary">
        <span>{incident.failureCount} transport failure{incident.failureCount === 1 ? "" : "s"}</span>
        <span>{incident.sources.map((source) => SOURCE_LABELS[source]).join(" · ")}</span>
        <span>{incident.signals.length} timeline events</span>
      </div>
      <details className="incident-details">
        <summary>Inspect incident timeline</summary>
        <TimelineSignals signals={incident.signals} />
      </details>
    </article>
  );
}

export function IncidentTimeline({ observations, events, window }: IncidentTimelineProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const timeline = useMemo(() => buildIncidentTimeline(observations, events, {
    windowMs: WINDOW_MS[window]
  }), [observations, events, window]);
  const normalizedQuery = query.trim().toLowerCase();

  const visibleIncidents = timeline.incidents.filter((incident) =>
    incidentMatches(incident, source, severity, status, normalizedQuery)
  );
  const visibleSignals = status === "all"
    ? timeline.standaloneSignals.filter((signal) => signalMatches(signal, source, severity, normalizedQuery))
    : [];

  const hasFilters = normalizedQuery.length > 0 || source !== "all" || severity !== "all" || status !== "all";
  const hasResults = visibleIncidents.length > 0 || visibleSignals.length > 0;

  return (
    <section className="incident-panel" aria-labelledby="incident-title">
      <div className="incident-heading">
        <div>
          <div className="eyebrow">INCIDENT INVESTIGATION</div>
          <h2 id="incident-title">Correlated incident timeline</h2>
          <p>Group related transport failures, inspect their signals, and follow recovery across independent sources.</p>
        </div>
        <span className="incident-window">{window} window</span>
      </div>

      <div className="incident-toolbar">
        <label className="incident-search">
          <span>Search</span>
          <input
            aria-label="Search incidents and signals"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search source, event, or detail"
          />
        </label>
        <label>
          <span>Source</span>
          <select aria-label="Incident source filter" value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}>
            <option value="all">All sources</option>
            <option value="browser">Browser</option>
            <option value="probe">Reachability probe</option>
            <option value="fetch">Fetch</option>
            <option value="xhr">XHR</option>
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select aria-label="Incident severity filter" value={severity} onChange={(event) => setSeverity(event.target.value as SeverityFilter)}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select aria-label="Incident status filter" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            <option value="ongoing">Ongoing</option>
            <option value="recovered">Recovered</option>
          </select>
        </label>
      </div>

      <div className="incident-results" aria-live="polite">
        {visibleIncidents.map((incident) => <IncidentCard key={incident.id} incident={incident} />)}
        {visibleSignals.length > 0 && (
          <div className="incident-other-signals">
            <h3>Other signals</h3>
            <TimelineSignals signals={visibleSignals} />
          </div>
        )}
        {!hasResults && (
          <div className="incident-empty">
            <strong>{hasFilters ? "No matching investigation results" : "No correlated incidents in this window"}</strong>
            <span>{hasFilters ? "Try widening a filter or changing the search." : "Transport failures, browser transitions, and recovery events will appear here as they happen."}</span>
          </div>
        )}
      </div>

      <p className="incident-footnote">
        Failures are correlated when source outages overlap or begin within 30 seconds. Recovery is tracked independently per source; any HTTP response ends a transport outage, but only 2xx responses count as successful. History is bounded and remains in memory.
      </p>
    </section>
  );
}
