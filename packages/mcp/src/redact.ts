/**
 * Egress redactor (issue #60) — the SINGLE chokepoint through which every event
 * the MCP server hands to an AI agent must pass.
 *
 * Posture: **store-but-don't-egress**. The sidecar stores credential headers
 * (Authorization, X-Api-Key, cookies, Set-Cookie, …) verbatim so one-click
 * Replay can re-authenticate. The MCP server is an egress surface — whatever it
 * returns leaves the machine to the agent/LLM — so every tool routes its events
 * through {@link redactEvents} before they become tool output. Doing it once, at
 * the fetch boundary, means a future tool inherits the redacted default instead
 * of re-leaking.
 *
 * `SENSITIVE_HEADERS` is a verbatim in-sync copy of the canonical set in
 * `@nextdog/node` (`packages/node/src/sensitive-headers.ts`), mirrored in
 * `@nextdog/ui`'s `redact.ts`. It is duplicated rather than imported to keep
 * this package standalone — the same convention as `filter-query.ts` and
 * `types.ts` here. The parity test (`redact.test.ts`) pins the list.
 */
import type { SidecarEvent } from './types';

/** Lowercase credential-bearing header names. Mirror of @nextdog/node SENSITIVE_HEADERS. */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'set-cookie2',
]);

/** Span attribute that holds the raw request Cookie header (captured for replay). */
const COOKIE_ATTR = 'http.request.cookies';
/** Matches `http.request.header.<name>` / `http.response.header.<name>` attributes. */
const HEADER_ATTR_RE = /^http\.(?:request|response)\.header\.(.+)$/;

/** True if an attribute key carries a credential and must not leave the machine. */
export function isSensitiveAttribute(key: string): boolean {
  if (key === COOKIE_ATTR) return true;
  const m = HEADER_ATTR_RE.exec(key);
  return m !== null && SENSITIVE_HEADERS.has(m[1].toLowerCase());
}

/** Return a copy of `attributes` with every credential-bearing entry removed. */
export function redactAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveAttribute(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Return a copy of an HTTP header map with every credential-bearing header
 * removed (case-insensitive). Used by `replay_request` to scrub the reconstructed
 * request it echoes back in `prepareOnly` mode: captured `authorization`/`cookie`/
 * `x-api-key`/`set-cookie` values must never egress to the agent (#60/#86). This
 * is the header-map analogue of {@link redactAttributes}, which scrubs the same
 * credentials when they live inside event attributes.
 */
export function stripSensitiveHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Redact credential headers from events before they leave the machine. Returns
 * new objects; the sidecar's stored data is never mutated.
 */
export function redactEvents(events: SidecarEvent[]): SidecarEvent[] {
  return events.map((event) => ({
    ...event,
    data: { ...event.data, attributes: redactAttributes(event.data.attributes) },
  }));
}
