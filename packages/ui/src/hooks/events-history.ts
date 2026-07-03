import type { SSEEvent } from './use-sse';

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

/**
 * The wall-clock timestamp (ms) of an event. Prefers the record's own
 * `data.timestamp` (the ingest time the sidecar persisted) and falls back to the
 * SSE envelope timestamp. Shared with the time-window filter so history paging
 * and time-range scoping agree on what "when" means for an event.
 */
export function timestampOf(event: SSEEvent): number {
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

/**
 * Hard cap on the live in-memory event buffer, applied *per event type* (issue #58,
 * refined by issue #71).
 *
 * The dashboard's persistent record lives on disk (core's FileStore); the client
 * only needs a bounded *live* window — "Load older" pages further back on demand.
 * Without a cap, the client buffer grew with every SSE message for the lifetime of
 * the session, and because each message re-ran an O(n) dedup + O(n log n) re-sort
 * of the *entire* buffer (see {@link mergeEvents}), per-event cost climbed with the
 * buffer size — O(n²) over a session. Under real traffic the main thread saturated
 * and the page froze (felt acutely while scrolling). Small-dataset QA never hit it.
 *
 * The cap is enforced **independently for logs and for spans** rather than as one
 * shared budget (issue #71). Console logs are typically far higher-volume than
 * spans, so a single shared cap let a log flood evict the sparse spans — and,
 * symmetrically, a span burst evict logs — making one type's entries "randomly
 * clear" while the other persisted. A per-type budget means one stream's volume can
 * never evict the other's entries. Each type is still bounded, so the #58 guarantee
 * holds: the total buffer can never exceed `2 × MAX_LIVE_EVENTS`, independent of
 * session length, and each virtualized list still renders at most MAX_LIVE_EVENTS
 * rows — the size utils/virtual-window.ts was designed around.
 */
export const MAX_LIVE_EVENTS = 2000;

/**
 * Bound a sorted, oldest-first buffer to at most `cap` events *of each type*,
 * dropping the oldest of whichever type overflows while preserving the overall
 * oldest-first order (issue #71). Returns the input array untouched when nothing
 * needs trimming, so callers can bail out of a re-render. O(n) in buffer length.
 */
function capPerType(list: SSEEvent[], cap: number): SSEEvent[] {
  let logs = 0;
  let spans = 0;
  for (const e of list) {
    if (e.type === 'span') spans++;
    else logs++;
  }
  if (logs <= cap && spans <= cap) return list;

  // Walk newest→oldest, keeping only the most recent `cap` events of each type.
  let keptLogs = 0;
  let keptSpans = 0;
  const keep = new Array<boolean>(list.length);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === 'span') {
      keep[i] = keptSpans < cap;
      if (keep[i]) keptSpans++;
    } else {
      keep[i] = keptLogs < cap;
      if (keep[i]) keptLogs++;
    }
  }
  const out: SSEEvent[] = [];
  for (let i = 0; i < list.length; i++) {
    if (keep[i]) out.push(list[i]);
  }
  return out;
}

/**
 * Append live SSE events onto an oldest-first buffer, de-duplicating by
 * {@link eventKey}, keeping it sorted oldest-first, and bounding it to the most
 * recent `cap` events *of each type* (see {@link capPerType} and issue #71). Unlike
 * {@link mergeEvents}, this never re-sorts the whole buffer: a live event is almost
 * always the newest, so it appends in O(1); a rare out-of-order delivery is
 * binary-inserted. Cost per call is therefore bounded by `cap`, not by how long the
 * session has been running (issue #58).
 *
 * Used only for the live SSE tail. History backfill and "load older" still go
 * through {@link mergeEvents}, which merges two ordered lists.
 */
export function appendLiveEvents(
  buf: SSEEvent[],
  incoming: SSEEvent[],
  cap = MAX_LIVE_EVENTS,
): SSEEvent[] {
  if (incoming.length === 0) return buf;

  const seen = new Set<string>();
  for (const e of buf) seen.add(eventKey(e));

  // Copy lazily — if every incoming event is a duplicate we return `buf` untouched
  // so React/Preact can bail out of the re-render.
  let next: SSEEvent[] | null = null;
  for (const event of incoming) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!next) next = buf.slice();

    const t = timestampOf(event);
    if (next.length === 0 || t >= timestampOf(next[next.length - 1])) {
      next.push(event); // live-tail fast path: newest goes at the end
    } else {
      // Out-of-order arrival — binary-insert to keep the buffer oldest-first.
      let lo = 0;
      let hi = next.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (timestampOf(next[mid]) <= t) lo = mid + 1;
        else hi = mid;
      }
      next.splice(lo, 0, event);
    }
  }

  if (!next) return buf;
  return capPerType(next, cap);
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
