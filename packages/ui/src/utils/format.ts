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

/** Extract common HTTP metadata from span attributes */
export function extractHttpMeta(attrs: Record<string, unknown>, name: string) {
  const method = String(attrs['http.method'] ?? attrs['http.request.method'] ?? 'GET');
  const route = String(attrs['http.route'] ?? attrs['http.target'] ?? name);
  const host = String(attrs['http.host'] ?? attrs['net.host.name'] ?? 'localhost:3000');
  const scheme = String(attrs['http.scheme'] ?? 'http');
  const url = route.startsWith('http') ? route : `${scheme}://${host}${route}`;
  return { method, route, host, scheme, url };
}
