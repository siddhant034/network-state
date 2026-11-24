import { describe, expect, it } from "vitest";
import {
  appendReliabilityObservation,
  filterReliabilityObservations,
  MAX_RELIABILITY_OBSERVATIONS,
  summarizeReliability,
  type ReliabilityObservation
} from "./reliability";

const sample = (
  timestamp: number,
  outcome: ReliabilityObservation["outcome"],
  source: ReliabilityObservation["source"] = "probe"
): ReliabilityObservation => ({ timestamp, outcome, source });

describe("reliability analytics", () => {
  it("keeps the observation history chronological and bounded", () => {
    const result = appendReliabilityObservation(
      [sample(3, "success"), sample(1, "network-error")],
      sample(2, "timeout"),
      2
    );

    expect(result).toEqual([sample(2, "timeout"), sample(3, "success")]);
    expect(appendReliabilityObservation([], sample(1, "success"))).toHaveLength(1);
    expect(MAX_RELIABILITY_OBSERVATIONS).toBe(500);
  });

  it("ignores invalid observations and invalid capacities", () => {
    const original = [sample(1, "success")];
    expect(appendReliabilityObservation(original, sample(Number.NaN, "timeout"))).toBe(original);
    expect(appendReliabilityObservation(original, sample(2, "success"), 0)).toBe(original);
  });

  it("filters by time window and excludes future observations", () => {
    const now = 1_000_000;
    const history = [
      sample(now - 60_000, "success"),
      sample(now - 10_000, "timeout", "fetch"),
      sample(now + 1, "success")
    ];

    expect(filterReliabilityObservations(history, "5m", now)).toEqual(history.slice(0, 2));
  });

  it("distinguishes HTTP response availability from 2xx application success", () => {
    const report = summarizeReliability([
      sample(1, "success"),
      sample(2, "http-error"),
      sample(3, "network-error"),
      sample(4, "timeout")
    ], 5);

    expect(report.total).toMatchObject({
      attempts: 4,
      responses: 2,
      successes: 1,
      httpErrors: 1,
      transportFailures: 2,
      availabilityPercent: 50,
      successRatePercent: 25,
      httpErrorRatePercent: 25,
      transportFailureRatePercent: 50
    });
  });

  it("measures recovery from the first transport failure to the next HTTP response", () => {
    const report = summarizeReliability([
      sample(100, "network-error"),
      sample(140, "timeout"),
      sample(250, "http-error"),
      sample(300, "timeout"),
      sample(450, "success")
    ], 500);

    expect(report.bySource.probe).toMatchObject({
      recoveryCount: 2,
      averageRecoveryMs: 150,
      medianRecoveryMs: 150,
      currentOutageCount: 0,
      currentOutageMs: null
    });
  });

  it("keeps source recovery independent and reports an ongoing outage", () => {
    const report = summarizeReliability([
      sample(100, "timeout", "probe"),
      sample(120, "success", "fetch"),
      sample(150, "network-error", "xhr")
    ], 300);

    expect(report.bySource.probe.currentOutageMs).toBe(200);
    expect(report.bySource.fetch.currentOutageMs).toBeNull();
    expect(report.bySource.xhr.currentOutageMs).toBe(150);
    expect(report.total.currentOutageCount).toBe(2);
    expect(report.total.currentOutageMs).toBe(200);
  });

  it("excludes aborted and invalid-endpoint outcomes from rates", () => {
    const report = summarizeReliability([
      sample(1, "aborted"),
      sample(2, "invalid-endpoint"),
      sample(3, "success")
    ], 4);

    expect(report.total).toMatchObject({
      attempts: 1,
      aborted: 1,
      invalidEndpoints: 1,
      availabilityPercent: 100,
      successRatePercent: 100
    });
  });

  it("returns null rates and recovery values when no measured attempts exist", () => {
    const report = summarizeReliability([], 100);

    expect(report.total).toMatchObject({
      attempts: 0,
      availabilityPercent: null,
      successRatePercent: null,
      averageRecoveryMs: null,
      medianRecoveryMs: null
    });
  });
});
