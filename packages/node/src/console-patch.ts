import { context, trace } from '@opentelemetry/api';
import { getRequestContext } from './request-context.js';

/**
 * Warn at most once if shipping captured console logs to the sidecar fails.
 * Same rationale as the exporter: a silent `.catch(() => {})` turns "logs not
 * showing" into an undiagnosable mystery, but a per-flush warning would spam the
 * console. We must use the ORIGINAL console.warn captured before patching, or
 * the warning would recurse back through the patched console.
 */
let warnedLogShipFailure = false;
function warnLogShipFailureOnce(originalWarn: (...args: unknown[]) => void): void {
  if (warnedLogShipFailure) return;
  warnedLogShipFailure = true;
  originalWarn(
    '[nextdog] failed to send console logs to the sidecar — is it running? ' +
      'Logs will not appear in the dashboard until this succeeds. ' +
      '(This warning is shown once.)',
  );
}

const LEVELS = ['debug', 'log', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_MAP: Record<Level, string> = {
  debug: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

function tryParseJson(str: string): unknown | null {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Deepest object nesting we will descend into. Beyond this — or on a cycle — we
 * stop and emit a sentinel instead of recursing. A logged self-referential or
 * pathologically-deep object (`a.b = a`, huge config trees) would otherwise blow
 * the stack INSIDE the console patch, taking down whatever the user was logging.
 */
const FLATTEN_MAX_DEPTH = 8;

/** @internal exported for testing — flattens nested objects to dot-notation keys
 * with a depth/cycle guard. */
export function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Mark this object as visited so a back-reference deeper in the tree is caught.
  seen.add(obj);
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const isPlainObject =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date);
    if (isPlainObject && seen.has(value as object)) {
      result[fullKey] = '[Circular]';
    } else if (isPlainObject && depth >= FLATTEN_MAX_DEPTH) {
      result[fullKey] = '[Object]';
    } else if (isPlainObject) {
      Object.assign(
        result,
        flattenObject(value as Record<string, unknown>, fullKey, depth + 1, seen),
      );
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function extractAttributes(args: unknown[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg && typeof arg === 'object' && !(arg instanceof Error)) {
      // Flatten nested objects into dot-notation keys
      Object.assign(attrs, flattenObject(arg as Record<string, unknown>));
    } else if (typeof arg === 'string') {
      // Try to parse JSON strings
      const parsed = tryParseJson(arg);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(attrs, flattenObject(parsed as Record<string, unknown>));
      }
    }
  }
  return attrs;
}

export function patchConsole(url: string, serviceName: string) {
  // Capture the un-patched console.warn so our own failure notice never recurses
  // back through the patched console (which would re-buffer it as a log).
  const originalWarn = console.warn.bind(console);

  const buffer: Array<{
    timestamp: number;
    level: string;
    message: string;
    attributes: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
    serviceName: string;
  }> = [];

  let flushTimer: ReturnType<typeof setInterval> | undefined;

  function flush() {
    if (buffer.length === 0) return;
    const logs = buffer.splice(0, buffer.length);
    const body = JSON.stringify({
      logs: logs.map((l) => ({
        type: 'log',
        timestamp: l.timestamp,
        data: l,
      })),
    });
    fetch(`${url}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => warnLogShipFailureOnce(originalWarn));
  }

  flushTimer = setInterval(flush, 500);
  if (flushTimer.unref) flushTimer.unref();

  for (const level of LEVELS) {
    const original = console[level].bind(console);

    console[level] = (...args: unknown[]) => {
      original(...args);

      const firstArg = args[0];
      if (typeof firstArg === 'string' && firstArg.startsWith('[nextdog]')) return;
      // Skip Next.js internal OTel/RSC noise
      if (
        typeof firstArg === 'string' &&
        (firstArg.includes('Unexpected root span type') ||
          firstArg.includes('Failed to fetch RSC payload'))
      )
        return;

      // Try multiple approaches to get the active span context
      // Next.js 14 has less reliable OTel context propagation
      let traceId: string | undefined;
      let spanId: string | undefined;

      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        const spanCtx = activeSpan.spanContext();
        traceId = spanCtx.traceId;
        spanId = spanCtx.spanId;
      } else {
        // Fallback: try extracting from the active context directly
        // This works in some Next.js 14 code paths where getActiveSpan() fails
        const ctx = context.active();
        const spanFromCtx = trace.getSpan(ctx);
        if (spanFromCtx) {
          const spanCtx = spanFromCtx.spanContext();
          traceId = spanCtx.traceId;
          spanId = spanCtx.spanId;
        }
      }

      const message = args.map(formatArg).join(' ');
      const attributes = extractAttributes(args);

      // Enrich with request context from our own AsyncLocalStorage
      // (reliable even when OTel context propagation fails in Next.js 14)
      const reqCtx = getRequestContext();
      if (reqCtx) {
        attributes['http.method'] = reqCtx.method;
        attributes['http.route'] = reqCtx.path;
        attributes['request.id'] = reqCtx.requestId;
      }

      buffer.push({
        timestamp: Date.now(),
        level: LEVEL_MAP[level],
        message,
        attributes: { ...attributes, runtime: 'server' },
        traceId,
        spanId,
        serviceName,
      });
    };
  }
}
