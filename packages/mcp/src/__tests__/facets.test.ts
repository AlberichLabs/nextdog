import { describe, expect, it } from 'vitest';
import { deriveFacets } from '../facets';
import type { SidecarEvent } from '../types';

/**
 * Parity fixtures for the MCP-local mirror of `@nextdog/ui`'s `deriveFacets`
 * (`packages/ui/src/utils/facets.ts`). The critical behaviour to pin is the
 * sensitive / high-cardinality attribute DENY-LIST (`ATTR_DENY_SEGMENT`) — the
 * MCP introspection tool must not become a credential-leak side channel (#60/#90).
 */
function span(attributes: Record<string, unknown>, serviceName = 'web'): SidecarEvent {
  return {
    type: 'span',
    timestamp: 1000,
    data: {
      serviceName,
      name: 'GET /x',
      status: { code: 'OK' },
      statusCode: 200,
      attributes: { 'http.method': 'GET', 'http.route': '/x', ...attributes },
    },
  };
}

describe('deriveFacets (MCP mirror of @nextdog/ui, #90)', () => {
  it('derives named facets with observed values and counts', () => {
    const facets = deriveFacets([
      span({}, 'web'),
      span({}, 'web'),
      span({}, 'payments'),
    ]);
    const service = facets.find((f) => f.key === 'service');
    expect(service?.values).toEqual([
      { value: 'web', count: 2 },
      { value: 'payments', count: 1 },
    ]);
    const method = facets.find((f) => f.key === 'method');
    expect(method?.values).toEqual([{ value: 'GET', count: 3 }]);
  });

  it('surfaces a bounded common attribute as a facet', () => {
    const facets = deriveFacets([span({ 'feature.flag': 'on' }), span({ 'feature.flag': 'off' })]);
    const flag = facets.find((f) => f.key === 'feature.flag');
    expect(flag?.values.map((v) => v.value).sort()).toEqual(['off', 'on']);
  });

  it('DENIES sensitive-by-name attributes (token/password/secret/…) from facets', () => {
    const facets = deriveFacets([
      span({ api_token: 'sk_live_leak', password: 'hunter2', session_secret: 'zzz' }),
    ]);
    const keys = facets.map((f) => f.key);
    expect(keys).not.toContain('api_token');
    expect(keys).not.toContain('password');
    expect(keys).not.toContain('session_secret');
    // And no denied value leaks into any facet.
    expect(JSON.stringify(facets)).not.toContain('sk_live_leak');
    expect(JSON.stringify(facets)).not.toContain('hunter2');
  });

  it('DENIES high-cardinality/noisy segments (id, body, header, url, …)', () => {
    const facets = deriveFacets([span({ user_id: '1', 'response.body': 'x', request_url: '/a' })]);
    const keys = facets.map((f) => f.key);
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('response.body');
    expect(keys).not.toContain('request_url');
  });

  it('drops an attribute facet whose distinct-value cardinality is too high', () => {
    const events = Array.from({ length: 25 }, (_, i) => span({ variant: `v${i}` }));
    const facets = deriveFacets(events);
    expect(facets.find((f) => f.key === 'variant')).toBeUndefined();
  });
});
