import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse';
import { computeKpis, KPI_THROUGHPUT_WINDOW_MS } from '../kpi';

const NOW = 1_000_000_000_000;

function reqSpan(over: Partial<SSEEvent['data']> & { durMs?: number; ts?: number } = {}): SSEEvent {
  const { durMs = 50, ts = NOW, ...data } = over;
  const startNano = BigInt(NOW) * 1_000_000n;
  const endNano = startNano + BigInt(Math.round(durMs * 1_000_000));
  return {
    type: 'span',
    timestamp: ts,
    data: {
      name: 'GET /x',
      serviceName: 'web',
      kind: 'SERVER',
      startTimeUnixNano: String(startNano),
      endTimeUnixNano: String(endNano),
      attributes: {},
      ...data,
    },
  };
}

describe('computeKpis', () => {
  it('returns nulls/zeros for an empty event set', () => {
    const k = computeKpis([], NOW);
    expect(k.totalRequests).toBe(0);
    expect(k.p95Ms).toBeNull();
    expect(k.errorRate).toBeNull();
    expect(k.throughputPerSec).toBe(0);
  });

  it('counts only root request spans (ignores child spans and logs)', () => {
    const events: SSEEvent[] = [
      reqSpan(),
      reqSpan({ parentSpanId: 'p1', kind: 'CLIENT' }), // child span — not a request
      { type: 'log', timestamp: NOW, data: { name: 'l', serviceName: 'web', attributes: {} } },
    ];
    expect(computeKpis(events, NOW).totalRequests).toBe(1);
  });

  it('treats a parent-less span with no kind as a request', () => {
    const e = reqSpan({ kind: undefined });
    expect(computeKpis([e], NOW).totalRequests).toBe(1);
  });

  it('computes throughput over the trailing window', () => {
    const inWindow = [reqSpan({ ts: NOW }), reqSpan({ ts: NOW - 10_000 })];
    const stale = reqSpan({ ts: NOW - KPI_THROUGHPUT_WINDOW_MS - 1 });
    const k = computeKpis([...inWindow, stale], NOW);
    expect(k.windowRequests).toBe(2);
    expect(k.throughputPerSec).toBeCloseTo(2 / (KPI_THROUGHPUT_WINDOW_MS / 1000), 6);
    // The stale request still counts toward total/p95/error, just not throughput.
    expect(k.totalRequests).toBe(3);
  });

  it('computes p95 latency across all requests', () => {
    const events = Array.from({ length: 100 }, (_, i) => reqSpan({ durMs: i + 1 }));
    const k = computeKpis(events, NOW);
    expect(k.p95Ms).toBe(96);
  });

  it('computes error rate from ERROR status and 5xx codes', () => {
    const events: SSEEvent[] = [
      reqSpan(),
      reqSpan({ status: { code: 'ERROR' } }),
      reqSpan({ attributes: { 'http.status_code': 503 } }),
      reqSpan({ attributes: { 'http.status_code': 404 } }), // 4xx is NOT an error here
    ];
    const k = computeKpis(events, NOW);
    expect(k.errorRate).toBeCloseTo(2 / 4, 6);
  });
});
