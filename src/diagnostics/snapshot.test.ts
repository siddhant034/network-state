import { describe, expect, it } from "vitest";
import type { NetworkState } from "../core/types";
import type { InstrumentedRequestEvent } from "../adapters/request-instrumentation";
import type { NetworkLabResult } from "../adapters/network-test-lab";
import {
  buildDiagnosticsCsv,
  createDiagnosticsSnapshot,
  MAX_DIAGNOSTICS_IMPORT_BYTES,
  parseDiagnosticsSnapshot
} from "./snapshot";

const timestamp = 1_800_000_000_000;

function createInput(includePaths = false) {
  const state: NetworkState = {
    connection: {
      status: "online",
      effectiveType: "4g",
      downlinkMbps: 12,
      rttMs: 45,
      saveData: false,
      since: timestamp - 10_000
    },
    events: [{
      id: "event-1",
      kind: "warning",
      title: "Request observed",
      detail: "Request to https://api.example.test/users/123?token=private#section",
      timestamp
    }],
    failures: [{
      id: "failure-1",
      url: "https://api.example.test/users/123?token=private#section",
      method: "GET",
      reason: "Network request failed",
      timestamp
    }],
    consecutiveFailures: 1
  };
  const requestEvents: InstrumentedRequestEvent[] = [{
    id: "request-1",
    transport: "fetch",
    method: "GET",
    url: "https://api.example.test/users/123?token=private#section",
    outcome: "http-error",
    status: 503,
    durationMs: 84,
    timestamp
  }];
  const networkLabResults: NetworkLabResult[] = [{
    id: "endpoint-1-1",
    endpointLabel: "status.example.test",
    sequence: 1,
    status: "reachable",
    httpStatus: 200,
    durationMs: 30,
    timestamp,
    attempts: 1,
    simulatedLatencyMs: 0,
    simulatedFailure: false,
    simulationApplied: false,
    detail: "Endpoint responded."
  }];

  return {
    state,
    monitoring: true,
    requestMonitoring: true,
    probeEndpoint: "https://probe.example.test/private/health?key=secret#fragment",
    probeIntervalSeconds: 30,
    probeTimeoutSeconds: 5,
    probeHistory: [{
      status: "http-error" as const,
      timestamp,
      durationMs: 42,
      httpStatus: 503,
      detail: "Endpoint returned HTTP 503."
    }],
    latencySamples: [{ timestamp, durationMs: 42, source: "probe" as const }],
    reliabilityObservations: [
      { timestamp: timestamp - 100, source: "probe" as const, outcome: "network-error" as const },
      { timestamp, source: "probe" as const, outcome: "success" as const }
    ],
    requestEvents,
    networkLabResults,
    locale: "en-IN",
    timezone: "Asia/Kolkata",
    exportedAt: timestamp,
    includePaths
  };
}

describe("diagnostics snapshot", () => {
  it("redacts paths, credentials, queries, and fragments by default", () => {
    const snapshot = createDiagnosticsSnapshot(createInput());

    expect(snapshot.configuration.probeEndpointLabel).toBe("probe.example.test");
    expect(snapshot.failures[0].url).toBe("api.example.test");
    expect(snapshot.requests[0].url).toBe("api.example.test");
    expect(snapshot.events[0].detail).toContain("api.example.test");
    expect(JSON.stringify(snapshot)).not.toMatch(/private|secret|users\/123|fragment/);
  });

  it("allows path-level diagnostics only when explicitly enabled and always strips query and fragment", () => {
    const snapshot = createDiagnosticsSnapshot(createInput(true));

    expect(snapshot.configuration.includePaths).toBe(true);
    expect(snapshot.configuration.probeEndpointLabel).toBe("https://probe.example.test/private/health");
    expect(snapshot.requests[0].url).toBe("https://api.example.test/users/123");
    expect(JSON.stringify(snapshot)).not.toMatch(/private#|key=|token=|fragment/);
  });

  it("builds correlated incidents into the portable report", () => {
    const snapshot = createDiagnosticsSnapshot(createInput());

    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0].status).toBe("recovered");
    expect(snapshot.incidents[0].sources).toEqual(["probe"]);
  });

  it("round-trips a valid snapshot and rejects unsupported or malformed reports", () => {
    const snapshot = createDiagnosticsSnapshot(createInput());

    expect(parseDiagnosticsSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true, snapshot });
    expect(parseDiagnosticsSnapshot(JSON.stringify({ ...snapshot, schemaVersion: 99 }))).toEqual({
      ok: false,
      error: "This snapshot uses an unsupported schema version."
    });
    expect(parseDiagnosticsSnapshot(JSON.stringify({ ...snapshot, events: [{ title: "missing fields" }] }))).toEqual({
      ok: false,
      error: "The snapshot is incomplete or contains invalid diagnostic records."
    });
  });

  it("rejects imports above the size limit before parsing", () => {
    const result = parseDiagnosticsSnapshot(" ".repeat(MAX_DIAGNOSTICS_IMPORT_BYTES + 1));
    expect(result).toEqual({
      ok: false,
      error: "This snapshot is larger than the 1 MB import limit."
    });
  });

  it("creates spreadsheet-safe CSV with quoted cells and formula protection", () => {
    const input = createInput();
    input.state.events[0].title = '=HYPERLINK("https://bad.test","open")';
    input.state.events[0].detail = 'A "quoted", multi-line\ndetail';
    const csv = buildDiagnosticsCsv(createDiagnosticsSnapshot(input));

    expect(csv.startsWith("\uFEFF\"record_type\",\"timestamp\"")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK");
    expect(csv).toContain('\"\"https://bad.test\"\"');
    expect(csv).toContain('"A ""quoted"", multi-line');
    expect(csv).toContain('"api.example.test"');
    expect(csv).not.toContain("token=private");
  });

  it("keeps exported histories within their documented bounds", () => {
    const input = createInput();
    input.state.events = Array.from({ length: 520 }, (_, index) => ({
      id: "event-" + index,
      kind: "info" as const,
      title: "Event " + index,
      detail: "Detail",
      timestamp: timestamp + index
    }));

    const snapshot = createDiagnosticsSnapshot(input);
    expect(snapshot.events).toHaveLength(500);
  });
});
