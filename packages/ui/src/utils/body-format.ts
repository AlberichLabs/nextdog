/**
 * Pretty-print a response/request body for display.
 * JSON content types are parsed and re-stringified with 2-space indent; on any
 * parse failure (or non-JSON content) the raw text is returned unchanged.
 *
 * Shared between the Replay result view and the detail pane's Response section
 * so "what actually happened" and a fresh re-run format bodies identically.
 */
export function formatBody(body: string, contentType: string): string {
  if (contentType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

export interface CapturedResponse {
  status?: number;
  headers: Record<string, string>;
  body?: string;
  contentType: string;
}

/**
 * Pull the captured response (status / headers / body) out of a span's
 * attributes. Returns null when no response was captured on this span.
 *
 * Attribute shape written by the Node exporter:
 *   http.response.status            -> number
 *   http.response.header.{name}     -> string (lowercased header name)
 *   http.response.body              -> string (text/JSON; binary is summarized)
 */
export function buildResponseSection(
  attributes: Record<string, unknown>
): CapturedResponse | null {
  const headerPrefix = 'http.response.header.';
  let status: number | undefined;
  let body: string | undefined;
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'http.response.status') {
      const n = Number(value);
      if (!Number.isNaN(n)) status = n;
    } else if (key === 'http.response.body') {
      body = String(value);
    } else if (key.startsWith(headerPrefix)) {
      headers[key.slice(headerPrefix.length)] = String(value);
    }
  }

  if (status === undefined && body === undefined && Object.keys(headers).length === 0) {
    return null;
  }

  return { status, headers, body, contentType: headers['content-type'] ?? '' };
}
