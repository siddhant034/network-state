import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Activity, ArrowDown, ArrowUpRight, Check, CircleHelp, Clock3, Gauge, Globe2, Pause, Play, RadioTower, RefreshCw, ShieldCheck, Wifi, WifiOff, Zap } from "lucide-react";
import { createNetworkMonitor } from "./core/network-monitor";
import type { NetworkEvent } from "./core/types";
import { runReachabilityProbe, type ReachabilityProbeResult } from "./adapters/reachability-probe";

const monitor = createNetworkMonitor();
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
  const [endpointDraft, setEndpointDraft] = useState("/");
  const [endpoint, setEndpoint] = useState("/");
  const [probeIntervalSeconds, setProbeIntervalSeconds] = useState(30);
  const [probeTimeoutSeconds, setProbeTimeoutSeconds] = useState(5);
  const [probeResult, setProbeResult] = useState<ReachabilityProbeResult | null>(null);
  const [probeHistory, setProbeHistory] = useState<ReachabilityProbeResult[]>([]);
  const activeProbeController = useRef<AbortController | null>(null);
  const [filter, setFilter] = useState<"all" | "errors" | "status">("all");

  useEffect(() => {
    monitor.start();
    return () => monitor.stop();
  }, []);

  const runProbe = useCallback(async () => {
    activeProbeController.current?.abort();
    const controller = new AbortController();
    activeProbeController.current = controller;
    setChecking(true);
    try {
      const result = await runReachabilityProbe(endpoint, {
        timeoutMs: probeTimeoutSeconds * 1000,
        signal: controller.signal
      });
      if (result.status === "aborted") return;
      setProbeResult(result);
      setProbeHistory((current) => [result, ...current].slice(0, 20));

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

  const connection = state.connection;
  const statusLabel = connection.status === "online" ? "Connected" : connection.status === "offline" ? "Offline" : connection.status === "unstable" ? "Unstable" : "Unknown";
  const statusClass = connection.status === "online" ? "good" : connection.status === "unstable" ? "warn" : "bad";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Network State home">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
          <span>network<span className="brand-light">state</span></span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator"><i /> LIVE MONITOR</span>
          <span className="topbar-divider" />
          <span className="version">PREVIEW 0.1</span>
        </div>
      </header>

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
        <Metric icon={<Zap />} label="Failed requests" value={String(state.failures.length)} note={probeResult ? `Last probe: ${probeResult.durationMs} ms` : state.consecutiveFailures ? `${state.consecutiveFailures} consecutive` : "Awaiting first probe"} />
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