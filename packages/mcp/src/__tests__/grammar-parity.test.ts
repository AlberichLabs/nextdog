import { describe, expect, it } from 'vitest';
import { groupFilterTokens } from '../filter-query';
import { matchesQuery } from '../matcher';
import type { SidecarEvent } from '../types';
import { ALL_EVENTS, spanWebOk } from './fixtures';

/**
 * These assertions pin the ported grammar to the canonical UI semantics
 * (packages/ui/src/utils/filter-query.ts + packages/ui/src/hooks/use-events.ts):
 *   - groups are AND'd, tokens within a group are OR'd
 *   - `!`/`-` negate
 *   - facet keys and their `===` vs `includes` semantics match the UI matcher
 * If the UI grammar changes, update the port and these tests together.
 */

function run(query: string) {
  return ALL_EVENTS.filter((e) => matchesQuery(e, query));
}

describe('grammar grouping parity', () => {
  it('OR binds adjacent tokens into one group', () => {
    expect(groupFilterTokens('a OR b c')).toEqual([
      [
        expect.objectContaining({ value: 'a', operator: 'AND' }),
        expect.objectContaining({ value: 'b', operator: 'OR' }),
      ],
      [expect.objectContaining({ value: 'c', operator: 'AND' })],
    ]);
  });

  it('a leading OR starts a fresh group rather than matching nothing', () => {
    expect(groupFilterTokens('OR a')).toEqual([[expect.objectContaining({ value: 'a' })]]);
  });
});

describe('matcher parity', () => {
  it('empty query matches everything', () => {
    expect(run('').length).toBe(ALL_EVENTS.length);
  });

  it('level:error is an exact, case-insensitive facet match', () => {
    expect(run('level:ERROR').map((e) => e.data.message)).toEqual([
      'checkout failed: card declined',
    ]);
  });

  it('route: is a substring facet match', () => {
    const ids = run('route:/api').map((e) => e.data.spanId);
    expect(ids).toContain('web-ok-root');
    expect(ids).toContain('web-checkout-root');
  });

  it('AND across groups narrows', () => {
    // service:web AND level:error -> only the web error log
    const r = run('service:web level:error');
    expect(r.map((e) => e.data.message)).toEqual(['checkout failed: card declined']);
  });

  it('OR within a group widens', () => {
    const r = run('level:error OR level:warn');
    expect(r.map((e) => e.data.message).sort()).toEqual([
      'checkout failed: card declined',
      'retrying charge',
    ]);
  });

  it('negation excludes', () => {
    const r = run('!service:payments');
    expect(r.every((e) => e.data.serviceName !== 'payments')).toBe(true);
  });

  it('free text searches across name/message/attributes', () => {
    const r = run('declined');
    const subjects = r.map((e) => e.data.message ?? e.data.name);
    expect(subjects).toContain('checkout failed: card declined');
    expect(subjects).toContain('charge'); // matched via exception.stacktrace attribute
  });

  it('status:ERROR matches spans by status code field', () => {
    const r = run('status:ERROR');
    expect(r.map((e) => e.data.spanId).sort()).toEqual(
      ['payments-charge', 'web-checkout-root'].sort(),
    );
  });
});

describe('HTTP-intuitive facets (#52)', () => {
  it('method:GET matches the GET span (was a silent dead-end)', () => {
    const r = run('method:GET');
    expect(r.map((e) => e.data.spanId)).toEqual(['web-ok-root']);
  });

  it('method:POST matches the POST span, case-insensitively', () => {
    expect(run('method:post').map((e) => e.data.spanId)).toEqual(['web-checkout-root']);
  });

  it('statusCode:NNN matches by HTTP status code', () => {
    expect(run('statusCode:200').map((e) => e.data.spanId)).toEqual(['web-ok-root']);
    expect(run('statusCode:500').map((e) => e.data.spanId)).toEqual(['web-checkout-root']);
  });

  it('numeric status:NNN aliases to the HTTP status code (was a silent dead-end)', () => {
    // `status:404`/`status:200` clearly mean the HTTP code — not the span OK/ERROR
    // status — so they must resolve rather than return nothing.
    expect(run('status:200').map((e) => e.data.spanId)).toEqual(['web-ok-root']);
    expect(run('status:500').map((e) => e.data.spanId)).toEqual(['web-checkout-root']);
  });

  it('non-numeric status: keeps the original span OK/ERROR semantics', () => {
    expect(run('status:OK').map((e) => e.data.spanId)).toEqual(['web-ok-root']);
    expect(run('status:ERROR').map((e) => e.data.spanId).sort()).toEqual(
      ['payments-charge', 'web-checkout-root'].sort(),
    );
  });

  it('status:404 / statusCode:404 resolve against a 404 event and reject a 200 one', () => {
    const span404: SidecarEvent = {
      type: 'span',
      timestamp: 3000,
      data: {
        traceId: 'trace-404',
        spanId: 'web-missing-root',
        name: 'GET /api/missing',
        kind: 'SERVER',
        serviceName: 'web',
        statusCode: 404,
        attributes: { 'http.route': '/api/missing', 'http.method': 'GET', 'http.status_code': 404 },
      },
    };
    expect(matchesQuery(span404, 'status:404')).toBe(true);
    expect(matchesQuery(span404, 'statusCode:404')).toBe(true);
    expect(matchesQuery(spanWebOk, 'status:404')).toBe(false);
    expect(matchesQuery(spanWebOk, 'statusCode:404')).toBe(false);
  });

  it('reads statusCode from http.response.status_code when present', () => {
    const span: SidecarEvent = {
      type: 'span',
      timestamp: 3100,
      data: {
        spanId: 'resp-code',
        name: 'GET /x',
        serviceName: 'web',
        attributes: { 'http.response.status_code': 418 },
      },
    };
    expect(matchesQuery(span, 'statusCode:418')).toBe(true);
    expect(matchesQuery(span, 'status:418')).toBe(true);
  });
});
