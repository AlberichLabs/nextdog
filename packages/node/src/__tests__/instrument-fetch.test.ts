import { context, SpanKind, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentOutboundHttp } from '../instrument-fetch';

const memoryExporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;
let restore: (() => void) | undefined;

describe('instrumentOutboundHttp', () => {
  beforeAll(() => {
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
    });
    // register() installs the AsyncHooks context manager used for parent linkage
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
  });

  beforeEach(() => {
    memoryExporter.reset();
    // Patch global fetch with a fake that returns a 201 response
    const fakeFetch = vi.fn(async (_input: unknown, _init?: unknown) => {
      return new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fakeFetch);

    restore = instrumentOutboundHttp();
  });

  afterEach(() => {
    restore?.();
    vi.unstubAllGlobals();
  });

  it('creates a CLIENT span for an outbound fetch with http attributes', async () => {
    await fetch('https://api.stripe.com/v1/charges', { method: 'POST' });

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.attributes['http.url']).toBe('https://api.stripe.com/v1/charges');
    expect(span.attributes['http.method']).toBe('POST');
    expect(span.attributes['http.status_code']).toBe(201);
    expect(span.endTime).toBeDefined();
  });

  it('nests the outbound fetch span under the active request span (parentSpanId linkage)', async () => {
    const tracer = trace.getTracer('test');
    const parent = tracer.startSpan('GET /api/checkout', { kind: SpanKind.SERVER });

    await context.with(trace.setSpan(context.active(), parent), async () => {
      await fetch('https://api.stripe.com/v1/charges', { method: 'POST' });
    });
    parent.end();

    const spans = memoryExporter.getFinishedSpans();
    const client = spans.find((s) => s.kind === SpanKind.CLIENT);
    const server = spans.find((s) => s.kind === SpanKind.SERVER);
    expect(client).toBeDefined();
    expect(server).toBeDefined();
    // The child fetch span must share the parent's trace and point at it as parent
    expect(client!.spanContext().traceId).toBe(server!.spanContext().traceId);
    const parentSpanId =
      // OTel >=1.26 exposes parentSpanContext; older exposes parentSpanId
      (client as unknown as { parentSpanContext?: { spanId: string } }).parentSpanContext?.spanId ??
      (client as unknown as { parentSpanId?: string }).parentSpanId;
    expect(parentSpanId).toBe(server!.spanContext().spanId);
  });

  it('marks the span as ERROR when the fetch rejects', async () => {
    restore?.();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    restore = instrumentOutboundHttp();

    await expect(fetch('https://example.com')).rejects.toThrow('network down');

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(2); // ERROR
  });

  it('is idempotent — calling twice does not double-wrap', async () => {
    const second = instrumentOutboundHttp();
    await fetch('https://example.com/once');
    second();
    const spans = memoryExporter.getFinishedSpans();
    // Exactly one span per fetch, not two
    expect(
      spans.filter((s) => s.attributes['http.url'] === 'https://example.com/once'),
    ).toHaveLength(1);
  });
});
