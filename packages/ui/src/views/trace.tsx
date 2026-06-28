import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import { token } from 'styled-system/tokens';
import { AttributeTable } from '../components/attribute-table';
import { CopyCurl } from '../components/copy-curl';
import { LogRow } from '../components/log-row';
import { ReplayButton } from '../components/replay-button';
import { ExportButton } from '../components/trace-io';
import { Waterfall } from '../components/waterfall';
import type { SSEEvent } from '../hooks/use-sse';
import { emptyStyle, jsonViewStyle } from '../styles/shared';
import { interactiveProps } from '../utils/a11y';
import { formatSpanDuration } from '../utils/format';

/* ── Styles ───────────────────────────────────────────────────────────── */

const s = {
  root: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }),
  header: css({
    py: '3',
    px: '4',
    borderBottom: '1px solid token(colors.border.subtle)',
    background: 'surface.panel',
    flexShrink: 0,
  }),
  backLink: css({
    fontSize: 'md',
    color: 'fg.dim',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    textDecoration: 'none',
    py: '1',
    px: '2',
    borderRadius: 'sm',
    margin: '-4px -8px',
    transition: 'all 0.15s ease',
    _hover: { background: 'surface.hover', color: 'fg.bright' },
  }),
  titleRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    marginTop: '2',
  }),
  routeHeading: css({
    fontSize: '2xl',
    color: 'fg.bright',
    fontFamily: 'mono',
    fontWeight: 600,
  }),
  metaRow: css({
    display: 'flex',
    gap: '2',
    marginTop: '1',
    fontSize: 'md',
    color: 'fg.dim',
    fontFamily: 'mono',
    alignItems: 'center',
  }),
  actionsRow: css({
    display: 'flex',
    gap: '2',
    alignItems: 'center',
    marginTop: '2',
  }),
  methodBase: css({ fontWeight: 600, fontSize: '2xl' }),
  statusOk: css({ color: 'green' }),
  statusError: css({ color: 'red' }),
  sep: css({ color: 'fg.dim', opacity: 0.4 }),

  // Main content area — horizontal split
  body: css({
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  }),

  // Left panel — waterfall + tabs
  leftPanel: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  }),

  // Collapsible waterfall section
  waterfallSection: css({
    borderBottom: '1px solid token(colors.border.subtle)',
    flexShrink: 0,
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    py: '1.5',
    px: '4',
    fontSize: 'xs',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'fg.dim',
    background: 'surface.bg',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.12s ease',
    _hover: { color: 'fg.bright' },
  }),
  collapseIcon: css({
    fontSize: 'sm',
    transition: 'transform 0.15s ease',
  }),

  // Tab bar
  tabBar: css({
    display: 'flex',
    gap: '0',
    borderBottom: '1px solid token(colors.border.subtle)',
    background: 'surface.panel',
    flexShrink: 0,
  }),
  tab: css({
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 500,
    color: 'fg.dim',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    borderBottom: '2px solid transparent',
    transition: 'all 0.12s ease',
    fontFamily: 'mono',
    _hover: { color: 'fg.bright' },
  }),
  tabActive: css({
    color: 'fg.bright',
    borderBottomColor: 'accent',
  }),
  tabBadge: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '16px',
    height: '14px',
    py: '0',
    px: '1',
    marginLeft: '1.5',
    borderRadius: 'full',
    fontSize: 'xs',
    fontWeight: 600,
    background: 'surface.hover',
    color: 'fg.dim',
  }),

  // Scrollable list area
  listArea: css({
    flex: 1,
    overflowY: 'auto',
  }),

  // Right detail panel
  rightPanel: css({
    position: 'relative',
    flexShrink: 0,
    borderLeft: '1px solid token(colors.border.subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'surface.panel',
  }),
  detailHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    py: '2',
    px: '4',
    borderBottom: '1px solid token(colors.border.subtle)',
    background: 'surface.bg',
    flexShrink: 0,
  }),
  detailTitle: css({
    fontSize: 'sm',
    fontWeight: 600,
    color: 'fg.bright',
  }),
  detailBody: css({
    flex: 1,
    overflowY: 'auto',
    py: '2',
    px: '0',
  }),
  closeBtn: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: 'sm',
    background: 'transparent',
    color: 'fg.dim',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    _hover: { background: 'surface.hover', color: 'fg.bright' },
  }),
  segmentGroup: css({
    display: 'inline-flex',
    borderRadius: 'md',
    border: '1px solid token(colors.border.subtle)',
    overflow: 'hidden',
  }),
  segmentBtn: css({
    py: '0.5',
    px: '2',
    fontSize: 'xs',
    fontFamily: 'mono',
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'fg.dim',
    transition: 'all 0.12s ease',
    _hover: { color: 'fg.bright', background: 'surface.hover' },
  }),
  segmentBtnActive: css({
    background: 'accent',
    color: 'surface.bg',
    fontWeight: 600,
  }),
  noSelection: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: 'fg.dim',
    fontSize: 'md',
    fontFamily: 'mono',
  }),

  // Horizontal resize handle (between left and right panels)
  hDragHandle: css({
    position: 'absolute',
    left: '-3px',
    top: '0',
    bottom: '0',
    width: '6px',
    cursor: 'col-resize',
    zIndex: 10,
    background: 'transparent',
    transition: 'background 0.15s',
    _hover: { background: 'accent', opacity: 0.5 },
    _active: { background: 'accent', opacity: 0.5 },
  }),

  // Vertical resize handle (below waterfall)
  vDragHandle: css({
    height: '4px',
    cursor: 'row-resize',
    background: 'transparent',
    transition: 'background 0.15s',
    flexShrink: 0,
    _hover: { background: 'accent', opacity: 0.5 },
    _active: { background: 'accent', opacity: 0.5 },
  }),
};

/* ── Helpers ──────────────────────────────────────────────────────────── */

const METHOD_COLORS: Record<string, string> = {
  get: token('colors.green'),
  post: token('colors.blue'),
  put: token('colors.yellow'),
  delete: token('colors.red'),
};

function methodColorStyle(method: string) {
  const color = METHOD_COLORS[method.toLowerCase()] ?? token('colors.fg');
  return css({ color });
}

/* ── Component ────────────────────────────────────────────────────────── */

interface TraceProps {
  path?: string;
  traceId?: string;
  events: SSEEvent[];
}

const PANEL_STORAGE_KEY = 'nextdog:trace-panel-width';
const WATERFALL_STORAGE_KEY = 'nextdog:trace-waterfall-height';

function loadNum(key: string, fallback: number) {
  try {
    const v = localStorage.getItem(key);
    return v ? Number(v) : fallback;
  } catch {
    return fallback;
  }
}

export function Trace({ traceId, events }: TraceProps) {
  const [selectedEvent, setSelectedEvent] = useState<SSEEvent | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [waterfallOpen, setWaterfallOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'spans' | 'logs'>('spans');

  // Resizable right panel
  const [panelWidth, setPanelWidth] = useState(() => loadNum(PANEL_STORAGE_KEY, 360));
  const panelDrag = useRef<{ startX: number; startW: number } | null>(null);

  // Resizable waterfall height
  const [waterfallHeight, setWaterfallHeight] = useState(() => loadNum(WATERFALL_STORAGE_KEY, 160));
  const wfDrag = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (panelDrag.current) {
        const delta = panelDrag.current.startX - e.clientX;
        const w = Math.max(240, Math.min(700, panelDrag.current.startW + delta));
        setPanelWidth(w);
      }
      if (wfDrag.current) {
        const delta = e.clientY - wfDrag.current.startY;
        const h = Math.max(60, Math.min(500, wfDrag.current.startH + delta));
        setWaterfallHeight(h);
      }
    };
    const onUp = () => {
      if (panelDrag.current) {
        panelDrag.current = null;
        try {
          localStorage.setItem(PANEL_STORAGE_KEY, String(panelWidth));
        } catch {}
      }
      if (wfDrag.current) {
        wfDrag.current = null;
        try {
          localStorage.setItem(WATERFALL_STORAGE_KEY, String(waterfallHeight));
        } catch {}
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panelWidth, waterfallHeight]);

  const startPanelDrag = useCallback(
    (e: PointerEvent) => {
      panelDrag.current = { startX: e.clientX, startW: panelWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [panelWidth],
  );

  const startWfDrag = useCallback(
    (e: PointerEvent) => {
      wfDrag.current = { startY: e.clientY, startH: waterfallHeight };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [waterfallHeight],
  );

  const traceEvents = useMemo(
    () => events.filter((e) => e.data.traceId === traceId),
    [events, traceId],
  );

  const spans = useMemo(() => traceEvents.filter((e) => e.type === 'span'), [traceEvents]);
  const logs = useMemo(() => traceEvents.filter((e) => e.type === 'log'), [traceEvents]);

  const rootSpan = useMemo(
    () => spans.find((s) => s.data.kind === 'SERVER' && !s.data.parentSpanId) ?? spans[0],
    [spans],
  );

  // Auto-switch to spans tab if no logs
  useEffect(() => {
    if (activeTab === 'logs' && logs.length === 0) setActiveTab('spans');
  }, [logs.length, activeTab]);

  if (!traceId) return <div className={emptyStyle}>No trace selected</div>;

  const method = rootSpan ? String(rootSpan.data.attributes['http.method'] ?? '') : '';
  const routePath = rootSpan
    ? String(
        rootSpan.data.attributes['http.route'] ??
          rootSpan.data.attributes['http.target'] ??
          rootSpan.data.name,
      )
    : traceId;
  const listItems = activeTab === 'spans' ? spans : logs;

  return (
    <div className={s.root}>
      {/* Header */}
      <div className={s.header}>
        <a href="/" className={s.backLink}>
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </a>
        <div className={s.titleRow}>
          {method && (
            <span className={`${s.methodBase} ${methodColorStyle(method)}`}>{method}</span>
          )}
          <h2 className={s.routeHeading}>{routePath}</h2>
        </div>
        <div className={s.metaRow}>
          <span className={rootSpan?.data.status?.code === 'ERROR' ? s.statusError : s.statusOk}>
            {rootSpan?.data.status?.code ?? ''}
          </span>
          <span className={s.sep}>|</span>
          <span>{rootSpan ? formatSpanDuration(rootSpan) : ''}</span>
          <span className={s.sep}>|</span>
          <span>{spans.length} spans</span>
          {logs.length > 0 && (
            <>
              <span className={s.sep}>|</span>
              <span>{logs.length} logs</span>
            </>
          )}
        </div>
        <div className={s.actionsRow}>
          <ExportButton
            events={traceEvents}
            meta={{ kind: 'trace', traceId }}
            label="Export trace"
            title="Download this trace (all spans + logs) as a portable file"
          />
          {rootSpan?.data.attributes['http.method'] && (
            <>
              <ReplayButton event={rootSpan} />
              <CopyCurl event={rootSpan} />
            </>
          )}
        </div>
      </div>

      {/* Body — horizontal split */}
      <div className={s.body}>
        {/* Left panel */}
        <div className={s.leftPanel}>
          {/* Collapsible waterfall */}
          <div className={s.waterfallSection}>
            <div
              role="button"
              tabIndex={0}
              className={s.sectionHeader}
              aria-expanded={waterfallOpen}
              {...interactiveProps(() => setWaterfallOpen(!waterfallOpen))}
            >
              <span>Waterfall</span>
              <span
                className={s.collapseIcon}
                style={{ transform: waterfallOpen ? 'rotate(0)' : 'rotate(-90deg)' }}
              >
                ▾
              </span>
            </div>
            {waterfallOpen && (
              <div style={{ height: `${waterfallHeight}px`, overflow: 'auto' }}>
                <Waterfall spans={spans} onSpanClick={(event) => setSelectedEvent(event)} />
              </div>
            )}
          </div>
          {waterfallOpen && <div className={s.vDragHandle} onPointerDown={startWfDrag} />}

          {/* Tab bar — Spans / Logs */}
          <div className={s.tabBar}>
            <button
              type="button"
              className={`${s.tab} ${activeTab === 'spans' ? s.tabActive : ''}`}
              onClick={() => setActiveTab('spans')}
            >
              Spans
              <span className={s.tabBadge}>{spans.length}</span>
            </button>
            {logs.length > 0 && (
              <button
                type="button"
                className={`${s.tab} ${activeTab === 'logs' ? s.tabActive : ''}`}
                onClick={() => setActiveTab('logs')}
              >
                Logs
                <span className={s.tabBadge}>{logs.length}</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className={s.listArea}>
            {listItems.length === 0 ? (
              <div className={emptyStyle}>No {activeTab} in this trace</div>
            ) : (
              listItems.map((item, i) => (
                <LogRow
                  key={i}
                  event={item}
                  selected={selectedEvent === item}
                  onClick={() => setSelectedEvent(item)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right detail panel */}
        {selectedEvent ? (
          <div className={s.rightPanel} style={{ width: `${panelWidth}px` }}>
            <div className={s.hDragHandle} onPointerDown={startPanelDrag} />
            <div className={s.detailHeader}>
              <span className={s.detailTitle}>
                {selectedEvent.type === 'span' ? 'Span' : 'Log'} Detail
              </span>
              <div className={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                <div className={s.segmentGroup}>
                  <button
                    type="button"
                    className={`${s.segmentBtn} ${!showJson ? s.segmentBtnActive : ''}`}
                    onClick={() => setShowJson(false)}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    className={`${s.segmentBtn} ${showJson ? s.segmentBtnActive : ''}`}
                    onClick={() => setShowJson(true)}
                  >
                    JSON
                  </button>
                </div>
                <button type="button" className={s.closeBtn} onClick={() => setSelectedEvent(null)}>
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className={s.detailBody}>
              {showJson ? (
                <pre className={jsonViewStyle}>{JSON.stringify(selectedEvent.data, null, 2)}</pre>
              ) : (
                <>
                  <AttributeTable
                    title="Properties"
                    attributes={{
                      name: selectedEvent.data.name,
                      service: selectedEvent.data.serviceName,
                      kind: selectedEvent.data.kind,
                      status: selectedEvent.data.status?.code,
                      ...(selectedEvent.data.message
                        ? { message: selectedEvent.data.message }
                        : {}),
                      ...(selectedEvent.data.level ? { level: selectedEvent.data.level } : {}),
                      traceId: selectedEvent.data.traceId,
                      spanId: selectedEvent.data.spanId,
                      parentSpanId: selectedEvent.data.parentSpanId,
                    }}
                  />
                  {Object.keys(selectedEvent.data.attributes).length > 0 && (
                    <AttributeTable
                      title="Attributes"
                      attributes={selectedEvent.data.attributes as Record<string, unknown>}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className={s.rightPanel} style={{ width: `${panelWidth}px` }}>
            <div className={s.hDragHandle} onPointerDown={startPanelDrag} />
            <div className={s.noSelection}>Click a span or log to view details</div>
          </div>
        )}
      </div>
    </div>
  );
}
