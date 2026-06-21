import type { SSEEvent } from './use-sse.js';

// These helpers run over events read back from on-disk history (`/api/events`),
// which may have been persisted under an older schema than the running build.
// They are deliberately field-tolerant: every field access falls back rather than
// asserts, so a schema change never crashes a history reload. The invariant that
// `data` is a non-null object is enforced upstream in core's FileStore reader
// (`isNextDogEvent`), so unknown/old shapes are dropped before they reach here.
// We keep these dependency-free on purpose — `@nextdog/ui` is the lowest package
// in the dependency graph (core depends on ui, not the reverse), so it cannot
// borrow core's `NextDogEvent` type without a cycle, and a published SDK UI should
// not pull a parser/serializer library (zod/lodash) into every consumer's bundle.

/**
 * Stable de-duplication key for an event. Spans are keyed by their unique spanId.
 * Logs have no unique id, so they are keyed by service + timestamp + message, which
 * is stable across history reloads and live SSE delivery of the same record.
 *
 * Schema-change behavior: missing optional fields fall back (`?? ''` / envelope
 * timestamp), and a span without a spanId degrades to a log-style key rather than
 * throwing. Worst case a renamed field yields a different key and an event is shown
 * twice — never a crash.
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
 *
 * This is already the minimal form: a single Set for O(1) dedup, one linear pass,
 * one sort — O(n log n), no intermediate allocations beyond the result. A library
 * (lodash.unionBy / .sortBy) would add bundle weight to every consumer for the same
 * complexity and worse: unionBy is O(n*m) without a hashed key. Kept hand-rolled.
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
