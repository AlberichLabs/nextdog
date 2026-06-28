/**
 * Transport-agnostic tool handlers for the @nextdog/mcp server.
 *
 * Each handler takes a {@link SidecarClient} and plain arguments, queries the
 * sidecar's read-only HTTP API, and returns a plain JSON-serializable result.
 * The MCP server wiring (`server.ts`) is responsible only for schema declaration
 * and turning these results / thrown errors into MCP tool responses. Keeping the
 * logic here (free of any MCP SDK types) is what lets us unit-test the tools
 * against a mocked sidecar without standing up a transport.
 *
 * READ-ONLY: nothing here mutates sidecar state.
 *
 * PRIVACY: these tools surface whatever the sidecar already returns — including
 * any captured request/response bodies and query params held in span attributes.
 * Redaction follows the project's (pending) telemetry-privacy policy; this layer
 * does not add or remove redaction. See README.
 */
import type { SidecarClient } from './client';
import { matchesQuery } from './matcher';
import { isLog, isSpan, type SidecarEvent, type SpanEvent } from './types';

const DEFAULT_LIMIT = 50;

function route(event: SidecarEvent): string | undefined {
  const a = event.data.attributes;
  const r = a['http.route'] ?? a['http.target'] ?? event.data.name;
  return r === undefined ? undefined : String(r);
}

function statusCode(event: SidecarEvent): number | undefined {
  const raw = event.data.statusCode ?? event.data.attributes['http.status_code'];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function isErrorSpan(event: SidecarEvent): boolean {
  if (!isSpan(event)) return false;
  if ((event.data.status?.code ?? '').toUpperCase() === 'ERROR') return true;
  const code = statusCode(event);
  return code !== undefined && code >= 500;
}

/** A compact summary of a root request span, for list/overview tools. */
export interface TraceSummary {
  traceId: string;
  rootName?: string;
  service: string;
  route?: string;
  statusCode?: number;
  status?: string;
  isError: boolean;
  startTime?: number;
  spanCount: number;
}

function summarizeTrace(traceId: string, spans: SpanEvent[]): TraceSummary {
  // Prefer the root (no parent) SERVER span; fall back to the earliest.
  const sorted = [...spans].sort((a, b) => a.timestamp - b.timestamp);
  const root = sorted.find((s) => !s.data.parentSpanId) ?? sorted[0];
  return {
    traceId,
    rootName: root?.data.name,
    service: root?.data.serviceName ?? spans[0]?.data.serviceName ?? '',
    route: root ? route(root) : undefined,
    statusCode: root ? statusCode(root) : undefined,
    status: root?.data.status?.code,
    isError: spans.some(isErrorSpan),
    startTime: root?.timestamp,
    spanCount: spans.length,
  };
}

function groupByTrace(spans: SpanEvent[]): Map<string, SpanEvent[]> {
  const byTrace = new Map<string, SpanEvent[]>();
  for (const span of spans) {
    const id = span.data.traceId;
    if (!id) continue;
    const list = byTrace.get(id);
    if (list) list.push(span);
    else byTrace.set(id, [span]);
  }
  return byTrace;
}

export interface ListRecentTracesArgs {
  /** Substring match on route/target/name (same semantics as the `route:` facet). */
  route?: string;
  /** Filter to traces whose root status matches, e.g. `ERROR` or an HTTP code like `500`. */
  status?: string;
  service?: string;
  /** Only include traces started within the last N minutes. */
  withinMinutes?: number;
  /** Only include error traces. */
  errorsOnly?: boolean;
  limit?: number;
}

/**
 * list_recent_traces — recent request traces, newest first, with optional
 * route/status/service/time filters. Returns one summary row per trace.
 */
export async function listRecentTraces(
  client: SidecarClient,
  args: ListRecentTracesArgs = {},
): Promise<{ traces: TraceSummary[] }> {
  const since =
    args.withinMinutes !== undefined ? Date.now() - args.withinMinutes * 60_000 : undefined;

  const events = await client.events({ type: 'span', service: args.service, since });
  const spans = events.filter(isSpan);
  const byTrace = groupByTrace(spans);

  let summaries = [...byTrace.entries()].map(([id, s]) => summarizeTrace(id, s));

  if (args.route) {
    const needle = args.route.toLowerCase();
    summaries = summaries.filter((t) => (t.route ?? '').toLowerCase().includes(needle));
  }
  if (args.status) {
    const wanted = args.status.toLowerCase();
    summaries = summaries.filter(
      (t) =>
        (t.status ?? '').toLowerCase() === wanted || String(t.statusCode ?? '') === args.status,
    );
  }
  if (args.errorsOnly) {
    summaries = summaries.filter((t) => t.isError);
  }

  summaries.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  return { traces: summaries.slice(0, args.limit ?? DEFAULT_LIMIT) };
}

/** One node in the reconstructed span tree. */
export interface SpanTreeNode {
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: string;
  service: string;
  status?: string;
  statusCode?: number;
  durationMs?: number;
  startTime: number;
  attributes: Record<string, unknown>;
  children: SpanTreeNode[];
}

function durationMs(span: SpanEvent): number | undefined {
  const { startTimeUnixNano, endTimeUnixNano } = span.data;
  if (!startTimeUnixNano || !endTimeUnixNano) return undefined;
  try {
    const start = BigInt(startTimeUnixNano.replace(/n$/, ''));
    const end = BigInt(endTimeUnixNano.replace(/n$/, ''));
    return Number(end - start) / 1_000_000;
  } catch {
    return undefined;
  }
}

function toNode(span: SpanEvent): SpanTreeNode {
  return {
    spanId: span.data.spanId,
    parentSpanId: span.data.parentSpanId,
    name: span.data.name,
    kind: span.data.kind,
    service: span.data.serviceName,
    status: span.data.status?.code,
    statusCode: statusCode(span),
    durationMs: durationMs(span),
    startTime: span.timestamp,
    attributes: span.data.attributes,
    children: [],
  };
}

/**
 * Build a parent→child forest from a flat span list. Spans whose parent is not
 * present in the set (e.g. an upstream span from another service) are treated as
 * roots so nothing is silently dropped.
 */
export function buildSpanTree(spans: SpanEvent[]): SpanTreeNode[] {
  const nodes = new Map<string, SpanTreeNode>();
  for (const span of spans) {
    if (span.data.spanId) nodes.set(span.data.spanId, toNode(span));
  }

  const roots: SpanTreeNode[] = [];
  for (const span of spans) {
    const node = span.data.spanId ? nodes.get(span.data.spanId) : toNode(span);
    if (!node) continue;
    const parentId = span.data.parentSpanId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byStart = (a: SpanTreeNode, b: SpanTreeNode) => a.startTime - b.startTime;
  const sortRec = (n: SpanTreeNode) => {
    n.children.sort(byStart);
    n.children.forEach(sortRec);
  };
  roots.sort(byStart);
  roots.forEach(sortRec);
  return roots;
}

export interface CorrelatedLog {
  timestamp: number;
  level?: string;
  message?: string;
  spanId?: string;
  service: string;
  attributes: Record<string, unknown>;
}

export interface GetTraceResult {
  traceId: string;
  found: boolean;
  spanTree: SpanTreeNode[];
  logs: CorrelatedLog[];
}

/**
 * get_trace — full span tree for one trace plus the console logs correlated to it
 * (same `traceId`), in time order.
 *
 * NOTE: the sidecar's `/api/events?traceId=` filter only *excludes* events whose
 * `traceId` differs — events with no `traceId` at all (e.g. an untraced
 * `console.log`) pass the server filter through. We re-assert the `traceId` match
 * here so a trace view only ever contains events that genuinely belong to it.
 */
export async function getTrace(
  client: SidecarClient,
  args: { traceId: string },
): Promise<GetTraceResult> {
  const events = (await client.events({ traceId: args.traceId })).filter(
    (e) => e.data.traceId === args.traceId,
  );
  const spans = events.filter(isSpan);
  const logs = events.filter(isLog);

  return {
    traceId: args.traceId,
    found: spans.length > 0 || logs.length > 0,
    spanTree: buildSpanTree(spans),
    logs: logs
      .map((l) => ({
        timestamp: l.timestamp,
        level: l.data.level,
        message: l.data.message,
        spanId: l.data.spanId,
        service: l.data.serviceName,
        attributes: l.data.attributes,
      }))
      .sort((a, b) => a.timestamp - b.timestamp),
  };
}

export interface SearchLogsArgs {
  /** Datadog-style filter string, e.g. `level:error service:web OR status:ERROR !route:/health`. */
  filter?: string;
  /** Restrict to logs only (default) or include spans too. */
  includeSpans?: boolean;
  limit?: number;
}

/**
 * search_logs — query events with the same Datadog-style grammar the dashboard
 * search bar uses (`level:error`, `service:`, `status:`, `!`, `OR`, free text).
 * Defaults to logs only; set `includeSpans` to also match spans.
 */
export async function searchLogs(
  client: SidecarClient,
  args: SearchLogsArgs = {},
): Promise<{ results: SidecarEvent[]; count: number }> {
  const events = await client.events(args.includeSpans ? {} : { type: 'log' });
  const filter = args.filter ?? '';
  const matched = events
    .filter((e) => matchesQuery(e, filter))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, args.limit ?? DEFAULT_LIMIT);
  return { results: matched, count: matched.length };
}

export interface ErrorSpanSummary {
  traceId?: string;
  spanId?: string;
  name?: string;
  service: string;
  route?: string;
  statusCode?: number;
  status?: string;
  message?: string;
  /** Stack trace, if captured on the span (`exception.stacktrace` / `error.stack`). */
  stack?: string;
  timestamp: number;
}

function stackTrace(span: SpanEvent): string | undefined {
  const a = span.data.attributes;
  const s = a['exception.stacktrace'] ?? a['exception.stack'] ?? a['error.stack'] ?? a.stack;
  return s === undefined ? undefined : String(s);
}

/**
 * get_errors — recent error spans (status ERROR or HTTP >= 500) with their
 * captured stack traces, newest first.
 */
export async function getErrors(
  client: SidecarClient,
  args: { service?: string; withinMinutes?: number; limit?: number } = {},
): Promise<{ errors: ErrorSpanSummary[] }> {
  const since =
    args.withinMinutes !== undefined ? Date.now() - args.withinMinutes * 60_000 : undefined;
  const events = await client.events({ type: 'span', service: args.service, since });
  const errors = events
    .filter(isSpan)
    .filter(isErrorSpan)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, args.limit ?? DEFAULT_LIMIT)
    .map(
      (s): ErrorSpanSummary => ({
        traceId: s.data.traceId,
        spanId: s.data.spanId,
        name: s.data.name,
        service: s.data.serviceName,
        route: route(s),
        statusCode: statusCode(s),
        status: s.data.status?.code,
        message: s.data.status?.message,
        stack: stackTrace(s),
        timestamp: s.timestamp,
      }),
    );
  return { errors };
}
