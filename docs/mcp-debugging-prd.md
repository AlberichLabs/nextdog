# PRD — MCP debugging/dev enhancements

Status: proposed · Roadmap item under [#23](https://github.com/AlberichLabs/nextdog/issues/23)
(MCP server + Claude skill). Dogfooding target: **codetest.dev**.

## Problem

The NextDog MCP server is excellent at answering *"what happened?"* against local
telemetry, but it can't close a debug loop. To reproduce a bug an agent has to
trigger the request out-of-band (curl, a browser, a test), then race
`list_recent_traces` / `search_logs` snapshots hoping the new events have landed,
then hand-map captured stack *strings* to source, then eyeball whether the fix
worked. That is a viewer, not a debugging tool.

## Goal

Turn the MCP from **observe-only** into a full agent loop:
**drive → observe → correlate-to-code → verify** — without the agent ever leaving
the MCP. Do it by *exposing capabilities the sidecar already has* (Replay, the
event cursor, facet aggregation) as tools, not by building new subsystems.

## Current state (the 4 read-only tools)

All four live in [`packages/mcp/src/tools.ts`](../packages/mcp/src/tools.ts) and are
wired in [`server.ts`](../packages/mcp/src/server.ts). Every one reads the sidecar's
HTTP API through a single `loadEvents` chokepoint that routes events through the
egress redactor before they leave the machine ([`redact.ts`](../packages/mcp/src/redact.ts), #60).

| Tool | Does | Notes |
| --- | --- | --- |
| `list_recent_traces` | Root-span summaries, newest first | route/status/service/`withinMinutes`/`errorsOnly` filters |
| `get_trace` | Full span tree + correlated logs for one `traceId` | reconstructed from `/api/events` |
| `search_logs` | Datadog-style filter grammar (`level:error service:web OR status:ERROR !route:/health`) | same grammar as the dashboard search bar |
| `get_errors` | Recent error spans (status `ERROR` or HTTP ≥ 500) with captured stack **strings** | `service`/`withinMinutes` filters |

Time-windowable via `withinMinutes` → the sidecar's `since` (epoch-ms) query param.
The sidecar captures request/response bodies, `db.statement`, cookies/credential
headers (verbatim, for Replay), and stacks. Credentials are stored but never
egress: `redactEvents` strips them at the MCP boundary (#60). **Read-only** —
nothing in `tools.ts` mutates sidecar state.

## Thesis: the four missing verbs

The agent loop needs four verbs the read-only tools don't provide:

1. **Drive** — trigger a repro from inside the MCP (today: out-of-band).
2. **Observe deterministically** — wait for the resulting events instead of racing snapshots.
3. **Correlate to code** — jump from telemetry to `file:line`, not a stack string.
4. **Verify** — assert the expected span/log happened (or stopped happening), not eyeball it.

The sidecar already implements the hard parts of #1–#3. This PRD mostly *exposes*
them.

## Enhancements

### v1 — the loop (highest leverage)

#### 1. `replay_request` — drive
**What:** Replay a captured request by `spanId`, with optional overrides (method,
url, headers, body). Returns the live response (status, headers, body, duration).
**Why:** Lets the agent reproduce a failure from inside the MCP instead of asking
the caller to re-issue the request. This is the missing "drive" verb.
**Approach:** Wrap the sidecar's existing `POST /api/replay`
([`core/src/server.ts`](../packages/core/src/server.ts)) — the same endpoint the
dashboard's Replay button already uses. It has three modes we map directly:
`{ spanId }` (one-click), `{ spanId, prepareOnly: true }` (reconstruct-only, for a
`prepare` sub-mode / dry run), and `{ request: {...} }` (edited replay). The
don't-store-tokens posture is preserved server-side; the MCP client just needs a
`POST` helper (today `SidecarClient` is GET-only).

#### 2. `wait_for_event` / `events_since` — observe deterministically
**What:** `events_since(cursor)` returns events newer than a cursor plus the next
cursor; `wait_for_event(predicate, timeoutMs)` blocks until a matching event
appears (or times out). Predicate = the same filter grammar as `search_logs`.
**Why:** Kills the drive-then-race problem. After `replay_request`, the agent waits
for *its* resulting span/log deterministically instead of polling snapshots and
hoping.
**Approach:** Cursor = an event timestamp; back it with `/api/events?since=<ms>`,
which already filters to events strictly newer than an epoch-ms cursor
([`core/src/server.ts`](../packages/core/src/server.ts), `client.ts`). `wait_for_event`
is a bounded `since`-poll loop in the MCP over that param — no sidecar change for a
first cut. (Stretch: add a resume-cursor to the existing `/sse` stream, which today
backfills the last 200 from the `RingBuffer` with no cursor —
[`sse-stream.ts`](../packages/core/src/sse-stream.ts) — so the tool can stream
rather than poll. Not required for v1.)

#### 3. `aggregate` / `assert` — verify
**What:** `aggregate({ groupBy, filter })` → counts (e.g. errors by route);
`assert({ filter, expect: { count / min / max / exists } })` → pass/fail plus the
matching sample. Filter = `search_logs` grammar.
**Why:** Turns the MCP into a *verification* tool. Triage ("which route throws
most?") and a fix-check primitive ("a span with `status:ERROR route:/checkout`
occurred 0 times in the last minute") the agent can branch on.
**Approach:** Pure reduction over `loadEvents` results in the MCP — reuse the
existing `matchesQuery` matcher ([`matcher.ts`](../packages/mcp/src/matcher.ts)) for
the filter and group by any span/log field. No sidecar change; inherits redaction
via `loadEvents`.

### v2 — depth (next)

#### 4. Source-mapped stack frames — correlate to code
**What:** Replace the raw stack *string* on `get_errors` with structured frames
(`{ file, line, column, function }`), and add "source location that emitted this
log/span" where available.
**Why:** Closes telemetry→code. The agent opens the offending file at the line
instead of parsing a string and guessing.
**Approach:** Parse the captured `exception.stacktrace` (already surfaced by
`get_errors` via `stackTrace()` in [`tools.ts`](../packages/mcp/src/tools.ts)) into
frames and apply source maps for the dev build. Additive field on the existing
error shape.

#### 5. Facet / schema introspection — discover the query surface
**What:** A `describe_telemetry` tool listing available services, routes, and
attribute keys with their observed values/counts, so the agent discovers what it
can filter on before querying.
**Why:** Removes guesswork about valid `service:` / `route:` / attribute tokens.
**Approach:** Reuse the facet aggregation the dashboard already computes —
`deriveFacets` in [`ui/src/utils/facets.ts`](../packages/ui/src/utils/facets.ts)
(named facets + bounded common attributes, high-cardinality/sensitive keys already
denied). Run the same reduction in the MCP over `/api/events`, plus the existing
`/api/services` list. Lift the pure logic into a shared module if we don't want to
duplicate it.

#### 6. Labeled capture window / run scoping — clean, parallel-safe repros
**What:** `begin_run(label)` → `replay_request`/drive → `get_run(label)` returns
only that run's events. A correlation label scopes one repro.
**Why:** Clean repros and safe for multiple agents driving the same app at once —
each fetches just its own run instead of a shared firehose.
**Approach:** Stamp a correlation attribute on driven requests (via
`replay_request` overrides / a header the adapter propagates) and filter events by
it — reuses the attribute-matching already in `matchesQuery`. Cursor-scoping (tool
2's `since`) covers the simple case; the label covers overlapping/parallel runs.

## Phased plan

- **v1 (this milestone):** tools 1–3 — `replay_request`, `wait_for_event`/`events_since`,
  `aggregate`/`assert`. Delivers the full drive→observe→verify loop reusing
  `/api/replay` and the `since` cursor. Only new sidecar-facing capability: the MCP
  client learns to `POST`.
- **v2:** tools 4–6 — source-mapped frames, facet introspection, run scoping. Depth
  once the loop exists.

## Success criteria

An AI agent can, **without leaving the MCP**:
1. Reproduce a captured request (`replay_request`).
2. Deterministically wait for the resulting telemetry (`wait_for_event`), no snapshot racing.
3. Assert on it (`assert`/`aggregate`) — e.g. "the 500 on `/checkout` is gone" — and branch on the result.

Measured by a scripted end-to-end on codetest.dev: induce a bug, have the agent
drive → wait → assert red, ship a fix, drive → wait → assert green — with zero
out-of-band tooling.

## Non-goals

- **Stays read-only-safe.** The *only* deliberate side effect is the Replay trigger
  (tool 1), which reuses the existing user-facing `/api/replay` — no new mutation
  surface.
- **No writes to user data.** No DB writes, no telemetry mutation, no new persisted state.
- **Privacy posture unchanged.** Every new tool reads through the `loadEvents` →
  `redactEvents` chokepoint (#60); credentials stay store-but-don't-egress. Replay
  keeps re-auth server-side; tokens never reach the agent.
- Not a load/fuzz tool and not a general HTTP client — replay is scoped to captured
  requests (plus edits), not arbitrary traffic generation.
