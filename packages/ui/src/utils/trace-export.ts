// ---------------------------------------------------------------------------
// Pure (DOM-free) serialize/validate logic for trace export & import (issue #7).
//
// Export writes a single self-contained JSON envelope: a small header carrying
// a `nextdog` marker + format `version` so an import can be validated and
// foreign/old files rejected with a clear message, plus the raw event list. The
// events are the exact same `SSEEvent` objects the live UI renders, so an
// imported file flows through the identical waterfall / logs / detail-pane
// rendering with no transformation.
//
// Kept free of Preact/DOM (mirrors saved-searches-store.ts / toast-store.ts) so
// round-tripping and validation are unit-testable with plain vitest. The UI
// wrappers (Blob download, File read) live in trace-export-io.ts. No runtime
// dependencies — this ships inside users' dev servers.
// ---------------------------------------------------------------------------

import type { SSEEvent } from '../hooks/use-sse';
import { redactEventsForExport } from './redact';

/** Marker that identifies a file as a NextDog export. */
export const EXPORT_MARKER = 'nextdog-trace-export';
/** Current envelope format version. Bumped on breaking shape changes. */
export const EXPORT_VERSION = 1;

/** What an export captures: a single trace, or the current filtered view. */
export type ExportKind = 'trace' | 'view';

export interface ExportMeta {
  kind: ExportKind;
  /** Present for `kind: 'trace'`; the traceId that was exported. */
  traceId?: string;
}

/** The on-disk file shape. Header fields first, events last. */
export interface ExportEnvelope extends ExportMeta {
  nextdog: typeof EXPORT_MARKER;
  version: number;
  /** Epoch ms the file was produced. */
  exportedAt: number;
  /** Count of events, for a quick truncation/sanity check on import. */
  eventCount: number;
  events: SSEEvent[];
}

export type ParseResult =
  | { ok: true; events: SSEEvent[]; envelope: ExportEnvelope }
  | { ok: false; error: string };

/**
 * Serialize events into a self-contained export string (pretty-printed JSON).
 * Export is an egress boundary, so events are first routed through the shared
 * redactor ({@link redactEventsForExport}) — credential headers captured for
 * Replay are stripped by default so tokens never leave the machine (#60).
 * Everything else round-trips verbatim, so import remains a pure inverse.
 */
export function serializeExport(events: SSEEvent[], meta: ExportMeta): string {
  const safeEvents = redactEventsForExport(events);
  const envelope: ExportEnvelope = {
    nextdog: EXPORT_MARKER,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    kind: meta.kind,
    ...(meta.traceId ? { traceId: meta.traceId } : {}),
    eventCount: safeEvents.length,
    events: safeEvents,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Timing fields that flow into BigInt() on the render path (format.ts parseNano,
 * waterfall.tsx buildTimings). Imported files are attacker-controlled (issue
 * #44), so any present timing value must be a string/number that parses as a
 * non-negative integer — otherwise the unguarded BigInt() would throw and, with
 * no error boundary above it, blank the whole dashboard. Absent fields are fine
 * (logs and untimed spans are valid).
 */
const NANO_TIMING_FIELDS = ['startTimeUnixNano', 'endTimeUnixNano'] as const;

/** True if `value` is absent, or a string/number that is a non-negative integer nano value. */
function isValidNano(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  // The server may serialize a BigInt with a trailing 'n' (e.g. "1500000000n").
  const s = typeof value === 'string' && value.endsWith('n') ? value.slice(0, -1) : String(value);
  if (s === '') return false;
  // Non-negative integer only: no decimals, signs, exponents, or garbage.
  return /^\d+$/.test(s);
}

/** Minimal structural check that a parsed entry looks like an SSEEvent. */
function isEventShaped(value: unknown): value is SSEEvent {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  if (e.type !== 'span' && e.type !== 'log') return false;
  if (typeof e.data !== 'object' || e.data === null) return false;
  const d = e.data as Record<string, unknown>;
  // `attributes` and `serviceName` are present on every real event and are
  // relied on throughout the rendering path (filter, waterfall, detail).
  if (typeof d.attributes !== 'object' || d.attributes === null) return false;
  if (typeof d.serviceName !== 'string') return false;
  // Timing fields, if present, must be parseable as non-negative integers (#44).
  for (const field of NANO_TIMING_FIELDS) {
    if (!isValidNano(d[field])) return false;
  }
  return true;
}

/**
 * Parse + validate an import string. Fails gracefully (never throws) with a
 * human-readable message on malformed JSON, a missing/foreign marker, an
 * unsupported version, or a truncated / wrong-shaped event list.
 */
export function parseImport(text: string): ParseResult {
  if (!text || text.trim() === '') {
    return { ok: false, error: 'The file is empty.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'Could not parse the file — it is not valid JSON (malformed or truncated).',
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'This is not a nextdog trace export.' };
  }

  const env = parsed as Record<string, unknown>;

  if (env.nextdog !== EXPORT_MARKER) {
    return { ok: false, error: 'This is not a nextdog trace export (missing the nextdog marker).' };
  }

  if (typeof env.version !== 'number') {
    return { ok: false, error: 'This export is missing a format version.' };
  }
  if (env.version > EXPORT_VERSION) {
    return {
      ok: false,
      error: `This file uses export version ${env.version}, newer than this NextDog supports (${EXPORT_VERSION}). Update NextDog to open it.`,
    };
  }

  if (!Array.isArray(env.events)) {
    return { ok: false, error: 'This export has no events array — the file may be truncated.' };
  }

  if (!env.events.every(isEventShaped)) {
    // Distinguish a bad-timing rejection (#44) from a generic shape failure so
    // the user gets an actionable message, matching the other rejections.
    const hasBadTiming = env.events.some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { data?: unknown }).data === 'object' &&
        (e as { data: Record<string, unknown> }).data !== null &&
        NANO_TIMING_FIELDS.some(
          (f) => !isValidNano((e as { data: Record<string, unknown> }).data[f]),
        ),
    );
    return {
      ok: false,
      error: hasBadTiming
        ? 'This export contains a span with an invalid timing value (startTimeUnixNano/endTimeUnixNano must be a non-negative integer).'
        : 'This export contains entries that are not valid NextDog events.',
    };
  }

  const events = env.events as SSEEvent[];
  const envelope: ExportEnvelope = {
    nextdog: EXPORT_MARKER,
    version: env.version,
    exportedAt: typeof env.exportedAt === 'number' ? env.exportedAt : Date.now(),
    kind: env.kind === 'view' ? 'view' : 'trace',
    ...(typeof env.traceId === 'string' ? { traceId: env.traceId } : {}),
    eventCount: typeof env.eventCount === 'number' ? env.eventCount : events.length,
    events,
  };

  return { ok: true, events, envelope };
}

/** Slugify an arbitrary id for safe use in a download filename. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
}

/** Suggested download filename for an export. */
export function exportFilename(meta: ExportMeta): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (meta.kind === 'trace' && meta.traceId) {
    return `nextdog-trace-${slug(meta.traceId)}-${stamp}.json`;
  }
  return `nextdog-view-${stamp}.json`;
}
