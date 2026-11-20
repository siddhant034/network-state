import { describe, expect, it } from "vitest";
import { appendLatencySample, MAX_LATENCY_SAMPLES } from "../analytics/latency";
import { appendReliabilityObservation, MAX_RELIABILITY_OBSERVATIONS } from "../analytics/reliability";
import { createNetworkMonitor } from "../core/network-monitor";

describe("long-lived session retention limits", () => {
  it("keeps monitor event and failure history bounded during a sustained failure burst", () => {
    const monitor = createNetworkMonitor({
      maxEvents: 80,
      maxFailures: 30,
      unstableAfterFailures: Number.MAX_SAFE_INTEGER
    });

    for (let index = 0; index < 5_000; index += 1) {
      monitor.recordRequestFailure({
        url: "/api/health",
        method: "GET",
        reason: "network-error",
        timestamp: index
      });
    }

    const snapshot = monitor.getSnapshot();
    expect(snapshot.events).toHaveLength(80);
    expect(snapshot.failures).toHaveLength(30);
    expect(snapshot.events[0].timestamp).toBe(4_999);
    expect(snapshot.failures[0].timestamp).toBe(4_999);
    expect(snapshot.events.at(-1)?.timestamp).toBe(4_920);
    expect(snapshot.failures.at(-1)?.timestamp).toBe(4_970);
  });

  it("keeps analytics histories bounded and chronological after thousands of samples", () => {
    let latency = [] as ReturnType<typeof appendLatencySample>;
    let reliability = [] as ReturnType<typeof appendReliabilityObservation>;

    for (let index = 0; index < 5_000; index += 1) {
      latency = appendLatencySample(latency, {
        timestamp: index,
        durationMs: index % 500,
        source: index % 2 === 0 ? "probe" : "fetch"
      });
      reliability = appendReliabilityObservation(reliability, {
        timestamp: index,
        source: index % 3 === 0 ? "probe" : index % 3 === 1 ? "fetch" : "xhr",
        outcome: index % 2 === 0 ? "success" : "network-error"
      });
    }

    expect(latency).toHaveLength(MAX_LATENCY_SAMPLES);
    expect(reliability).toHaveLength(MAX_RELIABILITY_OBSERVATIONS);
    expect(latency[0].timestamp).toBe(5_000 - MAX_LATENCY_SAMPLES);
    expect(latency.at(-1)?.timestamp).toBe(4_999);
    expect(reliability[0].timestamp).toBe(5_000 - MAX_RELIABILITY_OBSERVATIONS);
    expect(reliability.at(-1)?.timestamp).toBe(4_999);
  });
});
