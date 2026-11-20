import { describe, expect, it } from "vitest";
import type { NetworkEvent } from "../core/types";
import { buildIncidentTimeline } from "./incidents";
import type { ReliabilityObservation } from "./reliability";

const observation = (
  timestamp: number,
  source: ReliabilityObservation["source"],
  outcome: ReliabilityObservation["outcome"]
): ReliabilityObservation => ({ timestamp, source, outcome });

const browserEvent = (id: string, timestamp: number, title: string): NetworkEvent => ({
  id,
  timestamp,
  kind: title === "Connection lost" ? "warning" : "status",
  title,
  detail: title === "Connection lost" ? "The browser reports that it is offline." : "The browser reports that it is online."
});

describe("buildIncidentTimeline", () => {
  it("correlates overlapping outages from independent transports and resolves them independently", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "probe", "network-error"),
      observation(1_500, "fetch", "timeout"),
      observation(5_000, "probe", "success"),
      observation(6_000, "fetch", "http-error")
    ], [], { now: 7_000 });

    expect(timeline.incidents).toHaveLength(1);
    expect(timeline.incidents[0]).toMatchObject({
      summary: "Correlated network failures",
      status: "recovered",
      severity: "error",
      startAt: 1_000,
      endAt: 6_000,
      durationMs: 5_000,
      failureCount: 2,
      sources: ["fetch", "probe"]
    });
    expect(timeline.incidents[0].signals.map((signal) => signal.type)).toEqual([
      "failure", "failure", "recovery", "recovery"
    ]);
  });

  it("keeps source outages independent when only one transport recovers", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "probe", "timeout"),
      observation(1_500, "fetch", "network-error"),
      observation(3_000, "fetch", "success")
    ], [], { now: 5_000 });

    expect(timeline.incidents).toHaveLength(1);
    expect(timeline.incidents[0].status).toBe("ongoing");
    expect(timeline.incidents[0].durationMs).toBe(4_000);
    expect(timeline.incidents[0].signals.filter((signal) => signal.type === "recovery")).toHaveLength(1);
  });

  it("starts a separate incident when outages are outside the correlation window", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "probe", "network-error"),
      observation(35_001, "fetch", "timeout")
    ], [], { now: 40_000, correlationWindowMs: 30_000 });

    expect(timeline.incidents).toHaveLength(2);
    expect(timeline.incidents[0].sources).toEqual(["fetch"]);
    expect(timeline.incidents[1].sources).toEqual(["probe"]);
  });

  it("treats a later source failure as correlated while an earlier outage remains open", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "probe", "timeout"),
      observation(40_000, "fetch", "network-error")
    ], [], { now: 50_000, correlationWindowMs: 30_000 });

    expect(timeline.incidents).toHaveLength(1);
    expect(timeline.incidents[0]).toMatchObject({
      status: "ongoing",
      sources: ["fetch", "probe"],
      startAt: 1_000,
      durationMs: 49_000
    });
  });

  it("treats browser offline and online transitions as a critical incident", () => {
    const timeline = buildIncidentTimeline([], [
      browserEvent("offline-1", 1_000, "Connection lost"),
      browserEvent("online-1", 2_500, "Connection restored")
    ], { now: 3_000 });

    expect(timeline.incidents).toHaveLength(1);
    expect(timeline.incidents[0]).toMatchObject({
      severity: "critical",
      status: "recovered",
      durationMs: 1_500,
      sources: ["browser"]
    });
  });

  it("does not let a successful probe close a Fetch outage", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "fetch", "network-error"),
      observation(1_500, "probe", "success")
    ], [], { now: 2_000 });

    expect(timeline.incidents[0].status).toBe("ongoing");
    expect(timeline.incidents[0].signals).toHaveLength(1);
  });

  it("uses HTTP errors as transport recovery but keeps them visibly unsuccessful", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "probe", "timeout"),
      observation(2_000, "probe", "http-error")
    ], [], { now: 3_000 });

    expect(timeline.incidents[0].status).toBe("recovered");
    expect(timeline.incidents[0].signals[1]).toMatchObject({
      type: "recovery",
      severity: "warning",
      title: "HTTP error response"
    });
  });

  it("keeps aborted requests and invalid endpoints as standalone investigation signals", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "fetch", "aborted"),
      observation(2_000, "probe", "invalid-endpoint")
    ], [], { now: 3_000 });

    expect(timeline.incidents).toHaveLength(0);
    expect(timeline.standaloneSignals.map((signal) => signal.type)).toEqual(["configuration", "ignored"]);
  });

  it("retains ongoing incidents that began before the selected window but excludes old recovered incidents", () => {
    const timeline = buildIncidentTimeline([
      observation(1_000, "probe", "network-error"),
      observation(2_000, "fetch", "network-error"),
      observation(3_000, "xhr", "timeout"),
      observation(4_000, "probe", "success"),
      observation(5_000, "fetch", "success")
    ], [], { now: 100_000, windowMs: 10_000 });

    expect(timeline.incidents).toHaveLength(1);
    expect(timeline.incidents[0].status).toBe("ongoing");
    expect(timeline.incidents[0].startAt).toBe(1_000);
  });

  it("ignores future-dated observations and events", () => {
    const timeline = buildIncidentTimeline([
      observation(2_000, "probe", "network-error"),
      observation(10_001, "fetch", "timeout")
    ], [browserEvent("future", 10_002, "Connection lost")], { now: 10_000 });

    expect(timeline.incidents).toHaveLength(1);
    expect(timeline.incidents[0].sources).toEqual(["probe"]);
  });
});
