import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import type { SavedNetworkLabConfig } from "../adapters/network-lab-configs";
import {
  createNetworkLabConfigExport,
  parseNetworkLabConfigExport
} from "../adapters/network-lab-config-transfer";

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the selected config file as text."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected config file."));
    reader.readAsText(file);
  });
}

interface NetworkLabConfigTransferProps {
  configs: SavedNetworkLabConfig[];
  onImport: (configs: SavedNetworkLabConfig[]) => void;
  disabled?: boolean;
}

export function NetworkLabConfigTransfer({ configs, onImport, disabled = false }: NetworkLabConfigTransferProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelImportRef = useRef<HTMLButtonElement>(null);
  const previewWasOpenRef = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingImport, setPendingImport] = useState<SavedNetworkLabConfig[] | null>(null);

  const matchedCount = pendingImport?.filter((incoming) => configs.some((local) =>
    local.name.toLowerCase() === incoming.name.toLowerCase() || local.id === incoming.id
  )).length ?? 0;
  const addedCount = (pendingImport?.length ?? 0) - matchedCount;

  useEffect(() => {
    if (!pendingImport) {
      if (previewWasOpenRef.current) {
        previewWasOpenRef.current = false;
        inputRef.current?.focus();
      }
      return;
    }

    previewWasOpenRef.current = true;
    // Put keyboard users on the safe, non-destructive action first.
    cancelImportRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingImport(null);
        setError("");
        setStatus("Import cancelled. Your saved configs were not changed.");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingImport]);

  const handleExport = () => {
    try {
      const contents = createNetworkLabConfigExport(configs);
      const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "network-state-lab-configs.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setPendingImport(null);
      setError("");
      setStatus("Saved configs exported. Keep the file private; it contains full endpoint URLs.");
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not export saved configs.");
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingImport(null);
    setStatus("");
    setError("");
    if (file.size > 1_000_000) {
      setError("The config file is larger than the 1 MB import limit.");
      return;
    }

    try {
      const parsed = parseNetworkLabConfigExport(await readFileText(file));
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setPendingImport(parsed.configs);
      setStatus("File validated. Review the import below before applying it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import saved configs.");
    }
  };

  const handleApplyImport = () => {
    if (!pendingImport) return;
    try {
      onImport(pendingImport);
      setPendingImport(null);
      setError("");
      setStatus("Import complete. Matching configs were updated and new configs were added; nothing was run.");
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not save imported configs.");
    }
  };

  const handleCancelImport = () => {
    setPendingImport(null);
    setError("");
    setStatus("Import cancelled. Your saved configs were not changed.");
  };

  return (
    <div className="network-lab-config-transfer">
      <button type="button" className="network-lab-config-button muted" onClick={handleExport} disabled={disabled || configs.length === 0}>
        <Download size={13} /> Export JSON
      </button>
      <label className="network-lab-config-button muted network-lab-config-import" aria-disabled={disabled}>
        <Upload size={13} /> Import JSON
        <input
          ref={inputRef}
          aria-label="Import saved configs"
          type="file"
          accept="application/json,.json"
          disabled={disabled}
          onChange={(event) => { void handleImport(event); }}
        />
      </label>
      {error && <p className="network-lab-config-transfer-error" role="alert">{error}</p>}
      {status && <p className="network-lab-config-transfer-status" role="status">{status}</p>}
      {pendingImport && (
        <section className="network-lab-config-import-preview" role="region" aria-labelledby="network-lab-config-import-title" aria-describedby="network-lab-config-import-warning">
          <div className="network-lab-config-import-preview-heading">
            <strong id="network-lab-config-import-title" tabIndex={-1}>Review import</strong>
            <span>{pendingImport.length} config{pendingImport.length === 1 ? "" : "s"}</span>
          </div>
          <p>
            {matchedCount} existing config{matchedCount === 1 ? "" : "s"} will be updated · {addedCount} new config{addedCount === 1 ? "" : "s"} will be added.
          </p>
          <ul>
            {pendingImport.map((config) => {
              const matches = configs.some((local) =>
                local.name.toLowerCase() === config.name.toLowerCase() || local.id === config.id
              );
              return (
                <li key={config.id}>
                  <span>{config.name} <small>{config.endpoints.length} endpoint{config.endpoints.length === 1 ? "" : "s"}</small></span>
                  <span>{matches ? "Update" : "Add"}</span>
                </li>
              );
            })}
          </ul>
          <p id="network-lab-config-import-warning" className="network-lab-config-import-warning">
            Applying replaces settings for matching configs. Full endpoint URLs are sensitive. Review before applying; imported configs never run automatically. Press Escape to cancel.
          </p>
          <div className="network-lab-config-import-actions">
            <button type="button" className="network-lab-config-button" onClick={handleApplyImport} disabled={disabled}>Apply import</button>
            <button ref={cancelImportRef} type="button" className="network-lab-config-button muted" onClick={handleCancelImport}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
