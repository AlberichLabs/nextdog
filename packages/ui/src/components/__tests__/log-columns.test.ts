import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse.js';
import { buildLogRowCells, LOG_BASE_TRACK_IDS } from '../log-columns.js';

function makeLog(attributes: Record<string, unknown> = {}): SSEEvent {
  return {
    type: 'log',
    timestamp: 1_711_000_000_000,
    data: {
      timestamp: 1_711_000_000_000,
      level: 'info',
      message: 'Fetching user profile from database',
      serviceName: 'my-app',
      attributes,
    },
  } as unknown as SSEEvent;
}

describe('buildLogRowCells', () => {
  it('emits a runtime cell even when the log has no runtime attribute (issue #18)', () => {
    // Regression: previously the runtime cell was only rendered when a runtime
    // attribute existed, leaving the row one cell short of the 5-track grid and
    // collapsing the message into the 50px runtime track.
    const withRuntime = buildLogRowCells(makeLog({ runtime: 'server' }), {
      showService: true,
      customColumns: [],
    });
    const withoutRuntime = buildLogRowCells(makeLog({}), { showService: true, customColumns: [] });

    expect(withoutRuntime.length).toBe(withRuntime.length);
    expect(withoutRuntime.map((c) => c.id)).toContain('runtime');
  });

  it('cell count matches the grid track count regardless of runtime presence', () => {
    const tracks = LOG_BASE_TRACK_IDS.length; // time, level, service, runtime, message
    for (const attrs of [{ runtime: 'server' }, { runtime: 'browser' }, {}]) {
      const cells = buildLogRowCells(makeLog(attrs), { showService: true, customColumns: [] });
      expect(cells.length).toBe(tracks);
    }
  });

  it('keeps message in the last base position (after runtime), not the runtime slot', () => {
    const cells = buildLogRowCells(makeLog({}), { showService: true, customColumns: [] });
    const ids = cells.map((c) => c.id);
    expect(ids).toEqual(['time', 'level', 'service', 'runtime', 'message']);
    const runtimeCell = cells.find((c) => c.id === 'runtime')!;
    expect(runtimeCell.value).toBe(''); // placeholder, not the message
    expect(cells.find((c) => c.id === 'message')!.value).toContain('Fetching user profile');
  });

  it('accounts for custom columns in track order', () => {
    const cells = buildLogRowCells(makeLog({ region: 'us-east-1' }), {
      showService: true,
      customColumns: [{ id: 'custom-region', attrKey: 'region' }],
    });
    expect(cells.map((c) => c.id)).toEqual([
      'time',
      'level',
      'service',
      'runtime',
      'message',
      'custom-region',
    ]);
    expect(cells.at(-1)!.value).toBe('us-east-1');
  });
});
