/**
 * MCP server wiring: declares the four read-only tools and binds each to its
 * handler in `tools.ts`. This module owns the MCP SDK surface (schemas, response
 * envelopes, error formatting) and nothing else — the actual sidecar logic lives
 * in the transport-agnostic handlers so it can be unit-tested without a transport.
 */
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * The version reported in the MCP `initialize` handshake (`serverInfo.version`)
 * is read from this package's own manifest rather than hardcoded, so it can
 * never drift from the published version. The release flow bumps
 * `packages/mcp/package.json` to the release tag before build+publish, and both
 * `src/server.ts` (tests) and `dist/server.js` (published) sit one directory
 * below the manifest, so `../package.json` resolves in both. See issue #97.
 */
const { version: PACKAGE_VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};
import { SidecarClient, type SidecarClientOptions, SidecarUnavailableError } from './client';
import {
  aggregate,
  assertTelemetry,
  beginRun,
  describeTelemetry,
  eventsSince,
  getErrors,
  getRun,
  getTrace,
  listRecentTraces,
  replayRequest,
  searchLogs,
  waitForEvent,
} from './tools';

/** Wrap a handler so a sidecar-down (or any) failure becomes a clean MCP tool error. */
function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message =
    err instanceof SidecarUnavailableError
      ? err.message
      : `NextDog MCP tool error: ${err instanceof Error ? err.message : String(err)}`;
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export interface CreateServerOptions extends SidecarClientOptions {
  /** Inject a pre-built client (tests). Overrides the client options above. */
  client?: SidecarClient;
}

/**
 * Build the NextDog MCP server with all tools registered. The caller connects it
 * to a transport (stdio in the CLI).
 */
export function createMcpServer(opts: CreateServerOptions = {}): McpServer {
  const client = opts.client ?? new SidecarClient(opts);

  const server = new McpServer({
    name: '@nextdog/mcp',
    version: PACKAGE_VERSION,
  });

  server.registerTool(
    'list_recent_traces',
    {
      title: 'List recent traces',
      description:
        'List recent request traces from local NextDog telemetry, newest first. ' +
        'Optionally filter by route (substring), status (e.g. "ERROR" or "500"), ' +
        'service, a recent time window, or errors only.',
      inputSchema: {
        route: z.string().optional().describe('Substring match on the request route/target/name'),
        status: z
          .string()
          .optional()
          .describe('Root span status: "ERROR"/"OK" or an HTTP code like "500"'),
        service: z.string().optional().describe('Restrict to one service name'),
        withinMinutes: z
          .number()
          .optional()
          .describe('Only traces started within the last N minutes'),
        errorsOnly: z.boolean().optional().describe('Only include traces containing an error span'),
        limit: z.number().optional().describe('Max traces to return (default 50)'),
      },
    },
    (args) => run(() => listRecentTraces(client, args)),
  );

  server.registerTool(
    'get_trace',
    {
      title: 'Get a trace',
      description:
        'Get the full span tree for a trace plus its correlated console logs, ' +
        'in time order. Use a traceId from list_recent_traces, search_logs, or get_errors.',
      inputSchema: {
        traceId: z.string().describe('The trace id to fetch'),
      },
    },
    (args) => run(() => getTrace(client, args)),
  );

  server.registerTool(
    'search_logs',
    {
      title: 'Search logs',
      description:
        'Search local telemetry with the NextDog Datadog-style filter grammar — ' +
        'the same one the dashboard search bar uses. Supports facets ' +
        '(level:error, service:web, status:ERROR, route:/api, statusCode:500, name:, message:, kind:), ' +
        'free text, negation (!level:debug or -service:web), and OR groups ' +
        '(level:error OR level:warn). Tokens are AND-ed; OR-joined tokens form one group. ' +
        'Returns logs by default; set includeSpans to also match spans.',
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe(
            'Filter expression, e.g. "level:error service:web OR status:ERROR !route:/health"',
          ),
        includeSpans: z.boolean().optional().describe('Also match spans, not just logs'),
        limit: z.number().optional().describe('Max results (default 50)'),
      },
    },
    (args) => run(() => searchLogs(client, args)),
  );

  server.registerTool(
    'get_errors',
    {
      title: 'Get recent errors',
      description:
        'List recent error spans (status ERROR or HTTP >= 500) with their captured ' +
        'stack traces, newest first. Optionally filter by service or a recent time window.',
      inputSchema: {
        service: z.string().optional().describe('Restrict to one service name'),
        withinMinutes: z.number().optional().describe('Only errors within the last N minutes'),
        limit: z.number().optional().describe('Max errors to return (default 50)'),
      },
    },
    (args) => run(() => getErrors(client, args)),
  );

  // --- v1 debug loop: drive → observe → verify (#86, #87, #88) ---

  server.registerTool(
    'replay_request',
    {
      title: 'Replay a request',
      description:
        'Drive a repro: replay a captured request through the local sidecar and return the ' +
        'live response. Pass a spanId (from list_recent_traces/get_errors) for a one-click ' +
        'replay; add prepareOnly to reconstruct the request WITHOUT sending it (credential ' +
        'headers are stripped from that echo); or pass a full request to send an edited one. ' +
        'Scoped to captured requests plus edits — not arbitrary traffic.',
      inputSchema: {
        spanId: z.string().optional().describe('Span id of the captured request to replay'),
        prepareOnly: z
          .boolean()
          .optional()
          .describe('Reconstruct the request and return it without sending (dry run)'),
        request: z
          .object({
            method: z.string().optional(),
            url: z.string().optional(),
            headers: z.record(z.string()).optional(),
            body: z.string().optional(),
          })
          .optional()
          .describe('Edited replay: send exactly this request (overrides spanId)'),
      },
    },
    (args) => run(() => replayRequest(client, args)),
  );

  server.registerTool(
    'events_since',
    {
      title: 'Events since a cursor',
      description:
        'Deterministically observe: return events strictly newer than a cursor (epoch-ms), ' +
        'optionally filtered with the search_logs grammar, plus a nextCursor to poll from. ' +
        'Chain calls with nextCursor to page through new telemetry without gaps or duplicates.',
      inputSchema: {
        cursor: z
          .number()
          .optional()
          .describe('Epoch-ms cursor; only events strictly newer are returned (omit for all)'),
        filter: z.string().optional().describe('search_logs filter grammar'),
        limit: z.number().optional().describe('Max events to return (default 50)'),
      },
    },
    (args) => run(() => eventsSince(client, args)),
  );

  server.registerTool(
    'wait_for_event',
    {
      title: 'Wait for an event',
      description:
        'Block until an event matching a predicate (search_logs grammar) appears in local ' +
        'telemetry, or time out. Use after replay_request to wait for the resulting event ' +
        'deterministically instead of racing snapshots. Returns the matching event(s) + a ' +
        'nextCursor, or a clean timeout result.',
      inputSchema: {
        predicate: z.string().describe('search_logs filter grammar for the event to wait for'),
        timeoutMs: z
          .number()
          .optional()
          .describe('Max time to block in ms (default 5000, capped at 30000)'),
        cursor: z
          .number()
          .optional()
          .describe('Only consider events strictly newer than this epoch-ms cursor'),
      },
    },
    (args) => run(() => waitForEvent(client, args)),
  );

  server.registerTool(
    'aggregate',
    {
      title: 'Aggregate telemetry',
      description:
        'Count events grouped by a field (route, status, statusCode, service, level, method, ' +
        'name, kind, or any attribute), optionally narrowed by a search_logs filter and a ' +
        'recent time window. E.g. groupBy "route" over "status:ERROR" gives errors per route.',
      inputSchema: {
        groupBy: z.string().describe('Field to group by (e.g. "route", "statusCode", "service")'),
        filter: z.string().optional().describe('search_logs filter grammar to narrow first'),
        withinMinutes: z.number().optional().describe('Only events within the last N minutes'),
      },
    },
    (args) => run(() => aggregate(client, args)),
  );

  server.registerTool(
    'assert',
    {
      title: 'Assert on telemetry',
      description:
        'Verify a condition on local telemetry the agent can branch on: count events matching ' +
        'a search_logs filter and compare against an expectation (count / min / max / exists). ' +
        'Returns { pass, actual, sample }. Use to confirm a fix, e.g. assert the 500s on ' +
        '/checkout are gone.',
      inputSchema: {
        filter: z.string().describe('search_logs filter grammar for the events to count'),
        expect: z
          .object({
            count: z.number().optional().describe('Exact count'),
            min: z.number().optional().describe('At least this many'),
            max: z.number().optional().describe('At most this many'),
            exists: z.boolean().optional().describe('true: at least one; false: none'),
          })
          .describe('Provide exactly one expectation'),
        withinMinutes: z.number().optional().describe('Only events within the last N minutes'),
      },
    },
    (args) => run(() => assertTelemetry(client, args)),
  );

  // --- v2 depth: discover the surface, scope parallel-safe repros (#90, #91) ---

  server.registerTool(
    'describe_telemetry',
    {
      title: 'Describe telemetry surface',
      description:
        'Introspect the filterable surface before querying: returns the known services plus ' +
        'facets (route, status, level, and bounded custom attributes) with observed values and ' +
        'counts. Use it to discover valid service:/route:/attribute tokens for search_logs, ' +
        'aggregate, and assert instead of guessing. Sensitive/high-cardinality keys are omitted.',
      inputSchema: {},
    },
    () => run(() => describeTelemetry(client)),
  );

  server.registerTool(
    'begin_run',
    {
      title: 'Begin a labeled run',
      description:
        'Start a correlation scope for a parallel-safe repro. Returns a label and the ' +
        'x-nextdog-run header to stamp your driven request with: pass it via ' +
        'replay_request({ request: { headers: { "x-nextdog-run": <label> } } }). Then use ' +
        'get_run(label) to read back only that run’s events. No persisted state.',
      inputSchema: {
        label: z
          .string()
          .optional()
          .describe('Optional run label; a collision-resistant one is generated if omitted'),
      },
    },
    (args) => run(() => beginRun(args)),
  );

  server.registerTool(
    'get_run',
    {
      title: 'Get a run’s events',
      description:
        'Return only the events belonging to a labeled run (from begin_run), newest first — ' +
        'so overlapping/parallel repros don’t bleed into each other. Matches the run label ' +
        'exactly; an unknown or never-stamped label returns an empty run (no error).',
      inputSchema: {
        label: z.string().describe('The run label to scope to (from begin_run)'),
      },
    },
    (args) => run(() => getRun(client, args)),
  );

  return server;
}
