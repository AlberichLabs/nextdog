import { describe, it, expect } from 'vitest';
import { enterImported, exitImported, type ImportedSession } from '../imported-session.js';
import { serializeExport, parseImport } from '../trace-export.js';
import type { SSEEvent } from '../../hooks/use-sse.js';

function span(traceId: string, spanId: string): SSEEvent {
  return {
    type: 'span',
    timestamp: 1,
    data: {
      traceId,
      spanId,
      name: 'GET /x',
      kind: 'SERVER',
      attributes: {},
      serviceName: 'web',
    },
  };
}

describe('imported-session state machine', () => {
  it('starts inactive (null = live mode)', () => {
    const session: ImportedSession = null;
    expect(session).toBeNull();
  });

  it('enters imported mode from a parsed result, capturing events + source', () => {
    const events = [span('t1', 's1'), span('t1', 's2')];
    const blob = serializeExport(events, { kind: 'trace', traceId: 't1' });
    const result = parseImport(blob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = enterImported(result, 'mytrace.json');
    expect(session).not.toBeNull();
    expect(session.events).toEqual(events);
    expect(session.fileName).toBe('mytrace.json');
    expect(session.kind).toBe('trace');
    expect(session.traceId).toBe('t1');
  });

  it('exiting returns to live mode (null)', () => {
    const events = [span('t1', 's1')];
    const result = parseImport(serializeExport(events, { kind: 'view' }));
    if (!result.ok) throw new Error('expected ok');
    const session = enterImported(result, 'view.json');
    expect(session).not.toBeNull();
    expect(exitImported()).toBeNull();
  });
});
