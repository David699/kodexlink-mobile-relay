import type { TurnResult } from "./client.js";

export interface DurationStats {
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface TurnSummary {
  total: number;
  succeeded: number;
  failed: number;
  statusCounts: Record<string, number>;
  durations: DurationStats | null;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function percentile(sortedValues: number[], rank: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.ceil(rank * sortedValues.length) - 1;
  const safeIndex = Math.min(sortedValues.length - 1, Math.max(0, index));
  return sortedValues[safeIndex] ?? 0;
}

export function summarizeDurations(values: number[]): DurationStats | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const avgMs = total / sorted.length;

  return {
    minMs: round(minMs),
    maxMs: round(maxMs),
    avgMs: round(avgMs),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99))
  };
}

export function summarizeTurnsFromStats(
  statusCounts: Record<string, number>,
  durations: number[],
  failedCount: number
): TurnSummary {
  const normalizedStatusCounts: Record<string, number> = { ...statusCounts };
  const succeeded = Object.values(normalizedStatusCounts).reduce((sum, value) => sum + value, 0);
  return {
    total: succeeded + failedCount,
    succeeded,
    failed: failedCount,
    statusCounts: normalizedStatusCounts,
    durations: summarizeDurations(durations)
  };
}

export function summarizeTurns(results: Array<TurnResult | null>, failedCount: number): TurnSummary {
  const statusCounts: Record<string, number> = {};
  const durations: number[] = [];

  for (const result of results) {
    if (!result) {
      continue;
    }
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    durations.push(result.durationMs);
  }

  return summarizeTurnsFromStats(statusCounts, durations, failedCount);
}
