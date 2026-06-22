/**
 * MCP server wiring: declares the four read-only tools and binds each to its
 * handler in `tools.ts`. This module owns the MCP SDK surface (schemas, response
 * envelopes, error formatting) and nothing else — the actual sidecar logic lives
 * in the transport-agnostic handlers so it can be unit-tested without a transport.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SidecarClient, type SidecarClientOptions, SidecarUnavailableError } from './client.js';
import { getErrors, getTrace, listRecentTraces, searchLogs } from './tools.js';

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
    version: '0.1.0',
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

  return server;
}
