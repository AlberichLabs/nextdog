import { describe, expect, it } from 'vitest';
import { matchesQuery } from '../../hooks/use-events';
import type { SSEEvent } from '../../hooks/use-sse';
import { tokenFor } from '../filter-query';
import { deriveFacets } from '../facets';

/** Build a span event with the given overrides. */
function span(data: Partial<SSEEvent['data']> & { serviceName: string }): SSEEvent {
  return {
    type: 'span',
    timestamp: Date.now(),
    data: { name: 'span', attributes: {}, ...data },
  };
}

function log(data: Partial<SSEEvent['data']> & { serviceName: string }): SSEEvent {
  return {
    type: 'log',
    timestamp: Date.now(),
    data: { name: 'log', attributes: {}, ...data },
  };
}

/** Find a facet by key, asserting it exists. */
function facet(facets: ReturnType<typeof deriveFacets>, key: string) {
  const f = facets.find((x) => x.key === key);
  if (!f) throw new Error(`facet ${key} not found in [${facets.map((x) => x.key).join(', ')}]`);
  return f;
}

describe('deriveFacets — named facets', () => {
  it('counts service values, sorted by count descending', () => {
    const events = [
      span({ serviceName: 'web' }),
      span({ serviceName: 'web' }),
      span({ serviceName: 'api' }),
    ];
    const f = facet(deriveFacets(events), 'service');
    expect(f.values).toEqual([
      { value: 'web', count: 2 },
      { value: 'api', count: 1 },
    ]);
  });

  it('method facet reads http.method or http.request.method', () => {
    const events = [
      span({ serviceName: 'web', attributes: { 'http.method': 'GET' } }),
      span({ serviceName: 'web', attributes: { 'http.request.method': 'POST' } }),
      span({ serviceName: 'web', attributes: { 'http.method': 'GET' } }),
    ];
    const f = facet(deriveFacets(events), 'method');
    expect(f.values).toEqual([
      { value: 'GET', count: 2 },
      { value: 'POST', count: 1 },
    ]);
  });

  it('statusCode facet prefers statusCode then http.status_code', () => {
    const events = [
      span({ serviceName: 'web', statusCode: 200 }),
      span({ serviceName: 'web', attributes: { 'http.status_code': 404 } }),
    ];
    const f = facet(deriveFacets(events), 'statusCode');
    expect(f.values.map((v) => v.value).sort()).toEqual(['200', '404']);
  });

  it('status facet reflects OK/ERROR span status', () => {
    const events = [
      span({ serviceName: 'web', status: { code: 'OK' } }),
      span({ serviceName: 'web', status: { code: 'ERROR' } }),
      span({ serviceName: 'web', status: { code: 'ERROR' } }),
    ];
    const f = facet(deriveFacets(events), 'status');
    expect(f.values).toEqual([
      { value: 'ERROR', count: 2 },
      { value: 'OK', count: 1 },
    ]);
  });

  it('level facet appears for logs', () => {
    const events = [
      log({ serviceName: 'web', level: 'error' }),
      log({ serviceName: 'web', level: 'info' }),
    ];
    const f = facet(deriveFacets(events), 'level');
    expect(f.values.map((v) => v.value).sort()).toEqual(['error', 'info']);
  });

  it('omits a facet entirely when no event has a value for it', () => {
    const events = [span({ serviceName: 'web' })];
    const keys = deriveFacets(events).map((f) => f.key);
    expect(keys).toContain('service');
    expect(keys).not.toContain('level'); // no levels present
    expect(keys).not.toContain('method'); // no http.method present
  });
});

describe('deriveFacets — attribute facets', () => {
  it('surfaces a low-cardinality custom attribute as a facet', () => {
    const events = [
      span({ serviceName: 'web', attributes: { 'db.system': 'postgres' } }),
      span({ serviceName: 'web', attributes: { 'db.system': 'postgres' } }),
      span({ serviceName: 'web', attributes: { 'db.system': 'redis' } }),
    ];
    const f = facet(deriveFacets(events), 'db.system');
    expect(f.values).toEqual([
      { value: 'postgres', count: 2 },
      { value: 'redis', count: 1 },
    ]);
  });

  it('excludes high-cardinality and noisy/sensitive attributes', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      span({
        serviceName: 'web',
        attributes: {
          'request.id': `req-${i}`, // unique per event → high cardinality + id
          'http.request.body': `body-${i}`, // sensitive/noisy
          'auth.token': 'secret', // sensitive
        },
      }),
    );
    const keys = deriveFacets(events).map((f) => f.key);
    expect(keys).not.toContain('request.id');
    expect(keys).not.toContain('http.request.body');
    expect(keys).not.toContain('auth.token');
  });

  it('can be disabled via includeAttributes:false', () => {
    const events = [span({ serviceName: 'web', attributes: { 'db.system': 'postgres' } })];
    const keys = deriveFacets(events, { includeAttributes: false }).map((f) => f.key);
    expect(keys).not.toContain('db.system');
    expect(keys).toContain('service');
  });
});

describe('deriveFacets — token round-trip through the real matcher', () => {
  it('every derived facet value, clicked, yields a token the matcher accepts', () => {
    const events = [
      span({
        serviceName: 'web',
        kind: 'SERVER',
        status: { code: 'ERROR' },
        statusCode: 500,
        attributes: { 'http.method': 'POST', 'http.route': '/api/checkout' },
      }),
      span({
        serviceName: 'api',
        kind: 'CLIENT',
        status: { code: 'OK' },
        statusCode: 200,
        attributes: { 'http.method': 'GET', 'http.route': '/api/health' },
      }),
    ];

    const facets = deriveFacets(events);
    expect(facets.length).toBeGreaterThan(0);

    for (const f of facets) {
      for (const { value, count } of f.values) {
        const query = tokenFor(f.key, value);
        const matched = events.filter((e) => matchesQuery(e, query)).length;
        // The token must match at least as many events as the facet counted —
        // i.e. clicking a facet value never produces an empty/incorrect result.
        expect(matched).toBeGreaterThanOrEqual(count);
      }
    }
  });
});
