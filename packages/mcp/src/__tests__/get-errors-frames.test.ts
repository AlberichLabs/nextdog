import { describe, expect, it } from 'vitest';
import { SidecarClient } from '../client';
import { getErrors } from '../tools';
import type { SidecarEvent } from '../types';
import { makeFetch } from './fixtures';

function errSpan(spanId: string, attributes: Record<string, unknown>): SidecarEvent {
  return {
    type: 'span',
    timestamp: 3000,
    data: {
      traceId: 'trace-frames',
      spanId,
      name: 'POST /api/checkout',
      kind: 'SERVER',
      serviceName: 'web',
      status: { code: 'ERROR', message: 'boom' },
      statusCode: 500,
      attributes: { 'http.route': '/api/checkout', ...attributes },
    },
  };
}

function client(events: SidecarEvent[]) {
  return new SidecarClient({ fetchImpl: makeFetch(events).fetchImpl });
}

describe('get_errors — source-mapped frames (#89)', () => {
  it('adds a `frames` array parsed from the stack while retaining `stack`', async () => {
    const stack = 'Error: boom\n    at charge (/app/payments.ts:42:11)';
    const { errors } = await getErrors(client([errSpan('e1', { 'exception.stacktrace': stack })]));
    const e = errors[0];
    expect(e.stack).toBe(stack); // additive — never removed
    expect(e.frames).toEqual([
      { function: 'charge', file: '/app/payments.ts', line: 42, column: 11 },
    ]);
  });

  it('omits `frames` (no crash) when the stack is unparseable, keeping `stack`', async () => {
    const stack = 'totally unparseable stack blob';
    const { errors } = await getErrors(client([errSpan('e2', { 'exception.stacktrace': stack })]));
    expect(errors[0].stack).toBe(stack);
    expect(errors[0].frames).toBeUndefined();
  });

  it('omits `frames` when there is no stack at all', async () => {
    const { errors } = await getErrors(client([errSpan('e3', {})]));
    expect(errors[0].stack).toBeUndefined();
    expect(errors[0].frames).toBeUndefined();
  });

  it('surfaces the emitting `source` from code.* attributes when present', async () => {
    const { errors } = await getErrors(
      client([
        errSpan('e4', {
          'code.filepath': '/app/handler.ts',
          'code.lineno': 17,
          'code.function': 'handler',
        }),
      ]),
    );
    expect(errors[0].source).toEqual({ file: '/app/handler.ts', line: 17, function: 'handler' });
  });

  it('inherits #60 redaction — no captured credential leaks into frames output', async () => {
    const { errors } = await getErrors(
      client([
        errSpan('e5', {
          'exception.stacktrace': 'Error: boom\n    at charge (/app/payments.ts:42:11)',
          'http.request.header.authorization': 'Bearer super-secret-token',
        }),
      ]),
    );
    expect(JSON.stringify(errors)).not.toContain('super-secret-token');
    expect(errors[0].frames).toHaveLength(1); // frames still parsed
  });
});
