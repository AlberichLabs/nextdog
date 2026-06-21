import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer } from '../server.js';
import { request as httpRequest, type Server } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Server', () => {
  let server: Server;
  const port = 16789; // test port

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('GET /health returns 200 with status', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('GET /health carries a NextDog identifying signature', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json();
    // A stable marker so clients can tell a real NextDog sidecar apart from any
    // other process that happens to answer 2xx on :6789 (issue #17).
    expect(data.service).toBe('nextdog');
  });

  it('POST /v1/spans ingests spans and returns 202', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });

    const spans = [{
      traceId: 'trace-1',
      spanId: 'span-1',
      name: 'GET /test',
      kind: 'SERVER',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1050000000',
      attributes: {},
      status: { code: 'OK' },
      serviceName: 'test-app',
    }];

    const res = await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spans }),
    });
    expect(res.status).toBe(202);
  });

  it('GET /api/services returns list of known services', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });

    // Ingest a span first
    await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spans: [{
          traceId: 't1', spanId: 's1', name: 'test', kind: 'SERVER',
          startTimeUnixNano: '1000', endTimeUnixNano: '2000',
          attributes: {}, status: { code: 'OK' }, serviceName: 'my-service',
        }],
      }),
    });

    const res = await fetch(`http://localhost:${port}/api/services`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.services).toContain('my-service');
  });

  it('handles CORS preflight', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>(resolve => {
      const req = httpRequest(`http://localhost:${port}/v1/spans`, { method: 'OPTIONS' }, (res) => {
        resolve({ status: res.statusCode!, headers: res.headers });
      });
      req.end();
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('returns 404 for unknown API routes', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/api/unknown`);
    expect(res.status).toBe(404);
  });
});

describe('Server static files', () => {
  let server: Server;
  let tmpDir: string;
  const port = 16790;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nextdog-ui-'));
    await mkdir(join(tmpDir, 'assets'), { recursive: true });
    await writeFile(join(tmpDir, 'index.html'), '<html><body>NextDog</body></html>');
    await writeFile(join(tmpDir, 'assets', 'app.js'), 'console.log("app")');
    await writeFile(join(tmpDir, 'assets', 'style.css'), 'body { margin: 0 }');
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('serves static files with correct content-type', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-static', uiDir: tmpDir });

    const jsRes = await fetch(`http://localhost:${port}/assets/app.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('javascript');
    expect(await jsRes.text()).toBe('console.log("app")');

    const cssRes = await fetch(`http://localhost:${port}/assets/style.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('css');
    expect(await cssRes.text()).toBe('body { margin: 0 }');
  });

  it('SPA fallback serves index.html for unknown paths', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-static', uiDir: tmpDir });

    const res = await fetch(`http://localhost:${port}/requests`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('html');
    expect(await res.text()).toBe('<html><body>NextDog</body></html>');
  });

  it('returns 404 for unknown API routes', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-static', uiDir: tmpDir });

    const res = await fetch(`http://localhost:${port}/api/unknown`);
    expect(res.status).toBe(404);
  });
});
