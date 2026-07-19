import { describe, expect, it, vi } from 'vitest';
import { SidecarClient, SidecarUnavailableError } from '../client';
import { aggregate, assertTelemetry } from '../tools';
import type { SidecarEvent } from '../types';
import { makeFetch } from './fixtures';

function span(over: Partial<SidecarEvent['data']> & { timestamp?: number } = {}): SidecarEvent {
  const { timestamp = 1000, ...data } = over;
  return {
    type: 'span',
    timestamp,
    data: { name: 'GET /', kind: 'SERVER', serviceName: 'web', attributes: {}, ...data },
  };
}

/** Two ERROR spans on /checkout, one ERROR on /login, one OK on /home. */
const FIXTURE: SidecarEvent[] = [
  span({
    timestamp: 1000,
    attributes: { 'http.route': '/checkout', 'http.status_code': 500 },
    status: { code: 'ERROR' },
  }),
  span({
    timestamp: 1100,
    attributes: { 'http.route': '/checkout', 'http.status_code': 500 },
    status: { code: 'ERROR' },
  }),
  span({
    timestamp: 1200,
    attributes: { 'http.route': '/login', 'http.status_code': 503 },
    status: { code: 'ERROR' },
  }),
  span({
    timestamp: 1300,
    attributes: { 'http.route': '/home', 'http.status_code': 200 },
    status: { code: 'OK' },
  }),
];

function client(events = FIXTURE) {
  return new SidecarClient({ fetchImpl: makeFetch(events).fetchImpl });
}

describe('aggregate', () => {
  it('groups error counts by route', async () => {
    const { groups } = await aggregate(client(), { groupBy: 'route', filter: 'status:ERROR' });
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.count]));
    expect(byKey['/checkout']).toBe(2);
    expect(byKey['/login']).toBe(1);
    expect(byKey['/home']).toBeUndefined();
  });

  it('groups all events (no filter) by status code', async () => {
    const { groups } = await aggregate(client(), { groupBy: 'statusCode' });
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.count]));
    expect(byKey['500']).toBe(2);
    expect(byKey['503']).toBe(1);
    expect(byKey['200']).toBe(1);
  });

  it('unknown groupBy field buckets everything under "(none)", not a crash', async () => {
    const { groups } = await aggregate(client(), { groupBy: 'nope_not_a_field' });
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('(none)');
    expect(groups[0].count).toBe(4);
  });

  it('withinMinutes maps to a since window', async () => {
    const now = Date.now();
    const recent = [
      span({ timestamp: now - 60_000, attributes: { 'http.route': '/fresh' } }),
      span({ timestamp: now - 10 * 60_000, attributes: { 'http.route': '/stale' } }),
    ];
    const { groups } = await aggregate(client(recent), { groupBy: 'route', withinMinutes: 5 });
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('/fresh');
    expect(keys).not.toContain('/stale');
  });

  it('sidecar-down surfaces SidecarUnavailableError', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(
      aggregate(new SidecarClient({ fetchImpl }), { groupBy: 'route' }),
    ).rejects.toBeInstanceOf(SidecarUnavailableError);
  });
});

describe('assert', () => {
  it('exists: true passes when a match is present and returns a sample', async () => {
    const res = await assertTelemetry(client(), {
      filter: 'route:/checkout status:ERROR',
      expect: { exists: true },
    });
    expect(res.pass).toBe(true);
    expect(res.actual).toBe(2);
    expect(res.sample).toBeDefined();
  });

  it('count matches the exact number', async () => {
    const res = await assertTelemetry(client(), {
      filter: 'route:/checkout status:ERROR',
      expect: { count: 2 },
    });
    expect(res.pass).toBe(true);
    expect(res.actual).toBe(2);
  });

  it('min / max bounds evaluate correctly', async () => {
    const min = await assertTelemetry(client(), { filter: 'status:ERROR', expect: { min: 3 } });
    expect(min.pass).toBe(true); // 3 errors >= 3
    const max = await assertTelemetry(client(), { filter: 'status:ERROR', expect: { max: 2 } });
    expect(max.pass).toBe(false); // 3 errors is not <= 2
  });

  it('fix-check: assert red, then (fixed telemetry) assert green', async () => {
    // Red: the 500s on /checkout are present.
    const red = await assertTelemetry(client(), {
      filter: 'route:/checkout status:ERROR',
      expect: { exists: false },
    });
    expect(red.pass).toBe(false);
    expect(red.actual).toBe(2);

    // Green: after the fix, telemetry no longer has /checkout errors.
    const fixed = FIXTURE.filter((e) => e.data.attributes['http.route'] !== '/checkout');
    const green = await assertTelemetry(client(fixed), {
      filter: 'route:/checkout status:ERROR',
      expect: { exists: false },
    });
    expect(green.pass).toBe(true);
    expect(green.actual).toBe(0);
  });

  it('the returned sample is redacted (reads via loadEvents, #60)', async () => {
    const secret = span({
      timestamp: 2000,
      status: { code: 'ERROR' },
      attributes: { 'http.route': '/checkout', 'http.request.header.authorization': 'Bearer leak' },
    });
    const res = await assertTelemetry(client([secret]), {
      filter: 'route:/checkout',
      expect: { exists: true },
    });
    expect(res.sample).toBeDefined();
    expect(res.sample?.data.attributes['http.request.header.authorization']).toBeUndefined();
  });

  it('sidecar-down surfaces SidecarUnavailableError', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(
      assertTelemetry(new SidecarClient({ fetchImpl }), {
        filter: 'status:ERROR',
        expect: { exists: true },
      }),
    ).rejects.toBeInstanceOf(SidecarUnavailableError);
  });
});
