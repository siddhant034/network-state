import type { LatencyWindow } from "./latency";

export type ReliabilitySource = "probe" | "fetch" | "xhr";
export type ReliabilityOutcome =
  | "success"
  | "http-error"
  | "network-error"
  | "timeout"
  | "aborted"
  | "invalid-endpoint";

export interface ReliabilityObservation {
  timestamp: number;
  source: ReliabilitySource;
  outcome: ReliabilityOutcome;
}

export interface ReliabilityMetrics {
  attempts: number;
  responses: number;
  successes: number;
  httpErrors: number;
  transportFailures: number;
  aborted: number;
  invalidEndpoints: number;
  availabilityPercent: number | null;
  successRatePercent: number | null;
  httpErrorRatePercent: number | null;
  transportFailureRatePercent: number | null;
  recoveryCount: number;
  averageRecoveryMs: number | null;
  medianRecoveryMs: number | null;
  currentOutageCount: number;
  currentOutageMs: number | null;
}

export interface ReliabilityReport {
  total: ReliabilityMetrics;
  bySource: Record<ReliabilitySource, ReliabilityMetrics>;
}

export const MAX_RELIABILITY_OBSERVATIONS = 500;

const WINDOW_MS: Record<LatencyWindow, number> = {
  "5m": 5 * 60 * 1_000,
  "30m": 30 * 60 * 1_000,
  "2h": 2 * 60 * 60 * 1_000
};

const SOURCES: ReliabilitySource[] = ["probe", "fetch", "xhr"];
const OUTCOMES: ReliabilityOutcome[] = [
  "success",
  "http-error",
  "network-error",
  "timeout",
  "aborted",
  "invalid-endpoint"
];

function isValidObservation(value: ReliabilityObservation): boolean {
  return Number.isFinite(value.timestamp)
    && SOURCES.includes(value.source)
    && OUTCOMES.includes(value.outcome);
}

/** Add an observation to a bounded, chronological in-memory history. */
export function appendReliabilityObservation(
  observations: ReliabilityObservation[],
  observation: ReliabilityObservation,
  maxObservations = MAX_RELIABILITY_OBSERVATIONS
): ReliabilityObservation[] {
  if (!isValidObservation(observation) || !Number.isInteger(maxObservations) || maxObservations < 1) {
    return observations;
  }

  return [...observations, observation]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-maxObservations);
}

/** Keep observations in the selected window and discard future-dated samples. */
export function filterReliabilityObservations(
  observations: ReliabilityObservation[],
  window: LatencyWindow,
  now = Date.now()
): ReliabilityObservation[] {
  const cutoff = now - WINDOW_MS[window];
  return observations
    .filter((observation) => isValidObservation(observation)
      && observation.timestamp >= cutoff
      && observation.timestamp <= now)
    .sort((left, right) => left.timestamp - right.timestamp);
}

interface SourceAnalysis {
  metrics: ReliabilityMetrics;
  recoveryDurations: number[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function createMetrics(
  counts: Pick<ReliabilityMetrics, "attempts" | "responses" | "successes" | "httpErrors" | "transportFailures" | "aborted" | "invalidEndpoints">,
  recoveryDurations: number[],
  currentOutageDurations: number[]
): ReliabilityMetrics {
  const attempts = counts.attempts;
  const rate = (numerator: number) => attempts === 0 ? null : (numerator / attempts) * 100;
  const averageRecoveryMs = recoveryDurations.length
    ? recoveryDurations.reduce((sum, duration) => sum + duration, 0) / recoveryDurations.length
    : null;

  return {
    ...counts,
    availabilityPercent: rate(counts.responses),
    successRatePercent: rate(counts.successes),
    httpErrorRatePercent: rate(counts.httpErrors),
    transportFailureRatePercent: rate(counts.transportFailures),
    recoveryCount: recoveryDurations.length,
    averageRecoveryMs,
    medianRecoveryMs: median(recoveryDurations),
    currentOutageCount: currentOutageDurations.length,
    currentOutageMs: currentOutageDurations.length ? Math.max(...currentOutageDurations) : null
  };
}

function analyzeSource(observations: ReliabilityObservation[], now: number): SourceAnalysis {
  const ordered = observations
    .filter(isValidObservation)
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);

  let responses = 0;
  let successes = 0;
  let httpErrors = 0;
  let transportFailures = 0;
  let aborted = 0;
  let invalidEndpoints = 0;
  let outageStartedAt: number | null = null;
  const recoveryDurations: number[] = [];

  for (const observation of ordered) {
    switch (observation.outcome) {
      case "success":
        responses += 1;
        successes += 1;
        if (outageStartedAt !== null) {
          recoveryDurations.push(Math.max(0, observation.timestamp - outageStartedAt));
          outageStartedAt = null;
        }
        break;
      case "http-error":
        responses += 1;
        httpErrors += 1;
        // An HTTP error still proves that the host responded, so it closes a
        // transport outage without being counted as an application success.
        if (outageStartedAt !== null) {
          recoveryDurations.push(Math.max(0, observation.timestamp - outageStartedAt));
          outageStartedAt = null;
        }
        break;
      case "network-error":
      case "timeout":
        transportFailures += 1;
        if (outageStartedAt === null) outageStartedAt = observation.timestamp;
        break;
      case "aborted":
        aborted += 1;
        break;
      case "invalid-endpoint":
        invalidEndpoints += 1;
        break;
    }
  }

  const attempts = responses + transportFailures;
  const currentOutageDurations = outageStartedAt === null
    ? []
    : [Math.max(0, now - outageStartedAt)];

  return {
    recoveryDurations,
    metrics: createMetrics(
      { attempts, responses, successes, httpErrors, transportFailures, aborted, invalidEndpoints },
      recoveryDurations,
      currentOutageDurations
    )
  };
}

/**
 * Summarize response availability separately from application success.
 * HTTP 4xx/5xx responses count as reachable but not successful. Aborts and
 * invalid probe configuration are excluded from the measured-attempt denominator.
 * Recovery durations are calculated independently per source so a successful
 * Fetch request cannot close an outstanding reachability-probe outage.
 */
export function summarizeReliability(
  observations: ReliabilityObservation[],
  now = Date.now()
): ReliabilityReport {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const analyses = Object.fromEntries(SOURCES.map((source) => [
    source,
    analyzeSource(observations.filter((observation) => observation.source === source), safeNow)
  ])) as Record<ReliabilitySource, SourceAnalysis>;

  const bySource = Object.fromEntries(SOURCES.map((source) => [
    source,
    analyses[source].metrics
  ])) as Record<ReliabilitySource, ReliabilityMetrics>;

  const recoveryDurations = SOURCES.flatMap((source) => analyses[source].recoveryDurations);
  const sourceMetrics = SOURCES.map((source) => analyses[source].metrics);
  const counts = sourceMetrics.reduce((total, current) => ({
    attempts: total.attempts + current.attempts,
    responses: total.responses + current.responses,
    successes: total.successes + current.successes,
    httpErrors: total.httpErrors + current.httpErrors,
    transportFailures: total.transportFailures + current.transportFailures,
    aborted: total.aborted + current.aborted,
    invalidEndpoints: total.invalidEndpoints + current.invalidEndpoints
  }), {
    attempts: 0,
    responses: 0,
    successes: 0,
    httpErrors: 0,
    transportFailures: 0,
    aborted: 0,
    invalidEndpoints: 0
  });
  const activeOutages = sourceMetrics
    .map((metrics) => metrics.currentOutageMs)
    .filter((duration): duration is number => duration !== null);

  return {
    total: createMetrics(counts, recoveryDurations, activeOutages),
    bySource
  };
}
