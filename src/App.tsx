import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Activity, ArrowDown, ArrowUpRight, Check, CircleHelp, Clock3, Gauge, Globe2, Pause, Play, RadioTower, RefreshCw, ShieldCheck, Wifi, WifiOff, Zap } from "lucide-react";
import { createNetworkMonitor } from "./core/network-monitor";
import type { NetworkEvent } from "./core/types";
import { appendLatencySample, buildLatencyChartPoints, filterLatencySamples, summarizeLatency, type LatencySample, type LatencySourceFilter, type LatencyWindow } from "./analytics/latency";
import { appendReliabilityObservation, type ReliabilityObservation } from "./analytics/reliability";
import { ReliabilityPanel } from "./components/ReliabilityPanel";
import { IncidentTimeline } from "./components/IncidentTimeline";
import { NetworkTestLab } from "./components/NetworkTestLab";
import { DiagnosticsExport } from "./components/DiagnosticsExport";
import { createDiagnosticsSnapshot } from "./diagnostics/snapshot";
import type { NetworkLabResult } from "./adapters/network-test-lab";
import { runReachabilityProbe, type ReachabilityProbeResult } from "./adapters/reachability-probe";
import { installRequestInstrumentation, type InstrumentedRequestEvent } from "./adapters/request-instrumentation";

const monitor = createNetworkMonitor();
const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
const defaultProbeEndpoint = import.meta.env.BASE_URL;
const formatTime = (value: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
const formatAgo = (value: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
};

function App() {
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getSnapshot);
  const [monitoring, setMonitoring] = useState(true);
  const [checking, setChecking] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState(defaultProbeEndpoint);
  const [endpoint, setEndpoint] = useState(defaultProbeEndpoint);
  const [probeIntervalSeconds, setProbeIntervalSeconds] = useState(30);
  const [probeTimeoutSeconds, setProbeTimeoutSeconds] = useState(5);
  const [probeResult, setProbeResult] = useState<ReachabilityProbeResult | null>(null);
  const [probeHistory, setProbeHistory] = useState<ReachabilityProbeResult[]>([]);
  const [latencySamples, setLatencySamples] = useState<LatencySample[]>([]);
  const [reliabilityObservations, setReliabilityObservations] = useState<ReliabilityObservation[]>([]);
  const [latencyWindow, setLatencyWindow] = useState<LatencyWindow>("30m");
  const [latencySource, setLatencySource] = useState<LatencySourceFilter>("all");
  const [requestMonitoring, setRequestMonitoring] = useState(false);
  const [requestEvents, setRequestEvents] = useState<InstrumentedRequestEvent[]>([]);
  const [networkLabResults, setNetworkLabResults] = useState<NetworkLabResult[]>([]);
  const [includeDiagnosticPaths, setIncludeDiagnosticPaths] = useState(false);
  const [instrumentationSupport, setInstrumentationSupport] = useState({ fetch: false, xhr: false });
  const activeProbeController = useRef<AbortController | null>(null);
  const [filter, setFilter] = useState<"all" | "errors" | "status">("all");

  useEffect(() => {
    monitor.start();
    return () => monitor.stop();
  }, []);

  useEffect(() => {
    if (!requestMonitoring) {
      setInstrumentationSupport({ fetch: false, xhr: false });
      return;
    }
    const installation = installRequestInstrumentation({
      onRequest(event) {
        setRequestEvents((current) => [event, ...current].slice(0, 100));
        setReliabilityObservations((current) => appendReliabilityObservation(current, {
          timestamp: event.timestamp,
          source: event.transport,
          outcome: event.outcome
        }));
        if (event.outcome === "success" || event.outcome === "http-error") {
          setLatencySamples((current) => appendLatencySample(current, {
            timestamp: event.timestamp,
            durationMs: event.durationMs,
            source: event.transport
          }));
        }
        if (event.outcome === "network-error" || event.outcome === "timeout") {
          monitor.recordRequestFailure({ url: event.url, method: event.method, reason: event.outcome === "timeout" ? "Request timed out." : "No HTTP response was received." });
        } else if (event.outcome === "success" || event.outcome === "http-error") {
          monitor.recordRequestSuccess();
        }
      }
    });
    setInstrumentationSupport(installation.supported);
    return () => installation.stop();
  }, [requestMonitoring]);

  const runProbe = useCallback(async () => {
    activeProbeController.current?.abort();
    const controller = new AbortController();
    activeProbeController.current = controller;
    setChecking(true);
    try {
      const result = await runReachabilityProbe(endpoint, {
        timeoutMs: probeTimeoutSeconds * 1000,
        signal: controller.signal,
        fetcher: nativeFetch
      });
      if (result.status === "aborted") return;
      setProbeResult(result);
      setProbeHistory((current) => [result, ...current].slice(0, 20));
      setReliabilityObservations((current) => appendReliabilityObservation(current, {
        timestamp: result.timestamp,
        source: "probe",
        outcome: result.status === "reachable" ? "success" : result.status
      }));
      if (result.status === "reachable" || result.status === "http-error") {
        setLatencySamples((current) => appendLatencySample(current, {
          timestamp: result.timestamp,
          durationMs: result.durationMs,
          source: "probe"
        }));
      }

      if (result.status === "reachable" || result.status === "http-error") {
        // An HTTP response confirms the route to the endpoint is working, even
        // when the endpoint itself returned a non-2xx application response.
        monitor.recordRequestSuccess();
      } else if (result.status !== "invalid-endpoint") {
        // Never retain the configured URL, query string, headers, or request body.
        monitor.recordRequestFailure({
          url: "Configured reachability endpoint",
          method: "GET",
          reason: result.detail
        });
      }
    } finally {
      if (activeProbeController.current === controller) {
        activeProbeController.current = null;
        setChecking(false);
      }
    }
  }, [endpoint, probeTimeoutSeconds]);

  useEffect(() => {
    if (!monitoring) return;
    void runProbe();
    const timer = window.setInterval(() => { void runProbe(); }, probeIntervalSeconds * 1000);
    return () => {
      window.clearInterval(timer);
      activeProbeController.current?.abort();
    };
  }, [monitoring, probeIntervalSeconds, runProbe]);

  const events = useMemo(() => state.events.filter((event) => {
    if (filter === "errors") return event.kind === "error" || event.kind === "warning";
    if (filter === "status") return event.kind === "status" || event.kind === "info";
    return true;
  }), [state.events, filter]);

  const visibleLatencySamples = useMemo(
    () => filterLatencySamples(latencySamples, latencyWindow, Date.now(), latencySource),
    [latencySamples, latencyWindow, latencySource]
  );
  const latencySummary = useMemo(() => summarizeLatency(visibleLatencySamples), [visibleLatencySamples]);
  const latencyChartPoints = useMemo(() => buildLatencyChartPoints(visibleLatencySamples), [visibleLatencySamples]);
  const diagnosticsSnapshot = useMemo(() => createDiagnosticsSnapshot({
    state,
    monitoring,
    requestMonitoring,
    probeEndpoint: endpoint,
    probeIntervalSeconds,
    probeTimeoutSeconds,
    probeHistory,
    latencySamples,
    reliabilityObservations,
    requestEvents,
    networkLabResults,
    locale: typeof navigator === "undefined" ? null : navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    includePaths: includeDiagnosticPaths
  }), [state, monitoring, requestMonitoring, endpoint, probeIntervalSeconds, probeTimeoutSeconds, probeHistory, latencySamples, reliabilityObservations, requestEvents, networkLabResults, includeDiagnosticPaths]);

  const connection = state.connection;
  const statusLabel = connection.status === "online" ? "Connected" : connection.status === "offline" ? "Offline" : connection.status === "unstable" ? "Unstable" : "Unknown";
  const statusClass = connection.status === "online" ? "good" : connection.status === "unstable" ? "warn" : "bad";

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="networkstate home">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
          <span>network<span className="brand-light">state</span></span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator"><i /> LIVE MONITOR</span>
          <span className="topbar-divider" />
          <span className="version">PREVIEW 0.1</span>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
      <section className="intro">
        <div>
          <div className="eyebrow"><span /> BROWSER NETWORK OBSERVABILITY</div>
          <h1>Know when your<br /><em>connection</em> lets you down.</h1>
          <p className="intro-copy">A live view of your browser's network health. Catch connection drops, spot instability, and understand what your requests are experiencing.</p>
        </div>
        <div className="intro-orbit" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><RadioTower size={31} /></div>
          <span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" />
        </div>
      </section>

      <section className="status-panel">
        <div className="status-main">
          <div className={`status-icon ${statusClass}`}>{connection.status === "offline" ? <WifiOff /> : <Wifi />}</div>
          <div>
            <div className="status-overline">CURRENT CONNECTION</div>
            <div className="status-heading">{statusLabel}<span className={`status-pulse ${statusClass}`} /></div>
            <div className="status-sub">{connection.status === "online" ? "Your browser reports an active network connection." : connection.status === "offline" ? "The browser reports that you're offline." : connection.status === "unstable" ? "Multiple consecutive requests have failed." : "Waiting for browser connection information."}</div>
          </div>
        </div>
        <div className="status-meta">
          <div><span>Since</span><strong>{formatAgo(connection.since)}</strong></div>
          <div><span>Monitoring</span><strong className="monitor-state"><i className={monitoring ? "active" : ""} />{monitoring ? "Active" : "Paused"}</strong></div>
          <button className="icon-button" onClick={() => { if (monitoring) monitor.stop(); else monitor.start(); setMonitoring(!monitoring); }} aria-label={monitoring ? "Pause monitoring" : "Resume monitoring"}>{monitoring ? <Pause size={16} /> : <Play size={16} />}</button>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Connection metrics">
        <Metric icon={<Gauge />} label="Effective type" value={connection.effectiveType?.toUpperCase() ?? "—"} note="Browser-reported" />
        <Metric icon={<ArrowDown />} label="Downlink" value={connection.downlinkMbps !== null ? `${connection.downlinkMbps} Mbps` : "—"} note="Estimated bandwidth" />
        <Metric icon={<Clock3 />} label="Estimated RTT" value={connection.rttMs !== null ? `${connection.rttMs} ms` : "—"} note="Round-trip time" />
        <Metric icon={<Zap />} label="Connectivity failures" value={String(state.failures.length)} note={probeResult ? `Last probe: ${probeResult.durationMs} ms` : state.consecutiveFailures ? `${state.consecutiveFailures} consecutive` : "Awaiting first probe"} />
      </section>

      <section className="probe-panel" aria-labelledby="probe-title">
        <div className="probe-heading">
          <div>
            <div className="eyebrow">ACTIVE REACHABILITY</div>
            <h2 id="probe-title">Can this browser reach your endpoint?</h2>
            <p>Measure a real HTTP response independently of the browser's online/offline hint.</p>
          </div>
          <div className={`probe-state ${probeResult?.status ?? "idle"}`} role="status" aria-live="polite">
            <span />
            <strong>{probeResult?.status === "reachable" ? "Reachable" : probeResult?.status === "http-error" ? "HTTP response" : probeResult?.status === "timeout" ? "Timed out" : probeResult?.status === "network-error" ? "No response" : probeResult?.status === "invalid-endpoint" ? "Invalid endpoint" : "Waiting for probe"}</strong>
            {probeResult && <small>{probeResult.durationMs} ms</small>}
          </div>
        </div>
        <form className="probe-controls" onSubmit={(event) => { event.preventDefault(); setEndpoint(endpointDraft.trim()); }}>
          <label className="probe-endpoint">
            <span>Endpoint URL</span>
            <input value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="https://status.example.com/health" aria-label="Reachability endpoint URL" />
          </label>
          <label>
            <span>Interval</span>
            <select value={probeIntervalSeconds} onChange={(event) => setProbeIntervalSeconds(Number(event.target.value))}>
              <option value={15}>15 sec</option><option value={30}>30 sec</option><option value={60}>60 sec</option>
            </select>
          </label>
          <label>
            <span>Timeout</span>
            <select value={probeTimeoutSeconds} onChange={(event) => setProbeTimeoutSeconds(Number(event.target.value))}>
              <option value={3}>3 sec</option><option value={5}>5 sec</option><option value={10}>10 sec</option>
            </select>
          </label>
          <button className="secondary-button apply-button" type="submit" disabled={!endpointDraft.trim() || endpointDraft.trim() === endpoint}>Apply</button>
          <button className="secondary-button probe-button" type="button" onClick={() => { void runProbe(); }} disabled={checking}>
            <RefreshCw size={14} className={checking ? "spin" : ""} />{checking ? "Checking…" : "Probe now"}
          </button>
        </form>
        <div className="probe-footnote">
          <span>{probeResult ? probeResult.detail : "A probe runs immediately, then repeats while monitoring is active."}</span>
          <span>{probeResult ? formatTime(probeResult.timestamp) : "No result yet"}</span>
        </div>
        {probeHistory.length > 1 && (
          <div className="probe-history" aria-label="Recent reachability probes">
            {probeHistory.slice(1, 5).map((result, index) => (
              <span key={result.timestamp + "-" + index} className={result.status}>
                <i />{result.status === "reachable" ? "OK" : result.status === "http-error" ? "HTTP " + result.httpStatus : result.status === "timeout" ? "Timeout" : result.status === "invalid-endpoint" ? "Invalid URL" : "Failed"}
                <b>{result.durationMs} ms</b>
              </span>
            ))}
          </div>
        )}
      </section>


      <section className="latency-panel" aria-labelledby="latency-title">
        <div className="latency-heading">
          <div>
            <div className="eyebrow">RESPONSE-TIME ANALYTICS</div>
            <h2 id="latency-title">Latency history</h2>
            <p>Track HTTP response times over time, across reachability probes and opt-in page requests.</p>
          </div>
          <div className="latency-trend" data-trend={latencySummary.trend}>
            <span>{latencySummary.trend === "collecting" ? "Collecting baseline" : latencySummary.trend === "steady" ? "Latency steady" : (latencySummary.trend === "slower" ? "Slower" : "Faster") + " by " + Math.abs(latencySummary.changePercent ?? 0).toFixed(0) + "%"}</span>
          </div>
        </div>
        <div className="latency-toolbar">
          <div className="latency-filter-group" role="group" aria-label="Latency time range">
            {(["5m", "30m", "2h"] as const).map((range) => (
              <button key={range} type="button" aria-pressed={latencyWindow === range} className={latencyWindow === range ? "selected" : ""} onClick={() => setLatencyWindow(range)}>
                {range === "5m" ? "5 min" : range === "30m" ? "30 min" : "2 hours"}
              </button>
            ))}
          </div>
          <div className="latency-filter-group" role="group" aria-label="Latency source">
            {(["all", "probes", "requests"] as const).map((source) => (
              <button key={source} type="button" aria-pressed={latencySource === source} className={latencySource === source ? "selected" : ""} onClick={() => setLatencySource(source)}>
                {source === "all" ? "All" : source === "probes" ? "Probes" : "Page requests"}
              </button>
            ))}
          </div>
        </div>
        <div className="latency-stats">
          <div><span>Median</span><strong>{latencySummary.medianMs === null ? "—" : Math.round(latencySummary.medianMs) + " ms"}</strong></div>
          <div><span>95th percentile</span><strong>{latencySummary.p95Ms === null ? "—" : Math.round(latencySummary.p95Ms) + " ms"}</strong></div>
          <div><span>Average</span><strong>{latencySummary.averageMs === null ? "—" : Math.round(latencySummary.averageMs) + " ms"}</strong></div>
          <div><span>Samples</span><strong>{latencySummary.count}</strong></div>
        </div>
        {visibleLatencySamples.length ? (
          <div className="latency-chart-wrap">
            <svg className="latency-chart" viewBox="0 0 640 144" role="img" aria-label={`Latency history chart with ${latencySummary.count} response samples and a median of ${Math.round(latencySummary.medianMs ?? 0)} milliseconds`}>
              <line x1="12" y1="12" x2="628" y2="12" />
              <line x1="12" y1="72" x2="628" y2="72" />
              <line x1="12" y1="132" x2="628" y2="132" />
              <polyline points={latencyChartPoints} />
            </svg>
            <div className="latency-axis"><time>{formatTime(visibleLatencySamples[0].timestamp)}</time><time>{formatTime(visibleLatencySamples[visibleLatencySamples.length - 1].timestamp)}</time></div>
          </div>
        ) : (
          <div className="latency-empty">No HTTP response samples in this range yet. Reachability probes are included automatically; enable page request monitoring to add Fetch and XHR timings.</div>
        )}
        <div className="latency-footnote">
          <span>HTTP responses only · Transport failures remain in the activity stream</span>
          <span>{latencySummary.count ? "Newest samples first in history" : "No latency data retained yet"}</span>
        </div>
      </section>

      <ReliabilityPanel observations={reliabilityObservations} window={latencyWindow} />

      <IncidentTimeline observations={reliabilityObservations} events={state.events} window={latencyWindow} />

      <NetworkTestLab onResultsChange={setNetworkLabResults} />
      <DiagnosticsExport snapshot={diagnosticsSnapshot} includePaths={includeDiagnosticPaths} onIncludePathsChange={setIncludeDiagnosticPaths} />

      <section className="request-panel" aria-labelledby="request-title">
        <div className="request-panel-heading">
          <div>
            <div className="eyebrow">OPT-IN REQUEST MONITORING</div>
            <h2 id="request-title">What are your page requests experiencing?</h2>
            <p>Observe Fetch and XMLHttpRequest calls initiated by this page, without changing their responses.</p>
          </div>
          <button
            className={"request-toggle" + (requestMonitoring ? " enabled" : "")}
            type="button"
            aria-pressed={requestMonitoring}
            onClick={() => setRequestMonitoring((enabled) => !enabled)}
          >
            <i />{requestMonitoring ? "Stop monitoring" : "Enable monitoring"}
          </button>
        </div>
        <p className="request-privacy">Opt-in only. Query strings, fragments, headers, and bodies are never recorded. URL paths can still contain identifiers, so enable this only on pages where that is acceptable.</p>
        {requestMonitoring ? (
          <>
            <div className="request-summary">
              <span>{requestEvents.length} requests observed</span>
              <span>{requestEvents.filter((event) => event.outcome !== "success").length} non-success outcomes</span>
              <span>{instrumentationSupport.fetch ? "Fetch" : "Fetch unavailable"} · {instrumentationSupport.xhr ? "XHR" : "XHR unavailable"}</span>
            </div>
            <div className="request-list" aria-live="polite">
              {requestEvents.length ? requestEvents.slice(0, 6).map((event) => (
                <article className="request-row" key={event.id}>
                  <div className="request-row-main">
                    <span className="request-method">{event.method}</span>
                    <span className="request-url" title={event.url}>{event.url}</span>
                    <span className="request-transport">{event.transport.toUpperCase()}</span>
                  </div>
                  <div className="request-row-meta">
                    <span className={"request-outcome " + event.outcome}>{event.outcome === "success" ? "OK" : event.outcome === "http-error" ? "HTTP " + event.status : event.outcome === "timeout" ? "TIMEOUT" : event.outcome === "aborted" ? "ABORTED" : "NETWORK ERROR"}</span>
                    <span>{event.durationMs} ms</span>
                    <time dateTime={new Date(event.timestamp).toISOString()}>{formatTime(event.timestamp)}</time>
                  </div>
                </article>
              )) : <div className="request-empty">Waiting for this page to make a Fetch or XHR request.</div>}
            </div>
          </>
        ) : (
          <div className="request-empty">Page request monitoring is off. Enable it to observe requests made by this page.</div>
        )}
      </section>

      <section className="workspace">
        <div className="section-heading">
          <div><div className="eyebrow">ACTIVITY STREAM</div><h2>What's happening</h2></div>
          <div className="stream-actions">
            <span className="event-count">{monitoring ? "AUTO-PROBING" : "MONITORING PAUSED"}</span>
          </div>
        </div>
        <div className="stream-card">
          <div className="stream-toolbar">
            <div className="filter-tabs" role="tablist" aria-label="Filter events">
              {(["all", "errors", "status"] as const).map((value) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All events" : value === "errors" ? "Warnings & errors" : "System"}</button>)}
            </div>
            <span className="event-count">{events.length} EVENTS</span>
          </div>
          <div className="event-list">
            {events.length ? events.map((event) => <EventRow key={event.id} event={event} />) : <div className="empty-state"><div className="empty-icon"><ShieldCheck size={22} /></div><strong>All quiet on the network</strong><span>Events will appear here as your connection changes.</span></div>}
          </div>
          <div className="stream-footer"><span><i /> Listening for browser events</span><span>Newest first</span></div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="info-card">
          <div className="info-icon"><Globe2 size={18} /></div><div><h3>Browser-native signals</h3><p>Connection type, downlink and RTT are shown only when the browser exposes the Network Information API.</p></div><CircleHelp size={15} className="muted-icon" />
        </div>
        <div className="info-card">
          <div className="info-icon"><ShieldCheck size={18} /></div><div><h3>Privacy by design</h3><p>Probes contact only the configured endpoint. Cookies and referrers are omitted, and no diagnostics are sent to an analytics backend.</p></div><CircleHelp size={15} className="muted-icon" />
        </div>
      </section>
      <footer className="footer"><span>NETWORK STATE <b>·</b> BUILT FOR THE UNRELIABLE WEB</span><span>Browser signals are estimates, not guarantees <ArrowUpRight size={12} /></span></footer>
      </main>
      </div>
    </>
  );
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return <article className="metric-card"><div className="metric-top"><span className="metric-icon">{icon}</span><span>{label}</span></div><strong>{value}</strong><small>{note}</small></article>;
}

function EventRow({ event }: { event: NetworkEvent }) {
  const icon = event.kind === "error" ? <WifiOff size={15} /> : event.kind === "warning" ? <Activity size={15} /> : event.kind === "status" ? <Check size={15} /> : <RadioTower size={15} />;
  return <article className={`event-row ${event.kind}`}><div className="event-type-icon">{icon}</div><div className="event-content"><strong>{event.title}</strong><span>{event.detail}</span></div><time dateTime={new Date(event.timestamp).toISOString()}>{formatTime(event.timestamp)}</time></article>;
}

export default App;