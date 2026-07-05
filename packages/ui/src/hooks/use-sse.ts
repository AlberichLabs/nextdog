import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { appendLiveEvents, mergeEvents, oldestTimestamp } from './events-history';
import { initialConnectionState, onSSEOpen } from './sse-lifecycle';

export interface SSEEvent {
  type: 'span' | 'log';
  timestamp: number;
  data: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    name: string;
    kind?: string;
    startTimeUnixNano?: string;
    endTimeUnixNano?: string;
    attributes: Record<string, unknown>;
    status?: { code: string; message?: string };
    statusCode?: number;
    serviceName: string;
    level?: string;
    message?: string;
    timestamp?: number;
  };
}

/** Page size for history reloads and "load older" requests. */
const HISTORY_PAGE = 500;

export interface UseSSEResult {
  events: SSEEvent[];
  connected: boolean;
  error: string | null;
  clearEvents: () => void;
  /** Page further back into the on-disk history (beyond the live buffer). */
  loadOlder: () => void;
  loadingOlder: boolean;
  /** False once a "load older" page returns no new events — nothing more on disk. */
  hasMoreHistory: boolean;
}

export function useSSE(url: string, enabled = true): UseSSEResult {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const initialLoadDone = useRef(false);
  const connectionState = useRef(initialConnectionState);

  // Reload full history (spans AND logs) from the FileStore. Merges under whatever
  // SSE has already delivered, de-duplicating overlap. The dashboard is a persistent
  // record, not just a live tail (issue #8), so this backfills on mount AND on every
  // SSE reconnect (see below).
  const loadHistory = useCallback(() => {
    fetch(`${url}/api/events?last=${HISTORY_PAGE}`)
      .then((r) => r.json())
      .then((data) => {
        const history = (data.events ?? []) as SSEEvent[];
        if (history.length === 0) return;
        if (history.length < HISTORY_PAGE) setHasMoreHistory(false);
        setEvents((prev) => mergeEvents(history, prev));
      })
      .catch(() => {}); // Silently fail — SSE will still work
  }, [url]);

  // Initial load. Survives page refresh and dev-server restart. Skipped while
  // disabled (e.g. an imported, read-only trace is open — issue #7).
  useEffect(() => {
    if (!enabled) return;
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadHistory();
  }, [enabled, loadHistory]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    const es = new EventSource(`${url}/sse`);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
      // On a RECONNECT (not the first open), the process on :6789 may have been
      // replaced — an idle-shutdown recovery or a version auto-upgrade — with a
      // fresh sidecar whose in-memory ring buffer is empty, so its SSE backfill
      // carries none of the inherited history. Reload it from disk so the dashboard
      // recovers seamlessly with no gap (issue #79).
      const { state, reloadHistory } = onSSEOpen(connectionState.current);
      connectionState.current = state;
      if (reloadHistory) loadHistory();
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;
        // appendLiveEvents de-duplicates (spanId for spans, service+ts+message for
        // logs), keeps the list oldest-first, and bounds it to the most recent
        // MAX_LIVE_EVENTS — without re-sorting the whole buffer on every message,
        // which is what froze the page under real traffic (issue #58).
        setEvents((prev) => appendLiveEvents(prev, [event]));
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError('Connection lost — reconnecting...');
    };

    return () => {
      es.close();
      esRef.current = null;
      // A fresh EventSource (url/enabled change) starts a new connection lifecycle;
      // its first open is an initial connect, not a reconnect.
      connectionState.current = initialConnectionState;
    };
  }, [url, enabled, loadHistory]);

  const loadOlder = useCallback(() => {
    if (loadingOlder || !hasMoreHistory) return;
    setLoadingOlder(true);

    const before = oldestTimestamp(events);
    const params = new URLSearchParams({ last: String(HISTORY_PAGE) });
    if (before !== undefined) params.set('before', String(before));

    fetch(`${url}/api/events?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        const older = (data.events ?? []) as SSEEvent[];
        if (older.length < HISTORY_PAGE) setHasMoreHistory(false);
        if (older.length > 0) {
          setEvents((prev) => mergeEvents(older, prev));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingOlder(false));
  }, [url, events, loadingOlder, hasMoreHistory]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, connected, error, clearEvents, loadOlder, loadingOlder, hasMoreHistory };
}
