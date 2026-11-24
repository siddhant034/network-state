import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, FlaskConical, FolderOpen, Play, Save, Square, Trash2 } from "lucide-react";
import {
  deleteNetworkLabConfig,
  inspectSavedNetworkLabConfigs,
  loadSavedNetworkLabConfigs,
  NETWORK_LAB_CONFIG_STORAGE_KEY,
  replaceSavedNetworkLabConfigs,
  saveNetworkLabConfig
} from "../adapters/network-lab-configs";
import { mergeImportedNetworkLabConfigs } from "../adapters/network-lab-config-transfer";
import { parseNetworkLabEndpoints, runNetworkLab, type NetworkLabResult } from "../adapters/network-test-lab";
import { NetworkLabConfigTransfer } from "./NetworkLabConfigTransfer";
import "./NetworkTestLab.css";
import "./NetworkLabConfigTransfer.css";

const defaultEndpoint = () => new URL(import.meta.env.BASE_URL, window.location.href).toString();
const formatTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
}).format(timestamp);

function statusLabel(result: NetworkLabResult): string {
  if (result.status === "reachable") return "Reachable";
  if (result.status === "http-error") return "HTTP " + result.httpStatus;
  if (result.status === "timeout") return "Timed out";
  if (result.status === "simulated-failure") return "Simulated failure";
  if (result.status === "aborted") return "Cancelled";
  return "No response";
}

export function NetworkTestLab({ onResultsChange }: { onResultsChange?: (results: NetworkLabResult[]) => void }) {
  const [endpointInput, setEndpointInput] = useState(defaultEndpoint);
  const [requestsPerEndpoint, setRequestsPerEndpoint] = useState(3);
  const [concurrency, setConcurrency] = useState(2);
  const [timeoutSeconds, setTimeoutSeconds] = useState(5);
  const [retries, setRetries] = useState(1);
  const [simulatedLatency, setSimulatedLatency] = useState(0);
  const [simulatedFailureRate, setSimulatedFailureRate] = useState(0);
  const [results, setResults] = useState<NetworkLabResult[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedConfigs, setSavedConfigs] = useState(loadSavedNetworkLabConfigs);
  const [configName, setConfigName] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [configError, setConfigError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const selectedConfigIdRef = useRef(selectedConfigId);
  selectedConfigIdRef.current = selectedConfigId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== NETWORK_LAB_CONFIG_STORAGE_KEY && event.key !== null) return;

      let storage: Storage;
      try {
        storage = window.localStorage;
      } catch {
        setConfigError("Saved configurations could not be refreshed because local storage is unavailable.");
        setConfigMessage("");
        return;
      }
      if (event.storageArea && event.storageArea !== storage) return;

      const inspected = inspectSavedNetworkLabConfigs(storage);
      if (inspected.status === "invalid" || inspected.status === "unavailable") {
        setConfigError("Saved configurations changed to invalid data in another tab. The last valid list is still shown.");
        setConfigMessage("");
        return;
      }

      const next = inspected.configs;
      setSavedConfigs(next);
      if (!next.some((config) => config.id === selectedConfigIdRef.current)) {
        selectedConfigIdRef.current = "";
        setSelectedConfigId("");
        setConfigName("");
      }
      setConfigError("");
      setConfigMessage(event.key === null || event.newValue === null
        ? "Saved configurations were cleared in another tab."
        : "Saved configurations updated in another tab.");
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    onResultsChange?.(results);
  }, [results, onResultsChange]);

  const parsed = useMemo(() => parseNetworkLabEndpoints(endpointInput), [endpointInput]);
  const totalRequests = parsed.endpoints.length * requestsPerEndpoint;
  const completed = results.length;
  const successful = results.filter((result) => result.status === "reachable").length;
  const httpErrors = results.filter((result) => result.status === "http-error").length;
  const failures = results.filter((result) => result.status === "timeout" || result.status === "network-error" || result.status === "simulated-failure").length;
  const progress = totalRequests > 0 ? Math.min(100, Math.round((completed / totalRequests) * 100)) : 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;

    const parsedEndpoints = parseNetworkLabEndpoints(endpointInput);
    if (parsedEndpoints.errors.length > 0 || parsedEndpoints.endpoints.length === 0) {
      setError(parsedEndpoints.errors.join(" "));
      setMessage("");
      return;
    }

    setError("");
    setMessage("");
    setResults([]);
    setRunning(true);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await runNetworkLab(parsedEndpoints.endpoints, {
        requestsPerEndpoint,
        concurrency,
        timeoutMs: timeoutSeconds * 1_000,
        retries,
        simulatedLatencyMs: simulatedLatency,
        simulatedFailureRate,
        signal: controller.signal
      }, (result) => {
        if (mountedRef.current) {
          setResults((current) => [...current, result]);
        }
      });

      if (mountedRef.current) {
        setMessage(controller.signal.aborted ? "Run cancelled. Completed results are retained below." : "Run complete.");
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : "The test run could not be completed.");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mountedRef.current) setRunning(false);
    }
  };

  const cancelRun = () => controllerRef.current?.abort();

  const handleSaveConfig = () => {
    const id = selectedConfigId || (
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "lab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
    );
    const saved = saveNetworkLabConfig({
      id,
      name: configName,
      endpointInput,
      requestsPerEndpoint,
      concurrency,
      timeoutSeconds,
      retries,
      simulatedLatencyMs: simulatedLatency,
      simulatedFailureRate,
      updatedAt: Date.now()
    });

    if (!saved.ok) {
      setConfigError(saved.error);
      setConfigMessage("");
      return;
    }

    setSavedConfigs(saved.configs);
    setSelectedConfigId(saved.saved.id);
    setConfigName(saved.saved.name);
    setEndpointInput(saved.saved.endpointInput);
    setConfigError("");
    setConfigMessage(saved.removedQueryData
      ? "Configuration saved on this device. Query strings and fragments were removed."
      : "Configuration saved on this device.");
  };

  const handleLoadConfig = () => {
    const config = savedConfigs.find((item) => item.id === selectedConfigId);
    if (!config) return;
    setEndpointInput(config.endpointInput);
    setRequestsPerEndpoint(config.requestsPerEndpoint);
    setConcurrency(config.concurrency);
    setTimeoutSeconds(config.timeoutSeconds);
    setRetries(config.retries);
    setSimulatedLatency(config.simulatedLatencyMs);
    setSimulatedFailureRate(config.simulatedFailureRate);
    setConfigName(config.name);
    setResults([]);
    setError("");
    setMessage("");
    setConfigError("");
    setConfigMessage("Loaded “" + config.name + "”. Run the test when you are ready.");
  };

  const handleDeleteConfig = () => {
    if (!selectedConfigId) return;
    const deleted = deleteNetworkLabConfig(selectedConfigId);
    if (!deleted.ok) {
      setConfigError(deleted.error);
      setConfigMessage("");
      return;
    }
    setSavedConfigs(deleted.configs);
    setSelectedConfigId("");
    setConfigName("");
    setConfigError("");
    setConfigMessage("Saved configuration deleted from this device.");
  };

  const handleImportConfigs = (imported: SavedNetworkLabConfig[]) => {
    const merged = mergeImportedNetworkLabConfigs(savedConfigs, imported);
    const persisted = replaceSavedNetworkLabConfigs(merged);
    if (!persisted.ok) throw new Error(persisted.error);
    setSavedConfigs(persisted.configs);
    setSelectedConfigId(persisted.configs[0]?.id ?? "");
    setConfigError("");
    setConfigMessage("Imported saved configurations locally. Review them before running a test.");
  };

  return (
    <section className="network-lab-panel" aria-labelledby="network-lab-title" role="region">
      <div className="network-lab-heading">
        <div>
          <div className="eyebrow"><FlaskConical size={12} /> REPEATABLE DIAGNOSTICS</div>
          <h2 id="network-lab-title">Network testing lab</h2>
          <p>Compare endpoint reachability under a bounded, repeatable request workload.</p>
        </div>
        <div className="network-lab-mark" aria-hidden="true"><Activity size={20} /></div>
      </div>

      <div className="network-lab-configs" aria-label="Saved testing configurations">
        <div className="network-lab-config-save">
          <label>
            <span>Configuration name</span>
            <input
              aria-label="Configuration name"
              value={configName}
              onChange={(event) => setConfigName(event.target.value)}
              maxLength={48}
              placeholder="e.g. Production API checks"
              disabled={running}
            />
          </label>
          <button type="button" onClick={handleSaveConfig} disabled={running || !configName.trim() || parsed.errors.length > 0 || parsed.endpoints.length === 0}>
            <Save size={13} /> Save configuration
          </button>
          <button className="network-lab-new-config" type="button" onClick={() => {
            setSelectedConfigId("");
            setConfigName("");
            setConfigError("");
            setConfigMessage("Ready to save a new configuration.");
          }} disabled={running}>
            New configuration
          </button>
        </div>
        <div className="network-lab-config-load">
          <label>
            <span>Saved configurations</span>
            <select aria-label="Saved configurations" value={selectedConfigId} onChange={(event) => setSelectedConfigId(event.target.value)} disabled={running || savedConfigs.length === 0}>
              <option value="">Choose a saved configuration</option>
              {savedConfigs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={handleLoadConfig} disabled={running || !selectedConfigId}>
            <FolderOpen size={13} /> Load
          </button>
          <button className="network-lab-delete-config" type="button" onClick={handleDeleteConfig} disabled={running || !selectedConfigId}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
        {configError && <p className="network-lab-error" role="alert">{configError}</p>}
        {configMessage && <p className="network-lab-message" role="status">{configMessage}</p>}
        <p className="network-lab-config-note">Saved configurations stay in this browser only. Query strings and fragments are removed before saving; endpoint paths remain and may contain identifiers.</p>
        <NetworkLabConfigTransfer configs={savedConfigs} onImport={handleImportConfigs} disabled={running} />
      </div>

      <form className="network-lab-form" onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="network-lab-endpoints">
          <span>Test endpoints <small>One absolute HTTP(S) URL per line · up to five</small></span>
          <textarea
            aria-label="Test endpoints"
            rows={3}
            value={endpointInput}
            onChange={(event) => setEndpointInput(event.target.value)}
            spellCheck={false}
            placeholder={"https://api.example.com/health\nhttps://status.example.com/"}
            disabled={running}
          />
        </label>

        <div className="network-lab-controls">
          <label><span>Requests / endpoint</span>
            <select value={requestsPerEndpoint} onChange={(event) => setRequestsPerEndpoint(Number(event.target.value))} disabled={running}>
              <option value={1}>1 request</option><option value={3}>3 requests</option><option value={5}>5 requests</option><option value={10}>10 requests</option>
            </select>
          </label>
          <label><span>Concurrency</span>
            <select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} disabled={running}>
              <option value={1}>1 at a time</option><option value={2}>2 at a time</option><option value={4}>4 at a time</option><option value={6}>6 at a time</option>
            </select>
          </label>
          <label><span>Timeout</span>
            <select value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} disabled={running}>
              <option value={3}>3 sec</option><option value={5}>5 sec</option><option value={10}>10 sec</option><option value={30}>30 sec</option>
            </select>
          </label>
          <label><span>Retries</span>
            <select value={retries} onChange={(event) => setRetries(Number(event.target.value))} disabled={running}>
              <option value={0}>None</option><option value={1}>1 retry</option><option value={2}>2 retries</option>
            </select>
          </label>
          <label><span>Added client-side latency</span>
            <select value={simulatedLatency} onChange={(event) => setSimulatedLatency(Number(event.target.value))} disabled={running}>
              <option value={0}>Off</option><option value={100}>100 ms</option><option value={250}>250 ms</option><option value={500}>500 ms</option><option value={1_000}>1 sec</option><option value={2_000}>2 sec</option>
            </select>
          </label>
          <label><span>Injected failure rate</span>
            <select value={simulatedFailureRate} onChange={(event) => setSimulatedFailureRate(Number(event.target.value))} disabled={running}>
              <option value={0}>Off</option><option value={10}>10%</option><option value={25}>25%</option><option value={50}>50%</option><option value={100}>100%</option>
            </select>
          </label>
        </div>

        <div className="network-lab-actions">
          <div className="network-lab-workload">
            <span>{totalRequests} planned requests</span>
            <span>Max {concurrency} concurrent · {retries} retries</span>
          </div>
          <div className="network-lab-buttons">
            <button className="network-lab-run" type="submit" disabled={running || parsed.errors.length > 0 || parsed.endpoints.length === 0}>
              <Play size={14} /> Run test
            </button>
            {running && <button className="network-lab-cancel" type="button" onClick={cancelRun}><Square size={13} /> Cancel run</button>}
          </div>
        </div>
      </form>

      {(error || parsed.errors.length > 0) && <p className="network-lab-error" role="alert">{error || parsed.errors.join(" ")}</p>}
      {message && <p className="network-lab-message" role="status">{message}</p>}

      {(running || results.length > 0) && (
        <div className="network-lab-progress" aria-live="polite">
          <div><span>{running ? "Running diagnostics" : "Run progress"}</span><strong>{completed} / {totalRequests}</strong></div>
          <progress value={progress} max={100} aria-label="Network test progress" />
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="network-lab-summary" aria-label="Test result summary">
            <div><span>Reachable</span><strong>{successful}</strong></div>
            <div><span>HTTP errors</span><strong>{httpErrors}</strong></div>
            <div><span>Failures</span><strong>{failures}</strong></div>
            <div><span>Completed</span><strong>{completed}</strong></div>
          </div>
          <div className="network-lab-results">
            <table>
              <caption>Completed diagnostic requests · host labels only</caption>
              <thead><tr><th scope="col">Endpoint</th><th scope="col">#</th><th scope="col">Result</th><th scope="col">Duration</th><th scope="col">Attempts</th><th scope="col">Time</th></tr></thead>
              <tbody>
                {results.slice().reverse().map((result) => (
                  <tr key={result.id}>
                    <th scope="row">{result.endpointLabel}</th>
                    <td>{result.sequence}</td>
                    <td><span className={"network-lab-result-status " + result.status}>{statusLabel(result)}</span>{result.simulationApplied && <small className="network-lab-simulated">SIMULATED</small>}</td>
                    <td>{result.durationMs} ms</td>
                    <td>{result.attempts}</td>
                    <td><time dateTime={new Date(result.timestamp).toISOString()}>{formatTime(result.timestamp)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!running && results.length === 0 && <div className="network-lab-empty">Configure one or more endpoints and run a test to compare response availability and timing.</div>}
      <p className="network-lab-footnote">Requests are credential-free GETs. Use only endpoints you own or are authorized to test; cross-origin endpoints must permit this site through CORS. Simulation affects only these lab requests—it does not throttle other browser traffic. Endpoint paths and query strings are not retained in result rows. Named configurations are stored locally in this browser; query strings and fragments are stripped, but saved paths may contain identifiers.</p>
    </section>
  );
}
