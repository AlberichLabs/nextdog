/**
 * Event shape as returned by the sidecar's HTTP API (`/api/events`, `/api/spans`).
 *
 * This mirrors `@nextdog/ui`'s `SSEEvent`: a unified envelope where both spans and
 * logs flatten their fields into `data`. We deliberately keep this loose (optional
 * fields, `unknown` attribute values) because the matcher reads whatever is present
 * and tolerates missing fields — exactly as the dashboard does.
 *
 * We define it locally rather than importing from `@nextdog/core` so this package
 * stays self-contained and can talk to any sidecar over HTTP without a build-time
 * coupling to core's internal types. The bigint timestamps that core uses on the
 * wire arrive here as the `"123n"` string form (JSON has no bigint); the MCP tools
 * never do arithmetic on them, so we keep them as-is.
 */
export interface SidecarEvent {
  type: 'span' | 'log';
  timestamp: number;
  data: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    name?: string;
    kind?: string;
    startTimeUnixNano?: string;
    endTimeUnixNano?: string;
    attributes: Record<string, unknown>;
    status?: { code?: string; message?: string };
    statusCode?: number;
    serviceName: string;
    level?: string;
    message?: string;
    timestamp?: number;
  };
}

/** A span event narrowed for convenience. */
export type SpanEvent = SidecarEvent & { type: 'span' };

/** A log event narrowed for convenience. */
export type LogEvent = SidecarEvent & { type: 'log' };

export function isSpan(event: SidecarEvent): event is SpanEvent {
  return event.type === 'span';
}

export function isLog(event: SidecarEvent): event is LogEvent {
  return event.type === 'log';
}
