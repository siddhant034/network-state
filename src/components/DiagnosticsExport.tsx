import { useState, type ChangeEvent } from "react";
import { Archive, Download, FileJson2, FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import {
  buildDiagnosticsCsv,
  MAX_DIAGNOSTICS_IMPORT_BYTES,
  parseDiagnosticsSnapshot,
  type DiagnosticsSnapshot
} from "../diagnostics/snapshot";
import "./DiagnosticsExport.css";

interface DiagnosticsExportProps {
  snapshot: DiagnosticsSnapshot;
  includePaths: boolean;
  onIncludePathsChange: (include: boolean) => void;
}

function filenameDate(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, "-");
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

export function DiagnosticsExport({
  snapshot,
  includePaths,
  onIncludePathsChange
}: DiagnosticsExportProps) {
  const [importedSnapshot, setImportedSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [importError, setImportError] = useState("");

  const exportJson = () => {
    const filename = "network-state-" + filenameDate(snapshot.exportedAt) + ".json";
    downloadFile(filename, JSON.stringify(snapshot, null, 2), "application/json;charset=utf-8");
  };

  const exportCsv = () => {
    const filename = "network-state-" + filenameDate(snapshot.exportedAt) + ".csv";
    downloadFile(filename, buildDiagnosticsCsv(snapshot), "text/csv;charset=utf-8");
  };

  const exportImportedCsv = () => {
    if (!importedSnapshot) return;
    const filename = "network-state-imported-" + filenameDate(importedSnapshot.exportedAt) + ".csv";
    downloadFile(filename, buildDiagnosticsCsv(importedSnapshot), "text/csv;charset=utf-8");
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setImportError("");
    if (file.size > MAX_DIAGNOSTICS_IMPORT_BYTES) {
      setImportedSnapshot(null);
      setImportError("This snapshot is larger than the 1 MB import limit.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      const result = parseDiagnosticsSnapshot(content);
      if (result.ok) {
        setImportedSnapshot(result.snapshot);
        setImportError("");
      } else {
        setImportedSnapshot(null);
        setImportError(result.error);
      }
    };
    reader.onerror = () => {
      setImportedSnapshot(null);
      setImportError("The selected file could not be read.");
    };
    reader.readAsText(file);
  };

  return (
    <section className="diagnostics-export-panel" aria-labelledby="diagnostics-export-title">
      <div className="diagnostics-export-heading">
        <div>
          <div className="eyebrow"><Archive size={12} /> PORTABLE INVESTIGATIONS</div>
          <h2 id="diagnostics-export-title">Export diagnostics</h2>
          <p>Save a bounded snapshot of this session or reopen a previous investigation.</p>
        </div>
        <div className="diagnostics-export-mark" aria-hidden="true"><ShieldCheck size={20} /></div>
      </div>

      <div className="diagnostics-export-summary" aria-label="Current snapshot contents">
        <span>{snapshot.events.length} events</span>
        <span>{snapshot.requests.length} requests</span>
        <span>{snapshot.latencySamples.length} latency samples</span>
        <span>{snapshot.incidents.length} incidents</span>
        <span>{snapshot.networkLabResults.length} lab results</span>
      </div>

      <div className="diagnostics-export-options">
        <label className="diagnostics-path-option">
          <input
            type="checkbox"
            checked={includePaths}
            onChange={(event) => onIncludePathsChange(event.currentTarget.checked)}
          />
          <span>
            Include URL paths
            <small>Optional. Paths can contain identifiers. Query strings, fragments, and credentials are always removed.</small>
          </span>
        </label>
        <div className="diagnostics-export-actions">
          <button type="button" onClick={exportJson}><FileJson2 size={14} /> Export JSON</button>
          <button type="button" onClick={exportCsv}><FileSpreadsheet size={14} /> Export CSV</button>
        </div>
      </div>

      <div className="diagnostics-import">
        <label className="diagnostics-import-label">
          <Upload size={14} />
          <span>Open previous investigation</span>
          <input type="file" accept=".json,application/json" onChange={handleImport} />
        </label>
        <p>Only Network State snapshot files up to 1 MB are accepted. Imported reports are read-only and are not merged into the live session.</p>
        {importError && <p className="diagnostics-import-error" role="alert">{importError}</p>}
      </div>

      {importedSnapshot && (
        <div className="diagnostics-imported" role="region" aria-label="Imported investigation">
          <div className="diagnostics-imported-heading">
            <div>
              <strong>Previous investigation opened</strong>
              <span>Exported {formatTimestamp(importedSnapshot.exportedAt)}</span>
            </div>
            <button type="button" onClick={() => setImportedSnapshot(null)} aria-label="Close imported investigation">Close</button>
          </div>
          <div className="diagnostics-imported-stats">
            <span>{importedSnapshot.events.length} events</span>
            <span>{importedSnapshot.requests.length} requests</span>
            <span>{importedSnapshot.incidents.length} incidents</span>
            <span>{importedSnapshot.probes.length} probes</span>
          </div>
          {importedSnapshot.incidents.length ? (
            <div className="diagnostics-imported-incidents">
              {importedSnapshot.incidents.map((incident) => (
                <article key={incident.id}>
                  <div>
                    <strong>{incident.summary}</strong>
                    <span className={"diagnostics-incident-status " + incident.status}>{incident.status}</span>
                  </div>
                  <p>{incident.severity} · {incident.sources.join(", ")} · {incident.failureCount} failures · {Math.round(incident.durationMs / 1_000)} sec</p>
                  <details>
                    <summary>View {incident.signals.length} signals</summary>
                    <ol>
                      {incident.signals.map((signal) => (
                        <li key={signal.id}>
                          <time>{formatTimestamp(signal.timestamp)}</time>
                          <strong>{signal.title}</strong>
                          <span>{signal.detail}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <p className="diagnostics-imported-empty">This snapshot contains no correlated incidents. Its event and request records are still available in the exported report.</p>
          )}
          <button className="diagnostics-imported-export" type="button" onClick={exportImportedCsv}>
            <Download size={13} /> Export imported records as CSV
          </button>
        </div>
      )}

      <p className="diagnostics-export-privacy">Reports are generated locally. URL paths are redacted by default; request bodies, headers, cookies, query strings, and fragments are never exported. The snapshot includes bounded histories and locale/time-zone metadata, but no user agent or IP address.</p>
    </section>
  );
}
