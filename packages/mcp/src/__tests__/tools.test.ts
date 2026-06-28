import { describe, expect, it } from 'vitest';
import { SidecarClient } from '../client';
import { getErrors, getTrace, listRecentTraces, searchLogs } from '../tools';
import { makeFetch, TRACE_ERR, TRACE_OK } from './fixtures';

function client() {
  return new SidecarClient({ fetchImpl: makeFetch().fetchImpl });
}

describe('list_recent_traces', () => {
  it('returns one summary per trace, newest first', async () => {
    const { traces } = await listRecentTraces(client());
    expect(traces.map((t) => t.traceId)).toEqual([TRACE_ERR, TRACE_OK]);
  });

  it('flags the checkout trace as an error with route + 500', async () => {
    const { traces } = await listRecentTraces(client());
    const err = traces.find((t) => t.traceId === TRACE_ERR);
    if (!err) throw new Error(`expected a trace with id ${TRACE_ERR}`);
    expect(err.isError).toBe(true);
    expect(err.route).toBe('/api/checkout');
    expect(err.statusCode).toBe(500);
    expect(err.spanCount).toBe(2);
  });

  it('filters by route substring', async () => {
    const { traces } = await listRecentTraces(client(), { route: 'checkout' });
    expect(traces).toHaveLength(1);
    expect(traces[0].traceId).toBe(TRACE_ERR);
  });

  it('filters by errorsOnly', async () => {
    const { traces } = await listRecentTraces(client(), { errorsOnly: true });
    expect(traces.map((t) => t.traceId)).toEqual([TRACE_ERR]);
  });

  it('filters by status code string', async () => {
    const { traces } = await listRecentTraces(client(), { status: '500' });
    expect(traces.map((t) => t.traceId)).toEqual([TRACE_ERR]);
  });
});

describe('get_trace', () => {
  it('reconstructs the span tree with the child nested under the root', async () => {
    const res = await getTrace(client(), { traceId: TRACE_ERR });
    expect(res.found).toBe(true);
    expect(res.spanTree).toHaveLength(1);
    const root = res.spanTree[0];
    expect(root.spanId).toBe('web-checkout-root');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].spanId).toBe('payments-charge');
    expect(root.children[0].service).toBe('payments');
  });

  it('computes durationMs from the bigint nano timestamps', async () => {
    const res = await getTrace(client(), { traceId: TRACE_ERR });
    expect(res.spanTree[0].durationMs).toBe(150);
    expect(res.spanTree[0].children[0].durationMs).toBe(120);
  });

  it('returns logs correlated by traceId, in time order', async () => {
    const res = await getTrace(client(), { traceId: TRACE_ERR });
    expect(res.logs.map((l) => l.message)).toEqual(['checkout failed: card declined']);
    expect(res.logs[0].spanId).toBe('web-checkout-root');
  });

  it('excludes untraced events the server returns under a traceId filter', async () => {
    // The sidecar's /api/events?traceId= filter lets events with NO traceId
    // through. A fake that returns an untraced log alongside the real trace
    // events must not surface that log in the trace view.
    const orphanLog = {
      type: 'log' as const,
      timestamp: 2999,
      data: { level: 'warn', message: 'orphan no-trace log', serviceName: 'web', attributes: {} },
    };
    const fetchImpl = makeFetch([
      orphanLog,
      // a real traced log + span for TRACE_ERR
      {
        type: 'span' as const,
        timestamp: 2000,
        data: {
          traceId: TRACE_ERR,
          spanId: 'root',
          name: 'POST /x',
          kind: 'SERVER',
          serviceName: 'web',
          status: { code: 'ERROR' },
          attributes: {},
        },
      },
      {
        type: 'log' as const,
        timestamp: 2010,
        data: {
          traceId: TRACE_ERR,
          spanId: 'root',
          level: 'error',
          message: 'real',
          serviceName: 'web',
          attributes: {},
        },
      },
    ]).fetchImpl;
    const res = await getTrace(new SidecarClient({ fetchImpl }), { traceId: TRACE_ERR });
    expect(res.logs.map((l) => l.message)).toEqual(['real']);
  });

  it('reports not found for an unknown trace', async () => {
    const res = await getTrace(client(), { traceId: 'nope' });
    expect(res.found).toBe(false);
    expect(res.spanTree).toHaveLength(0);
    expect(res.logs).toHaveLength(0);
  });
});

describe('search_logs', () => {
  it('level:error returns only the error log', async () => {
    const { results } = await searchLogs(client(), { filter: 'level:error' });
    expect(results.map((r) => r.data.message)).toEqual(['checkout failed: card declined']);
  });

  it('honors OR groups (level:error OR level:warn)', async () => {
    const { results } = await searchLogs(client(), { filter: 'level:error OR level:warn' });
    expect(results.map((r) => r.data.message).sort()).toEqual([
      'checkout failed: card declined',
      'retrying charge',
    ]);
  });

  it('honors negation (!level:error)', async () => {
    const { results } = await searchLogs(client(), { filter: '!level:error' });
    const messages = results.map((r) => r.data.message);
    expect(messages).not.toContain('checkout failed: card declined');
    expect(messages).toContain('retrying charge');
    expect(messages).toContain('health check ok');
  });

  it('honors service: facet', async () => {
    const { results } = await searchLogs(client(), { filter: 'service:payments' });
    expect(results.map((r) => r.data.message)).toEqual(['retrying charge']);
  });

  it('can include spans and match status:ERROR', async () => {
    const { results } = await searchLogs(client(), {
      filter: 'status:ERROR',
      includeSpans: true,
    });
    const names = results.map((r) => r.data.name ?? r.data.message);
    expect(names).toContain('POST /api/checkout');
    expect(names).toContain('charge');
  });

  it('empty filter returns logs (matches everything, logs only by default)', async () => {
    const { results } = await searchLogs(client(), {});
    expect(results.every((r) => r.type === 'log')).toBe(true);
    expect(results.length).toBe(3);
  });
});

describe('get_errors', () => {
  it('returns error spans with stack traces, newest first', async () => {
    const { errors } = await getErrors(client());
    // payments-charge (2020, ERROR) and web-checkout-root (2000, 500)
    expect(errors.map((e) => e.spanId)).toEqual(['payments-charge', 'web-checkout-root']);
    const charge = errors.find((e) => e.spanId === 'payments-charge');
    if (!charge) throw new Error('expected a payments-charge error span');
    expect(charge.stack).toContain('card declined');
    expect(charge.message).toBe('card declined');
  });

  it('treats HTTP 500 as an error even without status ERROR override', async () => {
    const { errors } = await getErrors(client());
    const root = errors.find((e) => e.spanId === 'web-checkout-root');
    if (!root) throw new Error('expected a web-checkout-root error span');
    expect(root.statusCode).toBe(500);
  });

  it('filters by service', async () => {
    const { errors } = await getErrors(client(), { service: 'payments' });
    expect(errors.map((e) => e.spanId)).toEqual(['payments-charge']);
  });
});
