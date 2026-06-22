import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { trace, context, SpanKind } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { instrumentPgModule } from '../instrument-db.js';

const memoryExporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

/**
 * Minimal fake of the `pg` module surface: a Client whose `query` resolves a
 * result with `rows` and `rowCount`. Mirrors node-postgres' Client.prototype.query.
 */
function makeFakePg() {
  class Client {
    async query(_text: string, _params?: unknown[]) {
      return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
    }
  }
  return { Client, Pool: class {} };
}

describe('instrumentPgModule', () => {
  let restore: (() => void) | undefined;

  beforeAll(() => {
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
    });
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
  });

  beforeEach(() => {
    memoryExporter.reset();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('creates a CLIENT span for a pg query with statement, row count and elided params', async () => {
    const pg = makeFakePg();
    restore = instrumentPgModule(pg);

    const client = new pg.Client();
    const res = await client.query('SELECT * FROM users WHERE email = $1', ['secret@user.com']);
    expect(res.rowCount).toBe(2);

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.attributes['db.system']).toBe('postgresql');
    expect(span.attributes['db.statement']).toBe('SELECT * FROM users WHERE email = $1');
    expect(span.attributes['db.rows_affected']).toBe(2);
    // Bound params must NOT be captured (PII): no value should equal the param
    const serialized = JSON.stringify(span.attributes);
    expect(serialized).not.toContain('secret@user.com');
    // Param count may be recorded, but not the values
    expect(span.attributes['db.params_count']).toBe(1);
  });

  it('nests the query span under the active request span (parentSpanId linkage)', async () => {
    const pg = makeFakePg();
    restore = instrumentPgModule(pg);
    const tracer = trace.getTracer('test');
    const parent = tracer.startSpan('GET /api/users', { kind: SpanKind.SERVER });

    await context.with(trace.setSpan(context.active(), parent), async () => {
      const client = new pg.Client();
      await client.query('SELECT 1');
    });
    parent.end();

    const spans = memoryExporter.getFinishedSpans();
    const dbSpan = spans.find((s) => s.attributes['db.system'] === 'postgresql');
    const server = spans.find((s) => s.kind === SpanKind.SERVER);
    expect(dbSpan).toBeDefined();
    expect(server).toBeDefined();
    expect(dbSpan!.spanContext().traceId).toBe(server!.spanContext().traceId);
    const parentSpanId =
      (dbSpan as unknown as { parentSpanContext?: { spanId: string } }).parentSpanContext?.spanId ??
      (dbSpan as unknown as { parentSpanId?: string }).parentSpanId;
    expect(parentSpanId).toBe(server!.spanContext().spanId);
  });

  it('marks the span as ERROR when the query rejects', async () => {
    const pg = makeFakePg();
    pg.Client.prototype.query = async () => {
      throw new Error('relation "nope" does not exist');
    };
    restore = instrumentPgModule(pg);

    const client = new pg.Client();
    await expect(client.query('SELECT * FROM nope')).rejects.toThrow('does not exist');

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(2); // ERROR
  });

  it('is idempotent — instrumenting the same module twice wraps query once', async () => {
    const pg = makeFakePg();
    restore = instrumentPgModule(pg);
    const second = instrumentPgModule(pg);

    const client = new pg.Client();
    await client.query('SELECT 1');
    second();

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
  });
});
