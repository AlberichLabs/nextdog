import Router, { route } from 'preact-router';
import { useState, useCallback, useMemo, useEffect, useRef } from 'preact/hooks';
import { css } from 'styled-system/css';
import { useSSE } from './hooks/use-sse.js';
import { useEvents } from './hooks/use-events.js';
import { useKeyboard } from './hooks/use-keyboard.js';
import { useTheme } from './hooks/use-theme.js';
import { pillStyle } from './styles/shared.js';
import { Requests } from './views/requests.js';
import { Logs } from './views/logs.js';
import { Trace } from './views/trace.js';
import { DetailPane } from './components/detail-pane.js';
import { Logo } from './components/logo.js';
import { ThemeToggle } from './components/theme-toggle.js';
import { Sparkline } from './components/sparkline.js';
import { EmptyState } from './components/empty-state.js';
import { ToastContainer, useToasts } from './components/toast.js';
import { ShortcutHelp } from './components/shortcut-help.js';
import { ContextMenuContainer } from './components/context-menu.js';

const SIDECAR_URL = window.location.port === '5173'
  ? 'http://localhost:6789'
  : window.location.origin;

/** Threshold for slow request toasts (ms) */
const SLOW_REQUEST_MS = 1000;

function formatDurationMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const appStyle = css({
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
});

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '0',
  py: '0', px: '4',
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
  py: '0', px: '3',
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
  py: '0', px: '1',
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

export function App() {
  const [currentPath, setCurrentPath] = useState('/');
  const { events, connected, error, clearEvents, loadOlder, loadingOlder, hasMoreHistory } = useSSE(SIDECAR_URL);
  const eventsResult = useEvents(events);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const { theme, cycle } = useTheme();
  const { toasts, addToast, removeToast, pauseToasts, resumeToasts } = useToasts();

  const { spanCount, logCount } = useMemo(() => {
    let s = 0, l = 0;
    for (const e of events) { e.type === 'span' ? s++ : l++; }
    return { spanCount: s, logCount: l };
  }, [events]);

  // Track last-processed index to avoid re-scanning all events
  const lastProcessedIdx = useRef(0);

  // Slow request detection — only processes NEW events since last check
  useEffect(() => {
    for (let i = lastProcessedIdx.current; i < events.length; i++) {
      const event = events[i];
      if (event.type !== 'span') continue;
      if (!event.data.traceId) continue;
      if (event.data.kind !== 'SERVER') continue;

      if (event.data.startTimeUnixNano && event.data.endTimeUnixNano) {
        const start = BigInt(String(event.data.startTimeUnixNano).replace('n', ''));
        const end = BigInt(String(event.data.endTimeUnixNano).replace('n', ''));
        const ms = Number(end - start) / 1_000_000;
        if (ms >= SLOW_REQUEST_MS) {
          const route = String(event.data.attributes['http.route'] ?? event.data.attributes['http.target'] ?? event.data.name);
          const method = String(event.data.attributes['http.method'] ?? 'GET');
          addToast({
            message: `${method} ${route}`,
            type: ms >= 3000 ? 'error' : 'warning',
            traceId: event.data.traceId,
            duration: formatDurationMs(ms),
          });
        }
      }
    }
    lastProcessedIdx.current = events.length;
  }, [events, addToast]);

  const handleRoute = useCallback((e: { url: string }) => {
    setCurrentPath(e.url);
  }, []);

  const openTrace = useCallback((traceId: string) => {
    setSelectedTraceId(traceId);
  }, []);

  const closePane = useCallback(() => {
    setSelectedTraceId(null);
  }, []);

  const handleFilter = useCallback((key: string, value: string) => {
    eventsResult.setSearchQuery((prev: string) => {
      const filter = `${key}:${value}`;
      if (prev.includes(filter)) return prev;
      return prev ? `${prev} ${filter}` : filter;
    });
    setSelectedTraceId(null);
  }, [eventsResult]);

  const handleClear = useCallback(() => {
    clearEvents();
    lastProcessedIdx.current = 0;
  }, [clearEvents]);

  // --- Global keyboard shortcuts (focus filter, switch view, clear filter) ---
  // These are App-level concerns; the per-view useKeyboard hooks own j/k/Enter/Esc.
  const focusFilter = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>('input[data-nextdog-filter]');
    input?.focus();
  }, []);

  const clearFilter = useCallback(() => {
    eventsResult.setSearchQuery('');
  }, [eventsResult]);

  useKeyboard({
    onFocusFilter: focusFilter,
    onViewSpans: () => route('/'),
    onViewLogs: () => route('/logs'),
    onClearFilter: clearFilter,
  });

  const isActive = (path: string) => currentPath === path;

  const isEmpty = events.length === 0;

  return (
    <div className={appStyle}>
      <header className={headerStyle}>
        <div className={css({ display: 'flex', alignItems: 'center', gap: '2', marginRight: '2' })}>
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
          <a href="/logs" className={`${navLinkBase} ${isActive('/logs') ? navLinkActiveIndicator : ''}`}>
            Logs
            {logCount > 0 && (
              <span className={`${navBadgeStyle} ${isActive('/logs') ? navBadgeActiveStyle : ''}`}>
                {logCount > 999 ? '999+' : logCount}
              </span>
            )}
          </a>
        </nav>
        <div className={headerRightStyle}>
          <Sparkline events={events} />
          {events.length > 0 && hasMoreHistory && (
            <button
              className={pillStyle}
              onClick={loadOlder}
              disabled={loadingOlder}
              title="Load older history from disk (beyond the live buffer)"
            >
              {loadingOlder ? 'Loading…' : 'Load older'}
            </button>
          )}
          {events.length > 0 && (
            <button
              className={pillStyle}
              onClick={handleClear}
              title="Clear all events"
            >
              Clear
            </button>
          )}
          <span className={connected ? connectionStatusConnectedStyle : connectionStatusBaseStyle}>
            {connected ? 'Connected' : error ?? 'Disconnected'}
          </span>
          <ThemeToggle theme={theme} onCycle={cycle} />
        </div>
      </header>
      <div className={mainStyle}>
        {isEmpty ? (
          <EmptyState connected={connected} />
        ) : (
          <Router onChange={handleRoute}>
            <Requests path="/" eventsResult={eventsResult} onOpenTrace={openTrace} />
            <Logs path="/logs" eventsResult={eventsResult} allEvents={events} onOpenTrace={openTrace} onFilter={handleFilter} />
            <Trace path="/trace/:traceId" events={events} />
          </Router>
        )}
      </div>

      {selectedTraceId && (
        <DetailPane
          traceId={selectedTraceId}
          events={events}
          onClose={closePane}
          onFilter={handleFilter}
        />
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
  );
}
