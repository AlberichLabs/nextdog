import { describe, expect, it } from 'vitest';
import { SidecarClient } from '../client';
import {
  isSensitiveAttribute,
  redactAttributes,
  redactEvents,
  SENSITIVE_HEADERS,
} from '../redact';
import { getTrace, searchLogs } from '../tools';
import type { SidecarEvent } from '../types';
import { makeFetch } from './fixtures';

// Canonical set from @nextdog/node (packages/node/src/sensitive-headers.ts),
// also mirrored in @nextdog/ui's redact.ts. Kept in lockstep; pinned below.
const CANONICAL = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'set-cookie2',
];

const TRACE_AUTH = 'trace-auth-9001';

const authSpan: SidecarEvent = {
  type: 'span',
  timestamp: 9000,
  data: {
    traceId: TRACE_AUTH,
    spanId: 'auth-root',
    name: 'PUT /api/questions/123',
    kind: 'SERVER',
    startTimeUnixNano: '9000000000n',
    endTimeUnixNano: '9001000000n',
    serviceName: 'app',
    status: { code: 'OK' },
    statusCode: 200,
    attributes: {
      'http.route': '/api/questions/123',
      'http.method': 'PUT',
      'http.status_code': 200,
      'http.request.header.content-type': 'application/json',
      'http.request.header.authorization': 'Bearer s3cret-token',
      'http.request.header.x-api-key': 'key-123',
      'http.request.header.cookie': 'sid=SECRET_SESSION',
      'http.request.cookies': 'sid=SECRET_SESSION',
      'http.response.header.set-cookie': 'sid=NEW_SECRET; HttpOnly',
    },
  },
};

const authLog: SidecarEvent = {
  type: 'log',
  timestamp: 9005,
  data: {
    traceId: TRACE_AUTH,
    spanId: 'auth-root',
    level: 'info',
    message: 'authed request',
    serviceName: 'app',
    attributes: { 'http.request.header.authorization': 'Bearer s3cret-token' },
  },
};

function client(events: SidecarEvent[]) {
  return new SidecarClient({ fetchImpl: makeFetch(events).fetchImpl });
}

describe('egress redactor (#60)', () => {
  it('SENSITIVE_HEADERS matches the canonical @nextdog/node set (parity)', () => {
    expect([...SENSITIVE_HEADERS].sort()).toEqual([...CANONICAL].sort());
  });

  it('flags credential header + cookie attributes, keeps the rest', () => {
    expect(isSensitiveAttribute('http.request.header.authorization')).toBe(true);
    expect(isSensitiveAttribute('http.request.header.x-api-key')).toBe(true);
    expect(isSensitiveAttribute('http.response.header.set-cookie')).toBe(true);
    expect(isSensitiveAttribute('http.request.cookies')).toBe(true);
    expect(isSensitiveAttribute('http.request.header.content-type')).toBe(false);
    expect(isSensitiveAttribute('http.method')).toBe(false);
  });

  it('redactEvents strips credentials without mutating the source', () => {
    const events = [authSpan];
    const out = redactEvents(events);
    expect(out[0].data.attributes['http.request.header.authorization']).toBeUndefined();
    expect(out[0].data.attributes['http.request.header.content-type']).toBe('application/json');
    // Source event untouched.
    expect(authSpan.data.attributes['http.request.header.authorization']).toBe('Bearer s3cret-token');
  });

  it('redactAttributes drops every sensitive key', () => {
    const out = redactAttributes(authSpan.data.attributes);
    for (const key of [
      'http.request.header.authorization',
      'http.request.header.x-api-key',
      'http.request.header.cookie',
      'http.request.cookies',
      'http.response.header.set-cookie',
    ]) {
      expect(out[key]).toBeUndefined();
    }
  });

  it('get_trace tool output contains no captured token (the #60 invariant)', async () => {
    const res = await getTrace(client([authSpan, authLog]), { traceId: TRACE_AUTH });
    const json = JSON.stringify(res);
    expect(json).not.toContain('s3cret-token');
    expect(json).not.toContain('key-123');
    expect(json).not.toContain('SECRET_SESSION');
    expect(json).not.toContain('NEW_SECRET');
    // The trace is still surfaced — just without credentials.
    expect(json).toContain('PUT /api/questions/123');
  });

  it('search_logs tool output contains no captured token', async () => {
    const res = await searchLogs(client([authSpan, authLog]), {
      filter: 'authed',
      includeSpans: true,
    });
    expect(JSON.stringify(res)).not.toContain('s3cret-token');
  });
});
