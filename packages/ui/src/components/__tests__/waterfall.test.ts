import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse.js';
import { buildTimings } from '../waterfall.js';

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

describe('buildTimings (issue #44)', () => {
  it('builds timings from valid spans', () => {
    const { timings } = buildTimings([
      span({ spanId: 's1', startTimeUnixNano: '1000000000', endTimeUnixNano: '1500000000' }),
    ]);
    expect(timings).toHaveLength(1);
    expect(timings[0].durationMs).toBe(500);
  });

  // Issue #44: a crafted span with a non-numeric timing value used to reach an
  // unguarded BigInt() here and throw, blanking the dashboard. It must degrade,
  // not throw, and must not corrupt the timings of the valid sibling span.
  it('does not throw on a non-numeric timing value', () => {
    expect(() =>
      buildTimings([
        span({ spanId: 's1', startTimeUnixNano: 'not-a-number', endTimeUnixNano: '999' }),
      ]),
    ).not.toThrow();
  });

  it('drops a span with invalid timing while keeping the valid one', () => {
    const { timings } = buildTimings([
      span({ spanId: 'good', startTimeUnixNano: '1000000000', endTimeUnixNano: '1500000000' }),
      span({ spanId: 'bad', startTimeUnixNano: 'not-a-number', endTimeUnixNano: '999' }),
    ]);
    const names = timings.map((t) => t.source.data.spanId);
    expect(names).toContain('good');
    expect(names).not.toContain('bad');
  });
});
