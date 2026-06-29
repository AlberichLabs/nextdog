import { useEffect, useRef, useState } from 'preact/hooks';
import {
  filterByWindow,
  isLive,
  resolveWindow,
  type TimeRangeSelection,
  type TimeWindow,
  windowQueryParams,
} from '../utils/time-window';
import { mergeEvents } from './events-history';
import type { SSEEvent } from './use-sse';

/**
 * Upper bound on events pulled from disk for a single window. A 24h custom window
 * can hold a lot of records; this bounds the fetch (most-recent N) so the picker
 * stays snappy and the client buffer stays sane. Matches the order of magnitude of
 * the live buffer cap (MAX_LIVE_EVENTS = 2000) with headroom.
 */
const HISTORY_CAP = 5000;

/** How often the rolling lower bound of a relative preset advances. */
const TICK_MS = 1000;

export interface UseTimeRangeResult {
  selection: TimeRangeSelection;
  setSelection: (sel: TimeRangeSelection) => void;
  /** The events scoped to the active window — feed this into the search/facet pipeline. */
  events: SSEEvent[];
  /** Resolved window at the current tick (for labels / debugging). */
  window: TimeWindow;
  /** True while the window keeps tailing live; false while inspecting a fixed past period. */
  live: boolean;
  /** True while the on-disk snapshot for a bounded window is loading. */
  loading: boolean;
}

/**
 * The overlay's time-range filter, backed by the sidecar's 24h FileStore history.
 *
 * Three modes, all composing with the live SSE buffer the caller passes in:
 *  - **All** (default): pass the live buffer straight through — its own "Load older"
 *    already pages into disk, so no extra fetch and no re-sort of the buffer.
 *  - **Relative preset** (live): fetch the window's history from disk *once* on
 *    selection, then merge the live buffer on top and scope to a rolling window —
 *    so you see the full window from disk even past the live buffer cap, and live
 *    events keep appending within it.
 *  - **Custom** (historical): fetch a fixed [from, to] snapshot from disk and show
 *    exactly that — live-tail paused, nothing auto-appends. You're inspecting a
 *    frozen period.
 *
 * The data layer already serves ranges: `/api/events` forwards `since`/`before`
 * to `FileStore.query`, so no new endpoint is needed — we just drive it.
 */
export function useTimeRange(
  url: string,
  liveEvents: SSEEvent[],
  enabled: boolean,
): UseTimeRangeResult {
  const [selection, setSelection] = useState<TimeRangeSelection>({ kind: 'all' });
  const [snapshot, setSnapshot] = useState<SSEEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const live = isLive(selection);

  // Advance `now` while a relative preset is active so the rolling lower bound
  // keeps moving. Other modes have a fixed (or absent) lower bound — no tick.
  useEffect(() => {
    if (selection.kind !== 'preset') return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [selection.kind]);

  // Load the window's events from the FileStore whenever the selection changes to
  // a bounded window. "All" needs no fetch. A monotonic request id discards stale
  // responses if the user switches windows mid-flight.
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!enabled || selection.kind === 'all') {
      reqIdRef.current++;
      setSnapshot([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    const win = resolveWindow(selection, Date.now());
    const { since, before } = windowQueryParams(win);
    const params = new URLSearchParams({ last: String(HISTORY_CAP) });
    if (since !== undefined) params.set('since', String(since));
    if (before !== undefined) params.set('before', String(before));

    setLoading(true);
    fetch(`${url}/api/events?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (reqId !== reqIdRef.current) return; // superseded
        setSnapshot((data.events ?? []) as SSEEvent[]);
      })
      .catch(() => {
        if (reqId === reqIdRef.current) setSnapshot([]);
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [url, enabled, selection]);

  const window = resolveWindow(selection, now);

  let events: SSEEvent[];
  if (selection.kind === 'all') {
    // Fast path: hand back the live buffer untouched — preserves the bounded,
    // append-only perf characteristics the buffer was designed around (#58).
    events = liveEvents;
  } else if (live) {
    // Relative preset: disk history under the live tail, scoped to the rolling window.
    events = filterByWindow(mergeEvents(snapshot, liveEvents), window);
  } else {
    // Custom: frozen historical snapshot, scoped to the fixed window.
    events = filterByWindow(snapshot, window);
  }

  return { selection, setSelection, events, window, live, loading };
}
