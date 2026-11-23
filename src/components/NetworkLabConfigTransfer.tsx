import { useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import type { SavedNetworkLabConfig } from "../adapters/network-lab-configs";
import {
  createNetworkLabConfigExport,
  parseNetworkLabConfigExport
} from "../adapters/network-lab-config-transfer";

interface NetworkLabConfigTransferProps {
  configs: SavedNetworkLabConfig[];
  onImport: (configs: SavedNetworkLabConfig[]) => void;
}

export function NetworkLabConfigTransfer({ configs, onImport }: NetworkLabConfigTransferProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

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
    if (file.size > 1_000_000) {
      setStatus("");
      setError("The config file is larger than the 1 MB import limit.");
      return;
    }

    try {
      const parsed = parseNetworkLabConfigExport(await file.text());
      if (!parsed.ok) {
        setStatus("");
        setError(parsed.error);
        return;
      }
      onImport(parsed.configs);
      setError("");
      setStatus("Import complete. Matching names were updated and other configs were added; nothing was run.");
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not import saved configs.");
    }
  };

  return (
    <div className="network-lab-config-transfer">
      <button type="button" className="network-lab-config-button muted" onClick={handleExport} disabled={configs.length === 0}>
        <Download size={13} /> Export JSON
      </button>
      <label className="network-lab-config-button muted network-lab-config-import">
        <Upload size={13} /> Import JSON
        <input
          ref={inputRef}
          aria-label="Import saved configs"
          type="file"
          accept="application/json,.json"
          onChange={(event) => { void handleImport(event); }}
        />
      </label>
      {error && <p className="network-lab-config-transfer-error" role="alert">{error}</p>}
      {status && <p className="network-lab-config-transfer-status" role="status">{status}</p>}
    </div>
  );
}
