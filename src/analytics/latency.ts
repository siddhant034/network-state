export type LatencySource = "probe" | "fetch" | "xhr";
export type LatencySourceFilter = "all" | "probes" | "requests";
export type LatencyWindow = "5m" | "30m" | "2h";
export type LatencyTrend = "collecting" | "steady" | "slower" | "faster";

export interface LatencySample {
  timestamp: number;
  durationMs: number;
  source: LatencySource;
}

export interface LatencySummary {
  count: number;
  minMs: number | null;
  maxMs: number | null;
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  trend: LatencyTrend;
  changePercent: number | null;
}

export const MAX_LATENCY_SAMPLES = 240;

const WINDOW_MS: Record<LatencyWindow, number> = {
  "5m": 5 * 60 * 1_000,
  "30m": 30 * 60 * 1_000,
  "2h": 2 * 60 * 60 * 1_000
};

function isValidSample(sample: LatencySample): boolean {
  return Number.isFinite(sample.timestamp)
    && Number.isFinite(sample.durationMs)
    && sample.durationMs >= 0
    && (sample.source === "probe" || sample.source === "fetch" || sample.source === "xhr");
}

/** Add a sample while keeping the in-memory history bounded and chronological. */
export function appendLatencySample(
  samples: LatencySample[],
  sample: LatencySample,
  maxSamples = MAX_LATENCY_SAMPLES
): LatencySample[] {
  if (!isValidSample(sample) || !Number.isInteger(maxSamples) || maxSamples < 1) return samples;
  return [...samples, sample]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-maxSamples);
}

/** Select a time range and optionally separate reachability probes from page requests. */
export function filterLatencySamples(
  samples: LatencySample[],
  window: LatencyWindow,
  now = Date.now(),
  source: LatencySourceFilter = "all"
): LatencySample[] {
  const cutoff = now - WINDOW_MS[window];
  return samples.filter((sample) => {
    if (!isValidSample(sample) || sample.timestamp < cutoff || sample.timestamp > now) return false;
    if (source === "probes") return sample.source === "probe";
    if (source === "requests") return sample.source === "fetch" || sample.source === "xhr";
    return true;
  }).sort((left, right) => left.timestamp - right.timestamp);
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Summarize response times and compare the newest half with the preceding half. */
export function summarizeLatency(samples: LatencySample[]): LatencySummary {
  const sorted = samples
    .filter(isValidSample)
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      averageMs: null,
      medianMs: null,
      p95Ms: null,
      trend: "collecting",
      changePercent: null
    };
  }

  const chronological = samples
    .filter(isValidSample)
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((sample) => sample.durationMs);

  let trend: LatencyTrend = "collecting";
  let changePercent: number | null = null;

  if (chronological.length >= 4) {
    const midpoint = Math.floor(chronological.length / 2);
    const previousAverage = average(chronological.slice(0, midpoint));
    const recentAverage = average(chronological.slice(midpoint));
    changePercent = previousAverage === 0
      ? (recentAverage === 0 ? 0 : 100)
      : ((recentAverage - previousAverage) / previousAverage) * 100;
    trend = changePercent > 10 ? "slower" : changePercent < -10 ? "faster" : "steady";
  }

  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    averageMs: average(sorted),
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    trend,
    changePercent
  };
}

/** Produce a responsive SVG polyline from samples without introducing a chart dependency. */
export function buildLatencyChartPoints(
  samples: LatencySample[],
  width = 640,
  height = 144,
  padding = 12
): string {
  if (samples.length === 0 || width <= padding * 2 || height <= padding * 2) return "";

  const values = samples.map((sample) => sample.durationMs);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = maximum - minimum || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  return samples.map((sample, index) => {
    const x = samples.length === 1
      ? width / 2
      : padding + (index / (samples.length - 1)) * usableWidth;
    const y = height - padding - ((sample.durationMs - minimum) / spread) * usableHeight;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
}
