/**
 * Canonical set of credential-bearing HTTP header names (issue #60).
 *
 * Posture: **store-but-don't-egress**. These headers are captured and stored
 * VERBATIM in `~/.nextdog/data` and shown in the local dashboard — that is what
 * lets one-click Replay re-authenticate against your own endpoints. Localhost
 * storage and display are not egress.
 *
 * They are redacted only at the EGRESS boundary — trace export and the MCP
 * server — by a single shared redactor on each surface, so credentials never
 * leave the machine. This is the source-of-truth list; the egress redactors
 * keep an in-sync copy (they cannot import this — `@nextdog/ui` is a Preact
 * bundle and `@nextdog/mcp` is intentionally standalone, mirroring the existing
 * `filter-query.ts` duplication convention). Parity tests pin the equivalence.
 *
 * Names are lowercase; callers compare against `name.toLowerCase()`.
 */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'set-cookie2',
]);
