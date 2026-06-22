import { describe, expect, it } from 'vitest';
import { eventKey, mergeEvents, oldestTimestamp } from '../events-history.js';
import type { SSEEvent } from '../use-sse.js';

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

describe('oldestTimestamp', () => {
  it('returns the minimum timestamp for load-older paging', () => {
    expect(oldestTimestamp([span('s1', 30), span('s2', 10), span('s3', 20)])).toBe(10);
  });

  it('returns undefined for an empty list', () => {
    expect(oldestTimestamp([])).toBeUndefined();
  });
});
