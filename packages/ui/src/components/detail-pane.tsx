import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { css } from 'styled-system/css';
import { token } from 'styled-system/tokens';
import type { SSEEvent } from '../hooks/use-sse';
import { jsonViewStyle } from '../styles/shared';
import { interactiveProps } from '../utils/a11y';
import { stripResponseAttributes } from '../utils/body-format';
import { formatSpanDuration, httpCodeOf } from '../utils/format';
import { findRootSpan } from '../utils/root-span';
import { AttributeTable } from './attribute-table';
import { CopyCurl } from './copy-curl';
import { LogRow } from './log-row';
import { ReplayButton } from './replay-button';
import { ResponseSection } from './response-section';
import { ExportButton } from './trace-io';
import { Waterfall } from './waterfall';

const STORAGE_KEY = 'nextdog:pane-width';
const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;

function loadWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const w = Number(saved);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

// --- PandaCSS style constants ---

const paneSlideInKeyframes = `
@keyframes pane-slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
`;

const backdropStyle = css({
  position: 'fixed',
  inset: '0',
  background: 'rgba(0, 0, 0, 0.4)',
  zIndex: 100,
});

const detailPaneStyle = css({
  position: 'fixed',
  top: '0',
  right: '0',
  bottom: '0',
  background: 'surface.panel',
  borderLeft: '1px solid token(colors.border.subtle)',
  zIndex: 101,
  display: 'flex',
  flexDirection: 'column',
  animation: 'pane-slide-in 0.15s ease-out',
});

const dragHandleStyle = css({
  position: 'absolute',
  left: '-3px',
  top: '0',
  bottom: '0',
  width: '6px',
  cursor: 'col-resize',
  zIndex: 102,
  background: 'transparent',
  transition: 'background 0.15s',
  _hover: {
    background: 'accent',
    opacity: 0.5,
  },
  _active: {
    background: 'accent',
    opacity: 0.5,
  },
});

const headerStyle = css({
  py: '3',
  px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  background: 'surface.bg',
});

const headerTopStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '3',
});

const titleStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  fontFamily: 'mono',
  fontSize: 'lg',
  fontWeight: 600,
  color: 'fg.bright',
  minWidth: '0',
});

const routeStyle = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const actionsStyle = css({
  display: 'flex',
  gap: '1',
  flexShrink: 0,
});

const btnStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  border: 'none',
  borderRadius: 'sm',
  background: 'transparent',
  color: 'fg.dim',
  cursor: 'pointer',
  _hover: {
    background: 'surface.hover',
    color: 'fg.bright',
  },
});

const metaStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  marginTop: '6px',
  fontSize: 'md',
  color: 'fg.dim',
  fontFamily: 'mono',
});

const metaSepStyle = css({
  color: 'border.subtle',
});

const bodyStyle = css({
  flex: '1',
  overflowY: 'auto',
});

const sectionStyle = css({
  borderBottom: '1px solid token(colors.border.subtle)',
});

const sectionTitleStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  py: '2',
  px: '4',
  fontSize: 'sm',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'fg.dim',
  background: 'surface.bg',
  position: 'sticky',
  top: '0',
  zIndex: 1,
});

const logsStyle = css({
  maxHeight: '200px',
  overflowY: 'auto',
});

const segmentGroupStyle = css({
  display: 'inline-flex',
  borderRadius: 'md',
  border: '1px solid token(colors.border.subtle)',
  overflow: 'hidden',
});

const segmentBtnStyle = css({
  py: '0.5',
  px: '2',
  fontSize: 'xs',
  fontFamily: 'mono',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: 'fg.dim',
  textTransform: 'none',
  letterSpacing: '0',
  transition: 'all 0.12s ease',
  _hover: { color: 'fg.bright', background: 'surface.hover' },
});

const segmentBtnActiveStyle = css({
  background: 'accent',
  color: 'surface.bg',
  fontWeight: 600,
});

const METHOD_COLORS: Record<string, string> = {
  get: token('colors.green'),
  post: token('colors.blue'),
  put: token('colors.yellow'),
  delete: token('colors.red'),
};

function methodStyle(method: string) {
  const color = METHOD_COLORS[method.toLowerCase()] ?? token('colors.fg');
  return css({ fontWeight: '600', color });
}

const statusErrorStyle = css({ color: 'red' });
const statusOkStyle = css({ color: 'green' });

// Click-to-filter affordance for the always-visible request facts (issue #54),
// mirroring the dashed-underline hover used by the span ATTRIBUTES table so the
// feature reads the same everywhere it appears.
const factFilterableStyle = css({
  cursor: 'pointer',
  borderBottom: '1px dashed token(colors.border.strong)',
  transition: 'all 0.15s ease',
  _hover: {
    color: 'accent',
    borderColor: 'accent',
  },
});

// --- Component ---

interface DetailPaneProps {
  traceId: string;
  events: SSEEvent[];
  onClose: () => void;
  onFilter?: (key: string, value: string) => void;
}

export function DetailPane({ traceId, events, onClose, onFilter }: DetailPaneProps) {
  const [selectedEvent, setSelectedEvent] = useState<SSEEvent | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [width, setWidth] = useState(loadWidth);
  const dragging = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const onDragStart = useCallback((e: PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setWidth(newWidth);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist on drag end
      try {
        localStorage.setItem(STORAGE_KEY, String(loadWidth()));
      } catch {}
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Persist width on change (debounced via pointerup, but also save current)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {}
  }, [width]);

  const traceEvents = useMemo(
    () => events.filter((e) => e.data.traceId === traceId),
    [events, traceId],
  );

  const spans = useMemo(() => traceEvents.filter((e) => e.type === 'span'), [traceEvents]);

  const logs = useMemo(() => traceEvents.filter((e) => e.type === 'log'), [traceEvents]);

  // Find root span for header info
  const rootSpan = useMemo(() => findRootSpan(spans) ?? undefined, [spans]);

  // Auto-select the root span when the pane opens (issue #82). Previously the
  // request/response body + attributes (ResponseSection) only appeared after the
  // user drilled into a span INSIDE the waterfall, hiding the headline feature
  // two clicks deep. Defaulting the selection to the root span surfaces the body
  // on the FIRST open. We key on traceId (not rootSpan identity) so:
  //  - switching to a different request re-auto-selects that request's root, but
  //  - clicking another span within the SAME trace sticks (we don't re-force it),
  //    and streamed-in spans re-deriving `rootSpan` don't yank the selection back.
  const autoSelectedTrace = useRef<string | null>(null);
  useEffect(() => {
    if (autoSelectedTrace.current === traceId) return;
    if (rootSpan) {
      autoSelectedTrace.current = traceId;
      setSelectedEvent(rootSpan);
    }
  }, [traceId, rootSpan]);

  const method = rootSpan ? String(rootSpan.data.attributes['http.method'] ?? '') : '';
  const routePath = rootSpan
    ? String(
        rootSpan.data.attributes['http.route'] ??
          rootSpan.data.attributes['http.target'] ??
          rootSpan.data.name,
      )
    : traceId;
  const status = rootSpan?.data.status?.code ?? '';
  const duration = rootSpan ? formatSpanDuration(rootSpan) || '—' : '—';
  // HTTP status code for the request — clicking the status fact filters by this
  // (statusCode:NNN) so the produced query actually matches (issues #54 + #52).
  const httpCode = rootSpan ? httpCodeOf(rootSpan) : undefined;

  // Render a request fact as a click-to-filter control when onFilter is wired,
  // otherwise as plain text. Reuses the attribute-table interaction (#54).
  const renderFact = (
    className: string,
    text: string,
    filterKey: string,
    filterValue: string,
  ) =>
    onFilter ? (
      <span
        role="button"
        tabIndex={0}
        class={`${className} ${factFilterableStyle}`}
        {...interactiveProps(() => onFilter(filterKey, filterValue))}
        title={`Filter ${filterKey}:${filterValue}`}
      >
        {text}
      </span>
    ) : (
      <span class={className}>{text}</span>
    );

  const handleExpand = () => {
    route(`/trace/${traceId}`);
    onClose();
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: paneSlideInKeyframes }} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: presentational modal backdrop; click-to-dismiss is a pointer-only convenience (parked 2026-06-28) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: presentational modal backdrop; keyboard users dismiss via the close control, not the backdrop (parked 2026-06-28) */}
      <div class={backdropStyle} onClick={onClose} />
      <div class={detailPaneStyle} ref={paneRef} style={`width:${width}px`}>
        <div class={dragHandleStyle} onPointerDown={onDragStart} />
        <div class={headerStyle}>
          <div class={headerTopStyle}>
            <div class={titleStyle}>
              {method && renderFact(methodStyle(method), method, 'method', method)}
              {rootSpan
                ? renderFact(routeStyle, routePath, 'route', routePath)
                : <span class={routeStyle}>{routePath}</span>}
            </div>
            <div class={actionsStyle}>
              <ExportButton
                events={traceEvents}
                meta={{ kind: 'trace', traceId }}
                label="Export"
                title="Download this trace (all spans + logs) as a portable file"
              />
              <button
                type="button"
                class={btnStyle}
                onClick={handleExpand}
                title="Expand to full page"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
              <button type="button" class={btnStyle} onClick={onClose} title="Close">
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
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
          <div class={metaStyle}>
            {httpCode !== undefined
              ? renderFact(
                  status === 'ERROR' ? statusErrorStyle : statusOkStyle,
                  status || String(httpCode),
                  'statusCode',
                  String(httpCode),
                )
              : status
                ? renderFact(
                    status === 'ERROR' ? statusErrorStyle : statusOkStyle,
                    status,
                    'status',
                    status,
                  )
                : <span class={statusOkStyle}>{status}</span>}
            <span class={metaSepStyle}>|</span>
            <span>{duration}</span>
            <span class={metaSepStyle}>|</span>
            <span>{spans.length} spans</span>
            {logs.length > 0 && (
              <>
                <span class={metaSepStyle}>|</span>
                <span>{logs.length} logs</span>
              </>
            )}
            {rootSpan?.data.attributes['http.method'] && (
              <>
                <span class={metaSepStyle}>|</span>
                <ReplayButton event={rootSpan} />
                <CopyCurl event={rootSpan} />
              </>
            )}
          </div>
        </div>

        <div class={bodyStyle}>
          {/* Waterfall */}
          <div class={sectionStyle}>
            <div class={sectionTitleStyle}>Waterfall</div>
            <Waterfall spans={spans} onSpanClick={(event) => setSelectedEvent(event)} />
          </div>

          {/* Logs */}
          {logs.length > 0 && (
            <div class={sectionStyle}>
              <div class={sectionTitleStyle}>Logs</div>
              <div class={logsStyle}>
                {logs.map((log, i) => (
                  <LogRow
                    key={i}
                    event={log}
                    selected={selectedEvent === log}
                    onClick={() => setSelectedEvent(log)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* If no logs, show all events as a timeline */}
          {logs.length === 0 && spans.length > 0 && (
            <div class={sectionStyle}>
              <div class={sectionTitleStyle}>Spans</div>
              <div class={logsStyle}>
                {spans.map((span, i) => (
                  <LogRow
                    key={i}
                    event={span}
                    selected={selectedEvent === span}
                    onClick={() => setSelectedEvent(span)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Detail panel for selected span/log */}
          {selectedEvent && (
            <div class={sectionStyle}>
              <div class={sectionTitleStyle}>
                <span>{selectedEvent.type === 'span' ? 'Span' : 'Log'} Detail</span>
                <div class={segmentGroupStyle}>
                  <button
                    type="button"
                    class={`${segmentBtnStyle} ${!showJson ? segmentBtnActiveStyle : ''}`}
                    onClick={() => setShowJson(false)}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    class={`${segmentBtnStyle} ${showJson ? segmentBtnActiveStyle : ''}`}
                    onClick={() => setShowJson(true)}
                  >
                    JSON
                  </button>
                </div>
              </div>
              {showJson ? (
                <pre class={jsonViewStyle}>{JSON.stringify(selectedEvent.data, null, 2)}</pre>
              ) : (
                <>
                  <AttributeTable
                    title="Properties"
                    onFilter={onFilter}
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
                  {/* Exclude http.response.* — ResponseSection below renders those in a
                      dedicated view, so the large body string isn't shown twice. */}
                  {(() => {
                    const tableAttrs = stripResponseAttributes(
                      selectedEvent.data.attributes as Record<string, unknown>,
                    );
                    return Object.keys(tableAttrs).length > 0 ? (
                      <AttributeTable
                        title="Attributes"
                        onFilter={onFilter}
                        attributes={tableAttrs}
                      />
                    ) : null;
                  })()}
                  <ResponseSection
                    attributes={selectedEvent.data.attributes as Record<string, unknown>}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
