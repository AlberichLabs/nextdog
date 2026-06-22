/**
 * Zero-dependency auto-instrumentation of DATABASE queries.
 *
 * We do NOT take a hard dependency on `@opentelemetry/instrumentation-pg` /
 * `-mysql2` — those (and the `@opentelemetry/instrumentation` registration
 * machinery they need) are heavyweight runtime deps that would land in every
 * consumer's tree, violating nextdog's zero-runtime-dep design. Instead we
 * monkey-patch the driver's own `query` method when the driver is actually
 * present, the same approach used elsewhere in this package (console, fetch,
 * http.Server). The only thing this needs is `@opentelemetry/api`, already a
 * dependency.
 *
 * Each query becomes a CLIENT span carrying:
 *   - db.system        ("postgresql" | "mysql")
 *   - db.statement     (the SQL text)
 *   - db.rows_affected (row count, where the driver exposes it)
 *   - db.params_count  (how many bound params — but NEVER the values)
 *   - duration         (span start/end)
 *
 * REDACTION: bound parameters frequently contain PII (emails, tokens, ids), so
 * we capture the statement text but ELIDE the param VALUES by default. We only
 * record how many params there were. This is the privacy-preserving default.
 *
 * Parent linkage is automatic: the span is started inside the active OTel
 * context, so it nests under the in-flight request span in the waterfall.
 */
import { context, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = 'nextdog/db';
const WRAPPED = Symbol.for('nextdog.db.wrapped');

// Truncate very long statements so a giant generated query can't bloat a span.
const MAX_STATEMENT_LEN = 4096;

type AnyFn = (...args: unknown[]) => unknown;
interface Wrappable {
  prototype?: Record<string, unknown> & { [WRAPPED]?: boolean };
}

function statementOf(args: unknown[]): string {
  const first = args[0];
  let text: string | undefined;
  if (typeof first === 'string') {
    text = first;
  } else if (first && typeof first === 'object') {
    // pg / mysql2 also accept a config object: { text, sql, values }
    const cfg = first as { text?: string; sql?: string };
    text = cfg.text ?? cfg.sql;
  }
  if (!text) return '(unknown statement)';
  return text.length > MAX_STATEMENT_LEN ? `${text.slice(0, MAX_STATEMENT_LEN)}…` : text;
}

function paramsCountOf(args: unknown[]): number | undefined {
  // pg: query(text, values, cb) — values is args[1]
  // pg config object: { values: [...] }
  const first = args[0];
  if (
    first &&
    typeof first === 'object' &&
    Array.isArray((first as { values?: unknown[] }).values)
  ) {
    return (first as { values: unknown[] }).values.length;
  }
  if (Array.isArray(args[1])) return (args[1] as unknown[]).length;
  return undefined;
}

function rowsAffectedOf(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as { rowCount?: number; rows?: unknown[]; affectedRows?: number };
  if (typeof r.rowCount === 'number') return r.rowCount; // pg
  if (typeof r.affectedRows === 'number') return r.affectedRows; // pg-style top-level (defensive)
  // mysql2 returns a tuple: reads are [rows, fields], writes are [ResultSetHeader, undefined].
  if (Array.isArray(result)) {
    const head = result[0];
    if (Array.isArray(head)) return head.length; // read → row array
    if (
      head &&
      typeof head === 'object' &&
      typeof (head as { affectedRows?: number }).affectedRows === 'number'
    ) {
      return (head as { affectedRows: number }).affectedRows; // write → ResultSetHeader
    }
  }
  if (Array.isArray(r.rows)) return r.rows.length;
  return undefined;
}

/**
 * Wrap a single `query`-style method on a prototype to emit a span per call.
 * Handles both promise-returning and callback-style invocations.
 */
function wrapQueryMethod(
  proto: Record<string, unknown> & { [WRAPPED]?: boolean },
  methodName: string,
  dbSystem: string,
): void {
  const original = proto[methodName];
  if (typeof original !== 'function') return;

  const tracer = trace.getTracer(TRACER_NAME);

  const wrapped = function (this: unknown, ...args: unknown[]) {
    const statement = statementOf(args);
    const paramsCount = paramsCountOf(args);

    const span: Span = tracer.startSpan(statement, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': dbSystem,
        'db.statement': statement,
        // Bound params are deliberately elided (PII). Only the count is recorded.
        ...(paramsCount !== undefined ? { 'db.params_count': paramsCount } : {}),
      },
    });

    const ctx = trace.setSpan(context.active(), span);

    const finishOk = (result: unknown) => {
      const rows = rowsAffectedOf(result);
      if (rows !== undefined) span.setAttribute('db.rows_affected', rows);
      span.end();
    };
    const finishErr = (err: unknown) => {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
      span.end();
    };

    // If the caller passed a callback (last arg is a function), wrap it.
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const cb = lastArg as AnyFn;
      args[args.length - 1] = function (
        this: unknown,
        err: unknown,
        result: unknown,
        ...rest: unknown[]
      ) {
        if (err) finishErr(err);
        else finishOk(result);
        return cb.call(this, err, result, ...rest);
      };
      return context.with(ctx, () => (original as AnyFn).apply(this, args));
    }

    // Otherwise treat the return value as a thenable (promise) or sync value.
    return context.with(ctx, () => {
      let result: unknown;
      try {
        result = (original as AnyFn).apply(this, args);
      } catch (err) {
        finishErr(err);
        throw err;
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (res) => {
            finishOk(res);
            return res;
          },
          (err) => {
            finishErr(err);
            throw err;
          },
        );
      }
      finishOk(result);
      return result;
    });
  };

  proto[methodName] = wrapped;
}

/**
 * Instrument a `pg` (node-postgres) module object. Patches Client/Pool query.
 * Returns a restore function. Idempotent per module.
 */
export function instrumentPgModule(pg: unknown): () => void {
  return instrumentDriverModule(pg, 'postgresql', ['Client', 'Pool']);
}

/**
 * Instrument a `mysql2` module object. Patches Connection/Pool query+execute.
 * Returns a restore function. Idempotent per module.
 */
export function instrumentMysql2Module(mysql: unknown): () => void {
  return instrumentDriverModule(mysql, 'mysql', ['Connection', 'Pool'], ['query', 'execute']);
}

function instrumentDriverModule(
  mod: unknown,
  dbSystem: string,
  ctorNames: string[],
  methods: string[] = ['query'],
): () => void {
  if (!mod || typeof mod !== 'object') return () => {};

  const patched: Array<{
    proto: Record<string, unknown> & { [WRAPPED]?: boolean };
    originals: Record<string, unknown>;
  }> = [];

  for (const ctorName of ctorNames) {
    const ctor = (mod as Record<string, unknown>)[ctorName] as Wrappable | undefined;
    const proto = ctor?.prototype as
      | (Record<string, unknown> & { [WRAPPED]?: boolean })
      | undefined;
    if (!proto || proto[WRAPPED]) continue;

    const originals: Record<string, unknown> = {};
    for (const m of methods) {
      if (typeof proto[m] === 'function') {
        originals[m] = proto[m];
        wrapQueryMethod(proto, m, dbSystem);
      }
    }
    proto[WRAPPED] = true;
    patched.push({ proto, originals });
  }

  return () => {
    for (const { proto, originals } of patched) {
      for (const [m, fn] of Object.entries(originals)) {
        proto[m] = fn;
      }
      delete proto[WRAPPED];
    }
  };
}

/**
 * Lazily load installed DB drivers (dev only) and instrument them. Each import
 * is wrapped in try/catch so a missing driver is simply skipped — no driver is
 * a hard dependency. Returns a combined restore function.
 */
export async function registerDbInstrumentation(): Promise<() => void> {
  const restores: Array<() => void> = [];

  // node-postgres
  const pg = await optionalImport('pg');
  if (pg) restores.push(instrumentPgModule(pg));

  // mysql2
  const mysql = await optionalImport('mysql2');
  if (mysql) restores.push(instrumentMysql2Module(mysql));

  return () => {
    for (const r of restores) r();
  };
}

/**
 * Import an OPTIONAL driver. The specifier is held in a variable so TypeScript
 * does not try to resolve it at build time (it is not a dependency), and any
 * resolution failure at runtime resolves to `undefined` — the driver is simply
 * absent and skipped. This is what keeps the DB feature zero-dependency.
 */
async function optionalImport(specifier: string): Promise<unknown | undefined> {
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: unknown };
    return mod.default ?? mod;
  } catch {
    return undefined;
  }
}
