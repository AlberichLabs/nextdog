import type { SSEEvent } from '../hooks/use-sse';
import { interactiveProps } from '../utils/a11y';

function formatTime(timestamp: number): string {
  const ago = Date.now() - timestamp;
  if (ago < 5000) return 'just now';
  if (ago < 60000) return `${Math.floor(ago / 1000)}s ago`;
  if (ago < 3600000) return `${Math.floor(ago / 60000)}m ago`;
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatDuration(event: SSEEvent): string {
  if (!event.data.startTimeUnixNano || !event.data.endTimeUnixNano) return '';
  const start = BigInt(String(event.data.startTimeUnixNano).replace('n', ''));
  const end = BigInt(String(event.data.endTimeUnixNano).replace('n', ''));
  const ms = Number(end - start) / 1_000_000;
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function httpStatusClass(code?: number): string {
  if (!code) return '';
  if (code >= 500) return 'http-status http-5xx';
  if (code >= 400) return 'http-status http-4xx';
  if (code >= 300) return 'http-status http-3xx';
  if (code >= 200) return 'http-status http-2xx';
  return 'http-status';
}

function statusClass(event: SSEEvent): string {
  const code = event.data.status?.code;
  if (code === 'ERROR') return 'status-error';
  if (code === 'OK') return 'status-ok';
  return 'status-ok';
}

interface EventRowProps {
  event: SSEEvent;
  selected?: boolean;
  onClick?: () => void;
}

export function EventRow({ event, selected, onClick }: EventRowProps) {
  const route =
    event.data.attributes['http.route'] ?? event.data.attributes['http.target'] ?? event.data.name;
  const method =
    event.data.attributes['http.method'] ?? event.data.attributes['http.request.method'] ?? '';
  const httpCode =
    event.data.statusCode ?? (Number(event.data.attributes['http.status_code']) || undefined);

  return (
    <div
      class={`event-row ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      {...interactiveProps(onClick)}
    >
      <span class="timestamp">{formatTime(event.timestamp)}</span>
      <span class="service">{event.data.serviceName}</span>
      {method ? (
        <span class={`method method-${String(method).toLowerCase()}`}>{String(method)}</span>
      ) : (
        <span class="method" />
      )}
      <span class="route">{String(route)}</span>
      {httpCode ? (
        <span class={httpStatusClass(httpCode)}>{httpCode}</span>
      ) : (
        <span class={statusClass(event)}>{event.data.status?.code ?? ''}</span>
      )}
      <span class="duration">{formatDuration(event)}</span>
    </div>
  );
}
