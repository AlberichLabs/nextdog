// ---------------------------------------------------------------------------
// Pure state model for "imported, read-only" mode (issue #7).
//
// When a user opens an exported trace file the dashboard switches into a
// read-only session: the imported events replace the live stream (no SSE, no
// history reload), badged as imported, with a way back to live. The session is
// just data — the imported events flow through the SAME views/components as
// live data. `null` means "live mode". Kept DOM-free so the enter/exit
// transitions are unit-testable.
// ---------------------------------------------------------------------------

import type { SSEEvent } from '../hooks/use-sse';
import type { ExportKind, ParseResult } from './trace-export';

export interface ImportedSessionData {
  events: SSEEvent[];
  /** Original file name, shown in the imported badge. */
  fileName: string;
  kind: ExportKind;
  traceId?: string;
}

/** `null` = live mode; an object = an active read-only imported session. */
export type ImportedSession = ImportedSessionData | null;

/**
 * Build an imported session from a successful parse result. Caller guarantees
 * `result.ok` (the UI only enters on a valid file).
 */
export function enterImported(
  result: Extract<ParseResult, { ok: true }>,
  fileName: string,
): ImportedSessionData {
  return {
    events: result.events,
    fileName,
    kind: result.envelope.kind,
    ...(result.envelope.traceId ? { traceId: result.envelope.traceId } : {}),
  };
}

/** Leave imported mode and return to the live stream. */
export function exitImported(): ImportedSession {
  return null;
}
