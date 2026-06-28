/**
 * Single source of truth for the Logs grid column layout.
 *
 * The Logs view builds a CSS grid whose `gridTemplateColumns` track count must
 * always equal the number of cells emitted per row — otherwise cells land in the
 * wrong track. In particular the `runtime` track is always present in the
 * template, so `LogRow` must always emit a `runtime` cell (a placeholder when the
 * log has no runtime attribute). See issue #18.
 */

import type { SSEEvent } from '../hooks/use-sse.js';
import type { CustomColumn } from './column-types.js';

/** Fixed base columns, in render order, that are always part of the grid template. */
export const LOG_BASE_TRACK_IDS = ['time', 'level', 'service', 'runtime', 'message'] as const;

/** A logical cell to render in a LogRow, in grid-track order. */
export interface LogCell {
  /** Column id, matching the corresponding grid track. */
  id: string;
  /** Display value (empty string for an intentional placeholder cell). */
  value: string;
}

export function runtimeTag(event: SSEEvent): string | null {
  const rt = event.data.attributes.runtime as string | undefined;
  return rt === 'server' || rt === 'browser' ? rt : null;
}

interface BuildCellsOptions {
  showService: boolean;
  /**
   * Custom columns to append, in order. `buildLogRowCells` only needs each
   * column's `id` (grid track) and `attrKey` (value source), so it accepts the
   * minimal shape — callers pass the canonical {@link CustomColumn}, which is a
   * superset.
   */
  customColumns: Pick<CustomColumn, 'id' | 'attrKey'>[];
}

/**
 * Build the ordered list of cells a LogRow renders.
 *
 * The length and ordering MUST match the grid tracks defined in `logs.tsx`
 * (`columnConfigs`). Critically, the `runtime` cell is ALWAYS emitted — as a
 * placeholder when the log has no runtime attribute — so a runtime-less row does
 * not shift its message into the fixed-width runtime track (issue #18).
 */
export function buildLogRowCells(
  event: SSEEvent,
  { showService, customColumns }: BuildCellsOptions,
): LogCell[] {
  const message = event.data.message ?? event.data.name ?? '';
  const level = event.data.level ?? event.data.status?.code ?? '';
  const cells: LogCell[] = [
    { id: 'time', value: String(event.data.timestamp ?? event.timestamp) },
    { id: 'level', value: String(level) },
  ];
  if (showService) {
    cells.push({ id: 'service', value: event.data.serviceName });
  }
  // Always present — placeholder when absent — to keep cell count == track count.
  cells.push({ id: 'runtime', value: runtimeTag(event) ?? '' });
  cells.push({ id: 'message', value: String(message) });
  for (const col of customColumns) {
    const raw = event.data.attributes[col.attrKey];
    cells.push({ id: col.id, value: raw != null ? String(raw) : '' });
  }
  return cells;
}
