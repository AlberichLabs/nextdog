/**
 * KPI summary computation for the top stat strip (issue #82).
 *
 * Derives throughput, p95 latency and error rate from the in-memory event set
 * that's already loaded — no server round-trip. Pure and DOM-free so it can be
 * unit-tested and recomputed cheaply on every stream tick.
 *
 * A "request" is a root request span (a SERVER span, or the first span of a
 * trace when kind is absent) — the same rooting rule the Traces view and the
 * detail pane use, so the counts line up with what the user sees listed.
 */

import type { SSEEvent } from '../hooks/use-sse';
import { httpCodeOf, spanDurationMs } from './format';

/**
 * Trailing window (ms) for the throughput rate. Taste-fork (#82): 60s gives a
 * live-feeling req/s that tracks the stream without being jerky, and stays
 * meaningful even when a 24h history buffer is loaded (raw "total / total-span"
 * would read ~0/s against a day of buffer). "req/s" is requests in this window
 * divided by the window length in seconds.
 */
export const KPI_THROUGHPUT_WINDOW_MS = 60_000;

export interface Kpis {
  /** Requests per second over the trailing throughput window. */
  throughputPerSec: number;
  /** Count of requests counted in the trailing throughput window. */
  windowRequests: number;
  /** p95 request latency (ms) over ALL loaded requests, or null if none timed. */
  p95Ms: number | null;
  /** Fraction (0–1) of loaded requests that errored, or null if no requests. */
  errorRate: number | null;
  /** Total loaded requests (root request spans). */
  totalRequests: number;
}

/** Is this span a root request span (the thing a user counts as "a request")? */
function isRootRequestSpan(e: SSEEvent): boolean {
  return e.type === 'span' && !e.data.parentSpanId && (e.data.kind === 'SERVER' || !e.data.kind);
}

/** Did this request error? 5xx status, an ERROR status code, or (as a floor) 4xx. */
function isErrorRequest(e: SSEEvent): boolean {
  if (e.data.status?.code === 'ERROR') return true;
  const code = httpCodeOf(e);
  return code !== undefined && code >= 500;
}

/**
 * Compute the KPI strip figures from the loaded events.
 *
 * `now` is injectable for deterministic tests; defaults to Date.now(). The
 * throughput window is anchored to `now` so it decays as the stream idles.
 */
export function computeKpis(events: SSEEvent[], now: number = Date.now()): Kpis {
  const requests = events.filter(isRootRequestSpan);
  const total = requests.length;

  if (total === 0) {
    return {
      throughputPerSec: 0,
      windowRequests: 0,
      p95Ms: null,
      errorRate: null,
      totalRequests: 0,
    };
  }

  let errors = 0;
  let windowCount = 0;
  const durations: number[] = [];
  const windowStart = now - KPI_THROUGHPUT_WINDOW_MS;

  for (const r of requests) {
    if (isErrorRequest(r)) errors++;
    const ms = spanDurationMs(r);
    if (ms > 0) durations.push(ms);
    if (r.timestamp >= windowStart) windowCount++;
  }

  durations.sort((a, b) => a - b);
  const p95Ms =
    durations.length > 0
      ? durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)]
      : null;

  return {
    throughputPerSec: windowCount / (KPI_THROUGHPUT_WINDOW_MS / 1000),
    windowRequests: windowCount,
    p95Ms,
    errorRate: errors / total,
    totalRequests: total,
  };
}
