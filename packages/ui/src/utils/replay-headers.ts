/**
 * Header (de)serialization for the Replay editor.
 *
 * The editor shows non-auth headers as a "Key: Value" textarea (Postman-style)
 * plus a dedicated Authorization field. These helpers convert between that text
 * form and a plain headers object. Nothing here is persisted — the parsed
 * headers (including any pasted Authorization) live only for the outgoing replay
 * request (issue #60).
 */

/** Case-insensitive header names the editor surfaces in its dedicated field. */
const AUTH_HEADER = 'authorization';

/**
 * Parse a "Key: Value" block (one header per line) into a headers object.
 * Blank lines are skipped; the first colon separates name from value, so values
 * may themselves contain colons. Duplicate names keep the last occurrence.
 */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

/** Serialize a headers object to a "Key: Value" block, one per line. */
export function formatHeaderLines(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/**
 * Split a prefilled headers object into the dedicated Authorization value and
 * the remaining headers (case-insensitive on the auth key). Capture strips auth
 * headers, so `authorization` is normally empty — but we still handle it
 * defensively so a prefilled token would land in its own field, not the textarea.
 */
export function splitAuthHeader(headers: Record<string, string>): {
  authorization: string;
  rest: Record<string, string>;
} {
  let authorization = '';
  const rest: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === AUTH_HEADER) {
      authorization = v;
    } else {
      rest[k] = v;
    }
  }
  return { authorization, rest };
}

/**
 * Merge the editor's textarea headers with the dedicated Authorization field
 * into the final headers object sent to the sidecar. A non-empty Authorization
 * always wins over any `authorization` line typed in the textarea.
 */
export function composeReplayHeaders(
  headersText: string,
  authorization: string,
): Record<string, string> {
  const { rest } = splitAuthHeader(parseHeaderLines(headersText));
  const auth = authorization.trim();
  if (auth) rest.Authorization = auth;
  return rest;
}
