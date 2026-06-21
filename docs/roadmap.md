# NextDog Roadmap

This roadmap is grounded in the open [GitHub issues](https://github.com/cscherban/NextDog/issues)
and the framework-support items in the [README](../README.md#roadmap). The issues
are the canonical, living backlog — this page groups them by horizon for context.
When issues are closed or reprioritized, this page follows.

NextDog is an open-source side project. Horizons describe rough sequencing and
relative priority, not committed dates.

## Near-term

Capability and correctness gaps that make today's Next.js experience complete and
trustworthy.

- **Outbound `fetch`/HTTP spans in the waterfall** — auto-instrument the app's own
  API calls so they appear nested in the trace
  ([#4](https://github.com/cscherban/NextDog/issues/4)).
- **DB query span visibility** — surface Drizzle / Prisma / `pg` queries in the
  waterfall ([#5](https://github.com/cscherban/NextDog/issues/5)).
- **Service registry rebuild after sidecar restart** — `/api/services` currently
  returns empty until new traffic arrives
  ([#16](https://github.com/cscherban/NextDog/issues/16)).
- **Stricter sidecar health check** — `:6789` accepting any 2xx means telemetry
  can be sent to a non-NextDog process with no warning
  ([#17](https://github.com/cscherban/NextDog/issues/17)).
- **Dashboard fixes** — slow-request toasts that never dismiss
  ([#19](https://github.com/cscherban/NextDog/issues/19)), the Logs column track
  mismatch ([#18](https://github.com/cscherban/NextDog/issues/18)), low-contrast
  light-theme colors ([#20](https://github.com/cscherban/NextDog/issues/20)), and
  OR composition in the filter bar
  ([#21](https://github.com/cscherban/NextDog/issues/21)).
- **Launch readiness** — issue templates and a feedback intake path
  ([#3](https://github.com/cscherban/NextDog/issues/3), a launch blocker).

## Mid-term

History, navigation, and developer-experience depth.

- **Full-history reload from the FileStore** — browse beyond the last ~500 events
  on dashboard open ([#8](https://github.com/cscherban/NextDog/issues/8)).
- **Capture original request & response bodies** on the server span, not only on
  replay ([#6](https://github.com/cscherban/NextDog/issues/6)).
- **Export / share a trace** as a self-contained, importable file
  ([#7](https://github.com/cscherban/NextDog/issues/7)).
- **Correlate browser console logs to the server trace** by propagating trace
  context to the client ([#13](https://github.com/cscherban/NextDog/issues/13)).
- **List virtualization** to stay smooth at high span volume
  ([#9](https://github.com/cscherban/NextDog/issues/9)).
- **Saved searches + recent-search history** in the filter bar
  ([#10](https://github.com/cscherban/NextDog/issues/10)).
- **Sharper first-run / empty state** — distinguish "not connected" from
  "connected, no traffic" ([#11](https://github.com/cscherban/NextDog/issues/11)).
- **Rounded-out keyboard navigation** and an accurate shortcut sheet
  ([#12](https://github.com/cscherban/NextDog/issues/12)).

## Longer-term

Broader reach — more frameworks, more runtimes, and AI-agent integration.

- **MCP server + Claude skill** — let an AI coding agent (Claude Code, Cursor,
  Claude Desktop) query live local traces and logs over the sidecar API while you
  debug, instead of copy-pasting
  ([#23](https://github.com/cscherban/NextDog/issues/23)).
- **More full-stack adapters** (from the README roadmap):
  - **SvelteKit** (`@nextdog/sveltekit`) — implemented in-repo; remaining work is
    adding it to the publish workflow and shipping to npm.
  - **Remix / React Router v7** (`@nextdog/remix`).
- **Generic / infrastructure** (from the README roadmap):
  - **Docker sidecar image** — `docker pull nextdog/sidecar` for containerized and
    non-Node setups.
  - **OTLP protocol support** — accept standard OpenTelemetry HTTP exports
    (`POST /v1/traces`) so any OTel-instrumented app (Python, Go, Ruby) can send to
    NextDog.
- **Server-framework adapters** (lower priority, from the README roadmap):
  Express, Hono, Fastify.
