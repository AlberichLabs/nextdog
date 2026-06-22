// Client-side NextDog component — injects browser console capture
// Usage: import { NextDogScript } from '@nextdog/next/client'
// Then add <NextDogScript /> to your root layout

import { trace } from '@opentelemetry/api';
import { getBrowserPatchScript } from './browser-patch.js';

const TRACE_META_NAME = 'nextdog-trace-id';
const SPAN_META_NAME = 'nextdog-span-id';

const HEX_32 = /^[0-9a-f]{32}$/i;
const HEX_16 = /^[0-9a-f]{16}$/i;
// OTel uses an all-zero trace id to signal "no valid trace".
const INVALID_TRACE_ID = '0'.repeat(32);

/**
 * Read the ACTIVE server trace context (if any) from OpenTelemetry. This is the
 * trace of the request currently rendering the page, so stamping its id into the
 * document lets browser logs be correlated back to the originating request.
 *
 * Returns null when there is no active/valid trace, so callers can degrade to
 * today's behavior (no injection).
 */
export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  try {
    const span = trace.getActiveSpan();
    if (!span) return null;
    const ctx = span.spanContext();
    const traceId = ctx.traceId;
    const spanId = ctx.spanId;
    if (
      typeof traceId !== 'string' ||
      !HEX_32.test(traceId) ||
      traceId === INVALID_TRACE_ID ||
      typeof spanId !== 'string' ||
      !HEX_16.test(spanId)
    ) {
      return null;
    }
    return { traceId, spanId };
  } catch {
    // Reading trace context must never break a render.
    return null;
  }
}

/**
 * Meta-tag values for the active trace, for use with a framework's <meta>
 * mechanism (e.g. Next.js metadata `other`). Returns null in production or when
 * there is no active trace.
 */
export function getNextDogTraceMeta(): {
  [TRACE_META_NAME]: string;
  [SPAN_META_NAME]: string;
} | null {
  if (process.env.NODE_ENV !== 'development') return null;
  const ctx = getActiveTraceContext();
  if (!ctx) return null;
  return { [TRACE_META_NAME]: ctx.traceId, [SPAN_META_NAME]: ctx.spanId };
}

/**
 * HTML string of inert <meta> tags carrying the active server trace id. Safe to
 * place in <head>. Empty string in production or when no trace is active — never
 * corrupts the document, never injects a script, headers, body, or secrets.
 *
 * The trace id is the only thing exposed; it is low-sensitivity and the same id
 * already appears in the server logs the dashboard shows.
 */
export function getNextDogTraceMetaHtml(): string {
  const meta = getNextDogTraceMeta();
  if (!meta) return '';
  // Hex-only values (validated above); attribute-escape defensively anyway.
  const traceId = escapeAttr(meta[TRACE_META_NAME]);
  const spanId = escapeAttr(meta[SPAN_META_NAME]);
  return (
    `<meta name="${TRACE_META_NAME}" content="${traceId}">` +
    `<meta name="${SPAN_META_NAME}" content="${spanId}">`
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getNextDogScriptHtml(): string {
  if (process.env.NODE_ENV !== 'development') return '';
  const url = process.env.NEXTDOG_URL ?? 'http://localhost:6789';
  const serviceName = process.env.NEXTDOG_SERVICE_NAME ?? 'nextdog-app';
  // Inject the active server trace id as inert meta tags alongside the script so
  // the browser patch can read it on load and correlate browser logs to the
  // server trace. Empty string when no trace is active (graceful degradation).
  return `${getNextDogTraceMetaHtml()}<script>${getBrowserPatchScript(url, serviceName)}</script>`;
}

// For use with dangerouslySetInnerHTML in a React/Next component.
// Note: dangerouslySetInnerHTML can only carry the script body. To also inject
// the trace meta tag in this mode, render getNextDogTraceMetaHtml() (or
// getNextDogTraceMeta() via Next.js metadata) in <head> separately.
export function getNextDogScript(): { __html: string } | null {
  if (process.env.NODE_ENV !== 'development') return null;
  const url = process.env.NEXTDOG_URL ?? 'http://localhost:6789';
  const serviceName = process.env.NEXTDOG_SERVICE_NAME ?? 'nextdog-app';
  return { __html: getBrowserPatchScript(url, serviceName) };
}
