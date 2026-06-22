import { describe, it, expect, vi } from 'vitest';
import { SidecarClient, SidecarUnavailableError } from '../client.js';
import { makeFetch } from './fixtures.js';

describe('SidecarClient', () => {
  it('queries /api/events with the correct query params and base url', async () => {
    const { fetchImpl, calls } = makeFetch();
    const client = new SidecarClient({ baseUrl: 'http://localhost:6789', fetchImpl });

    await client.events({ type: 'span', service: 'web', traceId: 't1', since: 100, last: 10 });

    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]);
    expect(u.origin).toBe('http://localhost:6789');
    expect(u.pathname).toBe('/api/events');
    expect(u.searchParams.get('type')).toBe('span');
    expect(u.searchParams.get('service')).toBe('web');
    expect(u.searchParams.get('traceId')).toBe('t1');
    expect(u.searchParams.get('since')).toBe('100');
    expect(u.searchParams.get('last')).toBe('10');
  });

  it('strips a trailing slash from the base url', async () => {
    const { fetchImpl, calls } = makeFetch();
    const client = new SidecarClient({ baseUrl: 'http://localhost:6789/', fetchImpl });
    await client.services();
    expect(calls[0]).toBe('http://localhost:6789/api/services');
  });

  it('returns the events array', async () => {
    const { fetchImpl } = makeFetch();
    const client = new SidecarClient({ fetchImpl });
    const events = await client.events();
    expect(events.length).toBeGreaterThan(0);
  });

  it('reports healthy when /health answers 2xx', async () => {
    const { fetchImpl } = makeFetch();
    const client = new SidecarClient({ fetchImpl });
    await expect(client.isHealthy()).resolves.toBe(true);
  });

  it('throws SidecarUnavailableError when fetch rejects (sidecar down)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const client = new SidecarClient({ baseUrl: 'http://localhost:6789', fetchImpl });
    await expect(client.events()).rejects.toBeInstanceOf(SidecarUnavailableError);
    await expect(client.isHealthy()).resolves.toBe(false);
  });

  it('throws SidecarUnavailableError on a non-2xx response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
    const client = new SidecarClient({ fetchImpl });
    await expect(client.events()).rejects.toBeInstanceOf(SidecarUnavailableError);
  });

  it('includes the base url and guidance in the error message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
    const client = new SidecarClient({ baseUrl: 'http://localhost:6789', fetchImpl });
    await expect(client.events()).rejects.toThrow(/localhost:6789/);
    await expect(client.events()).rejects.toThrow(/dev server is running/);
  });
});
