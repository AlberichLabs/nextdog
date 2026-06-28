import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../use-sse';
import { matchesQuery } from '../use-events';

/**
 * Pins the canonical UI matcher (use-events.ts) — the source of truth that the
 * MCP matcher is ported from. The HTTP-intuitive facets (#52) must resolve here
 * exactly as the dashboard search bar promises: `method:GET`, `statusCode:404`,
 * and the numeric `status:404` alias all match real HTTP data instead of being
 * silent dead-ends.
 */

function span(data: Partial<SSEEvent['data']>): SSEEvent {
  return {
    type: 'span',
    timestamp: 1,
    data: {
      name: 'GET /x',
      serviceName: 'web',
      attributes: {},
      ...data,
    },
  };
}

const getOk = span({
  spanId: 'get-ok',
  statusCode: 200,
  status: { code: 'OK' },
  attributes: { 'http.method': 'GET', 'http.route': '/api/health', 'http.status_code': 200 },
});

const postErr = span({
  spanId: 'post-err',
  statusCode: 500,
  status: { code: 'ERROR' },
  attributes: { 'http.method': 'POST', 'http.route': '/api/checkout', 'http.status_code': 500 },
});

const missing404 = span({
  spanId: 'missing-404',
  statusCode: 404,
  attributes: { 'http.method': 'GET', 'http.route': '/api/missing', 'http.status_code': 404 },
});

describe('matchesQuery — HTTP-intuitive facets (#52)', () => {
  it('method:GET matches GET, not POST (case-insensitive)', () => {
    expect(matchesQuery(getOk, 'method:GET')).toBe(true);
    expect(matchesQuery(getOk, 'method:get')).toBe(true);
    expect(matchesQuery(postErr, 'method:GET')).toBe(false);
  });

  it('statusCode:NNN matches the HTTP status code', () => {
    expect(matchesQuery(getOk, 'statusCode:200')).toBe(true);
    expect(matchesQuery(missing404, 'statusCode:404')).toBe(true);
    expect(matchesQuery(getOk, 'statusCode:404')).toBe(false);
  });

  it('numeric status:NNN aliases to the HTTP status code', () => {
    expect(matchesQuery(missing404, 'status:404')).toBe(true);
    expect(matchesQuery(getOk, 'status:200')).toBe(true);
    expect(matchesQuery(getOk, 'status:404')).toBe(false);
  });

  it('non-numeric status: keeps the span OK/ERROR semantics', () => {
    expect(matchesQuery(getOk, 'status:OK')).toBe(true);
    expect(matchesQuery(postErr, 'status:ERROR')).toBe(true);
    expect(matchesQuery(getOk, 'status:ERROR')).toBe(false);
  });

  it('reads statusCode from http.response.status_code when present', () => {
    const teapot = span({ attributes: { 'http.response.status_code': 418 } });
    expect(matchesQuery(teapot, 'statusCode:418')).toBe(true);
    expect(matchesQuery(teapot, 'status:418')).toBe(true);
  });
});
