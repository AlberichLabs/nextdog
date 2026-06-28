import { describe, expect, it } from 'vitest';
import type { LogEntry, NextDogEvent, Span } from '../types';

describe('types', () => {
  it('Span type has required OTel fields', () => {
    const span: Span = {
      traceId: 'abc123',
      spanId: 'def456',
      parentSpanId: undefined,
      name: 'GET /api/users',
      kind: 'SERVER',
      startTimeUnixNano: 1711000000000000000n,
      endTimeUnixNano: 1711000000050000000n,
      attributes: { 'http.method': 'GET', 'http.route': '/api/users' },
      status: { code: 'OK' },
      serviceName: 'my-app',
    };
    expect(span.traceId).toBe('abc123');
    expect(span.serviceName).toBe('my-app');
  });

  it('LogEntry type has required fields', () => {
    const log: LogEntry = {
      timestamp: 1711000000000,
      level: 'info',
      message: 'Request received',
      attributes: { userId: '123' },
      traceId: 'abc123',
      spanId: 'def456',
      serviceName: 'my-app',
    };
    expect(log.level).toBe('info');
    expect(log.traceId).toBe('abc123');
  });

  it('NextDogEvent discriminated union works', () => {
    const spanEvent: NextDogEvent = {
      type: 'span',
      timestamp: 1711000000000,
      data: {
        traceId: 'abc123',
        spanId: 'def456',
        parentSpanId: undefined,
        name: 'GET /api/users',
        kind: 'SERVER',
        startTimeUnixNano: 1711000000000000000n,
        endTimeUnixNano: 1711000000050000000n,
        attributes: {},
        status: { code: 'OK' },
        serviceName: 'my-app',
      },
    };
    expect(spanEvent.type).toBe('span');

    const logEvent: NextDogEvent = {
      type: 'log',
      timestamp: 1711000000000,
      data: {
        timestamp: 1711000000000,
        level: 'error',
        message: 'Something broke',
        attributes: {},
        serviceName: 'my-app',
      },
    };
    expect(logEvent.type).toBe('log');
  });
});
