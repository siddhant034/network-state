import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { saveNetworkLabConfig } from "../adapters/network-lab-configs";
import { createNetworkLabConfigExport } from "../adapters/network-lab-config-transfer";
import { NetworkLabConfigTransfer } from "./NetworkLabConfigTransfer";

const config = saveNetworkLabConfig([], {
  id: "portable-one",
  name: "Office",
  endpoints: ["https://api.example.test/health?region=office"],
  options: {
    requestsPerEndpoint: 3,
    concurrency: 2,
    timeoutMs: 5_000,
    retries: 1,
    simulatedLatencyMs: 0,
    simulatedFailureRate: 0
  }
}, 100)[0];

function importFile(configs = [config]) {
  return new File([createNetworkLabConfigExport(configs, 200)], "lab-configs.json", {
    type: "application/json"
  });
}

describe("NetworkLabConfigTransfer", () => {
  afterEach(() => cleanup());

  it("previews a valid file and applies it only after explicit confirmation", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [importFile()] } });

    expect(await screen.findByRole("region", { name: "Import preview" })).toBeInTheDocument();
    expect(screen.getByText(/1 new config will be added/)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply import" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/nothing was run/);
    expect(onImport).toHaveBeenCalledWith([config]);
  });

  it("focuses Cancel first, dismisses with Escape, and restores focus without importing", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    const input = screen.getByLabelText("Import saved configs");

    fireEvent.change(input, { target: { files: [importFile()] } });

    expect(await screen.findByRole("region", { name: "Import preview" })).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "Import preview" })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/Import cancelled/);
    expect(input).toHaveFocus();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("returns focus to the file input when the preview is cancelled by button", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    const input = screen.getByLabelText("Import saved configs");

    fireEvent.change(input, { target: { files: [importFile()] } });
    await screen.findByRole("region", { name: "Import preview" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(input).toHaveFocus();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("shows update and add counts without exposing endpoint URLs in the preview", async () => {
    const existing = { ...config, id: "local-office" };
    const added = { ...config, id: "remote", name: "Remote" };
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[existing]} onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("Import saved configs"), {
      target: { files: [importFile([config, added])] }
    });

    expect(await screen.findByRole("region", { name: "Import preview" })).toBeInTheDocument();
    expect(screen.getByText(/1 existing config will be updated · 1 new config will be added/)).toBeInTheDocument();
    expect(screen.queryByText(/api\.example\.test/)).not.toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("cancels a preview without changing saved configs", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [importFile()] } });
    await screen.findByRole("region", { name: "Import preview" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onImport).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/Import cancelled/);
    expect(screen.queryByRole("region", { name: "Import preview" })).not.toBeInTheDocument();
  });

  it("keeps the preview available when applying fails", async () => {
    const onImport = vi.fn(() => { throw new Error("storage quota"); });
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [importFile()] } });
    await screen.findByRole("region", { name: "Import preview" });

    fireEvent.click(screen.getByRole("button", { name: "Apply import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("storage quota");
    expect(screen.getByRole("region", { name: "Import preview" })).toBeInTheDocument();
  });

  it("reports invalid files without invoking the import callback", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    const file = new File(["not json"], "bad.json", { type: "application/json" });

    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid JSON/);
    expect(onImport).not.toHaveBeenCalled();
  });
});
