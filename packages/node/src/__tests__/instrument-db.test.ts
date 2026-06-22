import { context, SpanKind, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { instrumentMysql2Module, instrumentPgModule } from '../instrument-db.js';

const memoryExporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

// One global provider for the whole file. Registering then disabling the global
// OTel API between describe blocks breaks context propagation for subsequent
// blocks, so we set up once and tear down once.
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

describe('instrumentMysql2Module', () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    memoryExporter.reset();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  /**
   * mysql2 writes (INSERT/UPDATE/DELETE) resolve to `[ResultSetHeader, undefined]`
   * where the count is at `result[0].affectedRows`, NOT a top-level field.
   */
  function makeFakeMysql2Write() {
    class Connection {
      async execute(_sql: string, _params?: unknown[]) {
        const header = { affectedRows: 3, insertId: 7, fieldCount: 0 };
        return [header, undefined];
      }
    }
    return { Connection, Pool: class {} };
  }

  /** mysql2 reads resolve to `[rows, fields]`. */
  function makeFakeMysql2Read() {
    class Connection {
      async query(_sql: string, _params?: unknown[]) {
        return [[{ id: 1 }, { id: 2 }], []];
      }
    }
    return { Connection, Pool: class {} };
  }

  it('captures db.rows_affected for a mysql2 write (ResultSetHeader.affectedRows)', async () => {
    const mysql = makeFakeMysql2Write();
    restore = instrumentMysql2Module(mysql);

    const conn = new mysql.Connection();
    await conn.execute('INSERT INTO users (email) VALUES (?)', ['x@y.com']);

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['db.system']).toBe('mysql');
    expect(spans[0].attributes['db.rows_affected']).toBe(3);
  });

  it('still captures row count for a mysql2 read ([rows, fields])', async () => {
    const mysql = makeFakeMysql2Read();
    restore = instrumentMysql2Module(mysql);

    const conn = new mysql.Connection();
    await conn.query('SELECT * FROM users');

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['db.rows_affected']).toBe(2);
  });
});
