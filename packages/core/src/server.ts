import { readFile, stat } from 'node:fs/promises';
import {
  createServer as httpCreateServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { extname, join } from 'node:path';
import { EventBus } from './event-bus';
import { FileStore } from './file-store';
import { NEXTDOG_HEALTH_MARKER } from './health';
import { RingBuffer } from './ring-buffer';
import { bigintReplacer } from './serialize';
import { SSEStream } from './sse-stream';
import type { NextDogEvent, Span } from './types';

export interface ServerOptions {
  port: number;
  host?: string;
  dataDir: string;
  uiDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/**
 * Read and JSON-parse a request body into an object. Unlike a bare
 * `JSON.parse(await readBody(req))`, this never throws on a malformed,
 * non-JSON, or non-object body: the ingest endpoints face whatever a misbehaving
 * exporter or a `curl` happens to send, and an uncaught parse error would surface
 * as an unhandled rejection / 500 (or crash the sidecar) rather than a clean 400.
 * Returns `{ ok: true, body }` for a valid JSON object, or `{ ok: false }` so the
 * caller can reply with `json(res, 400, …)`. Sibling of the import-side guard in #44.
 */
async function readJsonObject(
  req: IncomingMessage,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    return { ok: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

/**
 * A fully-resolved HTTP request to replay. Either reconstructed from a captured
 * span (one-click) or supplied verbatim by the UI's editor (the user has pasted
 * an Authorization header / edited anything).
 */
interface ReplayRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Rebuild the original HTTP request from a captured SERVER span. Credential
 * headers (Authorization, X-Api-Key, cookies, …) are now captured and stored
 * VERBATIM (store-but-don't-egress, issue #60), so the reconstructed request
 * carries them and one-click Replay re-authenticates against authed endpoints.
 * The raw token only ever flows disk → the original endpoint here, server-side;
 * it never reaches trace export or the MCP server (both redact it). For expired
 * tokens, the Edit & Replay editor pre-fills the captured value and lets the
 * user override it.
 */
function buildReplayRequest(span: Span): ReplayRequest {
  const attrs = span.attributes;
  const method = String(attrs['http.method'] ?? attrs['http.request.method'] ?? 'GET');
  const route = String(attrs['http.route'] ?? attrs['http.target'] ?? span.name);
  const host = String(attrs['http.host'] ?? attrs['net.host.name'] ?? 'localhost:3000');
  const scheme = String(attrs['http.scheme'] ?? 'http');
  const url = route.startsWith('http') ? route : `${scheme}://${host}${route}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('http.request.header.')) {
      headers[key.replace('http.request.header.', '')] = String(value);
    }
  }

  const cookies = attrs['http.request.cookies'] ?? attrs.cookie;
  if (cookies) {
    headers.cookie = String(cookies);
  }

  const body = attrs['http.request.body'] ? String(attrs['http.request.body']) : undefined;
  return { method, url, headers, body };
}

/**
 * Coerce a user-edited request payload from the UI into a ReplayRequest. Returns
 * null when there's no usable target URL. The headers the user typed (including
 * any Authorization) are taken as-is and live only for this request — they are
 * never written to the FileStore, preserving the don't-store-tokens posture.
 */
function coerceReplayRequest(raw: Record<string, unknown>): ReplayRequest | null {
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) return null;

  const method = typeof raw.method === 'string' && raw.method.trim() ? raw.method.trim() : 'GET';

  const headers: Record<string, string> = {};
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    for (const [k, v] of Object.entries(raw.headers as Record<string, unknown>)) {
      if (k.trim() && (typeof v === 'string' || typeof v === 'number')) {
        headers[k] = String(v);
      }
    }
  }

  const body = typeof raw.body === 'string' ? raw.body : undefined;
  return { method, url, headers, body };
}

/** Send a replay request and shape the response for the dashboard. */
async function performReplay(replayReq: ReplayRequest) {
  const startTime = Date.now();
  const response = await fetch(replayReq.url, {
    method: replayReq.method,
    headers: replayReq.headers,
    body:
      replayReq.body && replayReq.method !== 'GET' && replayReq.method !== 'HEAD'
        ? replayReq.body
        : undefined,
    redirect: 'follow',
  });

  const duration = Date.now() - startTime;
  const responseBody = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body:
      responseBody.length > 50_000
        ? `${responseBody.slice(0, 50_000)}\n... (truncated)`
        : responseBody,
    duration,
    url: replayReq.url,
    method: replayReq.method,
  };
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, bigintReplacer);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function cors(res: ServerResponse): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': '0',
  });
  res.end();
}

export function createServer(opts: ServerOptions): Promise<Server> {
  const bus = new EventBus();
  const ringBuffer = new RingBuffer(500);
  const fileStore = new FileStore(opts.dataDir);
  const sseStream = new SSEStream(ringBuffer);
  const services = new Set<string>();

  // Wire EventBus subscribers
  bus.on('*', (event) => {
    ringBuffer.push(event);
    sseStream.broadcast(event);
  });

  // Periodic flush to disk
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  const startFlushing = () => {
    flushTimer = setInterval(async () => {
      const events = ringBuffer.drain();
      if (events.length > 0) {
        await fileStore.flush(events);
      }
    }, 2000);
    flushTimer.unref();
  };

  // Periodic cleanup of old files (every hour)
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;
  const startCleanup = () => {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    cleanupTimer = setInterval(
      () => {
        fileStore.cleanup(TWENTY_FOUR_HOURS);
      },
      60 * 60 * 1000,
    );
    cleanupTimer.unref();
  };

  const server = httpCreateServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      return cors(res);
    }

    // Health check. The `service: NEXTDOG_HEALTH_MARKER` field is a stable
    // identifying signature: clients (e.g. @nextdog/node's isHealthy) require it
    // so they never mistake an unrelated process answering 2xx on :6789 for a
    // real NextDog sidecar (issue #17). The marker is shared with consumers via
    // @nextdog/core so producer and consumer can never drift apart.
    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, {
        status: 'ok',
        service: NEXTDOG_HEALTH_MARKER,
        uptime: process.uptime(),
      });
    }

    // Ingest spans
    if (req.method === 'POST' && pathname === '/v1/spans') {
      const parsed = await readJsonObject(req);
      if (!parsed.ok) {
        return json(res, 400, { error: 'invalid request body: expected a JSON object' });
      }
      let spans: Span[];
      try {
        const rawSpans: unknown[] = Array.isArray(parsed.body.spans) ? parsed.body.spans : [];
        spans = rawSpans.map((raw) => {
          const s = raw as Record<string, unknown>;
          return {
            ...s,
            startTimeUnixNano: BigInt(s.startTimeUnixNano as string),
            endTimeUnixNano: BigInt(s.endTimeUnixNano as string),
          } as Span;
        });
      } catch {
        return json(res, 400, { error: 'invalid spans payload' });
      }

      for (const span of spans) {
        services.add(span.serviceName);
        const event: NextDogEvent = {
          type: 'span',
          timestamp: Date.now(),
          data: span,
        };
        bus.emit(event);
      }
      return json(res, 202, { accepted: spans.length });
    }

    // Ingest logs
    if (req.method === 'POST' && pathname === '/v1/logs') {
      const parsed = await readJsonObject(req);
      if (!parsed.ok) {
        return json(res, 400, { error: 'invalid request body: expected a JSON object' });
      }
      const logs = Array.isArray(parsed.body.logs) ? parsed.body.logs : [];

      for (const log of logs) {
        const event: NextDogEvent =
          log.type === 'log'
            ? (log as NextDogEvent)
            : { type: 'log' as const, timestamp: Date.now(), data: log };
        if (event.data.serviceName) services.add(event.data.serviceName);
        bus.emit(event);
      }
      return json(res, 202, { accepted: logs.length });
    }

    // Query spans
    if (req.method === 'GET' && pathname === '/api/spans') {
      const service = url.searchParams.get('service') ?? undefined;
      const traceId = url.searchParams.get('traceId') ?? undefined;
      const last = url.searchParams.has('last') ? Number(url.searchParams.get('last')) : undefined;

      // Serve from ring buffer for recent queries, file store for deeper
      if (last && last <= 500 && !service && !traceId) {
        return json(res, 200, { spans: ringBuffer.getLast(last) });
      }

      const results = await fileStore.query({ service, traceId, last });
      return json(res, 200, { spans: results });
    }

    // Query events (spans AND logs) — full history from FileStore.
    // Supports browsing beyond the live RingBuffer and reloading logs on dashboard open.
    if (req.method === 'GET' && pathname === '/api/events') {
      const service = url.searchParams.get('service') ?? undefined;
      const traceId = url.searchParams.get('traceId') ?? undefined;
      const typeParam = url.searchParams.get('type');
      const type = typeParam === 'span' || typeParam === 'log' ? typeParam : undefined;
      const since = url.searchParams.has('since')
        ? Number(url.searchParams.get('since'))
        : undefined;
      const before = url.searchParams.has('before')
        ? Number(url.searchParams.get('before'))
        : undefined;
      const last = url.searchParams.has('last') ? Number(url.searchParams.get('last')) : undefined;

      const events = await fileStore.query({ service, traceId, type, since, before, last });
      return json(res, 200, { events });
    }

    // List services
    if (req.method === 'GET' && pathname === '/api/services') {
      return json(res, 200, { services: [...services] });
    }

    // Replay a request. Three modes, all on POST /api/replay:
    //   1. { request: {...} }          — send a user-edited request verbatim.
    //      This is how an Authorization header reaches an authed endpoint: the
    //      token lives only in this request and is never written to disk,
    //      preserving the don't-store-tokens posture (issue #60).
    //   2. { spanId, prepareOnly: true } — reconstruct the captured request and
    //      hand it back (auth-stripped) so the UI can pre-fill its editor. No send.
    //   3. { spanId }                  — one-click replay of the captured request.
    if (req.method === 'POST' && pathname === '/api/replay') {
      const parsed = await readJsonObject(req);
      if (!parsed.ok) {
        return json(res, 400, { error: 'invalid request body: expected a JSON object' });
      }

      // Mode 1 — edited replay. Send exactly what the user supplied.
      const rawRequest = parsed.body.request;
      if (rawRequest !== undefined) {
        if (typeof rawRequest !== 'object' || rawRequest === null || Array.isArray(rawRequest)) {
          return json(res, 400, { error: 'request must be an object' });
        }
        const replayReq = coerceReplayRequest(rawRequest as Record<string, unknown>);
        if (!replayReq) {
          return json(res, 400, { error: 'request.url is required' });
        }
        try {
          return json(res, 200, await performReplay(replayReq));
        } catch (err) {
          return json(res, 502, {
            error: 'replay failed',
            message: (err as Error).message,
            url: replayReq.url,
            method: replayReq.method,
          });
        }
      }

      // Modes 2 & 3 — reconstruct from a captured span.
      const { spanId, prepareOnly } = parsed.body;
      if (!spanId || typeof spanId !== 'string') {
        return json(res, 400, { error: 'spanId is required' });
      }

      // Find the span in the ring buffer first, then file store
      const allRecent = ringBuffer.getAll();
      let targetSpan: Span | undefined;

      for (const event of allRecent) {
        if (event.type === 'span' && event.data.spanId === spanId) {
          targetSpan = event.data as Span;
          break;
        }
      }

      if (!targetSpan) {
        // Search file store with spanId filter (short-circuits on first match)
        const stored = await fileStore.query({ spanId });
        if (stored.length > 0 && stored[0].type === 'span') {
          targetSpan = stored[0].data as Span;
        }
      }

      if (!targetSpan) {
        return json(res, 404, { error: 'span not found' });
      }

      const replayReq = buildReplayRequest(targetSpan);

      // Mode 2 — prefill the editor only; do NOT send.
      if (prepareOnly === true) {
        return json(res, 200, replayReq);
      }

      // Mode 3 — one-click replay (unchanged behaviour for non-auth requests).
      try {
        return json(res, 200, await performReplay(replayReq));
      } catch (err) {
        return json(res, 502, {
          error: 'replay failed',
          message: (err as Error).message,
          url: replayReq.url,
          method: replayReq.method,
        });
      }
    }

    // SSE live tail
    if (req.method === 'GET' && pathname === '/sse') {
      sseStream.addClient(res);
      req.on('close', () => sseStream.removeClient(res));
      return;
    }

    // Static file serving + SPA fallback
    if (opts.uiDir) {
      const filePath = join(opts.uiDir, pathname);
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isFile()) {
          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
          const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
          const content = await readFile(filePath);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
          });
          return res.end(content);
        }
      } catch {
        // File not found — fall through
      }

      // SPA fallback: non-API, non-v1 routes serve index.html
      if (!pathname.startsWith('/api/') && !pathname.startsWith('/v1/')) {
        try {
          const indexPath = join(opts.uiDir, 'index.html');
          const content = await readFile(indexPath);
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
          });
          return res.end(content);
        } catch {
          // index.html missing — fall through to 404
        }
      }
    }

    // 404
    json(res, 404, { error: 'not found' });
  });

  startFlushing();
  startCleanup();

  server.on('close', () => {
    if (flushTimer) clearInterval(flushTimer);
    if (cleanupTimer) clearInterval(cleanupTimer);
  });

  return new Promise((resolve, reject) => {
    // Rehydrate the service registry from persisted events so `service:` /
    // `!service:` filters work after a sidecar restart, before we start serving.
    fileStore
      .services()
      .then((persisted) => {
        for (const name of persisted) services.add(name);
      })
      .catch(() => {
        // Non-fatal: a corrupt/unreadable history shouldn't block startup.
        // The registry simply repopulates from live ingest.
      })
      .finally(() => {
        server.listen(opts.port, opts.host ?? '127.0.0.1', () => resolve(server));
      });

    server.on('error', reject);
  });
}
