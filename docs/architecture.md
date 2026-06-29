# NextDog Architecture

This document describes how NextDog is built and how data flows from a running
dev server to the dashboard. For installation and usage, see the
[README](../README.md).

## What NextDog is

NextDog is zero-config local observability for full-stack JavaScript dev servers.
While your app runs in development, NextDog captures OpenTelemetry spans and
console logs from the server process and serves a real-time dashboard at
`http://localhost:6789`. There is no agent to install, no account, no
infrastructure, and no cost.

NextDog is **inert in production** — the instrumentation hooks short-circuit when
`NODE_ENV !== 'development'`, so nothing runs, no spans are emitted, and no
network calls are made in a production build (see [Production behavior](#production-behavior)).

## Package layout

NextDog is a pnpm + Turborepo monorepo of small, single-purpose npm packages.

| Package | Role | Published |
|---|---|---|
| [`@nextdog/core`](../packages/core) | The sidecar HTTP server and ingest pipeline (EventBus, RingBuffer, FileStore, SSE). Ships the `nextdog` CLI binary. | yes |
| [`@nextdog/node`](../packages/node) | Shared Node.js instrumentation reused by every adapter: OTel span exporter, sidecar spawn/health, console capture, request capture, request context. | yes |
| [`@nextdog/next`](../packages/next) | Next.js adapter — `withNextDog()` config wrapper plus the `instrumentation.ts` register hook. | yes |
| [`@nextdog/nuxt`](../packages/nuxt) | Nuxt 3 module (Nitro server plugin). **Experimental.** | yes |
| [`@nextdog/sveltekit`](../packages/sveltekit) | SvelteKit adapter — `handle` hook + Vite plugin. **Implemented but not yet published.** | no |
| [`@nextdog/ui`](../packages/ui) | The dashboard (Preact + Vite), compiled to a static bundle and served by the core sidecar. | yes |

Dependency direction: the framework adapters (`next`, `nuxt`, `sveltekit`)
depend on `@nextdog/node` for the shared instrumentation and on `@nextdog/core`
for the sidecar. `@nextdog/core` depends on `@nextdog/ui` to serve the dashboard.
No adapter depends on another adapter's internals.

## The pipeline

A running app sends telemetry to a single shared **sidecar** process. The
sidecar receives spans and logs, fans them out to in-memory and on-disk sinks,
and streams them live to any connected dashboard.

```
  App dev server (@nextdog/node)            Sidecar :6789 (@nextdog/core)
  ┌───────────────────────────┐            ┌───────────────────────────────┐
  │ OTel SpanExporter ─────────┼─POST /v1/spans─▶                            │
  │ Console patch ─────────────┼─POST /v1/logs──▶  EventBus (typed emitter)  │
  │ Request capture / context  │            │        │                       │
  └───────────────────────────┘            │        ├─▶ RingBuffer (500)     │
                                            │        ├─▶ FileStore (NDJSON)   │
  Browser dashboard (@nextdog/ui)           │        └─▶ SSE stream           │
  ┌───────────────────────────┐            │                                 │
  │  ◀── GET /sse (live tail) ─┼────────────┤  Static dashboard served at /   │
  │  ◀── GET /api/spans ───────┼────────────┤                                 │
  └───────────────────────────┘            └───────────────────────────────┘
```

### Sidecar HTTP server (`@nextdog/core`)

A single process built on Node's raw `http` module — no server framework, no
runtime dependencies. It binds to port **6789** by default (configurable via
`NEXTDOG_URL`). Routes:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/spans` | Ingest OTel-format spans from an app |
| `POST` | `/v1/logs` | Ingest captured console log entries |
| `GET` | `/api/spans` | Query spans (`?service=`, `?traceId=`, `?spanId=`, `?last=N`) |
| `GET` | `/api/services` | List discovered service names |
| `POST` | `/api/replay` | Reconstruct and replay a captured request |
| `GET` | `/sse` | Live-tail stream (Server-Sent Events) |
| `GET` | `/health` | Liveness / uptime check |
| `GET` | `/*` | Static dashboard bundle, with SPA fallback to `index.html` |

The first app to boot spawns the sidecar as a **detached background process**;
subsequent apps detect the running sidecar and send to it. All apps share one
sidecar, and each span carries a `service.name` so the dashboard can group and
filter by service.

### EventBus

A thin typed wrapper over Node's `EventEmitter`. Ingested spans and logs are
published as events; the RingBuffer, FileStore, and SSE stream each subscribe
independently. Components share no mutable state, so each is testable in
isolation.

### RingBuffer

A fixed-size circular buffer of the most recent **500** events. It serves two
roles: a read cache (new SSE clients get a backfill of recent events before live
tailing) and a write buffer (events are batched before being flushed to the
FileStore roughly every 2 seconds).

### FileStore (NDJSON)

Persists events to `~/.nextdog/data/` (configurable via `NEXTDOG_DATA_DIR`) as
newline-delimited JSON, one file per hour (e.g. `2026-06-20-14.ndjson`). A
background sweep deletes files older than 24 hours. This is what makes history
survive a sidecar or dashboard restart.

### SSE stream

Manages connected dashboard clients. On connect, a client receives a backfill of
recent events from the RingBuffer, then live events as they arrive. Each message
is JSON tagged with a `type` (`span` | `log`) for client-side filtering. There is
no server-side filtering — the dashboard filters locally.

## Instrumentation path (`@nextdog/node`)

The shared Node instrumentation is what each framework adapter wires up. It has
five parts:

- **Exporter** — a custom OTel `SpanExporter` that batches spans and POSTs them
  to the sidecar's `/v1/spans`. It enriches server spans with captured request
  metadata (method, route, headers, status) and drops NextDog's own internal
  spans.
- **Sidecar spawn / health** — `ensureSidecar()` checks whether a healthy sidecar
  is already running (via a PID file and a `/health` probe) and, if not, spawns
  one as a detached child process, logging to `~/.nextdog/sidecar.log`.
- **Console capture** — patches `console.log/warn/error/debug/info`, captures each
  call as a structured log entry correlated to the active trace, and batches them
  to `/v1/logs`.
- **Request capture** — captures request metadata (and a bounded slice of the
  body) so a request can later be inspected and replayed, without consuming the
  request stream in a way that would break streaming responses.
- **Request context** — an `AsyncLocalStorage`-based context that carries
  request identity across async boundaries, used to correlate logs to the request
  that emitted them even when OTel context propagation is unavailable.

### How the adapters wire it up

- **`@nextdog/next`** — `withNextDog(config)` wraps your `next.config.js`,
  injecting the sidecar URL and service name (and enabling the instrumentation
  hook on Next.js 14). Your `instrumentation.ts` imports `@nextdog/next/register`,
  which registers the OTel provider + exporter, spawns the sidecar, and installs
  console/request capture.
- **`@nextdog/nuxt`** — a Nuxt module (`defineNuxtModule`) that registers a Nitro
  server plugin doing the same setup. Active only when `nuxt.options.dev` is true.
- **`@nextdog/sveltekit`** — a `handle` hook (`withNextDog()`) plus a Vite plugin.
  The hook lazily initializes instrumentation on the first request and wraps each
  request in an active span.

## Production behavior

NextDog is designed to vanish in production:

- `withNextDog()` (Next.js) returns your config unchanged when
  `NODE_ENV !== 'development'`.
- The Next.js `register` hook exits immediately unless `NODE_ENV === 'development'`
  (and skips the Edge runtime).
- The Nuxt module no-ops unless `nuxt.options.dev` is true.
- The SvelteKit hook and Vite plugin short-circuit in production mode.

The result is no runtime overhead, no network calls, and no telemetry emitted
from a production build.

## The dashboard (`@nextdog/ui`)

A Preact + Vite app compiled to a static bundle and served directly by the
sidecar. It connects to `/sse` for the live tail and uses `/api/*` for queries.
Main views:

- **Spans / Requests** — requests grouped by trace, with method, route, HTTP
  status, and duration. Opening a request reveals a detail pane with a span
  **waterfall** and an attribute table; requests can be replayed or copied as
  curl.
- **Logs** — a real-time log stream with a live-tail toggle, correlated to the
  request trace that emitted each line.
- **Filter bar** — Datadog-style search with filter pills (`level:error`,
  `service:my-app`, `statusCode:500`, `!service:noisy`, click-to-filter from the
  detail pane). See [Known limitations](#known-limitations).

It also includes keyboard navigation (`j`/`k`/`Enter`/`Esc`), a dark/light theme
toggle, and an empty state.

## Supported frameworks

| Framework | Package | Status |
|---|---|---|
| Next.js 16.x | `@nextdog/next` | Fully supported |
| Next.js 15.x | `@nextdog/next` | Fully supported |
| Next.js 14.x (14.0.4+) | `@nextdog/next` | Supported (instrumentation hook enabled automatically) |
| Nuxt 3 (3.8+) | `@nextdog/nuxt` | **Experimental** (`0.0.1`) |
| SvelteKit 2 | `@nextdog/sveltekit` | **Implemented, not yet published** |

## What works today vs. what's in progress

**Works today (published, on Next.js):**

- Full span + console-log capture with trace correlation
- The sidecar pipeline (EventBus, RingBuffer, NDJSON FileStore, SSE)
- The dashboard: spans/requests, logs, trace waterfall, detail pane, filter bar,
  request replay, keyboard nav, theming
- Multi-service support through one shared sidecar
- 24-hour on-disk history

**Experimental:**

- `@nextdog/nuxt` (Nuxt 3) — implemented and published at `0.0.1`, but less
  battle-tested than the Next.js adapter.

**Implemented but unreleased:**

- `@nextdog/sveltekit` — the code exists in the repo and works, but the package is
  not yet in the npm publish workflow (`.github/workflows/publish.yml`).

## Known limitations

These are tracked as open issues and inform the [roadmap](./roadmap.md):

- The dashboard reloads from the RingBuffer's recent window on open; browsing the
  full on-disk history is not wired up yet ([#8](https://github.com/AlberichLabs/nextdog/issues/8)).
- The service registry isn't rebuilt from the FileStore after a sidecar restart
  ([#16](https://github.com/AlberichLabs/nextdog/issues/16)).
- Outbound `fetch`/HTTP and DB query spans don't yet appear in the waterfall
  ([#4](https://github.com/AlberichLabs/nextdog/issues/4), [#5](https://github.com/AlberichLabs/nextdog/issues/5)).
- The filter bar commits AND-only via pills; OR composition is dropped
  ([#21](https://github.com/AlberichLabs/nextdog/issues/21)).
