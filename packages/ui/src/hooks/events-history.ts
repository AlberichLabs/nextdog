import type { SSEEvent } from './use-sse.js';

/**
 * Stable de-duplication key for an event. Spans are keyed by their unique spanId.
 * Logs have no unique id, so they are keyed by service + timestamp + message, which
 * is stable across history reloads and live SSE delivery of the same record.
 */
export function eventKey(event: SSEEvent): string {
  if (event.type === 'span' && event.data.spanId) {
    return `span:${event.data.spanId}`;
  }
  const ts = event.data.timestamp ?? event.timestamp;
  return `log:${event.data.serviceName}:${ts}:${event.data.message ?? ''}`;
}

function timestampOf(event: SSEEvent): number {
  return event.data.timestamp ?? event.timestamp ?? 0;
}

/**
 * Merge two ordered (oldest-first) event lists into one, dropping duplicates by
 * {@link eventKey}. Used both to backfill history under live events and to prepend
 * older pages. The result is sorted oldest-first and stable for equal timestamps.
 */
export function mergeEvents(a: SSEEvent[], b: SSEEvent[]): SSEEvent[] {
  const seen = new Set<string>();
  const merged: SSEEvent[] = [];
  for (const event of [...a, ...b]) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  merged.sort((x, y) => timestampOf(x) - timestampOf(y));
  return merged;
}

/** Timestamp of the oldest event in an oldest-first list, or undefined if empty. */
export function oldestTimestamp(events: SSEEvent[]): number | undefined {
  if (events.length === 0) return undefined;
  let min = timestampOf(events[0]);
  for (const e of events) {
    const t = timestampOf(e);
    if (t < min) min = t;
  }
  return min;
}
