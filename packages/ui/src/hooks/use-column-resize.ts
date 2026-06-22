import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

const STORAGE_KEY_PREFIX = 'nextdog:col-widths:';
const MIN_WIDTH = 40;

export interface ColumnConfig {
  id: string;
  defaultWidth: number;
}

function loadWidths(viewId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + viewId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWidths(viewId: string, widths: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + viewId, JSON.stringify(widths));
  } catch {}
}

interface DragState {
  colId: string;
  rightColId: string | null;
  startX: number;
  startWidth: number;
  rightStartWidth: number;
}

export function useColumnResize(viewId: string, columns: ColumnConfig[]) {
  const [overrides, setOverrides] = useState<Record<string, number>>(() => loadWidths(viewId));
  const dragging = useRef<DragState | null>(null);
  const pendingUpdate = useRef<Record<string, number> | null>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    saveWidths(viewId, overrides);
  }, [viewId, overrides]);

  useEffect(() => {
    const flushPending = () => {
      if (pendingUpdate.current) {
        const update = pendingUpdate.current;
        pendingUpdate.current = null;
        setOverrides((prev) => ({ ...prev, ...update }));
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const { colId, rightColId, startX, startWidth, rightStartWidth } = dragging.current;
      const delta = e.clientX - startX;

      const newWidth = Math.max(MIN_WIDTH, startWidth + delta);
      const actualDelta = newWidth - startWidth;

      const update: Record<string, number> = { [colId]: newWidth };

      // Steal from the right neighbor (if it's a fixed-width column)
      if (rightColId && rightStartWidth > 0) {
        const newRightWidth = Math.max(MIN_WIDTH, rightStartWidth - actualDelta);
        update[rightColId] = newRightWidth;
      }

      pendingUpdate.current = update;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(flushPending);
    };

    const onUp = () => {
      if (!dragging.current) return;
      if (pendingUpdate.current) {
        const update = pendingUpdate.current;
        pendingUpdate.current = null;
        setOverrides((prev) => ({ ...prev, ...update }));
      }
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  const startResize = useCallback(
    (colId: string, startX: number) => {
      const colIndex = columns.findIndex((c) => c.id === colId);
      const col = columns[colIndex];
      if (!col) return;

      const width = overrides[colId] ?? col.defaultWidth ?? 100;

      // Find the right neighbor (skip flex columns — they adjust automatically)
      let rightColId: string | null = null;
      let rightStartWidth = 0;
      for (let i = colIndex + 1; i < columns.length; i++) {
        if (columns[i].defaultWidth !== 0) {
          rightColId = columns[i].id;
          rightStartWidth = overrides[columns[i].id] ?? columns[i].defaultWidth;
          break;
        }
      }

      dragging.current = { colId, rightColId, startX, startWidth: width, rightStartWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [overrides, columns],
  );

  const gridTemplate = useMemo(() => {
    return columns
      .map((col) => {
        const w = overrides[col.id] ?? col.defaultWidth;
        if (col.defaultWidth === 0) return '1fr';
        return `${w}px`;
      })
      .join(' ');
  }, [columns, overrides]);

  const resetWidths = useCallback(() => {
    setOverrides({});
    try {
      localStorage.removeItem(STORAGE_KEY_PREFIX + viewId);
    } catch {}
  }, [viewId]);

  return { gridTemplate, startResize, resetWidths };
}
