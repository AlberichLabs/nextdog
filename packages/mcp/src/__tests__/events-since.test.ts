import { describe, expect, it, vi } from 'vitest';
import { SidecarClient, SidecarUnavailableError } from '../client';
import { eventsSince, waitForEvent } from '../tools';
import type { SidecarEvent } from '../types';
import { makeFetch } from './fixtures';

function ev(timestamp: number, over: Partial<SidecarEvent['data']> = {}): SidecarEvent {
  return {
    type: 'log',
    timestamp,
    data: { level: 'info', message: `m${timestamp}`, serviceName: 'web', attributes: {}, ...over },
  };
}

function client(events?: SidecarEvent[]) {
  return new SidecarClient({ fetchImpl: makeFetch(events).fetchImpl });
}

describe('events_since', () => {
  it('returns only events newer than the cursor', async () => {
    const events = [ev(100), ev(200), ev(300)];
    const { events: out } = await eventsSince(client(events), { cursor: 150 });
    expect(out.map((e) => e.timestamp)).toEqual([200, 300]);
  });

  it('nextCursor is the max timestamp seen (monotonic)', async () => {
    const events = [ev(100), ev(200), ev(300)];
    const { nextCursor } = await eventsSince(client(events), {});
    expect(nextCursor).toBe(300);
  });

  it('empty result returns the input cursor unchanged (no regression)', async () => {
    const events = [ev(100), ev(200)];
    const { events: out, nextCursor } = await eventsSince(client(events), { cursor: 500 });
    expect(out).toHaveLength(0);
    expect(nextCursor).toBe(500);
  });

  it('chaining two calls yields no gap and no duplicate', async () => {
    const events = [ev(100), ev(200), ev(300), ev(400)];
    const first = await eventsSince(client(events), { cursor: 0 });
    const second = await eventsSince(client(events), { cursor: first.nextCursor });
    const firstIds = first.events.map((e) => e.timestamp);
    const secondIds = second.events.map((e) => e.timestamp);
    // Every event appears exactly once across the two pages.
    expect([...firstIds, ...secondIds].sort()).toEqual([100, 200, 300, 400]);
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it('applies the filter grammar (same as search_logs)', async () => {
    const events = [ev(100, { level: 'error' }), ev(200, { level: 'info' })];
    const { events: out } = await eventsSince(client(events), { filter: 'level:error' });
    expect(out.map((e) => e.timestamp)).toEqual([100]);
  });

  it('advances nextCursor past non-matching events so chaining does not stall', async () => {
    // Only ts=200 matches, but nextCursor must still advance to 300 (max seen)
    // so a follow-up call does not re-scan the non-matching tail.
    const events = [ev(100, { level: 'info' }), ev(200, { level: 'error' }), ev(300, { level: 'info' })];
    const { nextCursor } = await eventsSince(client(events), { filter: 'level:error' });
    expect(nextCursor).toBe(300);
  });

  it('redacts credential headers (reads via loadEvents → redactEvents, #60)', async () => {
    const secret = ev(100, { attributes: { 'http.request.header.authorization': 'Bearer leak' } });
    const { events: out } = await eventsSince(client([secret]), {});
    expect(out[0].data.attributes['http.request.header.authorization']).toBeUndefined();
  });

  it('sidecar-down surfaces SidecarUnavailableError', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(
      eventsSince(new SidecarClient({ fetchImpl }), {}),
    ).rejects.toBeInstanceOf(SidecarUnavailableError);
  });
});

describe('wait_for_event', () => {
  it('resolves immediately when a matching event is already present', async () => {
    const events = [ev(100, { level: 'error', message: 'boom' })];
    const res = await waitForEvent(client(events), { predicate: 'level:error', cursor: 0 });
    expect(res.matched).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(res.events.map((e) => e.timestamp)).toEqual([100]);
  });

  it('resolves when a matching event lands mid-wait', async () => {
    // A stateful fetch: the matching event only appears from the 3rd poll on.
    let polls = 0;
    const base = [ev(100, { level: 'info' })];
    const fetchImpl = (async (input: string | URL) => {
      const u = new URL(typeof input === 'string' ? input : input.toString());
      if (u.pathname === '/api/events') {
        polls += 1;
        const since = u.searchParams.get('since');
        const all = polls >= 3 ? [...base, ev(500, { level: 'error', message: 'late' })] : base;
        const out = since ? all.filter((e) => e.timestamp > Number(since)) : all;
        return { ok: true, status: 200, json: () => Promise.resolve({ events: out }) } as Response;
      }
      return { ok: true, status: 200, json: () => Promise.resolve({ events: [] }) } as Response;
    }) as unknown as typeof fetch;

    const res = await waitForEvent(new SidecarClient({ fetchImpl }), {
      predicate: 'level:error',
      cursor: 0,
      timeoutMs: 2000,
      pollIntervalMs: 5,
    });
    expect(res.matched).toBe(true);
    expect(res.events.map((e) => e.data.message)).toEqual(['late']);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('returns a clean timeout result when nothing matches within timeoutMs', async () => {
    const events = [ev(100, { level: 'info' })];
    const start = Date.now();
    const res = await waitForEvent(client(events), {
      predicate: 'level:error',
      cursor: 0,
      timeoutMs: 60,
      pollIntervalMs: 5,
    });
    expect(res.matched).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.events).toHaveLength(0);
    // Bounded: it did not run away past the timeout.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('caps an absurd timeoutMs (bounded loop, no runaway)', async () => {
    const events = [ev(100, { level: 'error' })];
    // A huge timeout must be accepted but capped; with a matching event present
    // it still resolves immediately.
    const res = await waitForEvent(client(events), {
      predicate: 'level:error',
      timeoutMs: 999_999_999,
      pollIntervalMs: 5,
    });
    expect(res.matched).toBe(true);
  });

  it('sidecar-down surfaces SidecarUnavailableError', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(
      waitForEvent(new SidecarClient({ fetchImpl }), { predicate: 'level:error', timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(SidecarUnavailableError);
  });
});
