/**
 * Root-span selection for a trace's spans (issue #82).
 *
 * The detail pane and full-page trace view both need to identify the ROOT
 * request span — the top-level SERVER span (or, failing that, the first span) —
 * so it can be auto-selected on open, surfacing the request/response body +
 * attributes on the FIRST click instead of hiding them behind a waterfall drill.
 *
 * Pure and DOM-free so the auto-select behaviour can be unit-tested without
 * rendering.
 */

import type { SSEEvent } from '../hooks/use-sse';

/**
 * The root span of a trace: the parent-less SERVER span if present, else the
 * first span. Returns null for an empty span list. Mirrors the rooting rule the
 * Traces list (`groupByTrace`) already uses so the auto-selected span matches
 * the row the user clicked.
 */
export function findRootSpan(spans: SSEEvent[]): SSEEvent | null {
  if (spans.length === 0) return null;
  return spans.find((s) => s.data.kind === 'SERVER' && !s.data.parentSpanId) ?? spans[0];
}
