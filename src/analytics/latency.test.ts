import { describe, expect, it } from "vitest";
import {
  appendLatencySample,
  buildLatencyChartPoints,
  filterLatencySamples,
  summarizeLatency,
  type LatencySample
} from "./latency";

const sample = (timestamp: number, durationMs: number, source: LatencySample["source"] = "probe"): LatencySample => ({
  timestamp,
  durationMs,
  source
});

describe("latency analytics", () => {
  it("keeps samples chronological and bounded", () => {
    const result = appendLatencySample(
      [sample(3, 30), sample(1, 10)],
      sample(2, 20),
      2
    );

    expect(result).toEqual([sample(2, 20), sample(3, 30)]);
  });

  it("ignores invalid samples and invalid capacity values", () => {
    const original = [sample(1, 10)];
    expect(appendLatencySample(original, sample(2, -1))).toBe(original);
    expect(appendLatencySample(original, sample(2, 20), 0)).toBe(original);
  });

  it("filters by time range and source without mutating the history", () => {
    const now = 1_000_000;
    const history = [
      sample(now - 60_000, 20),
      sample(now - 10_000, 30, "fetch"),
      sample(now - 1_000, 40, "xhr"),
      sample(now + 1_000, 50)
    ];

    expect(filterLatencySamples(history, "5m", now)).toHaveLength(3);
    expect(filterLatencySamples(history, "5m", now, "probes")).toEqual([history[0], history[3 - 1]]);
    expect(filterLatencySamples(history, "5m", now, "requests")).toEqual([history[1], history[2]]);
    expect(history).toHaveLength(4);
  });

  it("calculates average, median, nearest-rank p95, minimum and maximum", () => {
    const summary = summarizeLatency([
      sample(1, 10),
      sample(2, 20),
      sample(3, 30),
      sample(4, 40),
      sample(5, 100)
    ]);

    expect(summary).toMatchObject({
      count: 5,
      minMs: 10,
      maxMs: 100,
      averageMs: 40,
      medianMs: 30,
      p95Ms: 100
    });
  });

  it("classifies trend only after enough samples are available", () => {
    expect(summarizeLatency([sample(1, 10), sample(2, 20), sample(3, 30)]).trend).toBe("collecting");
    expect(summarizeLatency([sample(1, 10), sample(2, 10), sample(3, 20), sample(4, 20)]).trend).toBe("slower");
    expect(summarizeLatency([sample(1, 20), sample(2, 20), sample(3, 10), sample(4, 10)]).trend).toBe("faster");
    expect(summarizeLatency([sample(1, 10), sample(2, 11), sample(3, 10), sample(4, 11)]).trend).toBe("steady");
  });

  it("builds chart points for empty, single and multiple samples", () => {
    expect(buildLatencyChartPoints([])).toBe("");
    expect(buildLatencyChartPoints([sample(1, 25)])).toBe("320.0,132.0");
    expect(buildLatencyChartPoints([sample(1, 10), sample(2, 20)])).toBe("12.0,132.0 628.0,12.0");
  });
});
