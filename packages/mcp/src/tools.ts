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
 * PRIVACY (issue #60): the MCP server is an egress surface — its output leaves
 * the machine to the AI agent — so every event is routed through the shared
 * egress redactor ({@link redactEvents}) at one chokepoint, {@link loadEvents},
 * before it becomes tool output. The sidecar stores credential headers verbatim
 * for Replay; they are stripped here by default so tokens never reach the agent.
 * Every tool MUST fetch via `loadEvents`, never `client.events` directly.
 */
import type { EventQuery, ReplayPayload, ReplayResult, SidecarClient } from './client';
import { deriveFacets, type Facet } from './facets';
import { matchesQuery } from './matcher';
import { redactEvents, stripSensitiveHeaders } from './redact';
import { parseStackFrames, type StackFrame } from './stack-frames';
import { isLog, isSpan, type SidecarEvent, type SpanEvent } from './types';

const DEFAULT_LIMIT = 50;

/**
 * The ONLY way tools read events: fetch from the sidecar, then redact credential
 * headers before anything leaves the machine. Centralizing this is the #60
 * invariant — a new tool that calls `loadEvents` inherits redaction for free.
 */
async function loadEvents(client: SidecarClient, query: EventQuery = {}): Promise<SidecarEvent[]> {
  return redactEvents(await client.events(query));
}

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

  const events = await loadEvents(client, { type: 'span', service: args.service, since });
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
  const events = (await loadEvents(client, { traceId: args.traceId })).filter(
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
  const events = await loadEvents(client, args.includeSpans ? {} : { type: 'log' });
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
  /**
   * Structured frames parsed from `stack` (#89) — ADDITIVE alongside `stack`,
   * present only when the stack is parseable. Positions are as-captured (source
   * maps deferred; see `stack-frames.ts`).
   */
  frames?: StackFrame[];
  /**
   * The source location that emitted the span, from OTel `code.*` attributes,
   * when the instrumentation captured it. Additive; omitted when absent.
   */
  source?: { file?: string; line?: number; column?: number; function?: string };
  timestamp: number;
}

function stackTrace(span: SpanEvent): string | undefined {
  const a = span.data.attributes;
  const s = a['exception.stacktrace'] ?? a['exception.stack'] ?? a['error.stack'] ?? a.stack;
  return s === undefined ? undefined : String(s);
}

/** Emitting source location from OTel `code.*` attributes, or undefined if none present. */
function codeSource(span: SpanEvent): ErrorSpanSummary['source'] | undefined {
  const a = span.data.attributes;
  const file = a['code.filepath'] ?? a['code.file.path'];
  const line = a['code.lineno'] ?? a['code.line.number'];
  const column = a['code.column'] ?? a['code.column.number'];
  const fn = a['code.function'] ?? a['code.function.name'];
  if (file === undefined && line === undefined && column === undefined && fn === undefined) {
    return undefined;
  }
  const source: ErrorSpanSummary['source'] = {};
  if (file !== undefined) source.file = String(file);
  if (line !== undefined && Number.isFinite(Number(line))) source.line = Number(line);
  if (column !== undefined && Number.isFinite(Number(column))) source.column = Number(column);
  if (fn !== undefined) source.function = String(fn);
  return source;
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
  const events = await loadEvents(client, { type: 'span', service: args.service, since });
  const errors = events
    .filter(isSpan)
    .filter(isErrorSpan)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, args.limit ?? DEFAULT_LIMIT)
    .map((s): ErrorSpanSummary => {
      const stack = stackTrace(s);
      const frames = parseStackFrames(stack);
      const source = codeSource(s);
      return {
        traceId: s.data.traceId,
        spanId: s.data.spanId,
        name: s.data.name,
        service: s.data.serviceName,
        route: route(s),
        statusCode: statusCode(s),
        status: s.data.status?.code,
        message: s.data.status?.message,
        stack,
        ...(frames ? { frames } : {}),
        ...(source ? { source } : {}),
        timestamp: s.timestamp,
      };
    });
  return { errors };
}

/** Map a `withinMinutes` window to a `since` epoch-ms cursor (mirror of tools.ts:119). */
function sinceFromWithinMinutes(withinMinutes?: number): number | undefined {
  return withinMinutes !== undefined ? Date.now() - withinMinutes * 60_000 : undefined;
}

// ---------------------------------------------------------------------------
// v1 debug loop — drive → observe → verify (issues #86, #87, #88)
// ---------------------------------------------------------------------------

export interface ReplayRequestArgs {
  /** Replay the request captured on this span. */
  spanId?: string;
  /** With `spanId`: reconstruct the request and return it WITHOUT sending it. */
  prepareOnly?: boolean;
  /** Edited replay: send exactly this request (takes precedence over `spanId`). */
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

/**
 * replay_request — the "drive" verb. Replays a captured request (by `spanId`,
 * optionally with edits, or a fully custom `request`) through the sidecar's
 * `POST /api/replay` and returns the live response, or — in `prepareOnly` mode —
 * the reconstructed request without sending it.
 *
 * PRIVACY (#60): for a *sent* replay, credentials re-authenticate server-side and
 * never reach us. For a `prepareOnly` echo the sidecar hands back the
 * reconstructed request WITH its captured credential headers, so we strip
 * `authorization`/`cookie`/`x-api-key`/`set-cookie` (and the rest of
 * SENSITIVE_HEADERS) before returning it — captured credentials must never egress
 * to the agent. Response headers of a sent replay are the replayed endpoint's own
 * and are returned as-is (that is the point of a replay).
 */
export async function replayRequest(
  client: SidecarClient,
  args: ReplayRequestArgs = {},
): Promise<ReplayResult> {
  const payload: ReplayPayload = {
    spanId: args.spanId,
    prepareOnly: args.prepareOnly,
    request: args.request,
  };
  const result = await client.replay(payload);

  // A sent replay has a `status`; a prepareOnly echo does not. Only the echo of
  // the reconstructed request may carry captured credentials, so strip there.
  const isSentResponse = typeof result === 'object' && result !== null && 'status' in result;
  if (args.prepareOnly === true && !isSentResponse) {
    return { ...result, headers: stripSensitiveHeaders(result.headers) };
  }
  return result;
}

export interface EventsSinceArgs {
  /** Return events strictly newer than this epoch-ms cursor. Omit for all history. */
  cursor?: number;
  /** `search_logs` filter grammar. */
  filter?: string;
  limit?: number;
}

export interface EventsSinceResult {
  events: SidecarEvent[];
  /** Max event timestamp seen — poll from here next to chain without gaps/dupes. */
  nextCursor: number;
}

/**
 * events_since — the deterministic "observe" primitive. Returns events strictly
 * newer than `cursor` (via the sidecar's `?since=` param) that match `filter`,
 * plus a `nextCursor` to poll from.
 *
 * `nextCursor` advances to the max timestamp of ALL events the window returned —
 * not just the matching ones — so a follow-up call skips the non-matching tail
 * and chaining yields no gap and no duplicate. When the window is truncated by
 * `limit`, `nextCursor` stops at the last returned event so nothing is skipped.
 * On an empty window the input `cursor` is returned unchanged. (Cursors are event
 * timestamps; two events sharing a timestamp at the boundary is the inherent
 * limit of a timestamp cursor.)
 */
export async function eventsSince(
  client: SidecarClient,
  args: EventsSinceArgs = {},
): Promise<EventsSinceResult> {
  const fetched = await loadEvents(client, { since: args.cursor });
  const sorted = [...fetched].sort((a, b) => a.timestamp - b.timestamp);
  const matched = sorted.filter((e) => matchesQuery(e, args.filter ?? ''));

  const limit = args.limit ?? DEFAULT_LIMIT;
  const truncated = matched.length > limit;
  const out = truncated ? matched.slice(0, limit) : matched;

  let nextCursor: number;
  if (truncated) {
    nextCursor = out[out.length - 1].timestamp;
  } else if (sorted.length > 0) {
    nextCursor = sorted[sorted.length - 1].timestamp;
  } else {
    nextCursor = args.cursor ?? 0;
  }

  return { events: out, nextCursor };
}

export interface WaitForEventArgs {
  /** `search_logs` filter grammar — the event(s) to wait for. */
  predicate: string;
  /** Max time to block, ms. Defaults to 5000, capped at 30000. */
  timeoutMs?: number;
  /** Only consider events strictly newer than this epoch-ms cursor. */
  cursor?: number;
  /** Poll interval, ms (default 250). Kept off the MCP schema; used by tests. */
  pollIntervalMs?: number;
}

export interface WaitForEventResult {
  matched: boolean;
  timedOut: boolean;
  events: SidecarEvent[];
  nextCursor: number;
}

/** Default and hard cap for `wait_for_event`'s bounded poll loop. */
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const MAX_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * wait_for_event — blocks until an event matching `predicate` appears, or times
 * out. A bounded, cancellable `since`-poll loop in the MCP over `events_since`
 * (no sidecar change). `timeoutMs` is clamped to [0, 30000] so an absurd value
 * cannot spin forever; the loop always terminates at the deadline.
 *
 * TODO(v2): stream via a resume-cursor on the sidecar's `/sse`
 * (`core/src/sse-stream.ts`) instead of polling — out of scope for v1 (#87).
 */
export async function waitForEvent(
  client: SidecarClient,
  args: WaitForEventArgs,
): Promise<WaitForEventResult> {
  const timeoutMs = Math.min(
    Math.max(0, args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
    MAX_WAIT_TIMEOUT_MS,
  );
  const pollIntervalMs = Math.max(1, args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let cursor = args.cursor;

  for (;;) {
    const { events, nextCursor } = await eventsSince(client, {
      cursor,
      filter: args.predicate,
    });
    if (events.length > 0) {
      return { matched: true, timedOut: false, events, nextCursor };
    }
    cursor = nextCursor;
    if (Date.now() >= deadline) {
      return { matched: false, timedOut: true, events: [], nextCursor: cursor ?? 0 };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
}

const NONE_BUCKET = '(none)';

/**
 * Resolve the group/aggregate key for an event field. Reuses the same field
 * vocabulary as the matcher/facets (route, status, service, level, …); anything
 * unrecognized falls through to `data.attributes[field]`, and a genuinely absent
 * value buckets under `(none)` rather than crashing.
 */
function fieldValue(event: SidecarEvent, field: string): string {
  switch (field) {
    case 'route':
      return route(event) ?? NONE_BUCKET;
    case 'status':
      return event.data.status?.code ?? NONE_BUCKET;
    case 'statusCode':
    case 'status_code': {
      const c = statusCode(event);
      return c === undefined ? NONE_BUCKET : String(c);
    }
    case 'service':
      return event.data.serviceName || NONE_BUCKET;
    case 'level':
      return event.data.level ?? NONE_BUCKET;
    case 'name':
      return event.data.name ?? NONE_BUCKET;
    case 'kind':
      return event.data.kind ?? NONE_BUCKET;
    case 'method': {
      const m =
        event.data.attributes['http.method'] ?? event.data.attributes['http.request.method'];
      return m === undefined ? NONE_BUCKET : String(m);
    }
    case 'trace':
    case 'traceId':
      return event.data.traceId ?? NONE_BUCKET;
    case 'span':
    case 'spanId':
      return event.data.spanId ?? NONE_BUCKET;
    case 'type':
      return event.type;
  }
  const attr = event.data.attributes[field];
  return attr === undefined ? NONE_BUCKET : String(attr);
}

export interface AggregateArgs {
  /** Event field to group by (route, status, statusCode, service, level, or any attribute). */
  groupBy: string;
  /** `search_logs` filter grammar to narrow before grouping. */
  filter?: string;
  withinMinutes?: number;
}

export interface AggregateResult {
  groupBy: string;
  groups: Array<{ key: string; count: number }>;
}

/**
 * aggregate — counts matching events grouped by a span/log field. Pure reduction
 * over `loadEvents` (redaction inherited, #60). Groups are returned largest-first.
 */
export async function aggregate(
  client: SidecarClient,
  args: AggregateArgs,
): Promise<AggregateResult> {
  const since = sinceFromWithinMinutes(args.withinMinutes);
  const events = await loadEvents(client, { since });
  const matched = events.filter((e) => matchesQuery(e, args.filter ?? ''));

  const counts = new Map<string, number>();
  for (const e of matched) {
    const key = fieldValue(e, args.groupBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groups = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return { groupBy: args.groupBy, groups };
}

/** The comparison an `assert` checks the matched count against. Provide exactly one. */
export interface AssertExpect {
  count?: number;
  min?: number;
  max?: number;
  exists?: boolean;
}

export interface AssertArgs {
  /** `search_logs` filter grammar — the events to count. */
  filter: string;
  expect: AssertExpect;
  withinMinutes?: number;
}

export interface AssertResult {
  pass: boolean;
  actual: number;
  /** First matching event (redacted), when there is one. */
  sample?: SidecarEvent;
}

function evaluateExpect(actual: number, expect: AssertExpect): boolean {
  if (expect.exists !== undefined) return expect.exists ? actual > 0 : actual === 0;
  let pass = true;
  let checked = false;
  if (expect.count !== undefined) {
    pass = pass && actual === expect.count;
    checked = true;
  }
  if (expect.min !== undefined) {
    pass = pass && actual >= expect.min;
    checked = true;
  }
  if (expect.max !== undefined) {
    pass = pass && actual <= expect.max;
    checked = true;
  }
  // No expectation supplied → nothing to assert; treat as a failed (unmet) check.
  return checked ? pass : false;
}

/**
 * assert — the "verify" verb. Counts events matching `filter` and evaluates the
 * count against `expect` ({count}/{min}/{max}/{exists}), returning a boolean the
 * agent can branch on plus the actual count and a (redacted) sample. Pure
 * reduction over `loadEvents` (redaction inherited, #60).
 *
 * Named `assertTelemetry` to avoid shadowing Node's `assert`; registered as the
 * `assert` MCP tool.
 */
export async function assertTelemetry(
  client: SidecarClient,
  args: AssertArgs,
): Promise<AssertResult> {
  const since = sinceFromWithinMinutes(args.withinMinutes);
  const events = await loadEvents(client, { since });
  const matched = events
    .filter((e) => matchesQuery(e, args.filter))
    .sort((a, b) => b.timestamp - a.timestamp);

  const actual = matched.length;
  return {
    pass: evaluateExpect(actual, args.expect),
    actual,
    sample: matched[0],
  };
}

// ---------------------------------------------------------------------------
// v2 depth — describe the query surface, scope parallel-safe repros (#89/#90/#91)
// ---------------------------------------------------------------------------

export interface DescribeTelemetryResult {
  /** Distinct service names known to the sidecar (`/api/services`). */
  services: string[];
  /** Facets (services, routes, attribute keys) with observed values + counts. */
  facets: Facet[];
}

/**
 * describe_telemetry — introspect the filterable surface so the agent can
 * discover valid `service:` / `route:` / attribute tokens before querying,
 * instead of guessing. Facets are derived from the SAME reduction the dashboard
 * facet drawer uses ({@link deriveFacets}), which carries the sensitive /
 * high-cardinality DENY-LIST across verbatim — so this introspection tool can't
 * become a credential-leak side channel. Events are read through `loadEvents`, so
 * credential headers are already stripped before faceting (#60).
 */
export async function describeTelemetry(
  client: SidecarClient,
): Promise<DescribeTelemetryResult> {
  const [events, services] = await Promise.all([loadEvents(client), client.services()]);
  return { services, facets: deriveFacets(events) };
}

/**
 * Run scoping (#91) — STAMPING MECHANISM: Option A (header, zero core change).
 *
 * `begin_run` hands back a `x-nextdog-run: <label>` header; the agent drives the
 * repro with `replay_request({ request: { headers: { 'x-nextdog-run': label } } })`.
 * The framework adapter already records every request header as a
 * `http.request.header.<name>` span attribute (`@nextdog/node`
 * `exporter.ts` → `http.request.header.x-nextdog-run`), so the driven request's
 * resulting span is stamped WITHOUT any sidecar/core change. `get_run` then filters
 * events on that attribute. Option B (sidecar echoes a correlation attribute onto
 * the replay's span) would need a core replay-path change, so Option A wins on
 * "least/no core change". The label attribute is non-sensitive, so it survives the
 * #60 egress redactor — exactly what lets `get_run` filter on it.
 *
 * No persisted state / no user-data writes: `begin_run` is a pure handle, `get_run`
 * a pure read+filter. Graceful fallback: an unstamped driven request simply yields
 * an empty run, never a crash.
 */
export const RUN_HEADER = 'x-nextdog-run';
/** Span attribute the adapter records the run header under. */
export const RUN_ATTR = `http.request.header.${RUN_HEADER}`;

export interface BeginRunArgs {
  /** Optional caller-chosen label; a collision-resistant one is generated if omitted. */
  label?: string;
}

export interface BeginRunResult {
  label: string;
  /** Add this header to the `replay_request` you drive the repro with, to stamp it. */
  header: Record<string, string>;
  /** The span attribute `get_run` filters on (for reference). */
  attribute: string;
  startedAt: number;
}

function generateLabel(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${Date.now().toString(36)}-${rand}`;
}

/**
 * begin_run — start a correlation scope for a parallel-safe repro. Returns the
 * label and the `x-nextdog-run` header to stamp driven `replay_request`s with.
 * Stateless: the label is the correlation key, so `get_run` works even across
 * processes and needs no prior `begin_run`.
 */
export async function beginRun(args: BeginRunArgs = {}): Promise<BeginRunResult> {
  const label = args.label && args.label.trim().length > 0 ? args.label : generateLabel();
  return {
    label,
    header: { [RUN_HEADER]: label },
    attribute: RUN_ATTR,
    startedAt: Date.now(),
  };
}

export interface GetRunArgs {
  /** The run label to scope to (from `begin_run`). */
  label: string;
}

export interface GetRunResult {
  label: string;
  events: SidecarEvent[];
  count: number;
}

/** True if an event was stamped with exactly this run label. */
function eventInRun(event: SidecarEvent, label: string): boolean {
  const a = event.data.attributes;
  // Exact equality (not the matcher's substring attr semantics) so a prefix run
  // label — `run-1` vs `run-12` — can never bleed across overlapping runs.
  return String(a[RUN_ATTR] ?? '') === label || String(a[RUN_HEADER] ?? '') === label;
}

/**
 * get_run — return only the events belonging to a labeled run, newest first.
 * Reads through `loadEvents` (redaction inherited, #60) and filters by the run
 * attribute; an unknown/never-stamped label yields an empty run rather than an error.
 */
export async function getRun(client: SidecarClient, args: GetRunArgs): Promise<GetRunResult> {
  const events = (await loadEvents(client))
    .filter((e) => eventInRun(e, args.label))
    .sort((a, b) => b.timestamp - a.timestamp);
  return { label: args.label, events, count: events.length };
}
