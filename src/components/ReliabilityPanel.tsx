import { useMemo } from "react";
import { filterReliabilityObservations, summarizeReliability, type ReliabilityObservation, type ReliabilitySource } from "../analytics/reliability";
import type { LatencyWindow } from "../analytics/latency";

interface ReliabilityPanelProps {
  observations: ReliabilityObservation[];
  window: LatencyWindow;
}

const SOURCES: Array<{ key: ReliabilitySource; label: string }> = [
  { key: "probe", label: "Reachability probes" },
  { key: "fetch", label: "Fetch requests" },
  { key: "xhr", label: "XHR requests" }
];

function formatPercent(value: number | null): string {
  return value === null ? "—" : value.toFixed(1) + "%";
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value >= 1_000 ? (value / 1_000).toFixed(1) + " s" : Math.round(value) + " ms";
}

export function ReliabilityPanel({ observations, window }: ReliabilityPanelProps) {
  const visibleObservations = useMemo(
    () => filterReliabilityObservations(observations, window),
    [observations, window]
  );
  const report = useMemo(
    () => summarizeReliability(visibleObservations),
    [visibleObservations]
  );
  const metrics = report.total;

  return (
    <section className="reliability-panel" aria-labelledby="reliability-title">
      <div className="reliability-heading">
        <div>
          <div className="eyebrow">SERVICE RELIABILITY</div>
          <h2 id="reliability-title">Availability & recovery</h2>
          <p>Separate endpoint reachability from successful application responses.</p>
        </div>
        <span className="reliability-window">Same {window} window as latency history</span>
      </div>

      <div className="reliability-stats">
        <div>
          <span>HTTP availability</span>
          <strong>{formatPercent(metrics.availabilityPercent)}</strong>
          <small>{metrics.responses} responses / {metrics.attempts} measured attempts</small>
        </div>
        <div>
          <span>2xx success rate</span>
          <strong>{formatPercent(metrics.successRatePercent)}</strong>
          <small>{metrics.successes} successful responses</small>
        </div>
        <div>
          <span>Transport failures</span>
          <strong>{metrics.transportFailures}</strong>
          <small>{formatPercent(metrics.transportFailureRatePercent)} of measured attempts</small>
        </div>
        <div>
          <span>Median recovery</span>
          <strong>{formatDuration(metrics.medianRecoveryMs)}</strong>
          <small>{metrics.recoveryCount} recovered outage{metrics.recoveryCount === 1 ? "" : "s"} · avg {formatDuration(metrics.averageRecoveryMs)}</small>
        </div>
      </div>

      <div className="reliability-table-wrap">
        <table className="reliability-table">
          <caption>Reliability by observation source</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Attempts</th>
              <th scope="col">Availability</th>
              <th scope="col">2xx rate</th>
              <th scope="col">Transport failures</th>
              <th scope="col">Current outage</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map(({ key, label }) => {
              const source = report.bySource[key];
              return (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{source.attempts}</td>
                  <td>{formatPercent(source.availabilityPercent)}</td>
                  <td>{formatPercent(source.successRatePercent)}</td>
                  <td>{source.transportFailures}</td>
                  <td>{formatDuration(source.currentOutageMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {metrics.currentOutageCount > 0 && (
        <div className="reliability-outage" role="status">
          {metrics.currentOutageCount} source{metrics.currentOutageCount === 1 ? "" : "s"} currently have an unresolved transport outage. The longest has lasted {formatDuration(metrics.currentOutageMs)}.
        </div>
      )}

      <p className="reliability-footnote">
        Any non-2xx HTTP response counts as available but not successful. Aborted requests and invalid probe URLs are excluded from rates. Recovery measures time from the first consecutive transport failure to the next HTTP response; sources are tracked independently; Fetch and XHR aggregate all observed URLs for each transport.
      </p>
    </section>
  );
}
