import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import { ColumnPicker } from '../components/column-picker';
import type { CustomColumn } from '../components/column-types';
import { attrContextActions, showContextMenu } from '../components/context-menu';
import { SavedSearches, useSavedSearches } from '../components/saved-searches';
import { SearchBar } from '../components/search-bar';
import { ServicePills } from '../components/service-pills';
import { SortIndicator } from '../components/sort-indicator';
import { useColumnResize } from '../hooks/use-column-resize';
import type { UseEventsResult } from '../hooks/use-events';
import { useKeyboard } from '../hooks/use-keyboard';
import { useIsNarrow } from '../hooks/use-narrow';
import type { SSEEvent } from '../hooks/use-sse';
import { useVirtualList } from '../hooks/use-virtual-list';
import {
  computePercentiles,
  getDurationClassName,
  getHttpStatusClassName,
  statusErrorStyle,
  statusOkStyle,
} from '../styles/row-styles';
import {
  colHeaderStyle,
  colResizeStyle,
  emptyStyle,
  pillActiveStyle,
  pillStyle,
  toolbarStyle,
} from '../styles/shared';
import { interactiveProps } from '../utils/a11y';
import { formatDurationMs, formatTime, spanDurationMs } from '../utils/format';
import { buildHeatScale } from '../utils/latency-scale';
import { HeatDuration } from '../components/heat-duration';

/** Columns collapsed on narrow viewports so Name keeps its width (issue #50). */
const SPANS_NARROW_COLLAPSE: ReadonlySet<string> = new Set(['kind', 'service']);

const SPAN_COLUMNS_STORAGE_KEY = 'nextdog:span-columns';

type SortField = 'time' | 'name' | 'kind' | 'service' | 'duration' | 'status' | string;
type SortDir = 'asc' | 'desc';

/** A flattened span row — one per individual span (not grouped by trace). */
interface SpanRow {
  event: SSEEvent;
  traceId?: string;
  name: string;
  kind: string;
  serviceName: string;
  durationMs: number;
  duration: string;
  status: string;
  httpCode?: number;
  timestamp: number;
  extraAttrs: Record<string, string>;
}

function loadCustomColumns(): CustomColumn[] {
  try {
    const saved = localStorage.getItem(SPAN_COLUMNS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveCustomColumns(cols: CustomColumn[]) {
  try {
    localStorage.setItem(SPAN_COLUMNS_STORAGE_KEY, JSON.stringify(cols));
  } catch {}
}

function toSpanRow(event: SSEEvent, customColumns: CustomColumn[]): SpanRow {
  const { data } = event;
  const durationMs = spanDurationMs(event);
  const httpCode =
    (data.statusCode ?? (Number(data.attributes['http.status_code']) || undefined)) || undefined;
  const extraAttrs: Record<string, string> = {};
  for (const col of customColumns) {
    const val = data.attributes[col.attrKey];
    extraAttrs[col.id] = val != null ? String(val) : '';
  }
  return {
    event,
    traceId: data.traceId,
    name: data.name ?? '',
    kind: data.kind ?? '',
    serviceName: data.serviceName,
    durationMs,
    duration: formatDurationMs(durationMs),
    status: data.status?.code ?? 'OK',
    httpCode,
    timestamp: event.timestamp,
    extraAttrs,
  };
}

/* ── Styles ───────────────────────────────────────────────────────────── */

const spanRowStyle = css({
  display: 'grid',
  gap: '2',
  py: '1.5',
  px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  alignItems: 'center',
  cursor: 'pointer',
  fontFamily: 'mono',
  fontSize: 'md',
  minWidth: '0',
  '& > span': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  _hover: { background: 'surface.hover' },
});

const spanRowHeaderStyle = css({
  cursor: 'default',
  fontSize: 'xs',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'fg.dim',
  py: '1',
  px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  background: 'surface.panel',
  position: 'sticky',
  top: '0',
  zIndex: '1',
  _hover: { background: 'surface.panel' },
});

const spanRowSelectedStyle = css({
  background: 'surface.hover',
  outline: '1px solid token(colors.accent)',
  outlineOffset: '-1px',
});

const timestampStyle = css({ color: 'fg.dim' });
const nameStyle = css({ color: 'fg' });
const kindStyle = css({ color: 'fg.dim', textTransform: 'uppercase', fontSize: 'sm' });
const serviceStyle = css({ color: 'blue' });
const customColStyle = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '120px',
  color: 'fg.dim',
});

/* ── Component ────────────────────────────────────────────────────────── */

interface SpansProps {
  path?: string;
  eventsResult: UseEventsResult;
  onOpenTrace?: (traceId: string) => void;
}

export function Spans({ eventsResult, onOpenTrace }: SpansProps) {
  const {
    filtered,
    services,
    activeServices,
    toggleService,
    setServices,
    searchQuery,
    setSearchQuery,
  } = eventsResult;
  const { recordRecent } = useSavedSearches();

  const applySearch = useCallback(
    (query: string, svcs: string[]) => {
      setSearchQuery(query);
      setServices(svcs);
    },
    [setSearchQuery, setServices],
  );

  // Record the active filter in the recent ring once it settles (debounced).
  useEffect(() => {
    const query = searchQuery.trim();
    const svcs = [...activeServices];
    if (!query && svcs.length === 0) return;
    const t = setTimeout(() => recordRecent({ query: searchQuery, services: svcs }), 1500);
    return () => clearTimeout(t);
  }, [searchQuery, activeServices, recordRecent]);

  const [sortBy, setSortBy] = useState<SortField>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>(loadCustomColumns);

  // Live-tail / pause — mirrors the Traces and Logs controls (issue #53).
  const [liveTail, setLiveTail] = useState(true);
  const [frozen, setFrozen] = useState<SSEEvent[]>([]);
  const sourceEvents = liveTail ? filtered : frozen;
  const spanEvents = useMemo(
    () => sourceEvents.filter((e) => e.type === 'span'),
    [sourceEvents],
  );
  const toggleLiveTail = () => {
    if (liveTail) {
      setFrozen([...filtered]);
      setLiveTail(false);
    } else {
      setLiveTail(true);
    }
  };

  const BUILTIN_FIELDS = new Set([
    'http.method',
    'http.request.method',
    'http.route',
    'http.target',
    'http.status_code',
    'http.response.status_code',
    'runtime',
    'level',
    'message',
    'service',
    'serviceName',
    'traceId',
    'spanId',
    'timestamp',
    'kind',
    'name',
    'type',
  ]);

  const availableAttrs = useMemo(() => {
    const keys = new Set<string>();
    for (const e of spanEvents) {
      if (e.data.attributes) {
        for (const k of Object.keys(e.data.attributes)) {
          if (!BUILTIN_FIELDS.has(k)) keys.add(k);
        }
      }
    }
    for (const col of customColumns) keys.delete(col.attrKey);
    return [...keys].sort();
  }, [spanEvents, customColumns]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'time' ? 'desc' : 'asc');
    }
  };

  const rows = useMemo(() => {
    const list = spanEvents.map((e) => toSpanRow(e, customColumns));
    // Newest-first by default to match the Traces view.
    list.reverse();
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortBy) {
        case 'time':
          return (a.timestamp - b.timestamp) * dir;
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'kind':
          return a.kind.localeCompare(b.kind) * dir;
        case 'service':
          return a.serviceName.localeCompare(b.serviceName) * dir;
        case 'duration':
          return (a.durationMs - b.durationMs) * dir;
        case 'status':
          return ((a.httpCode ?? 0) - (b.httpCode ?? 0) || a.status.localeCompare(b.status)) * dir;
        default: {
          const av = a.extraAttrs[sortBy] ?? '';
          const bv = b.extraAttrs[sortBy] ?? '';
          const an = Number(av);
          const bn = Number(bv);
          if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
          return av.localeCompare(bv) * dir;
        }
      }
    });
    return list;
  }, [spanEvents, sortBy, sortDir, customColumns]);

  const percentiles = useMemo(() => computePercentiles(rows.map((r) => r.durationMs)), [rows]);
  // Shared latency heat scale across the visible rows (issue #82).
  const heatScale = useMemo(() => buildHeatScale(rows.map((r) => r.durationMs)), [rows]);

  const { scrollRef, onScroll, rowRef, range, scrollToIndex } = useVirtualList(rows.length);

  const openRow = useCallback(
    (row: SpanRow) => {
      if (row.traceId) onOpenTrace?.(row.traceId);
    },
    [onOpenTrace],
  );

  useKeyboard({
    onNext: () => setSelectedIndex((i) => Math.min(i + 1, rows.length - 1)),
    onPrev: () => setSelectedIndex((i) => Math.max(i - 1, 0)),
    onSelect: () => {
      if (selectedIndex >= 0 && rows[selectedIndex]) openRow(rows[selectedIndex]);
    },
    onBack: () => setSelectedIndex(-1),
  });

  useEffect(() => {
    if (selectedIndex >= 0) scrollToIndex(selectedIndex);
  }, [selectedIndex, scrollToIndex]);

  const addColumn = (attrKey: string) => {
    const label = attrKey.split('.').pop() ?? attrKey;
    const col: CustomColumn = { id: `custom-${attrKey}`, label, attrKey };
    const next = [...customColumns, col];
    setCustomColumns(next);
    saveCustomColumns(next);
  };

  const removeColumn = (id: string) => {
    const next = customColumns.filter((c) => c.id !== id);
    setCustomColumns(next);
    saveCustomColumns(next);
  };

  const activeColumnKeys = useMemo(
    () => new Set(customColumns.map((c) => c.attrKey)),
    [customColumns],
  );

  const handleCellContext = useCallback(
    (e: MouseEvent, key: string, value: string) => {
      e.preventDefault();
      const actions = attrContextActions(key, value, {
        onFilter: (q) => setSearchQuery((prev) => (prev ? `${prev} ${q}` : q)),
        onAddColumn: (k) => addColumn(k),
        onRemoveColumn: (k) => {
          const col = customColumns.find((c) => c.attrKey === k);
          if (col) removeColumn(col.id);
        },
        isColumnActive: activeColumnKeys.has(key),
      });
      showContextMenu(e.clientX, e.clientY, actions);
    },
    [setSearchQuery, addColumn, removeColumn, customColumns, activeColumnKeys],
  );

  const columnConfigs = useMemo(
    () => [
      { id: 'time', defaultWidth: 75 },
      { id: 'name', defaultWidth: 0 }, // 0 = flex (1fr)
      { id: 'kind', defaultWidth: 70 },
      { id: 'service', defaultWidth: 90 },
      { id: 'duration', defaultWidth: 75 },
      { id: 'status', defaultWidth: 60 },
      ...customColumns.map((col) => ({ id: col.id, defaultWidth: 120 })),
    ],
    [customColumns],
  );

  const narrow = useIsNarrow();
  const collapsedIds = useMemo(() => (narrow ? SPANS_NARROW_COLLAPSE : undefined), [narrow]);
  const { gridTemplate, startResize } = useColumnResize('spans', columnConfigs, collapsedIds);

  return (
    <>
      <ServicePills
        services={services}
        active={activeServices}
        onToggle={toggleService}
        events={filtered}
      />
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        events={filtered}
        rightSlot={
          <>
            <SavedSearches query={searchQuery} services={[...activeServices]} onApply={applySearch} />
            <ColumnPicker
              customColumns={customColumns}
              availableAttrs={availableAttrs}
              onAdd={addColumn}
              onRemove={removeColumn}
            />
          </>
        }
      />

      <div className={toolbarStyle}>
        <button
          type="button"
          className={`${pillStyle} ${liveTail ? pillActiveStyle : ''}`}
          onClick={toggleLiveTail}
        >
          {liveTail ? '● Live' : '○ Paused'}
        </button>
        <span className={css({ fontSize: 'sm', color: 'fg.dim' })}>{rows.length} spans</span>
        {!liveTail && (
          <button type="button" className={pillStyle} onClick={toggleLiveTail}>
            Resume
          </button>
        )}
      </div>

      {/* Column headers — click to sort, drag edge to resize */}
      <div
        className={`${spanRowStyle} ${spanRowHeaderStyle}`}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {[
          { id: 'time', label: 'Time' },
          { id: 'name', label: 'Name' },
          { id: 'kind', label: 'Kind' },
          { id: 'service', label: 'Service' },
          { id: 'duration', label: 'Duration' },
          { id: 'status', label: 'Status' },
          ...customColumns.map((col) => ({ id: col.id, label: col.label })),
        ].map((col) => (
          <span
            key={col.id}
            role="button"
            tabIndex={0}
            className={colHeaderStyle}
            {...interactiveProps(() => toggleSort(col.id))}
          >
            {col.label}
            <SortIndicator field={col.id} sortBy={sortBy} sortDir={sortDir} />
            <span
              className={colResizeStyle}
              onPointerDown={(e: PointerEvent) => {
                e.stopPropagation();
                startResize(col.id, e.clientX);
              }}
            />
          </span>
        ))}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={css({
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          fontFamily: 'mono',
          fontSize: 'md',
        })}
      >
        {rows.length === 0 ? (
          <div className={emptyStyle}>
            {searchQuery || activeServices.size > 0 ? 'No spans match this filter' : 'No spans yet'}
          </div>
        ) : (
          <>
            {range.paddingTop > 0 && <div style={{ height: `${range.paddingTop}px` }} />}
            {rows.slice(range.startIndex, range.endIndex + 1).map((row, j) => {
              const i = range.startIndex + j;
              return (
                <div
                  key={row.event.data.spanId ?? i}
                  ref={j === 0 ? rowRef : undefined}
                  role="button"
                  tabIndex={0}
                  className={`${spanRowStyle} ${i === selectedIndex ? spanRowSelectedStyle : ''}`}
                  style={{ gridTemplateColumns: gridTemplate }}
                  {...interactiveProps(() => {
                    setSelectedIndex(i);
                    openRow(row);
                  })}
                >
                  <span className={timestampStyle}>{formatTime(row.timestamp)}</span>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28) */}
                  <span
                    className={nameStyle}
                    onContextMenu={(e: MouseEvent) => handleCellContext(e, 'name', row.name)}
                  >
                    {row.name}
                  </span>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28) */}
                  <span
                    className={kindStyle}
                    onContextMenu={(e: MouseEvent) => handleCellContext(e, 'kind', row.kind)}
                  >
                    {row.kind}
                  </span>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28) */}
                  <span
                    className={serviceStyle}
                    onContextMenu={(e: MouseEvent) =>
                      handleCellContext(e, 'service', row.serviceName)
                    }
                  >
                    {row.serviceName}
                  </span>
                  <HeatDuration
                    durationMs={row.durationMs}
                    label={row.duration}
                    scale={heatScale}
                    className={getDurationClassName(row.durationMs, percentiles)}
                  />

                  {row.httpCode ? (
                    // biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28)
                    <span
                      className={getHttpStatusClassName(row.httpCode)}
                      onContextMenu={(e: MouseEvent) =>
                        handleCellContext(e, 'statusCode', String(row.httpCode))
                      }
                    >
                      {row.httpCode}
                    </span>
                  ) : (
                    // biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28)
                    <span
                      className={row.status === 'ERROR' ? statusErrorStyle : statusOkStyle}
                      onContextMenu={(e: MouseEvent) => handleCellContext(e, 'status', row.status)}
                    >
                      {row.status}
                    </span>
                  )}
                  {customColumns.map((col) => (
                    // biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28)
                    <span
                      key={col.id}
                      className={customColStyle}
                      title={row.extraAttrs[col.id]}
                      onContextMenu={(e: MouseEvent) =>
                        handleCellContext(e, col.attrKey, row.extraAttrs[col.id])
                      }
                    >
                      {row.extraAttrs[col.id] || '—'}
                    </span>
                  ))}
                </div>
              );
            })}
            {range.paddingBottom > 0 && <div style={{ height: `${range.paddingBottom}px` }} />}
          </>
        )}
      </div>
    </>
  );
}
