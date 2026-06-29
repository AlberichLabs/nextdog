import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse';
import {
  filterByWindow,
  inWindow,
  isLive,
  parseDatetimeLocalValue,
  PRESET_MS,
  resolveWindow,
  toDatetimeLocalValue,
  windowQueryParams,
} from '../time-window';

function ev(ts: number, type: 'span' | 'log' = 'span'): SSEEvent {
  return {
    type,
    timestamp: ts,
    data: { name: 'x', serviceName: 'svc', attributes: {} },
  };
}

describe('resolveWindow', () => {
  const now = 1_000_000_000;

  it('returns an open window for "all"', () => {
    expect(resolveWindow({ kind: 'all' }, now)).toEqual({ from: null, to: null });
  });

  it('turns a relative preset into a rolling [now - preset, open] window', () => {
    expect(resolveWindow({ kind: 'preset', preset: '15m' }, now)).toEqual({
      from: now - PRESET_MS['15m'],
      to: null,
    });
  });

  it('advances the lower bound as `now` advances (rolling)', () => {
    const a = resolveWindow({ kind: 'preset', preset: '5m' }, now);
    const b = resolveWindow({ kind: 'preset', preset: '5m' }, now + 60_000);
    expect((b.from ?? 0) - (a.from ?? 0)).toBe(60_000);
    expect(b.to).toBeNull();
  });

  it('returns the fixed [from, to] for a custom window, normalizing reversed bounds', () => {
    expect(resolveWindow({ kind: 'custom', from: 200, to: 100 }, now)).toEqual({
      from: 100,
      to: 200,
    });
  });
});

describe('isLive', () => {
  it('is live for "all" and relative presets, historical for custom', () => {
    expect(isLive({ kind: 'all' })).toBe(true);
    expect(isLive({ kind: 'preset', preset: '1h' })).toBe(true);
    expect(isLive({ kind: 'custom', from: 1, to: 2 })).toBe(false);
  });
});

describe('inWindow / filterByWindow', () => {
  it('treats null bounds as open', () => {
    expect(inWindow(50, { from: null, to: null })).toBe(true);
  });

  it('includes the inclusive endpoints', () => {
    const w = { from: 100, to: 200 };
    expect(inWindow(100, w)).toBe(true);
    expect(inWindow(200, w)).toBe(true);
    expect(inWindow(99, w)).toBe(false);
    expect(inWindow(201, w)).toBe(false);
  });

  it('filters an event list to the window, preferring data.timestamp', () => {
    const events = [ev(50), ev(150), ev(250)];
    const out = filterByWindow(events, { from: 100, to: 200 });
    expect(out).toEqual([events[1]]);
  });

  it('returns the same array reference for a fully-open window (no needless copy)', () => {
    const events = [ev(1), ev(2)];
    expect(filterByWindow(events, { from: null, to: null })).toBe(events);
  });
});

describe('windowQueryParams', () => {
  it('omits bounds that are open', () => {
    expect(windowQueryParams({ from: null, to: null })).toEqual({});
  });

  it('maps an inclusive window onto the FileStore exclusive since/before params', () => {
    // FileStore: `since` is strictly-greater, `before` is strictly-less. To keep
    // the picker's bounds inclusive we widen by 1ms on each side.
    expect(windowQueryParams({ from: 100, to: 200 })).toEqual({ since: 99, before: 201 });
  });
});

describe('datetime-local round trip', () => {
  it('round-trips a timestamp to minute precision through the local-datetime value', () => {
    const ms = new Date(2026, 5, 28, 10, 30).getTime();
    const value = toDatetimeLocalValue(ms);
    expect(value).toBe('2026-06-28T10:30');
    expect(parseDatetimeLocalValue(value)).toBe(ms);
  });

  it('returns null for an unparseable value', () => {
    expect(parseDatetimeLocalValue('not-a-date')).toBeNull();
  });
});
