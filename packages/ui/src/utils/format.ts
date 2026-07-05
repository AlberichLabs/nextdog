import type { SSEEvent } from '../hooks/use-sse';

/**
 * Parse BigInt nano timestamps (handles the 'n' suffix from server serialization).
 *
 * Defensive: an invalid/garbage value degrades to 0n rather than throwing. Live
 * SSE data and imported files (issue #44) can both carry a malformed timing
 * field, and an unguarded BigInt('abc') throws a SyntaxError that — with no
 * error boundary above it — blanks the whole dashboard. Mirrors the MCP server's
 * durationMs() try/catch (packages/mcp/src/tools.ts).
 */
export function parseNano(value: string | bigint | undefined): bigint {
  if (!value) return 0n;
  if (typeof value === 'bigint') return value >= 0n ? value : 0n;
  const s = value.endsWith('n') ? value.slice(0, -1) : value;
  try {
    const n = BigInt(s);
    return n >= 0n ? n : 0n;
  } catch {
    return 0n;
  }
}

/** Format milliseconds as a human-readable duration */
export function formatDurationMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Compute duration in ms from an SSEEvent's nano timestamps */
export function spanDurationMs(event: SSEEvent): number {
  const start = parseNano(event.data.startTimeUnixNano);
  const end = parseNano(event.data.endTimeUnixNano);
  if (start === 0n || end === 0n) return 0;
  return Number(end - start) / 1_000_000;
}

/** Format an SSEEvent's duration as a string */
export function formatSpanDuration(event: SSEEvent): string {
  const ms = spanDurationMs(event);
  if (ms === 0) return '';
  return formatDurationMs(ms);
}

/** Format a timestamp as relative time (e.g., "just now", "5s ago") */
export function formatTime(ts: number): string {
  const ago = Date.now() - ts;
  if (ago < 5000) return 'just now';
  if (ago < 60000) return `${Math.floor(ago / 1000)}s ago`;
  if (ago < 3600000) return `${Math.floor(ago / 60000)}m ago`;
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * The HTTP status code for a span event, if present. Reads the same fields the
 * matcher's `statusCode:` facet does (issue #52), so a click-to-filter on a
 * status fact produces a `statusCode:NNN` query that actually matches (issue #54).
 */
export function httpCodeOf(event: SSEEvent): number | undefined {
  const raw =
    event.data.statusCode ??
    event.data.attributes['http.status_code'] ??
    event.data.attributes['http.response.status_code'];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Genuine last-resort authority used only when a span carries NO host at all
 * (neither `http.host` nor `net.host.name`). The capture path now records the
 * real `Host` header (issue #78), so the app's actual port drives the URL on any
 * port; this default is reached only for hostless/pre-fix spans.
 */
const LAST_RESORT_HOST = 'localhost:3000';

/** Extract common HTTP metadata from span attributes */
export function extractHttpMeta(attrs: Record<string, unknown>, name: string) {
  const method = String(attrs['http.method'] ?? attrs['http.request.method'] ?? 'GET');
  const route = String(attrs['http.route'] ?? attrs['http.target'] ?? name);
  const host = String(attrs['http.host'] ?? attrs['net.host.name'] ?? LAST_RESORT_HOST);
  const scheme = String(attrs['http.scheme'] ?? 'http');
  const url = route.startsWith('http') ? route : `${scheme}://${host}${route}`;
  return { method, route, host, scheme, url };
}
