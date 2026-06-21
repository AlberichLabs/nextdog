import { createServer as httpCreateServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { EventBus } from './event-bus.js';
import { RingBuffer } from './ring-buffer.js';
import { FileStore } from './file-store.js';
import { SSEStream } from './sse-stream.js';
import type { NextDogEvent, Span } from './types.js';

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
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? value.toString() + 'n' : value
  );
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
    cleanupTimer = setInterval(() => {
      fileStore.cleanup(TWENTY_FOUR_HOURS);
    }, 60 * 60 * 1000);
    cleanupTimer.unref();
  };

  const server = httpCreateServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      return cors(res);
    }

    // Health check
    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, { status: 'ok', uptime: process.uptime() });
    }

    // Ingest spans
    if (req.method === 'POST' && pathname === '/v1/spans') {
      const body = JSON.parse(await readBody(req));
      const spans: Span[] = (body.spans ?? []).map((s: Record<string, unknown>) => ({
        ...s,
        startTimeUnixNano: BigInt(s.startTimeUnixNano as string),
        endTimeUnixNano: BigInt(s.endTimeUnixNano as string),
      }));

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
      const body = JSON.parse(await readBody(req));
      const logs = body.logs ?? [];

      for (const log of logs) {
        const event: NextDogEvent = log.type === 'log'
          ? log as NextDogEvent
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
      const last = url.searchParams.has('last')
        ? Number(url.searchParams.get('last'))
        : undefined;

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
      const last = url.searchParams.has('last')
        ? Number(url.searchParams.get('last'))
        : undefined;

      const events = await fileStore.query({ service, traceId, type, since, before, last });
      return json(res, 200, { events });
    }

    // List services
    if (req.method === 'GET' && pathname === '/api/services') {
      return json(res, 200, { services: [...services] });
    }

    // Replay a request by spanId — reconstructs and re-sends the original HTTP request
    if (req.method === 'POST' && pathname === '/api/replay') {
      const body = JSON.parse(await readBody(req));
      const { spanId } = body;

      if (!spanId) {
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

      const attrs = targetSpan.attributes;
      const method = String(attrs['http.method'] ?? attrs['http.request.method'] ?? 'GET');
      const route = String(attrs['http.route'] ?? attrs['http.target'] ?? targetSpan.name);
      const host = String(attrs['http.host'] ?? attrs['net.host.name'] ?? 'localhost:3000');
      const scheme = String(attrs['http.scheme'] ?? 'http');
      const targetUrl = route.startsWith('http') ? route : `${scheme}://${host}${route}`;

      // Reconstruct headers
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith('http.request.header.')) {
          const headerName = key.replace('http.request.header.', '');
          headers[headerName] = String(value);
        }
      }

      // Add cookies
      const cookies = attrs['http.request.cookies'] ?? attrs['cookie'];
      if (cookies) {
        headers['cookie'] = String(cookies);
      }

      // Request body
      const reqBody = attrs['http.request.body'] ? String(attrs['http.request.body']) : undefined;

      try {
        const startTime = Date.now();
        const response = await fetch(targetUrl, {
          method,
          headers,
          body: reqBody && method !== 'GET' && method !== 'HEAD' ? reqBody : undefined,
          redirect: 'follow',
        });

        const duration = Date.now() - startTime;
        const responseBody = await response.text();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });

        return json(res, 200, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody.length > 50_000 ? responseBody.slice(0, 50_000) + '\n... (truncated)' : responseBody,
          duration,
          url: targetUrl,
          method,
        });
      } catch (err) {
        return json(res, 502, {
          error: 'replay failed',
          message: (err as Error).message,
          url: targetUrl,
          method,
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
          const cacheControl = ext === '.html'
            ? 'no-cache'
            : 'public, max-age=31536000, immutable';
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
      .then(persisted => {
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
