import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import type { SavedNetworkLabConfig } from "../adapters/network-lab-configs";
import {
  createNetworkLabConfigExport,
  MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES,
  parseNetworkLabConfigExport
} from "../adapters/network-lab-config-transfer";

interface NetworkLabConfigTransferProps {
  configs: SavedNetworkLabConfig[];
  onImport: (configs: SavedNetworkLabConfig[]) => void;
  disabled?: boolean;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the selected config file as text."));
    };
    reader.onerror = () => reject(new Error("Could not read the selected config file."));
    reader.readAsText(file);
  });
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function NetworkLabConfigTransfer({
  configs,
  onImport,
  disabled = false
}: NetworkLabConfigTransferProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previewWasOpenRef = useRef(false);
  const [pendingImport, setPendingImport] = useState<SavedNetworkLabConfig[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const matchedCount = pendingImport?.filter((incoming) =>
    configs.some((local) => normalizedName(local.name) === normalizedName(incoming.name))
  ).length ?? 0;
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
    cancelRef.current?.focus();
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
      anchor.download = "network-state-saved-lab-configs.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError("");
      setStatus("Saved configs exported. The file contains endpoint paths; keep it private.");
    } catch {
      setStatus("");
      setError("Could not export saved configurations.");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_NETWORK_LAB_CONFIG_IMPORT_BYTES) {
      setStatus("");
      setError("The config file is larger than the 1 MB import limit.");
      return;
    }

    try {
      const parsed = parseNetworkLabConfigExport(await readFileText(file));
      if (!parsed.ok) {
        setStatus("");
        setError(parsed.error);
        return;
      }
      setError("");
      setStatus("");
      setPendingImport(parsed.configs);
    } catch {
      setStatus("");
      setError("Could not read the selected config file.");
    }
  };

  const handleCancel = () => {
    setPendingImport(null);
    setError("");
    setStatus("Import cancelled. Your saved configs were not changed.");
  };

  const handleApply = () => {
    if (!pendingImport) return;
    try {
      onImport(pendingImport);
      setPendingImport(null);
      setError("");
      setStatus("Import complete. Review the saved configs before running a test; nothing was run.");
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not apply the imported configs.");
    }
  };

  return (
    <div className="network-lab-config-transfer">
      <button type="button" className="network-lab-transfer-button" onClick={handleExport} disabled={disabled || configs.length === 0}>
        <Download size={13} /> Export saved configs
      </button>
      <label className="network-lab-transfer-file" aria-disabled={disabled}>
        <Upload size={13} />
        <span>Import saved configs</span>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Import saved configs"
          onChange={(event) => { void handleFileChange(event); }}
          disabled={disabled}
        />
      </label>

      {error && <p className="network-lab-transfer-error" role="alert">{error}</p>}
      {status && <p className="network-lab-transfer-status" role="status">{status}</p>}

      {pendingImport && (
        <section
          className="network-lab-transfer-preview"
          role="region"
          aria-labelledby="network-lab-transfer-preview-title"
          aria-describedby="network-lab-transfer-preview-warning"
        >
          <div className="network-lab-transfer-preview-heading">
            <strong id="network-lab-transfer-preview-title" tabIndex={-1}>Review import</strong>
            <span>{pendingImport.length} config{pendingImport.length === 1 ? "" : "s"}</span>
          </div>
          <p>{matchedCount} existing config{matchedCount === 1 ? "" : "s"} will be updated · {addedCount} new config{addedCount === 1 ? "" : "s"} will be added.</p>
          <ul>
            {pendingImport.map((config) => {
              const matches = configs.some((local) => normalizedName(local.name) === normalizedName(config.name));
              return (
                <li key={config.id}>
                  <span>{config.name}</span>
                  <span>{matches ? "Update" : "Add"}</span>
                </li>
              );
            })}
          </ul>
          <p id="network-lab-transfer-preview-warning" className="network-lab-transfer-warning">
            Endpoint URLs are not shown in this preview. Applying updates matching names. Imported configs are saved locally and never run automatically. Press Escape to cancel.
          </p>
          <div className="network-lab-transfer-actions">
            <button type="button" className="network-lab-transfer-button primary" onClick={handleApply} disabled={disabled}>Apply import</button>
            <button ref={cancelRef} type="button" className="network-lab-transfer-button" onClick={handleCancel} disabled={disabled}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
