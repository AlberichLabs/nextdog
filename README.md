<p align="center">
  <img src="https://raw.githubusercontent.com/cscherban/NextDog/main/packages/ui/src/components/logo-readme.svg" width="80" />
</p>

<h1 align="center">NextDog</h1>

<p align="center">
  Zero-config dev observability for Next.js. Woof Woof.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nextdog/next"><img src="https://img.shields.io/npm/v/@nextdog/next.svg?label=%40nextdog%2Fnext&color=2dd4bf" alt="@nextdog/next" /></a>
  <a href="https://www.npmjs.com/package/@nextdog/core"><img src="https://img.shields.io/npm/v/@nextdog/core.svg?label=%40nextdog%2Fcore&color=2dd4bf" alt="@nextdog/core" /></a>
  <a href="https://www.npmjs.com/package/@nextdog/ui"><img src="https://img.shields.io/npm/v/@nextdog/ui.svg?label=%40nextdog%2Fui&color=2dd4bf" alt="@nextdog/ui" /></a>
  <a href="https://github.com/cscherban/NextDog/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license" /></a>
</p>

---

> Found a bug or have feedback? [Open an issue](https://github.com/cscherban/NextDog/issues/new/choose).

## What is NextDog?

NextDog gives you **local observability** for your app during development. It captures OpenTelemetry spans and console logs, and serves a real-time dashboard on `localhost:6789`. Drop-in adapters ship for **Next.js**, **Nuxt**, and **SvelteKit**.

- **Spans** — see every request, its route, status code, and duration
- **Logs** — `console.debug/log/info/warn/error` captured with trace correlation
- **Database queries** — `pg` / `mysql2` calls auto-traced as child spans with the SQL statement (param **values** elided by default)
- **Outbound HTTP** — `fetch` / `http` calls auto-traced as child spans
- **Request & response bodies** — captured for the request detail pane (auth headers stripped)
- **Trace Waterfall** — click any request to see the full span hierarchy
- **Attribute Filtering** — Datadog-style search with `!` (NOT), `OR`, click-to-filter
- **Export / Import** — save a trace or the current view to a portable file and re-open it later
- **Zero config** — two lines of code

## Quick Start

```bash
npm install @nextdog/next
```

**next.config.js:**
```js
const { withNextDog } = require('@nextdog/next');

module.exports = withNextDog({
  // your existing Next.js config
});
```

**instrumentation.ts** (create at project root):
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@nextdog/next/register');
  }
}
```

**Start your dev server**, then open **[http://localhost:6789](http://localhost:6789)**.

### Browser console capture (optional)

The server adapter captures server-side spans and logs out of the box. To also
capture **browser** `console.*` calls and correlate them to the server trace that
rendered the page, inject the browser patch from `@nextdog/next/client`. It
exposes inert HTML helpers (no React component) so you can render the script and
trace-id meta tags into your root layout:

```tsx
import { getNextDogScript } from '@nextdog/next/client';

export default function RootLayout({ children }) {
  const script = getNextDogScript(); // null in production / when no trace is active
  return (
    <html>
      <body>
        {script && <script dangerouslySetInnerHTML={script} />}
        {children}
      </body>
    </html>
  );
}
```

`getNextDogScript()` returns `null` outside development, so this is inert in production. (Full client-side `fetch` spans are a planned follow-up; today this correlates browser logs to the active server trace.)

## Nuxt 3 (Experimental)

```bash
npm install @nextdog/nuxt
```

**nuxt.config.ts:**
```ts
export default defineNuxtConfig({
  modules: ['@nextdog/nuxt'],
  nextdog: {
    serviceName: 'my-nuxt-app', // optional
  },
});
```

## SvelteKit

```bash
npm install @nextdog/sveltekit
```

**src/hooks.server.ts:**
```ts
import { withNextDog } from '@nextdog/sveltekit';

export const handle = withNextDog({
  serviceName: 'my-sveltekit-app', // optional
});
```

If you already export a `handle`, compose them with SvelteKit's [`sequence`](https://kit.svelte.dev/docs/modules#sveltejs-kit-hooks-sequence) helper. The adapter auto-spawns the sidecar on the first request, captures server spans + `console.*` logs, and auto-instruments `fetch`/`http` and `pg`/`mysql2` like the other adapters.

A small Vite plugin is also available if you prefer to set the service name / URL at config time instead of in the hook:

```ts
// vite.config.ts
import { nextdog } from '@nextdog/sveltekit/vite';

export default {
  plugins: [nextdog({ serviceName: 'my-sveltekit-app' })],
};
```

## Dashboard

The dashboard has two main views:

### Spans
Requests grouped by trace, showing method, route, HTTP status code, and duration. Click any request to open the detail pane with a waterfall view, an attribute table, captured request/response headers and bodies, child DB and outbound-HTTP spans, and **Copy as cURL** / **Replay** affordances.

### Logs
Real-time log stream with live tail toggle. Logs are automatically correlated to request traces via OpenTelemetry context propagation. Click any log to see its attributes and jump to the associated trace.

### Filtering
Datadog-style search bar with filter pills:

```
level:error                    # filter by log level
service:my-app                 # filter by service
status:ERROR                   # filter by span status
statusCode:500                 # filter by HTTP status code
!service:noisy                 # exclude a service
level:warn OR level:error      # OR expressions
route:/api/users               # filter by route
```

Click any attribute value in the detail pane to add it as a filter. Frequently-used queries can be kept as **saved searches**.

### Export / Import
Export a single trace or the current filtered view to a self-contained file (newline-delimited JSON, no server required to read it). Drag a file back onto the dashboard — or use **Open trace file** — to view it offline; a badge indicates you're viewing an imported trace, with one click back to live.

### Themes & keyboard
The dashboard ships dark and light themes (toggle in the header) and is keyboard-navigable:

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous row |
| `Enter` | Open trace / select |
| `Esc` | Close / go back |
| `?` | Toggle shortcut help |

## What NextDog captures & where it goes

NextDog is a development-time APM, and like any APM it captures a lot. Here is exactly what it records, where that data lives, and what (if anything) leaves your machine.

**Captures.** For each request: a span with method, route, status code, and duration; correlated `console.*` logs; the **request body** and **response body** (text/JSON only, capped at 16 KB / 50 KB; binary and compressed bodies are summarized, not stored); request/response headers; and child spans for outbound `fetch`/`http` calls and `pg`/`mysql2` database queries. Database spans include the **full SQL statement text**; bound **parameter values are elided by default** (only the parameter count is recorded). Credential-bearing headers (`authorization`, `proxy-authorization`, `x-api-key`, `x-auth-token`, `set-cookie`) are stripped before anything is stored.

**Storage.** Telemetry is written to `~/.nextdog/data` as hourly NDJSON files, retained ~24 hours, then deleted. It stays **local to your machine** — there is no NextDog account, server, or cloud. NextDog is **dev-only and inert unless `NODE_ENV=development`**: in any other environment the adapter returns your config unchanged and registers nothing.

**Egress.** By default **nothing leaves your machine** — telemetry flows from your dev server to the local sidecar on `localhost:6789` and the dashboard reads it back, all on `localhost`.

The one exception is opt-in: the optional **[`@nextdog/mcp`](packages/mcp)** server. If *you* connect it to an AI coding agent (Claude Code, Cursor, Claude Desktop), that agent can query your live telemetry — including request/response bodies and SQL statements — so it can reason over real spans and logs while you debug instead of pasting them by hand. That's the same bargain as pointing any APM at your data: it's exposed because you deliberately wired it up. No redaction is applied at the MCP layer; whatever the dashboard shows is what the agent can read. See the [`@nextdog/mcp` README](packages/mcp) for the tool set and setup.

## How It Works

```
Your App                       NextDog Sidecar (:6789)
┌─────────────┐               ┌──────────────────────┐
│ OTel SDK    │──POST /v1/──→ │ EventBus             │
│ Console     │   spans/logs  │  ├─ RingBuffer (500)  │
│ fetch / DB  │               │  ├─ FileStore (NDJSON) │
│ Body capture│               │  └─ SSE Stream        │
└─────────────┘               │                       │
                              │ Dashboard (Preact)    │
                              │  ← SSE live events    │
                              └──────────────────────┘
```

- **`@nextdog/next`** — Next.js plugin: OTel tracing, console capture, request/response body capture, and a browser-console patch. Auto-spawns the sidecar if not running.
- **`@nextdog/nuxt`** — Nuxt 3 module with the same instrumentation. *(experimental)*
- **`@nextdog/sveltekit`** — SvelteKit `handle` hook (+ optional Vite plugin) with the same instrumentation.
- **`@nextdog/node`** — shared Node.js instrumentation used by every adapter: the OTel→sidecar exporter, sidecar bootstrap, console patch, and zero-dependency auto-instrumentation of outbound `fetch`/`http` and `pg`/`mysql2`.
- **`@nextdog/core`** — sidecar HTTP server with EventBus, RingBuffer, FileStore, and SSE streaming. Serves the dashboard.
- **`@nextdog/ui`** — Preact + Vite dashboard. Dark/light theme, keyboard shortcuts (`j`/`k`/`Enter`/`Esc`/`?`), trace export/import.
- **`@nextdog/mcp`** — read-only MCP server exposing your live telemetry to an AI coding agent (see below; not published to npm).

For a deeper dive into the pipeline, the instrumentation path, and production behavior, see [`docs/architecture.md`](docs/architecture.md). For where the project is headed, see [`docs/roadmap.md`](docs/roadmap.md).

## MCP server (AI agent access)

[`@nextdog/mcp`](packages/mcp) is a read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI coding agent query your **live local NextDog telemetry** — recent traces, full span trees, correlated logs, and error spans — instead of you copy-pasting them into chat. It reads from the running sidecar over HTTP and never mutates state.

> **Not yet published to npm.** Run it from a clone of this repo: `pnpm install && pnpm build`, then point your MCP client at `node packages/mcp/dist/cli.js` (or the `nextdog-mcp` bin once installed). See the [`@nextdog/mcp` README](packages/mcp) for the four tools it exposes, the search grammar, and client configuration.

## Configuration

### `withNextDog(config, options?)`

| Option | Default | Description |
|--------|---------|-------------|
| `serviceName` | `'nextdog-app'` | Service name shown in the dashboard |
| `url` | `'http://localhost:6789'` | Sidecar URL |

```js
module.exports = withNextDog(nextConfig, {
  serviceName: 'my-api',
  url: 'http://localhost:9999',
});
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXTDOG_URL` | `http://localhost:6789` | Sidecar bind address |
| `NEXTDOG_DATA_DIR` | `~/.nextdog/data` | NDJSON storage directory |
| `NEXTDOG_UI_DIR` | auto-resolved | Path to UI dist (overrides built-in) |

### Production Safety

NextDog is **completely inert in production**:
- `withNextDog()` returns your config unchanged when `NODE_ENV !== 'development'`
- `register.ts` exits immediately when not in development
- No runtime overhead, no network calls, no bundled code

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@nextdog/next`](packages/next) | Next.js plugin + OTel instrumentation | [![npm](https://img.shields.io/npm/v/@nextdog/next.svg)](https://www.npmjs.com/package/@nextdog/next) |
| [`@nextdog/nuxt`](packages/nuxt) | Nuxt 3 module (**experimental**) | [![npm](https://img.shields.io/npm/v/@nextdog/nuxt.svg)](https://www.npmjs.com/package/@nextdog/nuxt) |
| [`@nextdog/sveltekit`](packages/sveltekit) | SvelteKit `handle` hook + Vite plugin | [![npm](https://img.shields.io/npm/v/@nextdog/sveltekit.svg)](https://www.npmjs.com/package/@nextdog/sveltekit) |
| [`@nextdog/node`](packages/node) | Shared Node.js instrumentation (exporter, console, fetch/DB) | [![npm](https://img.shields.io/npm/v/@nextdog/node.svg)](https://www.npmjs.com/package/@nextdog/node) |
| [`@nextdog/core`](packages/core) | Sidecar server + event pipeline | [![npm](https://img.shields.io/npm/v/@nextdog/core.svg)](https://www.npmjs.com/package/@nextdog/core) |
| [`@nextdog/ui`](packages/ui) | Dashboard (Preact + Vite) | [![npm](https://img.shields.io/npm/v/@nextdog/ui.svg)](https://www.npmjs.com/package/@nextdog/ui) |
| [`@nextdog/mcp`](packages/mcp) | Read-only MCP server for AI agents | not published |

## Compatibility

| Next.js Version | Status |
|----------------|--------|
| 16.x | Fully supported |
| 15.x | Fully supported |
| 14.x (14.0.4+) | Supported — `experimental.instrumentationHook` enabled automatically |

## Roadmap

**Fullstack frameworks** (highest value — server + client, routing, SSR):
- [x] **Next.js adapter** (`@nextdog/next`)
- [x] **Nuxt adapter** (`@nextdog/nuxt`) — Vue ecosystem *(experimental)*
- [x] **SvelteKit adapter** (`@nextdog/sveltekit`)
- [ ] **Remix / React Router v7 adapter** (`@nextdog/remix`)

**Generic / infrastructure:**
- [ ] **Docker sidecar image** — `docker pull nextdog/sidecar` for containerized setups and non-Node apps
- [ ] **OTLP protocol support** — accept standard OpenTelemetry HTTP exports (`POST /v1/traces`) so any OTel-instrumented app (Python, Go, Ruby) can send to NextDog

**Server frameworks** (lower priority — less to observe):
- [ ] **Express adapter** (`@nextdog/express`) — middleware-based
- [ ] **Hono / Fastify adapters**

## Development

```bash
git clone https://github.com/cscherban/NextDog.git
cd NextDog
pnpm install
pnpm build
pnpm test
```

Start the sidecar locally:
```bash
node packages/core/dist/cli.js
```

UI dev mode (hot reload):
```bash
cd packages/ui && pnpm dev
```

## License

MIT
