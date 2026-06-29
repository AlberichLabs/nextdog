import { timestampOf } from '../hooks/events-history';
import type { SSEEvent } from '../hooks/use-sse';

// Pure logic for the overlay's time-range filter (preset → window, window →
// event filter, window → FileStore query params). Kept dependency-free and side
// effect-free so it can be unit-tested and reused by the `useTimeRange` hook and
// the picker component without dragging in Preact or fetch.

/** A relative, rolling preset measured back from "now". */
export type RelativePreset = '5m' | '15m' | '1h' | '6h' | '24h';

/**
 * What the user has selected in the time-range picker.
 *  - `all`     — no time bound (the live buffer + "Load older" cover it). Live.
 *  - `preset`  — a rolling window of the last N minutes/hours. Live (keeps tailing).
 *  - `custom`  — a fixed [from, to] window. Historical (live-tail paused).
 */
export type TimeRangeSelection =
  | { kind: 'all' }
  | { kind: 'preset'; preset: RelativePreset }
  | { kind: 'custom'; from: number; to: number };

/** A resolved time window. `null` on a bound means "open" (unbounded that side). */
export interface TimeWindow {
  from: number | null;
  to: number | null;
}

/** Duration of each relative preset, in milliseconds. */
export const PRESET_MS: Record<RelativePreset, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

/** The relative presets, in display order. */
export const RELATIVE_PRESETS: { id: RelativePreset; label: string }[] = [
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
];

/**
 * A live selection keeps tailing: new SSE events keep landing inside the window.
 * Only a fixed custom range is historical (a frozen period you're inspecting).
 */
export function isLive(sel: TimeRangeSelection): boolean {
  return sel.kind !== 'custom';
}

/**
 * Resolve a selection into a concrete window at a given `now`. Relative presets
 * roll: their lower bound is `now - preset` and the upper bound is left open so a
 * live tail keeps appending. Custom bounds are normalized (min/max) so a reversed
 * from/to still yields a valid window.
 */
export function resolveWindow(sel: TimeRangeSelection, now: number): TimeWindow {
  switch (sel.kind) {
    case 'all':
      return { from: null, to: null };
    case 'preset':
      return { from: now - PRESET_MS[sel.preset], to: null };
    case 'custom':
      return { from: Math.min(sel.from, sel.to), to: Math.max(sel.from, sel.to) };
  }
}

/** Whether a timestamp falls inside an (inclusive, open-bound-aware) window. */
export function inWindow(ts: number, window: TimeWindow): boolean {
  if (window.from !== null && ts < window.from) return false;
  if (window.to !== null && ts > window.to) return false;
  return true;
}

/**
 * Scope an event list to a window. Returns the original array untouched for a
 * fully-open window so a no-op selection ("All") never forces a re-render or a
 * needless copy of the live buffer.
 */
export function filterByWindow(events: SSEEvent[], window: TimeWindow): SSEEvent[] {
  if (window.from === null && window.to === null) return events;
  return events.filter((e) => inWindow(timestampOf(e), window));
}

/**
 * Map an inclusive window onto the FileStore's `/api/events` range params.
 *
 * The FileStore treats `since` as strictly-greater and `before` as strictly-less
 * (see core's QueryOptions), so to keep the picker's bounds inclusive we widen by
 * 1ms on each side. Open bounds are simply omitted.
 */
export function windowQueryParams(window: TimeWindow): { since?: number; before?: number } {
  const params: { since?: number; before?: number } = {};
  if (window.from !== null) params.since = window.from - 1;
  if (window.to !== null) params.before = window.to + 1;
  return params;
}

/** Format a timestamp as the value an `<input type="datetime-local">` expects (local, minute precision). */
export function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a `datetime-local` value back into epoch ms (local time), or null if invalid. */
export function parseDatetimeLocalValue(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}
