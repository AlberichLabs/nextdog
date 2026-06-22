import { describe, it, expect } from 'vitest';
import {
  serializeExport,
  parseImport,
  EXPORT_MARKER,
  EXPORT_VERSION,
  type ExportEnvelope,
} from '../trace-export.js';
import type { SSEEvent } from '../../hooks/use-sse.js';

function span(traceId: string, spanId: string, extra: Partial<SSEEvent['data']> = {}): SSEEvent {
  return {
    type: 'span',
    timestamp: 1_000,
    data: {
      traceId,
      spanId,
      name: 'GET /api/users',
      kind: 'SERVER',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1500000000',
      attributes: { 'http.method': 'GET', 'http.route': '/api/users' },
      status: { code: 'OK' },
      serviceName: 'web',
      ...extra,
    },
  };
}

function log(traceId: string, message: string): SSEEvent {
  return {
    type: 'log',
    timestamp: 1_100,
    data: {
      traceId,
      name: 'log',
      attributes: {},
      serviceName: 'web',
      level: 'info',
      message,
    },
  };
}

describe('serializeExport / parseImport — round-trip', () => {
  it('round-trips a trace export (serialize -> parse yields the same events)', () => {
    const events = [span('t1', 's1'), log('t1', 'hello'), span('t1', 's2', { parentSpanId: 's1' })];
    const blob = serializeExport(events, { kind: 'trace', traceId: 't1' });
    const result = parseImport(blob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual(events);
    expect(result.envelope.kind).toBe('trace');
    expect(result.envelope.traceId).toBe('t1');
  });

  it('round-trips a filtered-view export', () => {
    const events = [span('t1', 's1'), span('t2', 's3')];
    const blob = serializeExport(events, { kind: 'view' });
    const result = parseImport(blob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual(events);
    expect(result.envelope.kind).toBe('view');
    expect(result.envelope.traceId).toBeUndefined();
  });

  it('writes a self-describing header (marker + version + count)', () => {
    const events = [span('t1', 's1'), log('t1', 'x')];
    const blob = serializeExport(events, { kind: 'trace', traceId: 't1' });
    const parsed = JSON.parse(blob) as ExportEnvelope;
    expect(parsed.nextdog).toBe(EXPORT_MARKER);
    expect(parsed.version).toBe(EXPORT_VERSION);
    expect(parsed.eventCount).toBe(2);
    expect(typeof parsed.exportedAt).toBe('number');
  });
});

describe('parseImport — validation', () => {
  it('accepts a real export', () => {
    const blob = serializeExport([span('t1', 's1')], { kind: 'trace', traceId: 't1' });
    expect(parseImport(blob).ok).toBe(true);
  });

  it('rejects a foreign JSON file (no nextdog marker)', () => {
    const result = parseImport(JSON.stringify({ hello: 'world', events: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a nextdog/i);
  });

  it('rejects a wrong marker value', () => {
    const result = parseImport(JSON.stringify({ nextdog: 'something-else', version: 1, events: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported future version', () => {
    const result = parseImport(
      JSON.stringify({ nextdog: EXPORT_MARKER, version: EXPORT_VERSION + 1, events: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/version/i);
  });

  it('rejects malformed (non-JSON) input', () => {
    const result = parseImport('{ this is not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/parse|json|malformed/i);
  });

  it('rejects a truncated export (events not an array)', () => {
    const result = parseImport(JSON.stringify({ nextdog: EXPORT_MARKER, version: EXPORT_VERSION }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/events/i);
  });

  it('rejects an envelope whose events are not event-shaped', () => {
    const result = parseImport(
      JSON.stringify({ nextdog: EXPORT_MARKER, version: EXPORT_VERSION, events: [{ foo: 1 }] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(parseImport('').ok).toBe(false);
  });
});

describe('exportFilename', () => {
  it('builds a trace filename from the traceId', async () => {
    const { exportFilename } = await import('../trace-export.js');
    expect(exportFilename({ kind: 'trace', traceId: 'abc123' })).toMatch(/^nextdog-trace-abc123.*\.json$/);
  });

  it('builds a view filename', async () => {
    const { exportFilename } = await import('../trace-export.js');
    expect(exportFilename({ kind: 'view' })).toMatch(/^nextdog-view.*\.json$/);
  });
});
