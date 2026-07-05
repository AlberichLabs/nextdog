import * as http from 'node:http';
import * as zlib from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { getRequestMetadata, startRequestCapture } from '../request-capture';

// Install the capture monkey-patch once for the whole suite.
beforeAll(() => {
  startRequestCapture();
});

/**
 * Spin up a real HTTP server (whose `request` event is now intercepted by the
 * capture patch), drive one request through it, and return the bytes the
 * client received. Captured metadata is read separately via getRequestMetadata.
 */
async function driveRequest(opts: {
  method: string;
  path: string;
  reqBody?: string;
  reqHeaders?: Record<string, string>;
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}): Promise<{ clientBody: Buffer; clientStatus: number; clientHeaders: http.IncomingHttpHeaders }> {
  const server = http.createServer(opts.handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: opts.method, path: opts.path, headers: opts.reqHeaders },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              clientBody: Buffer.concat(chunks),
              clientStatus: res.statusCode ?? 0,
              clientHeaders: res.headers,
            }),
          );
        },
      );
      req.on('error', reject);
      if (opts.reqBody) req.write(opts.reqBody);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Read captured metadata, failing the test loudly if nothing was captured. */
function expectMeta(
  method: string,
  path: string,
): NonNullable<ReturnType<typeof getRequestMetadata>> {
  const meta = getRequestMetadata(method, path);
  if (!meta) throw new Error(`expected captured request metadata for ${method} ${path}`);
  return meta;
}

describe('response capture', () => {
  it('captures response status, headers, and JSON body on the request metadata', async () => {
    const payload = JSON.stringify({ ok: true, items: [1, 2, 3] });
    const result = await driveRequest({
      method: 'GET',
      path: '/api/users',
      handler: (_req, res) => {
        res.writeHead(201, { 'Content-Type': 'application/json', 'X-Custom': 'hi' });
        res.end(payload);
      },
    });

    // Client received the intended response, untouched.
    expect(result.clientStatus).toBe(201);
    expect(result.clientBody.toString('utf-8')).toBe(payload);

    const meta = expectMeta('GET', '/api/users');
    expect(meta.responseStatus).toBe(201);
    expect(meta.responseBody).toBe(payload);
    expect(meta.responseHeaders?.['content-type']).toContain('application/json');
    expect(meta.responseHeaders?.['x-custom']).toBe('hi');
  });

  it('delivers a byte-identical body to the client across multiple write() chunks', async () => {
    const result = await driveRequest({
      method: 'GET',
      path: '/api/stream',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('hello ');
        res.write('world');
        res.end('!');
      },
    });

    expect(result.clientBody.toString('utf-8')).toBe('hello world!');

    const meta = expectMeta('GET', '/api/stream');
    expect(meta.responseBody).toBe('hello world!');
    expect(meta.responseStatus).toBe(200);
  });

  it('caps the captured response body at the max size without truncating the client body', async () => {
    // 60KB of text, larger than the 50KB cap.
    const big = 'x'.repeat(60 * 1024);
    const result = await driveRequest({
      method: 'GET',
      path: '/api/big',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(big);
      },
    });

    // Client got the full 60KB.
    expect(result.clientBody.length).toBe(big.length);

    const meta = expectMeta('GET', '/api/big');
    // Captured copy is capped.
    const { responseBody } = meta;
    if (responseBody === undefined) throw new Error('expected captured response body');
    expect(responseBody.length).toBeLessThan(big.length);
    expect(responseBody).toContain('(truncated)');
  });

  it('skips binary response bodies but still records status and headers', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const result = await driveRequest({
      method: 'GET',
      path: '/api/image',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
      },
    });

    // Client received the real binary bytes.
    expect(Buffer.compare(result.clientBody, png)).toBe(0);

    const meta = expectMeta('GET', '/api/image');
    expect(meta.responseStatus).toBe(200);
    expect(meta.responseHeaders?.['content-type']).toBe('image/png');
    // Body is summarized, not the raw bytes.
    expect(meta.responseBody).toMatch(/binary/i);
    expect(meta.responseBody).toContain('image/png');
  });

  it('captures a response body written as Uint8Array chunks (Web-stream piping)', async () => {
    // App Router pipes the Web Response body to the Node res as Uint8Array
    // chunks (see next/dist/server/pipe-readable), NOT Buffers/strings.
    const payload = JSON.stringify({ ok: true, source: 'app-router' });
    const enc = new TextEncoder();
    const result = await driveRequest({
      method: 'GET',
      path: '/api/webstream',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(enc.encode(payload.slice(0, 5)));
        res.write(enc.encode(payload.slice(5)));
        res.end();
      },
    });

    // Client received the intact body.
    expect(result.clientBody.toString('utf-8')).toBe(payload);

    const meta = expectMeta('GET', '/api/webstream');
    expect(meta.responseStatus).toBe(200);
    expect(meta.responseBody).toBe(payload);
  });

  it('captures a response body delivered as a single Uint8Array to res.end()', async () => {
    const payload = JSON.stringify({ done: true });
    const result = await driveRequest({
      method: 'GET',
      path: '/api/webstream-end',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(new TextEncoder().encode(payload));
      },
    });

    expect(result.clientBody.toString('utf-8')).toBe(payload);

    const meta = expectMeta('GET', '/api/webstream-end');
    expect(meta.responseBody).toBe(payload);
  });

  it('summarizes a gzip-compressed JSON response instead of capturing mojibake', async () => {
    const payload = JSON.stringify({ ok: true, items: [1, 2, 3] });
    const gz = zlib.gzipSync(Buffer.from(payload, 'utf-8'));
    const result = await driveRequest({
      method: 'GET',
      path: '/api/compressed',
      handler: (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        });
        res.end(gz);
      },
    });

    // Client received the real gzip bytes, untouched.
    expect(Buffer.compare(result.clientBody, gz)).toBe(0);

    const meta = expectMeta('GET', '/api/compressed');
    expect(meta.responseStatus).toBe(200);
    // The captured body must NOT be the raw gzip bytes decoded as UTF-8 (mojibake).
    expect(meta.responseBody).not.toContain(gz.toString('utf-8'));
    // It should be summarized as a compressed response.
    expect(meta.responseBody).toMatch(/compressed/i);
    expect(meta.responseBody).toContain('gzip');
    // And it must not contain the decoded plaintext either (we don't decompress).
    expect(meta.responseBody).not.toContain('items');
  });
});

describe('request body capture — App Router (Web Request) semantics', () => {
  it('captures a POST body consumed via async iteration (undici/Web Request), not on("data")', async () => {
    // App Router builds a Web Request whose body stream undici drains via
    // read()/async-iteration — it never registers a raw `req.on('data')`
    // listener. The capture must still observe the body bytes.
    const payload = JSON.stringify({ title: 'app-router-task' });
    const result = await driveRequest({
      method: 'POST',
      path: '/api/tasks',
      reqBody: payload,
      reqHeaders: { 'content-type': 'application/json' },
      handler: async (req, res) => {
        // Deliberately consume the body WITHOUT req.on('data'): iterate the
        // stream the way undici does for a Web Request body.
        let received = '';
        for await (const chunk of req) received += (chunk as Buffer).toString('utf-8');
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(new TextEncoder().encode(received));
      },
    });

    // The handler echoed the body it read, proving the client's bytes were
    // delivered intact and our capture didn't disturb the stream.
    expect(result.clientBody.toString('utf-8')).toBe(payload);

    const meta = expectMeta('POST', '/api/tasks');
    expect(meta.body).toBe(payload);
    expect(meta.responseBody).toBe(payload);
  });

  it('still captures a POST body consumed via on("data") (Pages Router / raw Node)', async () => {
    // Regression guard: the Pages Router path (raw Node req/res, body read via
    // 'data' events) must keep working unchanged.
    const payload = JSON.stringify({ title: 'pages-router-task' });
    const result = await driveRequest({
      method: 'POST',
      path: '/api/echo',
      reqBody: payload,
      reqHeaders: { 'content-type': 'application/json' },
      handler: (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(body);
        });
      },
    });

    expect(result.clientBody.toString('utf-8')).toBe(payload);

    const meta = expectMeta('POST', '/api/echo');
    expect(meta.body).toBe(payload);
    expect(meta.responseBody).toBe(payload);
  });

  it('captures the real Host header so URL reconstruction targets the right port (#78)', async () => {
    // The app can run on ANY port. The capture must record the actual authority
    // the client dialed (host:port) so downstream URL/Replay reconstruction does
    // not fall back to a hardcoded localhost:3000.
    await driveRequest({
      method: 'GET',
      path: '/api/whoami',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      },
    });

    const meta = expectMeta('GET', '/api/whoami');
    // driveRequest dials 127.0.0.1:<ephemeral-port>, so the Host header carries
    // that authority verbatim — NOT a hardcoded default.
    if (meta.host === undefined) throw new Error('expected captured request host');
    expect(meta.host).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  it('caps a large request body at the max size', async () => {
    const big = 'y'.repeat(20 * 1024); // 20KB > 16KB request cap
    const wrapped = JSON.stringify({ blob: big });
    await driveRequest({
      method: 'POST',
      path: '/api/big-body',
      reqBody: wrapped,
      reqHeaders: { 'content-type': 'application/json' },
      handler: async (req, res) => {
        // consume via async iteration
        for await (const _chunk of req) {
          /* drain */
        }
        res.writeHead(200);
        res.end('ok');
      },
    });

    const meta = expectMeta('POST', '/api/big-body');
    if (meta.body === undefined) throw new Error('expected captured request body');
    expect(meta.body.length).toBeLessThanOrEqual(16 * 1024);
    expect(meta.body.length).toBeGreaterThan(0);
  });
});
