import { describe, expect, it } from 'vitest';
import {
  appendLiveEvents,
  eventKey,
  MAX_LIVE_EVENTS,
  mergeEvents,
  oldestTimestamp,
} from '../events-history';
import type { SSEEvent } from '../use-sse';

const span = (id: string, ts: number, serviceName = 'web'): SSEEvent => ({
  type: 'span',
  timestamp: ts,
  data: { spanId: id, name: `op-${id}`, attributes: {}, serviceName },
});

const log = (ts: number, message: string, serviceName = 'web'): SSEEvent => ({
  type: 'log',
  timestamp: ts,
  data: { name: '', message, level: 'info', timestamp: ts, attributes: {}, serviceName },
});

describe('eventKey', () => {
  it('keys spans by spanId', () => {
    expect(eventKey(span('s1', 1))).toBe('span:s1');
  });

  it('keys logs by service + timestamp + message (stable across reloads)', () => {
    expect(eventKey(log(5, 'boot', 'api'))).toBe('log:api:5:boot');
  });
});

describe('eventKey — schema tolerance', () => {
  // The dedup key is computed over whatever shape the server sends back, including
  // events persisted under an older schema. It must degrade gracefully, never throw.
  it('keys an old-shape log missing the inner timestamp, falling back to the envelope ts', () => {
    const old = {
      type: 'log',
      timestamp: 9,
      data: { name: '', serviceName: 'legacy', message: 'hi', attributes: {} },
    } as unknown as SSEEvent;
    expect(eventKey(old)).toBe('log:legacy:9:hi');
  });

  it('keys a sparse log with no message without throwing', () => {
    const sparse = {
      type: 'log',
      timestamp: 3,
      data: { name: '', serviceName: 'svc', attributes: {} },
    } as unknown as SSEEvent;
    expect(eventKey(sparse)).toBe('log:svc:3:');
  });

  it('falls back to a log key for a span event missing its spanId', () => {
    const noId = {
      type: 'span',
      timestamp: 4,
      data: { name: 'op', serviceName: 'svc', attributes: {} },
    } as unknown as SSEEvent;
    // No spanId → not keyed as a span; falls through to the log-style key, no throw.
    expect(eventKey(noId)).toBe('log:svc:4:');
  });
});

describe('mergeEvents', () => {
  it('merges old-shape and new-shape events without throwing', () => {
    const oldShape = {
      type: 'log',
      timestamp: 1,
      data: { name: '', serviceName: 'legacy', message: 'from old schema', attributes: {} },
    } as unknown as SSEEvent;
    const merged = mergeEvents([oldShape], [span('s1', 2)]);
    expect(merged.map((e) => e.type)).toEqual(['log', 'span']);
  });

  it('merges history under live events and de-duplicates spans by spanId', () => {
    const live = [span('s2', 2), span('s3', 3)];
    const history = [span('s1', 1), span('s2', 2)]; // s2 overlaps with live
    const merged = mergeEvents(history, live);
    expect(merged.map((e) => e.data.spanId)).toEqual(['s1', 's2', 's3']);
  });

  it('reloads logs (not just spans) from history', () => {
    const live: SSEEvent[] = [];
    const history = [log(1, 'hello from disk'), span('s1', 2)];
    const merged = mergeEvents(history, live);
    const types = merged.map((e) => e.type);
    expect(types).toContain('log');
    expect(types).toContain('span');
    expect(merged.find((e) => e.type === 'log')?.data.message).toBe('hello from disk');
  });

  it('de-duplicates identical logs delivered both via history and SSE', () => {
    const same = log(7, 'duplicate');
    const merged = mergeEvents([same], [{ ...same }]);
    expect(merged).toHaveLength(1);
  });

  it('keeps result sorted oldest-first', () => {
    const merged = mergeEvents([span('s3', 30)], [span('s1', 10), span('s2', 20)]);
    expect(merged.map((e) => e.timestamp)).toEqual([10, 20, 30]);
  });
});

describe('appendLiveEvents', () => {
  it('appends a newer live event to the end of an oldest-first buffer', () => {
    const buf = [span('s1', 10), span('s2', 20)];
    const next = appendLiveEvents(buf, [span('s3', 30)]);
    expect(next.map((e) => e.timestamp)).toEqual([10, 20, 30]);
  });

  it('de-duplicates a live event already present (SSE backfill overlapping history)', () => {
    const buf = [span('s1', 10), span('s2', 20)];
    const next = appendLiveEvents(buf, [span('s2', 20)]);
    expect(next).toBe(buf); // unchanged reference — lets the view skip a re-render
  });

  it('binary-inserts a rare out-of-order delivery, keeping the buffer sorted', () => {
    const buf = [span('s1', 10), span('s3', 30)];
    const next = appendLiveEvents(buf, [span('s2', 20)]);
    expect(next.map((e) => e.timestamp)).toEqual([10, 20, 30]);
  });

  // Regression for #58: the live buffer must stay bounded no matter how many events
  // stream in over a session. Before the fix the client accumulated every event
  // (and re-sorted the whole buffer each time), so this length was 5000 → O(n²) cost
  // and a frozen page under real traffic.
  it('caps the buffer to the most recent MAX_LIVE_EVENTS under sustained traffic', () => {
    let buf: SSEEvent[] = [];
    for (let i = 0; i < 5000; i++) {
      buf = appendLiveEvents(buf, [span(`s${i}`, i)]);
      expect(buf.length).toBeLessThanOrEqual(MAX_LIVE_EVENTS);
    }
    expect(buf).toHaveLength(MAX_LIVE_EVENTS);
    // It keeps the newest window and stays oldest-first.
    expect(buf[0].timestamp).toBe(5000 - MAX_LIVE_EVENTS);
    expect(buf[buf.length - 1].timestamp).toBe(4999);
    for (let i = 1; i < buf.length; i++) {
      expect(buf[i].timestamp).toBeGreaterThanOrEqual(buf[i - 1].timestamp);
    }
  });

  it('honours a custom cap and drops the oldest events first', () => {
    let buf: SSEEvent[] = [];
    for (let i = 0; i < 10; i++) buf = appendLiveEvents(buf, [span(`s${i}`, i)], 3);
    expect(buf.map((e) => e.timestamp)).toEqual([7, 8, 9]);
  });

  it('returns the same buffer when there is nothing to append', () => {
    const buf = [span('s1', 10)];
    expect(appendLiveEvents(buf, [])).toBe(buf);
  });
});

// Regression for #71: logs "randomly clear" while spans/traces persist.
// Root cause — the live buffer was a SINGLE shared cap across both event types.
// Console logs are far higher-volume than spans, so a log flood pushed the shared
// window forward and evicted the *other* type; symmetrically a span burst could
// evict logs. The cap must be PER TYPE so one stream's volume can never clear the
// other's entries, while each stays bounded (the #58 freeze fix must survive).
describe('appendLiveEvents — per-type budgets (#71)', () => {
  it('does not evict spans when a flood of logs streams in', () => {
    let buf: SSEEvent[] = [];
    // Sparse spans first…
    for (let i = 0; i < 50; i++) buf = appendLiveEvents(buf, [span(`sp${i}`, i)]);
    // …then a flood of newer logs, far exceeding the buffer cap.
    for (let i = 0; i < 3000; i++) buf = appendLiveEvents(buf, [log(1000 + i, `m${i}`)]);

    const spans = buf.filter((e) => e.type === 'span');
    const logs = buf.filter((e) => e.type === 'log');
    expect(spans).toHaveLength(50); // every span survives the log flood
    expect(logs.length).toBeLessThanOrEqual(MAX_LIVE_EVENTS); // logs stay bounded
  });

  it('does not evict logs when a burst of spans streams in', () => {
    let buf: SSEEvent[] = [];
    for (let i = 0; i < 50; i++) buf = appendLiveEvents(buf, [log(i, `m${i}`)]);
    for (let i = 0; i < 3000; i++) buf = appendLiveEvents(buf, [span(`sp${i}`, 1000 + i)]);

    const logs = buf.filter((e) => e.type === 'log');
    const spans = buf.filter((e) => e.type === 'span');
    expect(logs).toHaveLength(50); // every log survives the span burst
    expect(spans.length).toBeLessThanOrEqual(MAX_LIVE_EVENTS);
  });

  it('keeps logs that fit their own budget even when spans share the buffer', () => {
    // 1500 logs + 500 spans = 2000 events. Both are individually under budget, but
    // the old single shared cap (2000) would evict the oldest as soon as newer
    // events arrived because spans occupied slots. Per-type budgets keep both.
    let buf: SSEEvent[] = [];
    let ts = 0;
    for (let i = 0; i < 1500; i++) {
      buf = appendLiveEvents(buf, [log(ts++, `log${i}`)]);
      if (i % 3 === 0) buf = appendLiveEvents(buf, [span(`sp${i}`, ts++)]);
    }
    // Push one more newer log to force an eviction decision on a full-ish buffer.
    buf = appendLiveEvents(buf, [log(ts++, 'log-final')]);
    const logs = buf.filter((e) => e.type === 'log');
    const spans = buf.filter((e) => e.type === 'span');
    expect(logs).toHaveLength(1501); // no log cleared by the presence of spans
    expect(spans).toHaveLength(500);
  });

  it('bounds EACH type under sustained mixed traffic (preserves the #58 cap)', () => {
    let buf: SSEEvent[] = [];
    let ts = 0;
    for (let i = 0; i < 2500; i++) {
      buf = appendLiveEvents(buf, [log(ts++, `log${i}`)]);
      buf = appendLiveEvents(buf, [span(`sp${i}`, ts++)]);
    }
    const logs = buf.filter((e) => e.type === 'log');
    const spans = buf.filter((e) => e.type === 'span');
    expect(logs.length).toBeLessThanOrEqual(MAX_LIVE_EVENTS);
    expect(spans.length).toBeLessThanOrEqual(MAX_LIVE_EVENTS);
    // Total is bounded (no unbounded growth → no O(n²) / freeze regression).
    expect(buf.length).toBeLessThanOrEqual(2 * MAX_LIVE_EVENTS);
    // …and the buffer stays oldest-first.
    for (let i = 1; i < buf.length; i++) {
      expect(buf[i].timestamp).toBeGreaterThanOrEqual(buf[i - 1].timestamp);
    }
  });
});

describe('oldestTimestamp', () => {
  it('returns the minimum timestamp for load-older paging', () => {
    expect(oldestTimestamp([span('s1', 30), span('s2', 10), span('s3', 20)])).toBe(10);
  });

  it('returns undefined for an empty list', () => {
    expect(oldestTimestamp([])).toBeUndefined();
  });
});
