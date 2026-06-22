import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { mergeEvents, oldestTimestamp } from './events-history.js';

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

  // Reload full history (spans AND logs) from the FileStore on initial load.
  // Survives page refresh and dev-server restart — the dashboard is a persistent
  // record, not just a live tail (issue #8). Skipped while disabled (e.g. an
  // imported, read-only trace is open — issue #7).
  useEffect(() => {
    if (!enabled) return;
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    fetch(`${url}/api/events?last=${HISTORY_PAGE}`)
      .then((r) => r.json())
      .then((data) => {
        const history = (data.events ?? []) as SSEEvent[];
        if (history.length === 0) return;
        if (history.length < HISTORY_PAGE) setHasMoreHistory(false);
        // Merge under whatever SSE has already delivered, de-duplicating overlap.
        setEvents((prev) => mergeEvents(history, prev));
      })
      .catch(() => {}); // Silently fail — SSE will still work
  }, [url, enabled]);

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
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;
        // mergeEvents de-duplicates (spanId for spans, service+ts+message for logs)
        // and keeps the list oldest-first.
        setEvents((prev) => mergeEvents(prev, [event]));
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
    };
  }, [url, enabled]);

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
