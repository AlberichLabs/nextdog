# `@nextdog/express` + `@nextdog/browser` — Design Spec

**Date:** 2026-04-03
**Status:** Approved

---

## Goal

Add two new independent packages to the NextDog monorepo:

- **`@nextdog/express`** — Express middleware for server-side OTel tracing, console capture, and request replay. Pure server, no browser concerns.
- **`@nextdog/browser`** — Browser-side SDK for fetch/XHR tracing, page navigation spans, and console log capture. Works with any backend or standalone.

Together they enable a full E2E observability story: browser spans and server spans share a `traceId` via W3C `traceparent` header propagation, unified in a single dashboard feed.

---

## Architecture

```
Browser (@nextdog/browser)         Express (@nextdog/express)
┌──────────────────────┐           ┌────────────────────────┐
│ fetch/XHR spans      │           │ request spans          │
│ navigation spans     │           │ console patch          │
│ console patch        │           │ request capture        │
│ traceparent headers  │──────────▶│ (reads traceparent,    │
└──────────┬───────────┘           │  creates child spans)  │
           │                       └───────────┬────────────┘
           │ POST /v1/spans                     │ POST /v1/spans
           │ POST /v1/logs                      │ POST /v1/logs
           └───────────────────┬────────────────┘
                               ▼
                        Sidecar (:6789)
                    ┌──────────────────┐
                    │ unified feed:    │
                    │ browser + server │
                    │ spans + logs     │
                    └──────────────────┘
```

The sidecar is the **only coupling point** between the two packages. Neither requires the other — they are independently useful.

---

## Package: `@nextdog/express`

### User-facing API

```js
// app.js (CommonJS or ESM)
const { nextdog } = require('@nextdog/express');

const app = express();
app.use(nextdog({ serviceName: 'my-api' }));
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `serviceName` | `'nextdog-app'` | Service name shown in the dashboard |
| `url` | `'http://localhost:6789'` | Sidecar URL |

`NEXTDOG_URL` and `NEXTDOG_SERVICE_NAME` env vars are also respected as fallbacks.

### Behaviour

1. **One-time init** (on first request): calls `ensureSidecar(url)`, registers `NodeTracerProvider` with `BatchSpanProcessor` + `NextDogExporter`, calls `patchConsole(url, serviceName)` and `startRequestCapture()`. All from `@nextdog/node`.
2. **Per-request**: starts an OTel span. If the incoming request has a `traceparent` header, the OTel SDK automatically parents the new span to the browser span (W3C propagation is on by default).
3. **On `res.finish`**: sets `http.route` from `req.route?.path ?? req.path`, `http.status_code` from `res.statusCode`, sets span status to `ERROR` if `>= 500`, then ends the span.
4. **Production**: entire middleware is a no-op when `NODE_ENV !== 'development'`. `next()` is called immediately with no instrumentation, no sidecar spawn.

### Route name resolution

Express only populates `req.route` after the matched router processes the request. The span name is set at init time using `req.path`, then **updated on `res.finish`** to use `req.route?.path` if available. This gives accurate template-matched route names (e.g. `/users/:id` rather than `/users/42`) in the dashboard.

### Dependencies

- `@nextdog/node: workspace:*` — shared instrumentation (exporter, sidecar, console-patch, request-capture)
- `@opentelemetry/api: ^1`
- `@opentelemetry/sdk-trace-node: ^1`
- `@opentelemetry/resources: ^1`
- `@opentelemetry/semantic-conventions: ^1`

Peer dep: `express: ^4 || ^5`

### Package exports

```json
{
  ".": "./dist/index.js"
}
```

Single export — no sub-path exports needed.

---

## Package: `@nextdog/browser`

### User-facing API

**Manual init (universal — any bundler, any framework):**
```ts
// main.ts / index.tsx / App.vue entry
import { initNextDog } from '@nextdog/browser';
initNextDog({ serviceName: 'my-spa' });
```

**Vite plugin (zero app-code changes):**
```ts
// vite.config.ts
import { nextdog } from '@nextdog/browser/vite';
export default defineConfig({
  plugins: [nextdog({ serviceName: 'my-spa' })],
});
```

The Vite plugin injects the `initNextDog()` call into the app entry point at dev-serve time. It is a no-op during `vite build`.

**Framework helpers (optional, same package):**
```ts
// React
import { NextDogProvider } from '@nextdog/browser/react';
// <NextDogProvider serviceName="my-spa"> wraps app, calls initNextDog on mount

// Vue
import { nextdogPlugin } from '@nextdog/browser/vue';
app.use(nextdogPlugin({ serviceName: 'my-spa' }));
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `serviceName` | `'nextdog-app'` | Service name shown in the dashboard |
| `url` | `'http://localhost:6789'` | Sidecar URL |
| `propagateTraceContext` | `true` | Inject `traceparent` header on fetch/XHR |

### What gets instrumented

1. **`fetch`** — monkey-patched. Each call starts a client span, injects `traceparent` header, ends span on response. Span name: `<METHOD> <url.pathname>`.
2. **`XMLHttpRequest`** — patched via `open`/`send`. Same behaviour as fetch.
3. **Page navigation** — `history.pushState`, `history.replaceState`, `popstate` events, and the initial `DOMContentLoaded` each create a navigation span with `navigation.type` and `url.path` attributes.
4. **`console.log/warn/error`** — patched to also POST log entries to the sidecar. Entries include current `traceId`/`spanId` from the active OTel context (if any), `level`, `message`, `timestamp`, and `service.name`.

### Transport

- **Primary**: `fetch` with `keepalive: true` — survives page unloads, supports JSON bodies, works with CORS
- **Fallback**: `navigator.sendBeacon` with a `Blob('application/json')` — note this does trigger a CORS preflight, handled by the sidecar's `OPTIONS` response
- Batches spans in a 2-second buffer before flushing (same cadence as server-side `BatchSpanProcessor`)

### Sidecar CORS

The sidecar adds `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: content-type, traceparent, tracestate` to `POST /v1/spans` and `POST /v1/logs` responses. This is acceptable because the sidecar is a local dev-only tool and never runs in production.

### Production safety

`initNextDog()` checks `location.hostname`. If not `localhost` or `127.0.0.1`, it returns immediately and installs nothing. The Vite plugin only runs in `serve` mode. The browser bundle is never included in production builds.

### Package exports

```json
{
  ".": "./dist/index.js",
  "./vite": "./dist/vite.js",
  "./react": "./dist/react.js",
  "./vue": "./dist/vue.js"
}
```

---

## Sidecar changes (`@nextdog/core`)

1. **CORS headers** — add to `POST /v1/spans` and `POST /v1/logs`:
   ```
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Headers: content-type, traceparent, tracestate
   Access-Control-Allow-Methods: POST, OPTIONS
   ```
   Handle `OPTIONS` preflight requests with `200`.

2. **`source` field on events** — the browser SDK includes `source: 'browser'` in every span and log payload it POSTs. The sidecar stores it as-is. The dashboard can use this to show a browser icon or badge. This is additive — server events omit the field and the dashboard treats absence as `'server'`.

---

## Data flow: E2E trace example

```
1. User clicks "Submit" in SPA
   → browser creates root span S1 (traceId: abc123)
   → fetch POST /api/order fires
   → traceparent: 00-abc123-S1-01 added to request headers

2. Express middleware receives request
   → OTel SDK extracts traceparent, creates child span S2 (parent: S1)
   → handler runs, DB query fires (child span S3)
   → response 201, S2 ends

3. Browser fetch resolves
   → S1 ends with status 201

4. Sidecar receives:
   → S1 from browser SDK (POST /v1/spans)
   → S2, S3 from Express (POST /v1/spans)
   → All share traceId: abc123

5. Dashboard waterfall shows:
   [browser] POST /api/order        450ms
     [server] POST /api/order       380ms
       [server] db.query orders      210ms
```

---

## What's out of scope

- Webpack / Rollup / Parcel plugins — manual `initNextDog()` is the fallback for non-Vite bundlers
- Browser performance metrics (LCP, CLS, FID) — this is tracing, not RUM
- Source map integration — out of scope for now
- NestJS adapter — separate package, separate plan

---

## README updates

Add `@nextdog/express` to the packages table. Add `@nextdog/browser` to the packages table. Update the roadmap:
- Mark Express adapter as in-progress
- Add `@nextdog/browser` as a new entry
- Add a "Browser + Express E2E" section to the README showing the combined setup
