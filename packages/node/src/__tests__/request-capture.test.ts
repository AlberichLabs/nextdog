import { describe, it, expect, beforeAll } from 'vitest';
import * as http from 'node:http';
import { startRequestCapture, getRequestMetadata } from '../request-capture.js';

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
            })
          );
        }
      );
      req.on('error', reject);
      if (opts.reqBody) req.write(opts.reqBody);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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

    const meta = getRequestMetadata('GET', '/api/users');
    expect(meta).toBeDefined();
    expect(meta!.responseStatus).toBe(201);
    expect(meta!.responseBody).toBe(payload);
    expect(meta!.responseHeaders?.['content-type']).toContain('application/json');
    expect(meta!.responseHeaders?.['x-custom']).toBe('hi');
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

    const meta = getRequestMetadata('GET', '/api/stream');
    expect(meta!.responseBody).toBe('hello world!');
    expect(meta!.responseStatus).toBe(200);
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

    const meta = getRequestMetadata('GET', '/api/big');
    // Captured copy is capped.
    expect(meta!.responseBody!.length).toBeLessThan(big.length);
    expect(meta!.responseBody).toContain('(truncated)');
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

    const meta = getRequestMetadata('GET', '/api/image');
    expect(meta!.responseStatus).toBe(200);
    expect(meta!.responseHeaders?.['content-type']).toBe('image/png');
    // Body is summarized, not the raw bytes.
    expect(meta!.responseBody).toMatch(/binary/i);
    expect(meta!.responseBody).toContain('image/png');
  });
});
