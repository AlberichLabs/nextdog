// ---------------------------------------------------------------------------
// Thin browser I/O wrappers around the pure trace-export module (issue #7).
// Uses only the standard File API + Blob/anchor download — no libraries. Kept
// separate from trace-export.ts so the serialize/validate logic stays DOM-free
// and unit-testable.
// ---------------------------------------------------------------------------

import type { SSEEvent } from '../hooks/use-sse.js';
import {
  type ExportMeta,
  exportFilename,
  type ParseResult,
  parseImport,
  serializeExport,
} from './trace-export.js';

/** Serialize events and trigger a browser download of the self-contained file. */
export function downloadExport(events: SSEEvent[], meta: ExportMeta): void {
  const text = serializeExport(events, meta);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(meta);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a dropped/selected File and validate it as a NextDog export. */
export async function readImportFile(file: File): Promise<ParseResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'Could not read the file.' };
  }
  return parseImport(text);
}
