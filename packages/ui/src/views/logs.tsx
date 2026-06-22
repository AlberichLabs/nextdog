import { useRef, useEffect, useState, useMemo, useCallback } from 'preact/hooks';
import { css } from 'styled-system/css';
import { LogRow } from '../components/log-row.js';
import { ServicePills } from '../components/service-pills.js';
import { SearchBar } from '../components/search-bar.js';
import { AttributeTable } from '../components/attribute-table.js';
import { ColumnPicker } from '../components/column-picker.js';
import { SavedSearches, useSavedSearches } from '../components/saved-searches.js';
import { SortIndicator } from '../components/sort-indicator.js';
import { useKeyboard } from '../hooks/use-keyboard.js';
import { useColumnResize } from '../hooks/use-column-resize.js';
import { useVirtualList } from '../hooks/use-virtual-list.js';
import { showContextMenu, attrContextActions } from '../components/context-menu.js';
import { pillStyle, pillActiveStyle, emptyStyle, colHeaderStyle, colResizeStyle, toolbarStyle, mlAutoStyle, jsonViewStyle } from '../styles/shared.js';
import type { SSEEvent } from '../hooks/use-sse.js';
import type { UseEventsResult } from '../hooks/use-events.js';

const SIDEBAR_STORAGE_KEY = 'nextdog:log-detail-width';
const LOG_COLUMNS_STORAGE_KEY = 'nextdog:log-columns';
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;

interface ColumnDef {
  id: string;
  label: string;
  attrKey: string;
}

function loadWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      const w = Number(saved);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

function loadCustomColumns(): ColumnDef[] {
  try {
    const saved = localStorage.getItem(LOG_COLUMNS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveCustomColumns(cols: ColumnDef[]) {
  try { localStorage.setItem(LOG_COLUMNS_STORAGE_KEY, JSON.stringify(cols)); } catch {}
}

/* ── PandaCSS style constants ─────────────────────────────────────────── */

const logDetailStyle = css({
  position: 'relative',
  flexShrink: '0',
  borderLeft: '1px solid token(colors.border.subtle)',
  display: 'flex',
  flexDirection: 'column',
  background: 'surface.panel',
  overflow: 'hidden',
});

const logDragHandleStyle = css({
  position: 'absolute',
  left: '-3px',
  top: '0',
  bottom: '0',
  width: '6px',
  cursor: 'col-resize',
  zIndex: '10',
  background: 'transparent',
  transition: 'background 0.15s',
  _hover: {
    background: 'accent',
    opacity: '0.5',
  },
  _active: {
    background: 'accent',
    opacity: '0.5',
  },
});

const logDetailHeaderStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  py: '3', px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  fontSize: 'md',
  background: 'surface.bg',
});

const logDetailBodyStyle = css({
  flex: '1',
  overflowY: 'auto',
  py: '3', px: '4',
});

const logDetailMessageStyle = css({
  fontFamily: 'mono',
  fontSize: 'md',
  color: 'fg.bright',
  py: '3', px: '3',
  background: 'surface.hover',
  borderRadius: 'md',
  marginBottom: '4',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
  lineHeight: '1.6',
  border: '1px solid token(colors.border.subtle)',
});

const logRowHeaderStyle = css({
  display: 'grid',
  gap: '2',
  cursor: 'default',
  fontSize: 'xs',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'fg.dim',
  py: '1', px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  background: 'surface.panel',
  position: 'sticky',
  top: '0',
  zIndex: '1',
  fontFamily: 'mono',
  alignItems: 'center',
  _hover: {
    background: 'surface.panel',
  },
});

const outerFlexStyle = css({
  display: 'flex',
  flex: '1',
  overflow: 'hidden',
});

const innerColumnStyle = css({
  display: 'flex',
  flexDirection: 'column',
  flex: '1',
  minWidth: '0',
});

const logCountStyle = css({
  fontSize: 'sm',
  color: 'fg.dim',
});

const headerTitleStyle = css({
  fontWeight: '600',
  color: 'fg.bright',
});

const detailButtonGroupStyle = css({
  display: 'flex',
  gap: '1',
});

const tabButtonGroupStyle = css({
  display: 'inline-flex',
  borderRadius: 'md',
  border: '1px solid token(colors.border.subtle)',
  overflow: 'hidden',
  marginBottom: '4',
});

const tabBtnStyle = css({
  py: '1', px: '3',
  fontSize: 'sm',
  fontFamily: 'mono',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: 'fg.dim',
  transition: 'all 0.12s ease',
  _hover: { color: 'fg.bright', background: 'surface.hover' },
});

const tabBtnActiveStyle = css({
  background: 'accent',
  color: 'surface.bg',
  fontWeight: 600,
});

/* ── Components ───────────────────────────────────────────────────────── */

interface LogsProps {
  path?: string;
  eventsResult: UseEventsResult;
  allEvents: SSEEvent[];
  onOpenTrace?: (traceId: string) => void;
  onFilter?: (key: string, value: string) => void;
}

export function Logs({ eventsResult, allEvents, onOpenTrace, onFilter }: LogsProps) {
  const { filtered, services, activeServices, toggleService, setServices, searchQuery, setSearchQuery } = eventsResult;
  const { recordRecent } = useSavedSearches();

  const applySearch = useCallback((query: string, svcs: string[]) => {
    setSearchQuery(query);
    setServices(svcs);
  }, [setSearchQuery, setServices]);

  // Record the active filter in the recent ring once it settles (debounced).
  useEffect(() => {
    const query = searchQuery.trim();
    const svcs = [...activeServices];
    if (!query && svcs.length === 0) return;
    const t = setTimeout(() => recordRecent({ query: searchQuery, services: svcs }), 1500);
    return () => clearTimeout(t);
  }, [searchQuery, activeServices, recordRecent]);

  const [liveTail, setLiveTail] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [selectedLog, setSelectedLog] = useState<SSEEvent | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [customColumns, setCustomColumns] = useState<ColumnDef[]>(loadCustomColumns);
  const [sortBy, setSortBy] = useState<string>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Draggable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(loadWidth);
  const dragging = useRef(false);

  const onDragStart = useCallback((e: PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      // Sidebar is on the right, so width = viewport right edge minus pointer X
      // But it's inside a flex container, not fixed — compute from the parent
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);

  // Filter to logs only
  const logs = useMemo(() => filtered.filter((e) => e.type === 'log'), [filtered]);

  // In non-live mode, freeze the list
  const [frozenLogs, setFrozenLogs] = useState<SSEEvent[]>([]);
  const displayLogs = liveTail ? logs : frozenLogs;

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir(field === 'time' ? 'desc' : 'asc');
    }
  };

  // Sort display logs
  const sortedLogs = useMemo(() => {
    if (sortBy === 'time' && sortDir === 'desc') return displayLogs; // default order
    const sorted = [...displayLogs];
    const dir = sortDir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'time': return ((a.data.timestamp ?? a.timestamp) - (b.data.timestamp ?? b.timestamp)) * dir;
        case 'level': return (a.data.level ?? '').localeCompare(b.data.level ?? '') * dir;
        case 'service': return a.data.serviceName.localeCompare(b.data.serviceName) * dir;
        case 'message': return (a.data.message ?? a.data.name ?? '').localeCompare(b.data.message ?? b.data.name ?? '') * dir;
        default: {
          const av = String(a.data.attributes[sortBy.replace('custom-', '')] ?? '');
          const bv = String(b.data.attributes[sortBy.replace('custom-', '')] ?? '');
          const an = Number(av), bn = Number(bv);
          if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
          return av.localeCompare(bv) * dir;
        }
      }
    });
    return sorted;
  }, [displayLogs, sortBy, sortDir]);

  // Windowed rendering — only visible rows (+ overscan) reach the DOM (issue #9).
  const { scrollRef: listRef, onScroll: onVirtualScroll, rowRef, range, scrollToIndex, scrollToBottom } = useVirtualList(sortedLogs.length);

  const toggleLiveTail = () => {
    if (liveTail) {
      setFrozenLogs([...logs]);
      setLiveTail(false);
    } else {
      setLiveTail(true);
      setAutoScroll(true);
    }
  };

  // Built-in fields that are already shown as core columns — hide from column picker
  const BUILTIN_FIELDS = new Set(['runtime', 'level', 'message', 'service', 'serviceName', 'traceId', 'spanId', 'timestamp', 'kind', 'name', 'type']);

  // Discover available attribute keys for the column picker
  const availableAttrs = useMemo(() => {
    const keys = new Set<string>();
    for (const e of displayLogs) {
      if (e.data.attributes) {
        for (const k of Object.keys(e.data.attributes)) {
          if (!BUILTIN_FIELDS.has(k)) keys.add(k);
        }
      }
    }
    for (const col of customColumns) keys.delete(col.attrKey);
    return [...keys].sort();
  }, [displayLogs, customColumns]);

  const addColumn = (attrKey: string) => {
    const label = attrKey.split('.').pop() ?? attrKey;
    const col: ColumnDef = { id: `custom-${attrKey}`, label, attrKey };
    const next = [...customColumns, col];
    setCustomColumns(next);
    saveCustomColumns(next);
  };

  const removeColumn = (id: string) => {
    const next = customColumns.filter((c) => c.id !== id);
    setCustomColumns(next);
    saveCustomColumns(next);
  };

  const activeColumnKeys = useMemo(() => new Set(customColumns.map((c) => c.attrKey)), [customColumns]);

  const handleCellContext = useCallback((e: MouseEvent, key: string, value: string) => {
    e.preventDefault();
    const actions = attrContextActions(key, value, {
      onFilter: (q) => setSearchQuery((prev: string) => prev ? `${prev} ${q}` : q),
      onAddColumn: (k) => addColumn(k),
      onRemoveColumn: (k) => {
        const col = customColumns.find((c) => c.attrKey === k);
        if (col) removeColumn(col.id);
      },
      isColumnActive: activeColumnKeys.has(key),
    });
    showContextMenu(e.clientX, e.clientY, actions);
  }, [setSearchQuery, addColumn, removeColumn, customColumns, activeColumnKeys]);

  // Draggable column widths
  const columnConfigs = useMemo(() => [
    { id: 'time', defaultWidth: 90 },
    { id: 'level', defaultWidth: 50 },
    { id: 'service', defaultWidth: 80 },
    { id: 'runtime', defaultWidth: 50 },
    { id: 'message', defaultWidth: 0 }, // 0 = flex (1fr)
    ...customColumns.map((col) => ({ id: col.id, defaultWidth: 120 })),
  ], [customColumns]);

  const { gridTemplate, startResize } = useColumnResize('logs', columnConfigs);

  useKeyboard({
    onNext: () => setSelectedIndex((i) => Math.min(i + 1, displayLogs.length - 1)),
    onPrev: () => setSelectedIndex((i) => Math.max(i - 1, 0)),
    onSelect: () => {
      if (selectedIndex >= 0 && displayLogs[selectedIndex]) {
        setSelectedLog(displayLogs[selectedIndex]);
      }
    },
    onBack: () => {
      if (selectedLog) {
        setSelectedLog(null);
      } else {
        setSelectedIndex(-1);
      }
    },
  });

  // Keyboard-selected row stays visible even when it's outside the rendered
  // window (otherwise it isn't mounted and can't be scrolled into view). After
  // moving, re-sync auto-scroll from the resting position so navigating up away
  // from the tail doesn't get yanked back to the bottom by the next event.
  useEffect(() => {
    if (selectedIndex < 0) return;
    scrollToIndex(selectedIndex);
    const el = listRef.current;
    if (el) setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
  }, [selectedIndex, scrollToIndex]);

  // Re-pin to the newest row whenever the list grows OR the measured total
  // height changes (the row-height measurement settles a frame after mount, so
  // depending on length alone can leave the tail a few rows short).
  useEffect(() => {
    if (liveTail && autoScroll) {
      scrollToBottom();
    }
  }, [sortedLogs.length, range.totalHeight, autoScroll, liveTail, scrollToBottom]);

  const handleScroll = () => {
    onVirtualScroll();
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const handleLogClick = (log: SSEEvent, index: number) => {
    setSelectedIndex(index);
    setSelectedLog(log);
  };

  return (
    <div className={outerFlexStyle}>
      <div className={innerColumnStyle}>
        <ServicePills services={services} active={activeServices} onToggle={toggleService} events={filtered} />
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
          <button className={`${pillStyle} ${liveTail ? pillActiveStyle : ''}`} onClick={toggleLiveTail}>
            {liveTail ? '● Live' : '○ Paused'}
          </button>
          <span className={logCountStyle}>{displayLogs.length} logs</span>
          {!liveTail && (
            <button className={pillStyle} onClick={toggleLiveTail}>Resume</button>
          )}
        </div>

        {/* Column headers — click to sort, drag edge to resize */}
        <div
          className={logRowHeaderStyle}
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {[
            { id: 'time', label: 'Time' },
            { id: 'level', label: 'Level' },
            { id: 'service', label: 'Service' },
            { id: 'runtime', label: '' },
            { id: 'message', label: 'Message' },
            ...customColumns.map((col) => ({ id: col.id, label: col.label })),
          ].map((col) => (
            <span key={col.id} className={colHeaderStyle} onClick={col.label ? () => toggleSort(col.id) : undefined}>
              {col.label}{col.label && <SortIndicator field={col.id} sortBy={sortBy} sortDir={sortDir} />}
              {col.label && <span className={colResizeStyle} onPointerDown={(e: PointerEvent) => { e.stopPropagation(); startResize(col.id, e.clientX); }} />}
            </span>
          ))}
        </div>

        <div className={css({ flex: 1, overflowY: 'auto', overflowX: 'hidden', fontFamily: 'mono', fontSize: 'md' })} ref={listRef} onScroll={handleScroll}>
          {sortedLogs.length === 0 ? (
            <div className={emptyStyle}>{searchQuery || activeServices.size > 0 ? 'No logs match this filter' : 'No logs yet'}</div>
          ) : (
            <>
              {range.paddingTop > 0 && <div style={{ height: `${range.paddingTop}px` }} />}
              {sortedLogs.slice(range.startIndex, range.endIndex + 1).map((log, j) => {
                const i = range.startIndex + j;
                return (
                  <LogRow
                    key={i}
                    rootRef={j === 0 ? rowRef : undefined}
                    event={log}
                    showService
                    selected={i === selectedIndex}
                    onClick={() => handleLogClick(log, i)}
                    onCellContext={handleCellContext}
                    style={{ gridTemplateColumns: gridTemplate }}
                    extraColumns={customColumns.map((col) => ({
                      id: col.id,
                      attrKey: col.attrKey,
                      value: log.data.attributes[col.attrKey] != null ? String(log.data.attributes[col.attrKey]) : '',
                    }))}
                  />
                );
              })}
              {range.paddingBottom > 0 && <div style={{ height: `${range.paddingBottom}px` }} />}
            </>
          )}
        </div>
      </div>

      {/* Log detail sidebar — draggable */}
      {selectedLog && (
        <div className={logDetailStyle} style={{ width: `${sidebarWidth}px` }}>
          <div className={logDragHandleStyle} onPointerDown={onDragStart} />
          <div className={logDetailHeaderStyle}>
            <span className={headerTitleStyle}>Log Detail</span>
            <div className={detailButtonGroupStyle}>
              {selectedLog.data.traceId && (
                <button
                  className={pillStyle}
                  onClick={() => onOpenTrace?.(selectedLog.data.traceId!)}
                >
                  View Trace
                </button>
              )}
              <button className={css({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', border: 'none', borderRadius: 'sm', background: 'transparent', color: 'fg.dim', cursor: 'pointer', _hover: { background: 'surface.hover', color: 'fg.bright' } })} onClick={() => setSelectedLog(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div className={logDetailBodyStyle}>
            <div className={logDetailMessageStyle}>
              {selectedLog.data.message ?? selectedLog.data.name}
            </div>
            <div className={tabButtonGroupStyle}>
              <button className={`${tabBtnStyle} ${!showJson ? tabBtnActiveStyle : ''}`} onClick={() => setShowJson(false)}>Table</button>
              <button className={`${tabBtnStyle} ${showJson ? tabBtnActiveStyle : ''}`} onClick={() => setShowJson(true)}>JSON</button>
            </div>
            {showJson ? (
              <pre className={jsonViewStyle}>{JSON.stringify(selectedLog.data, null, 2)}</pre>
            ) : (
              <>
                <AttributeTable
                  title="Properties"
                  onFilter={onFilter}
                  onAddColumn={addColumn}
                  onRemoveColumn={(key) => { const col = customColumns.find((c) => c.attrKey === key); if (col) removeColumn(col.id); }}
                  activeColumns={activeColumnKeys}
                  attributes={{
                    level: selectedLog.data.level,
                    message: selectedLog.data.message,
                    service: selectedLog.data.serviceName,
                    traceId: selectedLog.data.traceId,
                    spanId: selectedLog.data.spanId,
                  }}
                />
                {Object.keys(selectedLog.data.attributes).length > 0 && (
                  <AttributeTable
                    title="Attributes"
                    onFilter={onFilter}
                    onAddColumn={addColumn}
                    onRemoveColumn={(key) => { const col = customColumns.find((c) => c.attrKey === key); if (col) removeColumn(col.id); }}
                    activeColumns={activeColumnKeys}
                    attributes={selectedLog.data.attributes as Record<string, unknown>}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
