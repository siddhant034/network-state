import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NetworkState } from "../core/types";
import { createDiagnosticsSnapshot } from "../diagnostics/snapshot";
import { DiagnosticsExport } from "./DiagnosticsExport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeSnapshot() {
  const timestamp = 1_800_000_000_000;
  const state: NetworkState = {
    connection: {
      status: "online",
      effectiveType: null,
      downlinkMbps: null,
      rttMs: null,
      saveData: null,
      since: timestamp
    },
    events: [{
      id: "event-1",
      kind: "info",
      title: "Connection restored",
      detail: "The browser is online.",
      timestamp
    }],
    failures: [],
    consecutiveFailures: 0
  };

  return createDiagnosticsSnapshot({
    state,
    monitoring: true,
    requestMonitoring: false,
    probeEndpoint: "https://status.example.test/health?token=private",
    probeIntervalSeconds: 30,
    probeTimeoutSeconds: 5,
    probeHistory: [],
    latencySamples: [],
    reliabilityObservations: [],
    requestEvents: [],
    networkLabResults: [],
    exportedAt: timestamp
  });
}

describe("DiagnosticsExport", () => {
  it("shows the current session summary and keeps path export opt-in", () => {
    const onIncludePathsChange = vi.fn();
    render(<DiagnosticsExport snapshot={makeSnapshot()} includePaths={false} onIncludePathsChange={onIncludePathsChange} />);

    expect(screen.getByRole("region", { name: "Export diagnostics" })).toBeInTheDocument();
    expect(screen.getByText("1 events")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Include URL paths/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include URL paths/ }));
    expect(onIncludePathsChange).toHaveBeenCalledWith(true);
  });

  it("downloads JSON and CSV using browser blob URLs", () => {
    const createObjectURL = vi.fn(() => "blob:diagnostics-test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<DiagnosticsExport snapshot={makeSnapshot()} includePaths={false} onIncludePathsChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeInTheDocument();
  });

  it("opens a validated snapshot and renders its previous incident", async () => {
    const timestamp = 1_800_000_000_000;
    const state: NetworkState = {
      connection: { status: "online", effectiveType: null, downlinkMbps: null, rttMs: null, saveData: null, since: timestamp },
      events: [],
      failures: [],
      consecutiveFailures: 0
    };
    const snapshot = createDiagnosticsSnapshot({
      state,
      monitoring: true,
      requestMonitoring: false,
      probeEndpoint: "/",
      probeIntervalSeconds: 30,
      probeTimeoutSeconds: 5,
      probeHistory: [],
      latencySamples: [],
      reliabilityObservations: [
        { timestamp: timestamp - 2_000, source: "probe", outcome: "network-error" },
        { timestamp, source: "probe", outcome: "success" }
      ],
      requestEvents: [],
      networkLabResults: [],
      exportedAt: timestamp
    });
    const file = new File([JSON.stringify(snapshot)], "network-state.json", { type: "application/json" });

    render(<DiagnosticsExport snapshot={makeSnapshot()} includePaths={false} onIncludePathsChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Open previous investigation"), { target: { files: [file] } });

    expect(await screen.findByRole("region", { name: "Imported investigation" })).toBeInTheDocument();
    expect(screen.getByText("Reachability probe outage")).toBeInTheDocument();
    expect(screen.getByText("recovered", { selector: "span.diagnostics-incident-status" })).toBeInTheDocument();
    expect(screen.getByText(/warning · probe · 1 failures/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export imported records as CSV" }));
  });

  it("rejects a file with an unsupported snapshot schema", async () => {
    const invalid = new File([JSON.stringify({ format: "network-state-diagnostics", schemaVersion: 88 })], "old.json", { type: "application/json" });
    render(<DiagnosticsExport snapshot={makeSnapshot()} includePaths={false} onIncludePathsChange={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Open previous investigation"), { target: { files: [invalid] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/unsupported schema version/));
  });
});
