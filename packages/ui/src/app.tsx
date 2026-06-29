import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Router from 'preact-router';
import { css } from 'styled-system/css';
import { ContextMenuContainer } from './components/context-menu';
import { DetailPane } from './components/detail-pane';
import { EmptyState } from './components/empty-state';
import { ErrorBoundary } from './components/error-boundary';
import { FacetDrawer } from './components/facet-drawer';
import { Logo } from './components/logo';
import { ShortcutHelp } from './components/shortcut-help';
import { detectSlowRequestToast } from './components/slow-request-toast';
import { Sparkline } from './components/sparkline';
import { ThemeToggle } from './components/theme-toggle';
import { ToastContainer, useToasts } from './components/toast';
import {
  ExportButton,
  ImportDropZone,
  ImportedBadge,
  OpenTraceButton,
} from './components/trace-io';
import { useEvents } from './hooks/use-events';
import type { SSEEvent } from './hooks/use-sse';
import { useSSE } from './hooks/use-sse';
import { useTheme } from './hooks/use-theme';
import { pillStyle } from './styles/shared';
import { toggleToken } from './utils/filter-query';
import { enterImported, exitImported, type ImportedSession } from './utils/imported-session';
import type { ParseResult } from './utils/trace-export';
import { Logs } from './views/logs';
import { Requests } from './views/requests';
import { Spans } from './views/spans';
import { Trace } from './views/trace';

// In dev, the harness (scripts/dev.mjs) serves the UI from a Vite port and the
// sidecar from a separate dev port, so VITE_NEXTDOG_SIDECAR_URL points the UI at
// it cross-origin (the sidecar sends CORS `*`). This branch is gated on
// `import.meta.env.DEV`, so production builds tree-shake it away and the shipped
// behaviour (port 5173 → :6789, otherwise same-origin) is unchanged.
const SIDECAR_URL =
  (import.meta.env.DEV && import.meta.env.VITE_NEXTDOG_SIDECAR_URL) ||
  (window.location.port === '5173' ? 'http://localhost:6789' : window.location.origin);

const appStyle = css({
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
});

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '0',
  py: '0',
  px: '4',
  height: '44px',
  borderBottom: '1px solid token(colors.border.subtle)',
  background: 'surface.panel',
});

const headerH1Style = css({
  fontSize: 'xl',
  fontWeight: 600,
  color: 'fg.bright',
  letterSpacing: '-0.2px',
});

const navStyle = css({
  display: 'flex',
  gap: '0',
  height: '100%',
  alignItems: 'stretch',
});

const navLinkBase = css({
  display: 'flex',
  alignItems: 'center',
  py: '0',
  px: '3',
  color: 'fg.dim !important',
  fontSize: 'lg',
  fontWeight: 500,
  textDecoration: 'none',
  borderBottom: '2px solid transparent',
  transition: 'all 0.15s ease',
  _hover: {
    color: 'fg.bright !important',
  },
});

const navLinkActiveIndicator = css({
  color: 'fg.bright !important',
  borderBottomColor: 'accent',
});

const navBadgeStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '18px',
  height: '16px',
  py: '0',
  px: '1',
  marginLeft: '1.5',
  borderRadius: 'full',
  fontSize: 'xs',
  fontWeight: 600,
  background: 'surface.hover',
  color: 'fg.dim',
});

const navBadgeActiveStyle = css({
  background: 'surface.raised',
  color: 'fg.bright',
});

const headerRightStyle = css({
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: '3',
  flexShrink: 0,
});

const connectionStatusBaseStyle = css({
  fontSize: 'sm',
  color: 'fg.dim',
  display: 'flex',
  alignItems: 'center',
  gap: '1',
  _before: {
    content: '""',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'red',
  },
});

const connectionStatusConnectedStyle = css({
  fontSize: 'sm',
  color: 'fg.dim',
  display: 'flex',
  alignItems: 'center',
  gap: '1',
  _before: {
    content: '""',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'green',
  },
});

const mainStyle = css({
  flex: 1,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

// Horizontal split: facet drawer (left) + the active view (right). The view
// column owns its own vertical layout, so it stays a flex column that fills.
const contentRowStyle = css({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
});

const viewColumnStyle = css({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export function App() {
  const [currentPath, setCurrentPath] = useState('/');
  // Imported, read-only session (issue #7). Non-null = viewing a file: the live
  // stream is paused (no SSE) and these events replace the live ones everywhere.
  const [imported, setImported] = useState<ImportedSession>(null);
  const isImported = imported !== null;
  const {
    events: liveEvents,
    connected,
    error,
    clearEvents,
    loadOlder,
    loadingOlder,
    hasMoreHistory,
  } = useSSE(SIDECAR_URL, !isImported);
  // Imported events flow through the exact same views/components as live data.
  const events = isImported ? imported.events : liveEvents;
  const eventsResult = useEvents(events);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const { theme, cycle } = useTheme();
  const { toasts, addToast, removeToast, pauseToasts, resumeToasts } = useToasts();

  const handleImport = useCallback(
    (result: ParseResult, fileName: string) => {
      if (!result.ok) {
        addToast({ message: `Can't open ${fileName}: ${result.error}`, type: 'error' });
        return;
      }
      setSelectedTraceId(null);
      setImported(enterImported(result, fileName));
    },
    [addToast],
  );

  const exitToLive = useCallback(() => {
    setSelectedTraceId(null);
    setImported(exitImported());
  }, []);

  const { spanCount, logCount, traceCount } = useMemo(() => {
    let s = 0;
    let l = 0;
    const traces = new Set<string>();
    for (const e of events) {
      if (e.type === 'span') {
        s++;
        if (e.data.traceId) traces.add(e.data.traceId);
      } else {
        l++;
      }
    }
    return { spanCount: s, logCount: l, traceCount: traces.size };
  }, [events]);

  // Facet drawer state. Counts come from the view-appropriate event subset
  // (spans for Spans/Traces, logs for Logs); the drawer is hidden on the
  // full-screen trace detail route.
  const onTraceDetail = currentPath.startsWith('/trace/');
  const facetType: SSEEvent['type'] = currentPath === '/logs' ? 'log' : 'span';
  const facetEvents = useMemo(
    () => events.filter((e) => e.type === facetType),
    [events, facetType],
  );

  const handleFacetToggle = useCallback(
    (key: string, value: string) => {
      eventsResult.setSearchQuery((prev: string) => toggleToken(prev, key, value));
    },
    [eventsResult],
  );

  // Track last-processed index to avoid re-scanning all events
  const lastProcessedIdx = useRef(0);
  // The moment this dashboard started watching. Slow-request toasts are gated to
  // requests that completed at/after this time, so the FileStore history replayed
  // on every load/refresh doesn't re-fire stale toasts (issue #51).
  const watchStartMs = useRef(Date.now());

  // Slow request detection — only processes NEW events since last check.
  // Skipped in imported mode: a static snapshot shouldn't raise live alerts.
  useEffect(() => {
    if (isImported) {
      lastProcessedIdx.current = events.length;
      return;
    }
    for (let i = lastProcessedIdx.current; i < events.length; i++) {
      const toast = detectSlowRequestToast(events[i], watchStartMs.current);
      if (toast) addToast(toast);
    }
    lastProcessedIdx.current = events.length;
  }, [events, addToast, isImported]);

  const handleRoute = useCallback((e: { url: string }) => {
    setCurrentPath(e.url);
  }, []);

  const openTrace = useCallback((traceId: string) => {
    setSelectedTraceId(traceId);
  }, []);

  const closePane = useCallback(() => {
    setSelectedTraceId(null);
  }, []);

  const handleFilter = useCallback(
    (key: string, value: string) => {
      eventsResult.setSearchQuery((prev: string) => {
        const filter = `${key}:${value}`;
        if (prev.includes(filter)) return prev;
        return prev ? `${prev} ${filter}` : filter;
      });
      setSelectedTraceId(null);
    },
    [eventsResult],
  );

  const handleClear = useCallback(() => {
    clearEvents();
    lastProcessedIdx.current = 0;
  }, [clearEvents]);

  const isActive = (path: string) => currentPath === path;

  const isEmpty = events.length === 0;

  // Latch true on the first event ever seen this session. Survives a manual
  // Clear (which resets `events` to []) so the empty state can tell "connected
  // but no traffic yet" apart from "you cleared an active stream". (issue #11)
  const everReceivedRef = useRef(false);
  if (events.length > 0) everReceivedRef.current = true;
  const everReceived = everReceivedRef.current;

  return (
    <ImportDropZone onImport={handleImport}>
      <div className={appStyle}>
        {isImported && imported && (
          <ImportedBadge
            fileName={imported.fileName}
            eventCount={imported.events.length}
            onExit={exitToLive}
          />
        )}
        <header className={headerStyle}>
          <div
            className={css({ display: 'flex', alignItems: 'center', gap: '2', marginRight: '2' })}
          >
            <Logo size={22} />
            <h1 className={headerH1Style}>NextDog</h1>
          </div>
          <nav className={navStyle}>
            <a href="/" className={`${navLinkBase} ${isActive('/') ? navLinkActiveIndicator : ''}`}>
              Spans
              {spanCount > 0 && (
                <span className={`${navBadgeStyle} ${isActive('/') ? navBadgeActiveStyle : ''}`}>
                  {spanCount > 999 ? '999+' : spanCount}
                </span>
              )}
            </a>
            <a
              href="/traces"
              className={`${navLinkBase} ${isActive('/traces') ? navLinkActiveIndicator : ''}`}
            >
              Traces
              {traceCount > 0 && (
                <span
                  className={`${navBadgeStyle} ${isActive('/traces') ? navBadgeActiveStyle : ''}`}
                >
                  {traceCount > 999 ? '999+' : traceCount}
                </span>
              )}
            </a>
            <a
              href="/logs"
              className={`${navLinkBase} ${isActive('/logs') ? navLinkActiveIndicator : ''}`}
            >
              Logs
              {logCount > 0 && (
                <span
                  className={`${navBadgeStyle} ${isActive('/logs') ? navBadgeActiveStyle : ''}`}
                >
                  {logCount > 999 ? '999+' : logCount}
                </span>
              )}
            </a>
          </nav>
          <div className={headerRightStyle}>
            <Sparkline events={events} />
            {!isImported && events.length > 0 && hasMoreHistory && (
              <button
                type="button"
                className={pillStyle}
                onClick={loadOlder}
                disabled={loadingOlder}
                title="Load older history from disk (beyond the live buffer)"
              >
                {loadingOlder ? 'Loading…' : 'Load older'}
              </button>
            )}
            {!isImported && eventsResult.filtered.length > 0 && (
              <ExportButton
                events={eventsResult.filtered}
                meta={{ kind: 'view' }}
                label="Export view"
                title="Download the current filtered view as a portable file"
              />
            )}
            <OpenTraceButton onImport={handleImport} />
            {!isImported && events.length > 0 && (
              <button
                type="button"
                className={pillStyle}
                onClick={handleClear}
                title="Clear all events"
              >
                Clear
              </button>
            )}
            {isImported ? (
              <span className={connectionStatusBaseStyle}>Live paused</span>
            ) : (
              <span
                className={connected ? connectionStatusConnectedStyle : connectionStatusBaseStyle}
              >
                {connected ? 'Connected' : (error ?? 'Disconnected')}
              </span>
            )}
            <ThemeToggle theme={theme} onCycle={cycle} />
          </div>
        </header>
        <div className={mainStyle}>
          {isEmpty ? (
            isImported ? (
              <EmptyState connected={false} everReceived sidecarUrl={SIDECAR_URL} />
            ) : (
              <EmptyState
                connected={connected}
                everReceived={everReceived}
                sidecarUrl={SIDECAR_URL}
              />
            )
          ) : (
            <div className={contentRowStyle}>
              {!onTraceDetail && (
                <ErrorBoundary>
                  <FacetDrawer
                    events={facetEvents}
                    query={eventsResult.searchQuery}
                    onToggleValue={handleFacetToggle}
                  />
                </ErrorBoundary>
              )}
              <div className={viewColumnStyle}>
                <ErrorBoundary>
                  <Router onChange={handleRoute}>
                    <Spans path="/" eventsResult={eventsResult} onOpenTrace={openTrace} />
                    <Requests path="/traces" eventsResult={eventsResult} onOpenTrace={openTrace} />
                    <Logs
                      path="/logs"
                      eventsResult={eventsResult}
                      allEvents={events}
                      onOpenTrace={openTrace}
                      onFilter={handleFilter}
                    />
                    <Trace path="/trace/:traceId" events={events} />
                  </Router>
                </ErrorBoundary>
              </div>
            </div>
          )}
        </div>

        {selectedTraceId && (
          <ErrorBoundary>
            <DetailPane
              traceId={selectedTraceId}
              events={events}
              onClose={closePane}
              onFilter={handleFilter}
            />
          </ErrorBoundary>
        )}

        <ToastContainer
          toasts={toasts}
          removeToast={removeToast}
          onOpenTrace={openTrace}
          onPause={pauseToasts}
          onResume={resumeToasts}
          hidden={selectedTraceId !== null}
        />
        <ShortcutHelp />
        <ContextMenuContainer />
      </div>
    </ImportDropZone>
  );
}
