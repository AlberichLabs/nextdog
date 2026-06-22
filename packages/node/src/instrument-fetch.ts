/**
 * Zero-dependency auto-instrumentation of OUTBOUND HTTP made via the global
 * `fetch` (undici under the hood in Node 18+). When a route handler calls
 * `fetch('https://api.stripe.com/...')`, this wraps the call in an OTel CLIENT
 * span carrying `http.url`, `http.method`, `http.status_code` and a duration.
 *
 * Parent linkage is automatic: `tracer.startSpan` (run inside the active
 * context via `context.with`) parents the new span to whatever request span is
 * active on the OTel context stack, so the call nests correctly under the
 * incoming-request span in the waterfall — no `parentSpanId` plumbing needed.
 *
 * We deliberately patch `fetch` ourselves rather than depend on
 * `@opentelemetry/instrumentation-undici`/`-http`. Those are heavyweight
 * runtime deps that would land in every consumer's tree; we already depend on
 * `@opentelemetry/api`, which is all this needs.
 */
import { context, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = 'nextdog/outbound-http';

// Marker so we never double-wrap (e.g. registered twice across HMR reloads).
const WRAPPED = Symbol.for('nextdog.fetch.wrapped');

type FetchFn = typeof globalThis.fetch;

function urlOf(input: Parameters<FetchFn>[0]): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    // Request object
    return (input as Request).url ?? String(input);
  } catch {
    return String(input);
  }
}

function methodOf(input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]): string {
  if (init?.method) return init.method.toUpperCase();
  try {
    if (input && typeof input === 'object' && 'method' in input && (input as Request).method) {
      return (input as Request).method.toUpperCase();
    }
  } catch {
    /* ignore */
  }
  return 'GET';
}

/**
 * Wrap the global `fetch` so each call emits a CLIENT span. Returns a restore
 * function that puts the original `fetch` back (used in tests / teardown).
 * Idempotent: a second call is a no-op and returns a no-op restore.
 */
export function instrumentOutboundHttp(): () => void {
  const original = globalThis.fetch as FetchFn & { [WRAPPED]?: boolean };
  if (!original) return () => {};
  if (original[WRAPPED]) return () => {};

  const tracer = trace.getTracer(TRACER_NAME);

  const wrapped = function nextdogFetch(
    this: unknown,
    input: Parameters<FetchFn>[0],
    init?: Parameters<FetchFn>[1],
  ): ReturnType<FetchFn> {
    const url = urlOf(input);
    const method = methodOf(input, init);

    const span: Span = tracer.startSpan(`${method} ${url}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.url': url,
        'http.method': method,
      },
    });

    // Run the call inside the span's context so any further nested work
    // (and the span itself) link correctly in the trace.
    const ctx = trace.setSpan(context.active(), span);

    return context.with(ctx, () => {
      let result: ReturnType<FetchFn>;
      try {
        result = original.call(this, input, init);
      } catch (err) {
        // Synchronous throw (rare for fetch, but be safe).
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
        span.end();
        throw err;
      }

      return result.then(
        (res) => {
          span.setAttribute('http.status_code', res.status);
          if (res.status >= 400) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.status}` });
          }
          span.end();
          return res;
        },
        (err) => {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
          span.end();
          throw err;
        },
      ) as ReturnType<FetchFn>;
    });
  } as FetchFn & { [WRAPPED]?: boolean };

  wrapped[WRAPPED] = true;
  globalThis.fetch = wrapped;

  return () => {
    if (globalThis.fetch === wrapped) {
      globalThis.fetch = original;
    }
  };
}
