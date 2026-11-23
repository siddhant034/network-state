import { describe, expect, it } from "vitest";
import { createDiagnosticsSnapshot } from "./diagnostics-export";
import type { NetworkState } from "../core/types";

const state: NetworkState = {
  connection: {
    status: "unstable",
    effectiveType: "4g",
    downlinkMbps: 8,
    rttMs: 120,
    saveData: false,
    since: 1_000
  },
  events: [{
    id: "event-1",
    kind: "error",
    title: "Request failed",
    detail: "GET https://private.example/account/123?token=secret",
    timestamp: 2_000
  }],
  failures: [{
    id: "failure-1",
    url: "https://private.example/account/123?token=secret",
    method: "GET",
    reason: "private query token=secret",
    timestamp: 2_000
  }],
  consecutiveFailures: 1
};

describe("createDiagnosticsSnapshot", () => {
  it("exports normalized diagnostics while excluding request destinations and free-form details", () => {
    const snapshot = createDiagnosticsSnapshot({
      state,
      probeHistory: [{
        status: "reachable",
        timestamp: 3_000,
        durationMs: 45,
        httpStatus: 204,
        detail: "probe detail containing secret"
      }],
      latencySamples: [{ timestamp: 3_000, durationMs: 45, source: "probe" }],
      reliabilityObservations: [{ timestamp: 3_000, source: "probe", outcome: "success" }],
      generatedAt: 4_000
    });

    const serialized = JSON.stringify(snapshot);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.generatedAt).toBe(new Date(4_000).toISOString());
    expect(snapshot.events[0]).not.toHaveProperty("detail");
    expect(snapshot.requestFailures[0]).not.toHaveProperty("url");
    expect(snapshot.requestFailures[0]).not.toHaveProperty("reason");
    expect(snapshot.probes[0]).not.toHaveProperty("detail");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("account/123");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("probe detail");
  });

  it("bounds every exported history to the dashboard's retention limits", () => {
    const snapshot = createDiagnosticsSnapshot({
      state: {
        ...state,
        events: Array.from({ length: 100 }, (_, index) => ({
          id: String(index), kind: "info" as const, title: "Event", detail: "detail", timestamp: index
        })),
        failures: Array.from({ length: 40 }, (_, index) => ({
          id: String(index), url: "/private", method: "GET", reason: "failure", timestamp: index
        }))
      },
      probeHistory: Array.from({ length: 30 }, (_, index) => ({
        status: "reachable" as const, timestamp: index, durationMs: index, httpStatus: 200, detail: "detail"
      })),
      latencySamples: Array.from({ length: 300 }, (_, index) => ({
        timestamp: index, durationMs: index, source: "probe" as const
      })),
      reliabilityObservations: Array.from({ length: 600 }, (_, index) => ({
        timestamp: index, source: "probe" as const, outcome: "success" as const
      })),
      generatedAt: 5_000
    });

    expect(snapshot.events).toHaveLength(80);
    expect(snapshot.requestFailures).toHaveLength(30);
    expect(snapshot.probes).toHaveLength(20);
    expect(snapshot.latencySamples).toHaveLength(240);
    expect(snapshot.reliabilityObservations).toHaveLength(500);
  });

  it("rejects invalid export timestamps", () => {
    expect(() => createDiagnosticsSnapshot({
      state,
      probeHistory: [],
      latencySamples: [],
      reliabilityObservations: [],
      generatedAt: Number.NaN
    })).toThrow(/finite timestamp/);
  });
});
