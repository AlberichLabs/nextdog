# @nextdog/mcp

A **read-only [MCP](https://modelcontextprotocol.io) server** that lets an AI coding
agent — Claude Code, Cursor, Claude Desktop — query your **live local NextDog
telemetry** while you debug. Instead of copy-pasting logs and stack traces into the
chat, the agent reads the actual span tree and correlated error logs straight from
the running NextDog sidecar.

> *"Why did `POST /api/checkout` just 500?"* → the agent calls `get_errors`, then
> `get_trace`, and reasons over the real spans + logs.

It is a tiny local **stdio** process. No network egress, no account, no recurring
cost. Read-only: it never mutates sidecar state.

## Tools

| Tool | What it does |
| --- | --- |
| `list_recent_traces` | Recent request traces, newest first. Optional `route` (substring), `status` (`ERROR`/`OK` or an HTTP code like `500`), `service`, `withinMinutes`, `errorsOnly`, `limit`. |
| `get_trace` | Full span tree for one `traceId` + the console logs correlated to it, in time order. |
| `search_logs` | Search telemetry with the **same Datadog-style grammar the dashboard search bar uses** — `level:error`, `service:web`, `status:ERROR`, `route:/api`, `!` / `-` negation, `OR` groups, free text. Logs only by default; set `includeSpans: true` to also match spans. |
| `get_errors` | Recent error spans (status `ERROR` or HTTP ≥ 500) with captured stack traces. Optional `service`, `withinMinutes`, `limit`. |

### Filter grammar (`search_logs`)

The grammar is ported verbatim from the dashboard, so a query returns the same
results you'd see typing it into the NextDog search bar:

- **Facets:** `level:`, `service:`, `route:`, `status:`, `statusCode:`, `name:`,
  `message:`, `kind:`, `type:`, `trace:`/`traceId:`, `span:`/`spanId:`, `runtime:`,
  plus any span attribute key. Exact match for `level`/`service`/`status`/`kind`;
  substring for `route`/`name`/`message`/attributes.
- **Free text:** a bare term matches across name, message, service, level, status,
  and attribute values.
- **Negation:** `!level:debug` or `-service:web`.
- **OR groups:** `level:error OR level:warn`. Tokens are AND-ed; `OR`-joined tokens
  form one group (groups AND'd, tokens within a group OR'd).

Example: `level:error OR status:ERROR !route:/health`

## Requirements / data source

This server reads **live** from the NextDog sidecar's HTTP API (default
`http://localhost:6789`). **The sidecar must be running** — it normally starts
automatically inside your dev server via the framework adapter
(`@nextdog/next` / `@nextdog/nuxt` / `@nextdog/sveltekit`). If the sidecar is not
reachable, every tool returns a clear error telling you to start your dev server
(it does not crash the agent).

Set `NEXTDOG_URL` to point at a non-default address.

> **Reading history after the dev server stops** — NextDog also persists telemetry
> as NDJSON at `~/.nextdog/data` (24h retention). A FileStore-direct fallback that
> reads that file when the sidecar is down is a planned follow-up; today this server
> uses the HTTP path only.

## Install & register

Install in your project (or use `npx`):

```bash
pnpm add -D @nextdog/mcp
```

### Claude Code / Cursor — `.mcp.json`

Add a `.mcp.json` at your project root (Claude Code and Cursor both read this):

```json
{
  "mcpServers": {
    "nextdog": {
      "command": "npx",
      "args": ["-y", "@nextdog/mcp"],
      "env": {
        "NEXTDOG_URL": "http://localhost:6789"
      }
    }
  }
}
```

If you installed it as a dev dependency, you can point at the local bin instead:

```json
{
  "mcpServers": {
    "nextdog": {
      "command": "nextdog-mcp"
    }
  }
}
```

### Claude Desktop

Add the same server block to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nextdog": {
      "command": "npx",
      "args": ["-y", "@nextdog/mcp"]
    }
  }
}
```

Restart the client; the four NextDog tools then appear to the agent.

## Privacy

These tools surface **whatever the sidecar already returns**, which may include
captured request/response bodies and query params held in span attributes.

**Credential headers are redacted by default.** The MCP server is an egress
surface, so every event it returns is routed through a shared redactor that strips
credential-bearing headers (`authorization`, `proxy-authorization`, `x-api-key`,
`x-auth-token`, `cookie`, `set-cookie`). NextDog stores those headers locally so
one-click **Replay** can re-authenticate, but they never reach the agent. Other
captured content — bodies, SQL, non-credential headers, query params — is surfaced
as-is: if it contains secrets, that exposure exists in the dashboard today and
reaches the agent here the same way.

## Programmatic use

The tool handlers are exported and transport-agnostic, so you can drive them
directly (e.g. from a test or a custom integration) without an MCP transport:

```ts
import { SidecarClient, getTrace, searchLogs } from '@nextdog/mcp';

const client = new SidecarClient({ baseUrl: 'http://localhost:6789' });
const { results } = await searchLogs(client, { filter: 'level:error' });
const trace = await getTrace(client, { traceId: results[0]?.data.traceId! });
```

## License

MIT
