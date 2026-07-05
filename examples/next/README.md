# example-next

A tiny, runnable Next.js app that demonstrates **NextDog** through the *real*
instrumentation — the same `@nextdog/next` package you'd `npm install`, wired via
the exact two-line quick-start. It's the subject of the demo GIF and a durable
reference for "what does NextDog actually show me?".

Nothing to configure, no database, no external services: **clone and run.**

## Run it

From the repo root (builds the workspace packages, then starts the app):

```bash
pnpm install
pnpm build
pnpm --filter example-next dev
```

Then, in a second terminal, drive the routes in a GIF-friendly order:

```bash
pnpm --filter example-next demo-traffic
```

- App: <http://localhost:3000>
- **NextDog dashboard: <http://localhost:6789>** (the sidecar auto-spawns on the
  first request)

`demo-traffic` targets `http://localhost:3000` by default; override with
`BASE_URL=http://localhost:3001 pnpm --filter example-next demo-traffic`.

## How it's wired (the whole integration)

1. **`next.config.mjs`** — `export default withNextDog(nextConfig, { serviceName: 'example-next' })`
2. **`instrumentation.ts`** — `await import('@nextdog/next/register')` on the Node runtime
3. *(optional)* **`app/layout.tsx`** — injects `getNextDogScript()` so browser
   `console.*` logs are captured and correlated to the server trace

That's it. Everything below is captured automatically — no per-route code.

## Routes and what each demonstrates

| Route | Demonstrates |
|-------|--------------|
| `GET /api/tasks` | a calm, normal request |
| `POST /api/tasks` | **request + response body capture** (the money frame — shown side-by-side in the request detail pane) |
| `GET /api/tasks/:id` | a **404** with a response body (unknown id) |
| `GET /api/secure` | **Bearer auth** — 401 without a token; the 200 is **Replay**-able with the token |
| `GET /api/slow` | a **~1.5s** request, visible in the waterfall |
| `GET /api/outbound` | an **outbound `fetch`** → auto-instrumented **child span** |
| `GET /api/boom` | a **500** + a `console.error` carrying an **Error object** (Logs view) |
| `GET /api/db` | an **optional** SQL `db.statement` span — see below |

## The SQL route is optional (and why)

NextDog auto-instruments the `pg` / `mysql2` drivers, emitting a child span with
the SQL `db.statement` (bound parameter *values* elided). But a real DB span needs
a real database, which can't be zero-setup — so **`/api/db` is disabled by
default** and the rest of the app runs with no database at all. Outbound `fetch`
(`/api/outbound`) already gives you child spans in the waterfall.

To see a genuine `db.statement` span, point it at any Postgres you already have:

```bash
cd examples/next
pnpm add pg
DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm dev
# then hit http://localhost:3000/api/db
```

## Production safety

NextDog is inert unless `NODE_ENV === 'development'`: `withNextDog()` returns your
config unchanged, `register` exits immediately, and nothing is bundled or sent.
