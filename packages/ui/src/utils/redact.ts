// ---------------------------------------------------------------------------
// Egress redactor (issue #60) — the SINGLE chokepoint through which any
// outbound/shareable serialization of events must pass.
//
// Posture: **store-but-don't-egress**. Credential headers (Authorization,
// X-Api-Key, cookies, Set-Cookie, …) are captured and stored verbatim so
// one-click Replay can re-authenticate against your own endpoints — and shown
// in the local dashboard, which is not egress. They are redacted here, by
// default, at the moment data is about to leave the machine (trace export).
// Routing ALL export serialization through this one helper means a future
// egress surface inherits the redacted default instead of re-leaking.
//
// `SENSITIVE_HEADERS` is a verbatim in-sync copy of the canonical set in
// `@nextdog/node` (`packages/node/src/sensitive-headers.ts`). It is duplicated
// rather than imported because `@nextdog/ui` is a Preact bundle that cannot pull
// in the Node adapter — the same convention as `filter-query.ts`. The parity
// test (`redact.test.ts`) pins the list against the documented canonical set.
// ---------------------------------------------------------------------------

import type { SSEEvent } from '../hooks/use-sse';

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

/** True if an attribute key carries a credential and must not be exported. */
export function isSensitiveAttribute(key: string): boolean {
  if (key === COOKIE_ATTR) return true;
  const m = HEADER_ATTR_RE.exec(key);
  return m !== null && SENSITIVE_HEADERS.has(m[1].toLowerCase());
}

/**
 * Return a copy of `attributes` with every credential-bearing entry removed.
 * Never mutates the input (the live dashboard keeps rendering the raw values).
 */
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
 * Redact credential headers from a list of events for egress. Returns new
 * objects; the originals (live UI state) are left untouched.
 */
export function redactEventsForExport(events: SSEEvent[]): SSEEvent[] {
  return events.map((event) => ({
    ...event,
    data: { ...event.data, attributes: redactAttributes(event.data.attributes) },
  }));
}
