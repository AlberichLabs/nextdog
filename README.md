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

## What is NextDog?

NextDog gives you a **local observability** for your Next.js app during development. It captures OpenTelemetry spans and console logs, and serves a real-time dashboard on `localhost:6789`.

- **Spans** — see every request, its route, status code, and duration
- **Logs** — `console.log/warn/error` captured with trace correlation
- **Trace Waterfall** — click any request to see the full span hierarchy
- **Attribute Filtering** — Datadog-style search with `!` (NOT), `OR`, click-to-filter
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

## Dashboard

The dashboard has two main views:

### Spans
Requests grouped by trace, showing method, route, HTTP status code, and duration. Click any request to open the detail pane with a waterfall view and attribute table.

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

Click any attribute value in the detail pane to add it as a filter.

## How It Works

```
Next.js App                    NextDog Sidecar (:6789)
┌─────────────┐               ┌──────────────────────┐
│ OTel SDK    │──POST /v1/──→ │ EventBus             │
│ Console     │   spans/logs  │  ├─ RingBuffer (500)  │
│ Patch       │               │  ├─ FileStore (NDJSON) │
└─────────────┘               │  └─ SSE Stream        │
                              │                       │
                              │ Dashboard (Preact)    │
                              │  ← SSE live events    │
                              └──────────────────────┘
```

- **`@nextdog/next`** — Next.js plugin that sets up OTel tracing + console capture. Auto-spawns the sidecar if not running.
- **`@nextdog/nuxt`** — Nuxt.js plugin that sets up OTel tracing + console capture. Auto-spawns the sidecar if not running.
- **`@nextdog/core`** — Sidecar HTTP server with EventBus, RingBuffer, FileStore, and SSE streaming. Serves the dashboard.
- **`@nextdog/ui`** — Preact + Vite dashboard (~46KB JS, ~11KB CSS). Dark/light theme, keyboard shortcuts (j/k/Enter/Esc).

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

| Package | Description | Size |
|---------|-------------|------|
| [`@nextdog/next`](packages/next) | Next.js plugin + OTel instrumentation | [![npm](https://img.shields.io/npm/v/@nextdog/next.svg)](https://www.npmjs.com/package/@nextdog/next) |
| [`@nextdog/core`](packages/core) | Sidecar server + event pipeline | [![npm](https://img.shields.io/npm/v/@nextdog/core.svg)](https://www.npmjs.com/package/@nextdog/core) |
| [`@nextdog/ui`](packages/ui) | Dashboard (Preact + Vite) | [![npm](https://img.shields.io/npm/v/@nextdog/ui.svg)](https://www.npmjs.com/package/@nextdog/ui) |
| [`@nextdog/nuxt`](packages/nuxt) | Nuxt 3 module (**experimental**) | `0.0.1` |

## Compatibility

| Next.js Version | Status |
|----------------|--------|
| 16.x | Fully supported |
| 15.x | Fully supported |
| 14.x (14.0.4+) | Supported — `experimental.instrumentationHook` enabled automatically |

## Roadmap

**Fullstack frameworks** (highest value — server + client, routing, SSR):
- [x] **Nuxt adapter** (`@nextdog/nuxt`) — Vue ecosystem *(experimental)*
- [ ] **SvelteKit adapter** (`@nextdog/sveltekit`)
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
