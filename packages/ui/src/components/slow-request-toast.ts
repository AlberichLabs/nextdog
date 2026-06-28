/**
 * Slow-request toast detection.
 *
 * Toasts are LIVE alerts. The dashboard reloads the full FileStore history on
 * every mount/refresh (issue #8), so the toast effect must not re-fire warnings
 * for requests that already finished before this session started watching —
 * otherwise every page load replays stale toasts (issue #51).
 *
 * The gate is the request's completion time, not its position in the events
 * array: history merges in oldest-first and can reorder relative to live SSE
 * events, so a raw array index is not a reliable "new vs. historical" signal.
 */

import type { SSEEvent } from '../hooks/use-sse';
import { parseNano } from '../utils/format';

/** Threshold for slow request toasts (ms). */
export const SLOW_REQUEST_MS = 1000;
/** At/above this duration the toast is an error rather than a warning. */
export const SLOW_ERROR_MS = 3000;

export interface SlowRequestToast {
  message: string;
  type: 'warning' | 'error';
  traceId: string;
  duration: string;
}

function formatDurationMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Return a toast descriptor for a slow SERVER request that COMPLETED at/after
 * `watchStartMs` (the moment this dashboard started watching), or null.
 *
 * Returning null for requests that finished before `watchStartMs` is what stops
 * historical requests — replayed from disk on load/refresh — from re-toasting.
 */
export function detectSlowRequestToast(
  event: SSEEvent,
  watchStartMs: number,
): SlowRequestToast | null {
  if (event.type !== 'span') return null;
  if (!event.data.traceId) return null;
  if (event.data.kind !== 'SERVER') return null;

  const start = parseNano(event.data.startTimeUnixNano);
  const end = parseNano(event.data.endTimeUnixNano);
  if (start <= 0n || end <= 0n) return null;

  // Skip requests that completed before we started watching (replayed history).
  const endMs = Number(end / 1_000_000n);
  if (endMs < watchStartMs) return null;

  const ms = Number(end - start) / 1_000_000;
  if (ms < SLOW_REQUEST_MS) return null;

  const route = String(
    event.data.attributes['http.route'] ?? event.data.attributes['http.target'] ?? event.data.name,
  );
  const method = String(event.data.attributes['http.method'] ?? 'GET');
  return {
    message: `${method} ${route}`,
    type: ms >= SLOW_ERROR_MS ? 'error' : 'warning',
    traceId: event.data.traceId,
    duration: formatDurationMs(ms),
  };
}
