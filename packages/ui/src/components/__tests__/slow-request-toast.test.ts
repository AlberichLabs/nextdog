import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse';
import { detectSlowRequestToast } from '../slow-request-toast';

/** Build a SERVER span event whose request ran [durationMs] and ended at [endMs]. */
function makeServerSpan({
  endMs,
  durationMs,
  route = '/api/checkout',
  method = 'POST',
  traceId = 'abc123',
}: {
  endMs: number;
  durationMs: number;
  route?: string;
  method?: string;
  traceId?: string;
}): SSEEvent {
  const endNano = BigInt(endMs) * 1_000_000n;
  const startNano = endNano - BigInt(Math.round(durationMs)) * 1_000_000n;
  return {
    type: 'span',
    timestamp: endMs,
    data: {
      traceId,
      name: route,
      kind: 'SERVER',
      startTimeUnixNano: startNano.toString(),
      endTimeUnixNano: endNano.toString(),
      attributes: { 'http.route': route, 'http.method': method },
      serviceName: 'web',
    },
  };
}

describe('detectSlowRequestToast', () => {
  // The mount/"started watching" moment all the cases are gated against.
  const watchStartMs = 1_750_000_000_000;

  it('does NOT toast for a slow request that completed before we started watching (issue #51)', () => {
    // A historical slow request replayed from FileStore on load/refresh.
    const event = makeServerSpan({ endMs: watchStartMs - 60_000, durationMs: 1800 });
    expect(detectSlowRequestToast(event, watchStartMs)).toBeNull();
  });

  it('toasts a slow request that completed after we started watching', () => {
    const event = makeServerSpan({ endMs: watchStartMs + 5_000, durationMs: 1800 });
    const toast = detectSlowRequestToast(event, watchStartMs);
    expect(toast).not.toBeNull();
    expect(toast?.type).toBe('warning');
    expect(toast?.message).toBe('POST /api/checkout');
    expect(toast?.traceId).toBe('abc123');
  });

  it('uses the error type for a very slow (>=3s) live request', () => {
    const event = makeServerSpan({ endMs: watchStartMs + 5_000, durationMs: 4200 });
    expect(detectSlowRequestToast(event, watchStartMs)?.type).toBe('error');
  });

  it('does NOT toast a fast live request', () => {
    const event = makeServerSpan({ endMs: watchStartMs + 5_000, durationMs: 120 });
    expect(detectSlowRequestToast(event, watchStartMs)).toBeNull();
  });

  it('ignores non-span / non-SERVER / trace-less events', () => {
    const slowLive = makeServerSpan({ endMs: watchStartMs + 5_000, durationMs: 1800 });
    expect(detectSlowRequestToast({ ...slowLive, type: 'log' }, watchStartMs)).toBeNull();
    expect(
      detectSlowRequestToast(
        { ...slowLive, data: { ...slowLive.data, kind: 'CLIENT' } },
        watchStartMs,
      ),
    ).toBeNull();
    expect(
      detectSlowRequestToast(
        { ...slowLive, data: { ...slowLive.data, traceId: undefined } },
        watchStartMs,
      ),
    ).toBeNull();
  });
});
