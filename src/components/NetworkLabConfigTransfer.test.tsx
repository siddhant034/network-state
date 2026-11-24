import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveNetworkLabConfig, type SavedNetworkLabConfig } from "../adapters/network-lab-configs";
import { createNetworkLabConfigExport } from "../adapters/network-lab-config-transfer";
import { NetworkLabConfigTransfer } from "./NetworkLabConfigTransfer";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function makeConfig(id: string, name: string, endpointInput = "https://api.example.test/private/health?token=hidden"): SavedNetworkLabConfig {
  const saved = saveNetworkLabConfig({
    id,
    name,
    endpointInput,
    requestsPerEndpoint: 3,
    concurrency: 2,
    timeoutSeconds: 5,
    retries: 1,
    simulatedLatencyMs: 0,
    simulatedFailureRate: 0,
    updatedAt: 100
  }, new MemoryStorage());
  if (!saved.ok) throw new Error(saved.error);
  return saved.saved;
}

function importFile(configs: SavedNetworkLabConfig[]): File {
  return new File([createNetworkLabConfigExport(configs, 200)], "saved-configs.json", { type: "application/json" });
}

describe("NetworkLabConfigTransfer", () => {
  afterEach(() => cleanup());

  it("previews names without endpoint paths and applies only after explicit confirmation", async () => {
    const incoming = makeConfig("portable-id", "Office");
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [importFile([incoming])] } });
    const preview = await screen.findByRole("region", { name: "Review import" });
    expect(preview).toHaveTextContent("Office");
    expect(preview).not.toHaveTextContent("/private/health");
    expect(preview).not.toHaveTextContent("token=hidden");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(onImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply import" }));
    expect(onImport).toHaveBeenCalledWith([incoming]);
    expect(await screen.findByRole("status")).toHaveTextContent(/nothing was run/i);
  });

  it("cancels on Escape, restores focus to the file input, and leaves configs untouched", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    const input = screen.getByLabelText("Import saved configs");

    fireEvent.change(input, { target: { files: [importFile([makeConfig("one", "One")])] } });
    await screen.findByRole("region", { name: "Review import" });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("region", { name: "Review import" })).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent(/Import cancelled/);
    expect(input).toHaveFocus();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("rejects invalid files without calling the import callback", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText("Import saved configs"), {
      target: { files: [new File(["not json"], "bad.json", { type: "application/json" })] }
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid JSON/);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("disables both transfer controls while a lab run is active", () => {
    render(<NetworkLabConfigTransfer configs={[makeConfig("one", "One")]} onImport={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Export saved configs" })).toBeDisabled();
    expect(screen.getByLabelText("Import saved configs")).toBeDisabled();
  });
});
