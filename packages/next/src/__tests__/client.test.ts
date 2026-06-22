import { type Context, type ContextManager, context, TraceFlags, trace } from '@opentelemetry/api';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Minimal synchronous context manager so trace.setSpan/getActiveSpan work in a
 * plain Node test without pulling in an OTel SDK dependency. Synchronous
 * context.with is all these tests exercise.
 */
class SyncContextManager implements ContextManager {
  private _stack: Context[] = [];
  active(): Context {
    return (
      this._stack[this._stack.length - 1] ??
      (context as unknown as { _getRoot?: () => Context })._getRoot?.() ??
      rootCtx
    );
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this._stack.push(ctx);
    try {
      return fn.call(thisArg as ThisParameterType<F>, ...args);
    } finally {
      this._stack.pop();
    }
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    this._stack = [];
    return this;
  }
}

// Capture the root context before installing our manager.
const rootCtx = context.active();

beforeAll(() => {
  context.setGlobalContextManager(new SyncContextManager());
});

async function loadClient() {
  // import fresh each call; functions read NODE_ENV dynamically at call time
  return import('../client.js');
}

/** Build a real active span context using only @opentelemetry/api (no SDK). */
function withActiveSpan<T>(traceId: string, spanId: string, fn: () => T): T {
  const spanContext = {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
  };
  const span = trace.wrapSpanContext(spanContext);
  return context.with(trace.setSpan(context.active(), span), fn);
}

describe('getNextDogTraceMetaHtml / server trace injection', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('returns empty meta markup in production', async () => {
    process.env.NODE_ENV = 'production';
    const { getNextDogTraceMetaHtml } = await loadClient();
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const html = withActiveSpan(traceId, spanId, () => getNextDogTraceMetaHtml());
    expect(html).toBe('');
  });

  it('injects the ACTIVE server trace id into a meta tag during a span', async () => {
    process.env.NODE_ENV = 'development';
    const { getNextDogTraceMetaHtml } = await loadClient();

    const traceId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const spanId = '0123456789abcdef';

    const html = withActiveSpan(traceId, spanId, () => getNextDogTraceMetaHtml());

    expect(html).toContain('nextdog-trace-id');
    // The injected trace id MUST equal the server span's traceId — correlation guarantee.
    expect(html).toContain(traceId);
    expect(html).toContain(spanId);
    // inert: a meta tag, not a script; no secrets, headers, or body injected.
    expect(html).not.toContain('<script');
    expect(html.toLowerCase()).toContain('<meta');
  });

  it('is inert (empty) when there is no active trace', async () => {
    process.env.NODE_ENV = 'development';
    const { getNextDogTraceMetaHtml } = await loadClient();
    // No active span on the context.
    expect(getNextDogTraceMetaHtml()).toBe('');
  });

  it('getNextDogTraceMeta object form returns null without an active trace', async () => {
    process.env.NODE_ENV = 'development';
    const { getNextDogTraceMeta } = await loadClient();
    expect(getNextDogTraceMeta()).toBeNull();
  });
});
