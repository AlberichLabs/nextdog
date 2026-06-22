/**
 * Captures HTTP request metadata (headers, cookies, body) and stores it
 * so the span exporter can enrich spans with this data for replay.
 *
 * Works by monkey-patching Node's http.Server to intercept incoming requests.
 * Metadata is stored keyed by "method url" for correlation with OTel spans
 * in the exporter (since the OTel active span is not available at request time).
 */
import * as http from 'node:http';
import { requestContextStorage, createRequestContext } from './request-context.js';

export interface RequestMetadata {
  method: string;
  url: string;
  headers: Record<string, string>;
  cookies: string;
  body?: string;
  /** Response status code of the ORIGINAL request (what actually happened) */
  responseStatus?: number;
  /** Response headers of the original request */
  responseHeaders?: Record<string, string>;
  /** Captured response body (text/JSON only; binary is summarized; capped) */
  responseBody?: string;
  capturedAt: number;
}

// Store captured request metadata keyed by "METHOD url" for recent lookups.
// Multiple requests to the same URL are queued oldest-first (FIFO): captures are
// push()ed on, and getRequestMetadata shift()s the oldest matching entry off.
const requestStore = new Map<string, RequestMetadata[]>();

// Max request body size to capture (16KB — enough for API payloads, avoids memory issues)
const MAX_BODY_SIZE = 16 * 1024;

// Max response body size to capture (50KB — matches the replay endpoint's cap;
// responses are typically larger than requests). Capped so a streaming or large
// response never buffers unbounded memory in the user's dev server.
const MAX_RESPONSE_BODY_SIZE = 50 * 1024;

// Content-type prefixes/fragments we consider safe to capture as text.
// Anything else (images, fonts, octet-stream, video, etc.) is summarized, not buffered.
const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/graphql',
  'text/',
  '+json',
  '+xml',
];

function isTextContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return TEXT_CONTENT_TYPES.some((t) => ct.includes(t));
}

// Content-Encoding values that mean the body is compressed (not raw text/UTF-8).
// We do NOT decompress — capturing the raw bytes as text would store mojibake —
// so a compressed body is summarized like the binary case.
const COMPRESSED_ENCODINGS = ['gzip', 'br', 'deflate', 'compress', 'zstd'];

function compressionOf(contentEncoding: string): string | null {
  const ce = contentEncoding.toLowerCase().trim();
  if (!ce || ce === 'identity') return null;
  // content-encoding can be a comma-separated list (e.g. "gzip, br").
  const found = COMPRESSED_ENCODINGS.find((enc) =>
    ce.split(',').some((part) => part.trim() === enc)
  );
  return found ?? ce; // unknown non-identity encoding: still treat as compressed
}

// Cleanup entries older than 60s to prevent memory leaks
const CLEANUP_INTERVAL = 30_000;
const MAX_AGE = 60_000;

function captureHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value && key !== 'host') {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return headers;
}

/**
 * Capture the request body WITHOUT adding 'data' listeners (which would put
 * the stream into flowing mode and break Next.js 14's body parsing).
 * Instead, we monkey-patch req.on so that when Next.js (or any other consumer)
 * reads the body, we passively observe the chunks.
 */
function captureBody(req: http.IncomingMessage, metadata: RequestMetadata): void {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const chunks: Buffer[] = [];
  let size = 0;
  const originalOn = req.on;

  // Intercept listener registration to piggyback on whoever reads the body
  req.on = function (this: http.IncomingMessage, event: string, listener: (...args: any[]) => void) {
    if (event === 'data') {
      const self = this;
      const wrappedListener = (chunk: Buffer) => {
        if (size < MAX_BODY_SIZE) {
          chunks.push(chunk);
          size += chunk.length;
        }
        return listener.call(self, chunk);
      };
      return originalOn.call(this, event, wrappedListener);
    }
    if (event === 'end') {
      const self = this;
      const wrappedListener = (...args: any[]) => {
        if (chunks.length > 0) {
          const body = Buffer.concat(chunks).toString('utf-8');
          metadata.body = body.length > MAX_BODY_SIZE ? body.slice(0, MAX_BODY_SIZE) : body;
          chunks.length = 0;
        }
        return listener.call(self, ...args);
      };
      return originalOn.call(this, event, wrappedListener);
    }
    return originalOn.call(this, event, listener);
  } as typeof req.on;
}

/**
 * Passively tee the response so we record what the ORIGINAL request actually
 * returned (status, headers, body) WITHOUT re-issuing it via Replay.
 *
 * This wraps res.write/res.end on the single ServerResponse instance: each chunk
 * is observed (copied into a capped buffer) and then forwarded UNCHANGED to the
 * original method. We never consume the stream the client needs, never alter the
 * bytes/headers/timing the client sees, and stop buffering once the cap is hit so
 * a large or streaming response can't exhaust memory.
 */
function captureResponse(res: http.ServerResponse, metadata: RequestMetadata): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflowed = false;
  let captured = false;
  // Headers passed inline to writeHead(status, headers) bypass setHeader() and
  // therefore never appear in res.getHeaders(). Capture them here so we record
  // exactly what the client received.
  const writeHeadHeaders: Record<string, string> = {};

  const observe = (chunk: unknown): void => {
    if (overflowed || chunk == null) return;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk)
        : null;
    if (!buf) return;
    if (size + buf.length > MAX_RESPONSE_BODY_SIZE) {
      // Take what fits, then stop buffering.
      const remaining = MAX_RESPONSE_BODY_SIZE - size;
      if (remaining > 0) {
        chunks.push(buf.subarray(0, remaining));
        size += remaining;
      }
      overflowed = true;
      return;
    }
    chunks.push(buf);
    size += buf.length;
  };

  const finalize = (): void => {
    if (captured) return;
    captured = true;

    metadata.responseStatus = res.statusCode;

    const headers: Record<string, string> = {};
    const raw = res.getHeaders();
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    // Merge in any headers passed inline to writeHead (setHeader-bypassing).
    Object.assign(headers, writeHeadHeaders);
    metadata.responseHeaders = headers;

    const contentType = headers['content-type'] ?? '';
    const compression = compressionOf(headers['content-encoding'] ?? '');
    if (size === 0) {
      // No body — leave responseBody undefined.
    } else if (compression) {
      // Compressed body: the buffered bytes are not UTF-8 text. Decoding them
      // would yield mojibake, so summarize instead of capturing garbage.
      metadata.responseBody = `[compressed ${compression} response, ${size} bytes — not captured]`;
    } else if (contentType && !isTextContentType(contentType)) {
      metadata.responseBody = `[binary ${contentType} response, ${size} bytes — not captured]`;
    } else {
      const body = Buffer.concat(chunks).toString('utf-8');
      metadata.responseBody = overflowed ? body + '\n... (truncated)' : body;
    }
  };

  const originalWriteHead = res.writeHead.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  // res.writeHead(statusCode[, statusMessage][, headers])
  res.writeHead = function (this: http.ServerResponse, ...args: unknown[]) {
    const last = args[args.length - 1];
    if (last && typeof last === 'object') {
      if (Array.isArray(last)) {
        // Flat [k1, v1, k2, v2, ...] or array of [k, v] pairs.
        if (Array.isArray(last[0])) {
          for (const pair of last as [unknown, unknown][]) {
            if (pair && pair.length === 2) writeHeadHeaders[String(pair[0]).toLowerCase()] = String(pair[1]);
          }
        } else {
          for (let i = 0; i + 1 < last.length; i += 2) {
            writeHeadHeaders[String(last[i]).toLowerCase()] = String(last[i + 1]);
          }
        }
      } else {
        for (const [k, v] of Object.entries(last as Record<string, unknown>)) {
          if (v != null) writeHeadHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
      }
    }
    return (originalWriteHead as (...a: unknown[]) => http.ServerResponse)(...args);
  } as typeof res.writeHead;

  // res.write(chunk[, encoding][, cb])
  res.write = function (this: http.ServerResponse, chunk: unknown, ...rest: unknown[]) {
    observe(chunk);
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  } as typeof res.write;

  // res.end([chunk][, encoding][, cb])
  res.end = function (this: http.ServerResponse, ...args: unknown[]) {
    // The first arg is the final chunk only if it's not a callback/encoding.
    const maybeChunk = args[0];
    if (maybeChunk != null && (Buffer.isBuffer(maybeChunk) || typeof maybeChunk === 'string')) {
      observe(maybeChunk);
    }
    const result = (originalEnd as (...a: unknown[]) => http.ServerResponse)(...args);
    finalize();
    return result;
  } as typeof res.end;

  // Belt-and-suspenders: also capture if the response finishes/closes without
  // a final end() chunk path we observed (e.g. pipe()d streams).
  res.on('finish', finalize);
}

/**
 * Look up request metadata by method + URL path.
 * Finds the most recent capture matching these fields.
 */
export function getRequestMetadata(method: string, url: string): RequestMetadata | undefined {
  const key = `${method} ${url}`;
  const stack = requestStore.get(key);
  if (!stack || stack.length === 0) return undefined;
  // Return and consume the oldest matching entry (FIFO — first request in, first matched)
  return stack.shift();
}

function cleanup() {
  const now = Date.now();
  for (const [key, stack] of requestStore) {
    const filtered = stack.filter((m) => now - m.capturedAt < MAX_AGE);
    if (filtered.length === 0) {
      requestStore.delete(key);
    } else {
      requestStore.set(key, filtered);
    }
  }
}

export function startRequestCapture() {
  const timer = setInterval(cleanup, CLEANUP_INTERVAL);
  timer.unref();

  const originalEmit = http.Server.prototype.emit;

  http.Server.prototype.emit = function (event: string, ...args: unknown[]) {
    if (event === 'request') {
      const req = args[0] as http.IncomingMessage;
      const res = args[1] as http.ServerResponse | undefined;

      const headers = captureHeaders(req);
      const metadata: RequestMetadata = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers,
        cookies: headers['cookie'] ?? '',
        capturedAt: Date.now(),
      };

      // Capture body asynchronously (mutates metadata.body when ready)
      captureBody(req, metadata);

      // Tee the response so we record what the original request actually
      // returned (status/headers/body), no Replay/re-issue required.
      if (res) {
        captureResponse(res, metadata);
      }

      // Store keyed by method + url
      const key = `${metadata.method} ${metadata.url}`;
      const stack = requestStore.get(key);
      if (stack) {
        stack.push(metadata);
      } else {
        requestStore.set(key, [metadata]);
      }

      // Run the rest of the request inside AsyncLocalStorage context
      // so console.log calls have access to request info
      const reqCtx = createRequestContext(metadata.method, metadata.url);
      return requestContextStorage.run(reqCtx, () =>
        originalEmit.apply(this, [event, ...args])
      );
    }

    return originalEmit.apply(this, [event, ...args]);
  };
}
