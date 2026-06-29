import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse';
import { serializeExport } from '../trace-export';
import {
  isSensitiveAttribute,
  redactAttributes,
  redactEventsForExport,
  SENSITIVE_HEADERS,
} from '../redact';

// Canonical set from @nextdog/node (packages/node/src/sensitive-headers.ts).
// This copy must stay in lockstep; the parity test below pins it.
const CANONICAL = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'set-cookie2',
];

function authSpan(): SSEEvent {
  return {
    type: 'span',
    timestamp: 1,
    data: {
      name: 'PUT /api/questions/123',
      serviceName: 'app',
      attributes: {
        'http.method': 'PUT',
        'http.request.header.content-type': 'application/json',
        'http.request.header.authorization': 'Bearer s3cret-token',
        'http.request.header.x-api-key': 'key-123',
        'http.request.header.cookie': 'sid=SECRET_SESSION',
        'http.request.cookies': 'sid=SECRET_SESSION',
        'http.response.header.set-cookie': 'sid=NEW_SECRET; HttpOnly',
        'http.response.header.x-safe': 'visible',
      },
    },
  };
}

describe('egress redactor (#60)', () => {
  it('SENSITIVE_HEADERS matches the canonical @nextdog/node set (parity)', () => {
    expect([...SENSITIVE_HEADERS].sort()).toEqual([...CANONICAL].sort());
  });

  it('flags credential header + cookie attributes, keeps the rest', () => {
    expect(isSensitiveAttribute('http.request.header.authorization')).toBe(true);
    expect(isSensitiveAttribute('http.request.header.x-api-key')).toBe(true);
    expect(isSensitiveAttribute('http.request.header.cookie')).toBe(true);
    expect(isSensitiveAttribute('http.response.header.set-cookie')).toBe(true);
    expect(isSensitiveAttribute('http.request.cookies')).toBe(true);
    expect(isSensitiveAttribute('http.request.header.content-type')).toBe(false);
    expect(isSensitiveAttribute('http.response.header.x-safe')).toBe(false);
    expect(isSensitiveAttribute('http.method')).toBe(false);
  });

  it('redactAttributes strips credentials without mutating the input', () => {
    const attrs = authSpan().data.attributes;
    const out = redactAttributes(attrs);
    expect(out['http.request.header.authorization']).toBeUndefined();
    expect(out['http.request.header.x-api-key']).toBeUndefined();
    expect(out['http.request.header.cookie']).toBeUndefined();
    expect(out['http.request.cookies']).toBeUndefined();
    expect(out['http.response.header.set-cookie']).toBeUndefined();
    // Non-sensitive attributes survive.
    expect(out['http.request.header.content-type']).toBe('application/json');
    expect(out['http.response.header.x-safe']).toBe('visible');
    // Original (live UI state) is untouched.
    expect(attrs['http.request.header.authorization']).toBe('Bearer s3cret-token');
  });

  it('export output contains no captured token (the #60 invariant)', () => {
    const blob = serializeExport([authSpan()], { kind: 'trace', traceId: 't1' });
    expect(blob).not.toContain('s3cret-token');
    expect(blob).not.toContain('key-123');
    expect(blob).not.toContain('SECRET_SESSION');
    expect(blob).not.toContain('NEW_SECRET');
    // The trace is still exported — just without the credentials.
    expect(blob).toContain('PUT /api/questions/123');
  });

  it('redactEventsForExport leaves the live events untouched', () => {
    const events = [authSpan()];
    redactEventsForExport(events);
    expect(events[0].data.attributes['http.request.header.authorization']).toBe(
      'Bearer s3cret-token',
    );
  });
});
