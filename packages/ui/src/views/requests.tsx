import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import { ColumnPicker } from '../components/column-picker';
import type { ColumnDef, CustomColumn } from '../components/column-types';
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
  getMethodClassName,
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
import { extractHttpMeta, formatDurationMs, formatTime, spanDurationMs } from '../utils/format';
import { buildHeatScale } from '../utils/latency-scale';
import { HeatDuration } from '../components/heat-duration';

/** Columns collapsed on narrow viewports so Route keeps its width (issue #50). */
const REQUESTS_NARROW_COLLAPSE: ReadonlySet<string> = new Set(['duration', 'service']);

interface RequestGroup {
  traceId: string;
  method: string;
  routePath: string;
  status: string;
  httpCode?: number;
  duration: string;
  durationMs: number;
  serviceName: string;
  spans: SSEEvent[];
  timestamp: number;
  /** Arbitrary extra attributes keyed by column ID */
  extraAttrs: Record<string, string>;
}

const CORE_COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'Time', core: true },
  { id: 'method', label: 'Method', core: true },
  { id: 'route', label: 'Route', core: true },
  { id: 'status', label: 'Status', core: true },
  { id: 'duration', label: 'Duration', core: true },
  { id: 'service', label: 'Service', core: true },
];

const COLUMNS_STORAGE_KEY = 'nextdog:request-columns';

function loadCustomColumns(): CustomColumn[] {
  try {
    const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveCustomColumns(cols: CustomColumn[]) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(cols));
  } catch {}
}

function groupByTrace(events: SSEEvent[], customColumns: CustomColumn[]): RequestGroup[] {
  const groups = new Map<string, SSEEvent[]>();
  for (const event of events) {
    const traceId = event.data.traceId;
    if (!traceId) continue;
    let group = groups.get(traceId);
    if (!group) {
      group = [];
      groups.set(traceId, group);
    }
    group.push(event);
  }

  return [...groups.entries()]
    .map(([traceId, spans]) => {
      const rootSpan =
        spans.find((s) => s.data.kind === 'SERVER' && !s.data.parentSpanId) ?? spans[0];
      const { method, route: routePath } = extractHttpMeta(
        rootSpan.data.attributes,
        rootSpan.data.name,
      );
      const statusCode = rootSpan.data.status?.code ?? 'OK';
      const httpCode =
        (rootSpan.data as any).statusCode ??
        (Number(rootSpan.data.attributes['http.status_code']) || undefined);
      const durationMs = spanDurationMs(rootSpan);
      const duration = formatDurationMs(durationMs);

      // Extract custom column values
      const extraAttrs: Record<string, string> = {};
      for (const col of customColumns) {
        if (col.attrKey) {
          const val = rootSpan.data.attributes[col.attrKey];
          extraAttrs[col.id] = val != null ? String(val) : '';
        }
      }

      return {
        traceId,
        method,
        routePath,
        status: statusCode,
        httpCode,
        duration,
        durationMs,
        serviceName: rootSpan.data.serviceName,
        spans,
        timestamp: rootSpan.timestamp,
        extraAttrs,
      };
    })
    .reverse();
}

type SortField = 'time' | 'method' | 'route' | 'status' | 'duration' | 'service' | string;
type SortDir = 'asc' | 'desc';

/* ── PandaCSS style constants ─────────────────────────────────────────── */

const requestRowStyle = css({
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
  _hover: {
    background: 'surface.hover',
  },
});

const requestRowHeaderStyle = css({
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
  _hover: {
    background: 'surface.panel',
  },
});

const requestRowSelectedStyle = css({
  background: 'surface.hover',
  outline: '1px solid token(colors.accent)',
  outlineOffset: '-1px',
});

const timestampStyle = css({
  color: 'fg.dim',
});

const routeStyle = css({
  color: 'fg',
});

const serviceStyle = css({
  color: 'blue',
});

const customColStyle = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '120px',
  color: 'fg.dim',
});

interface RequestsProps {
  path?: string;
  eventsResult: UseEventsResult;
  onOpenTrace?: (traceId: string) => void;
}

export function Requests({ eventsResult, onOpenTrace }: RequestsProps) {
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

  // Record the active filter in the recent ring once it settles (debounced so
  // we capture searches the user actually ran, not every keystroke). De-dupe
  // and capping live in the store.
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

  // Live-tail / pause — mirrors the Logs view control (issue #53). The Spans
  // view streams silently otherwise; pausing freezes the current event snapshot
  // so new spans stop being prepended, and resuming catches back up to live.
  const [liveTail, setLiveTail] = useState(true);
  const [frozenEvents, setFrozenEvents] = useState<SSEEvent[]>([]);
  const displayEvents = liveTail ? filtered : frozenEvents;
  const toggleLiveTail = () => {
    if (liveTail) {
      setFrozenEvents([...filtered]);
      setLiveTail(false);
    } else {
      setLiveTail(true);
    }
  };

  // TODO(parked 2026-06-22): `allColumns` (and its input `CORE_COLUMNS`) are an
  // unwired column-customization feature — computed but never rendered. Biome flags
  // it as dead; suppressed rather than ripple-deleted here to avoid a feature-removal
  // refactor inside a lint-adoption PR. See memos/parked-questions.md.
  // biome-ignore lint/correctness/noUnusedVariables: unwired feature, see TODO above
  const allColumns = useMemo(() => [...CORE_COLUMNS, ...customColumns], [customColumns]);

  // Built-in fields already shown as core columns
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

  // Discover available attribute keys from the events for the column picker
  const availableAttrs = useMemo(() => {
    const keys = new Set<string>();
    for (const e of displayEvents) {
      if (e.data.attributes) {
        for (const k of Object.keys(e.data.attributes)) {
          if (!BUILTIN_FIELDS.has(k)) keys.add(k);
        }
      }
    }
    // Remove already-added custom columns
    for (const col of customColumns) {
      if (col.attrKey) keys.delete(col.attrKey);
    }
    return [...keys].sort();
  }, [displayEvents, customColumns]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'time' ? 'desc' : 'asc');
    }
  };

  const groups = useMemo(() => {
    const g = groupByTrace(displayEvents, customColumns);
    const dir = sortDir === 'asc' ? 1 : -1;
    g.sort((a, b) => {
      switch (sortBy) {
        case 'time':
          return (a.timestamp - b.timestamp) * dir;
        case 'method':
          return a.method.localeCompare(b.method) * dir;
        case 'route':
          return a.routePath.localeCompare(b.routePath) * dir;
        case 'status':
          return ((a.httpCode ?? 0) - (b.httpCode ?? 0)) * dir;
        case 'duration':
          return (a.durationMs - b.durationMs) * dir;
        case 'service':
          return a.serviceName.localeCompare(b.serviceName) * dir;
        default: {
          // Custom column sort
          const av = a.extraAttrs[sortBy] ?? '';
          const bv = b.extraAttrs[sortBy] ?? '';
          const an = Number(av),
            bn = Number(bv);
          if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
          return av.localeCompare(bv) * dir;
        }
      }
    });
    return g;
  }, [displayEvents, sortBy, sortDir, customColumns]);

  const percentiles = useMemo(() => computePercentiles(groups.map((g) => g.durationMs)), [groups]);
  // Shared latency heat scale across the visible rows (issue #82).
  const heatScale = useMemo(() => buildHeatScale(groups.map((g) => g.durationMs)), [groups]);

  // Windowed rendering — only the visible rows (+ overscan) hit the DOM so the
  // list stays smooth as the SSE buffer fills (issue #9).
  const { scrollRef, onScroll, rowRef, range, scrollToIndex } = useVirtualList(groups.length);

  useKeyboard({
    onNext: () => setSelectedIndex((i) => Math.min(i + 1, groups.length - 1)),
    onPrev: () => setSelectedIndex((i) => Math.max(i - 1, 0)),
    onSelect: () => {
      if (selectedIndex >= 0 && groups[selectedIndex]) {
        onOpenTrace?.(groups[selectedIndex].traceId);
      }
    },
    onBack: () => setSelectedIndex(-1),
  });

  // Keep the keyboard-selected row visible even when it sits outside the
  // rendered window (the row may not be mounted otherwise).
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

  // Draggable column widths
  const columnConfigs = useMemo(
    () => [
      { id: 'time', defaultWidth: 75 },
      { id: 'method', defaultWidth: 55 },
      { id: 'route', defaultWidth: 0 }, // 0 = flex (1fr)
      { id: 'status', defaultWidth: 50 },
      { id: 'duration', defaultWidth: 75 },
      { id: 'service', defaultWidth: 90 },
      ...customColumns.map((col) => ({ id: col.id, defaultWidth: 120 })),
    ],
    [customColumns],
  );

  // On narrow viewports collapse the lower-value duration + service columns so
  // the Route (flex) column stays legible instead of clipping to ~0 (issue #50).
  const narrow = useIsNarrow();
  const collapsedIds = useMemo(() => (narrow ? REQUESTS_NARROW_COLLAPSE : undefined), [narrow]);

  const { gridTemplate, startResize } = useColumnResize('requests', columnConfigs, collapsedIds);

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
            <SavedSearches
              query={searchQuery}
              services={[...activeServices]}
              onApply={applySearch}
            />
            <ColumnPicker
              customColumns={customColumns}
              availableAttrs={availableAttrs}
              onAdd={addColumn}
              onRemove={removeColumn}
            />
          </>
        }
      />

      {/* Live-tail / pause — mirrors the Logs view control (issue #53). */}
      <div className={toolbarStyle}>
        <button
          type="button"
          className={`${pillStyle} ${liveTail ? pillActiveStyle : ''}`}
          onClick={toggleLiveTail}
        >
          {liveTail ? '● Live' : '○ Paused'}
        </button>
        <span className={css({ fontSize: 'sm', color: 'fg.dim' })}>{groups.length} requests</span>
        {!liveTail && (
          <button type="button" className={pillStyle} onClick={toggleLiveTail}>
            Resume
          </button>
        )}
      </div>

      {/* Column headers — click to sort, drag edge to resize */}
      <div
        className={`${requestRowStyle} ${requestRowHeaderStyle}`}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {[
          { id: 'time', label: 'Time' },
          { id: 'method', label: 'Method' },
          { id: 'route', label: 'Route' },
          { id: 'status', label: 'Status' },
          { id: 'duration', label: 'Duration' },
          { id: 'service', label: 'Service' },
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
        {groups.length === 0 ? (
          <div className={emptyStyle}>
            {searchQuery || activeServices.size > 0
              ? 'No requests match this filter'
              : 'No requests yet'}
          </div>
        ) : (
          <>
            {range.paddingTop > 0 && <div style={{ height: `${range.paddingTop}px` }} />}
            {groups.slice(range.startIndex, range.endIndex + 1).map((group, j) => {
              const i = range.startIndex + j;
              return (
                <div
                  key={group.traceId}
                  ref={j === 0 ? rowRef : undefined}
                  role="button"
                  tabIndex={0}
                  className={`${requestRowStyle} ${i === selectedIndex ? requestRowSelectedStyle : ''}`}
                  style={{ gridTemplateColumns: gridTemplate }}
                  {...interactiveProps(() => {
                    setSelectedIndex(i);
                    onOpenTrace?.(group.traceId);
                  })}
                >
                  <span className={timestampStyle}>{formatTime(group.timestamp)}</span>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28) */}
                  <span
                    className={getMethodClassName(group.method)}
                    onContextMenu={(e: MouseEvent) =>
                      handleCellContext(e, 'http.method', group.method)
                    }
                  >
                    {group.method}
                  </span>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28) */}
                  <span
                    className={routeStyle}
                    onContextMenu={(e: MouseEvent) =>
                      handleCellContext(e, 'route', group.routePath)
                    }
                  >
                    {group.routePath}
                  </span>
                  {group.httpCode ? (
                    // biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28)
                    <span
                      className={getHttpStatusClassName(group.httpCode)}
                      onContextMenu={(e: MouseEvent) =>
                        handleCellContext(e, 'statusCode', String(group.httpCode))
                      }
                    >
                      {group.httpCode}
                    </span>
                  ) : (
                    // biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28)
                    <span
                      className={group.status === 'ERROR' ? statusErrorStyle : statusOkStyle}
                      onContextMenu={(e: MouseEvent) =>
                        handleCellContext(e, 'status', group.status)
                      }
                    >
                      {group.status}
                    </span>
                  )}
                  <HeatDuration
                    durationMs={group.durationMs}
                    label={group.duration}
                    scale={heatScale}
                    className={getDurationClassName(group.durationMs, percentiles)}
                  />

                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28) */}
                  <span
                    className={serviceStyle}
                    onContextMenu={(e: MouseEvent) =>
                      handleCellContext(e, 'service', group.serviceName)
                    }
                  >
                    {group.serviceName}
                  </span>
                  {customColumns.map((col) => (
                    // biome-ignore lint/a11y/noStaticElementInteractions: right-click-only cell filter; no keyboard equivalent without a context-menu redesign (parked 2026-06-28)
                    <span
                      key={col.id}
                      className={customColStyle}
                      title={group.extraAttrs[col.id]}
                      onContextMenu={(e: MouseEvent) =>
                        handleCellContext(e, col.attrKey, group.extraAttrs[col.id])
                      }
                    >
                      {group.extraAttrs[col.id] || '—'}
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
