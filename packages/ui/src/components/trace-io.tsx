// ---------------------------------------------------------------------------
// UI affordances for trace export/import (issue #7):
//   - ExportButton: a pill that downloads events as a self-contained file.
//   - OpenTraceButton: "Open trace file" picker (hidden <input type=file>).
//   - ImportDropZone: a full-window drag-and-drop overlay for trace files.
//   - ImportedBadge: the "viewing imported trace" banner + Exit-to-live button.
//
// All file I/O goes through utils/trace-export-io (File API + Blob, no libs).
// ---------------------------------------------------------------------------

import type { ComponentChildren } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { pillStyle } from '../styles/shared';
import type { ExportMeta, ParseResult } from '../utils/trace-export';
import { downloadExport, readImportFile } from '../utils/trace-export-io';

/* ── Export ───────────────────────────────────────────────────────────── */

interface ExportButtonProps {
  events: SSEEvent[];
  meta: ExportMeta;
  label?: string;
  title?: string;
  className?: string;
}

/** Pill that downloads `events` as a self-contained NextDog export file. */
export function ExportButton({ events, meta, label, title, className }: ExportButtonProps) {
  const onClick = useCallback(() => {
    if (events.length === 0) return;
    downloadExport(events, meta);
  }, [events, meta]);

  const text = label ?? (meta.kind === 'trace' ? 'Export trace' : 'Export view');
  return (
    <button
      type="button"
      class={className ?? pillStyle}
      onClick={onClick}
      disabled={events.length === 0}
      title={
        title ??
        `Download ${events.length} event${events.length === 1 ? '' : 's'} as a portable file`
      }
    >
      {text}
    </button>
  );
}

/* ── Open file (picker) ───────────────────────────────────────────────── */

interface OpenTraceButtonProps {
  onImport: (result: ParseResult, fileName: string) => void;
  label?: string;
  className?: string;
}

/** "Open trace file" pill backed by a hidden file input. */
export function OpenTraceButton({ onImport, label, className }: OpenTraceButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = useCallback(
    async (e: Event) => {
      const input = e.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // allow re-selecting the same file
      if (!file) return;
      const result = await readImportFile(file);
      onImport(result, file.name);
    },
    [onImport],
  );

  return (
    <>
      <button
        type="button"
        class={className ?? pillStyle}
        onClick={() => inputRef.current?.click()}
        title="Open an exported NextDog trace file (read-only)"
      >
        {label ?? 'Open trace file'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={onChange}
        class={css({ display: 'none' })}
      />
    </>
  );
}

/* ── Drop zone overlay ────────────────────────────────────────────────── */

const dropOverlayStyle = css({
  position: 'fixed',
  inset: '0',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(2px)',
  pointerEvents: 'none',
});

const dropCardStyle = css({
  px: '8',
  py: '6',
  borderRadius: 'lg',
  border: '2px dashed token(colors.accent)',
  background: 'surface.panel',
  color: 'fg.bright',
  fontSize: 'xl',
  fontWeight: 600,
  textAlign: 'center',
});

interface ImportDropZoneProps {
  onImport: (result: ParseResult, fileName: string) => void;
  children: ComponentChildren;
}

/**
 * Wraps the app; a window-wide drag of a file shows an overlay and, on drop,
 * reads + validates the first file through the same import path as the picker.
 */
export function ImportDropZone({ onImport, children }: ImportDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const result = await readImportFile(file);
      onImport(result, file.name);
    },
    [onImport],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop import zone; keyboard users import via the Import button instead (parked 2026-06-28)
    <div
      class={css({ display: 'contents' })}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {dragging && (
        <div class={dropOverlayStyle}>
          <div class={dropCardStyle}>Drop a NextDog trace file to open it</div>
        </div>
      )}
    </div>
  );
}

/* ── Imported badge / exit-to-live banner ─────────────────────────────── */

const importedBarStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  py: '1.5',
  px: '4',
  background: 'rgba(116, 185, 255, 0.12)',
  borderBottom: '1px solid token(colors.border.subtle)',
  fontSize: 'sm',
  color: 'fg.bright',
  flexShrink: 0,
});

const importedTagStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  px: '2',
  py: '0.5',
  borderRadius: 'full',
  background: 'blue',
  color: 'surface.bg',
  fontWeight: 600,
  fontSize: 'xs',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
});

const fileNameStyle = css({
  fontFamily: 'mono',
  color: 'fg',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '40ch',
});

interface ImportedBadgeProps {
  fileName: string;
  eventCount: number;
  onExit: () => void;
}

/** Banner shown while viewing an imported (read-only, no-SSE) trace. */
export function ImportedBadge({ fileName, eventCount, onExit }: ImportedBadgeProps) {
  return (
    <div class={importedBarStyle}>
      <span class={importedTagStyle}>Imported</span>
      <span>Read-only · live stream paused ·</span>
      <span class={fileNameStyle} title={fileName}>
        {fileName}
      </span>
      <span class={css({ color: 'fg.dim' })}>({eventCount} events)</span>
      <button
        type="button"
        class={`${pillStyle} ${css({ marginLeft: 'auto' })}`}
        onClick={onExit}
        title="Return to the live stream"
      >
        Exit to live
      </button>
    </div>
  );
}
