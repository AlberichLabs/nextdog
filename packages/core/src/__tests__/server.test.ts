import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as httpCreateServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEXTDOG_HEALTH_MARKER } from '../health';
import { createServer } from '../server';

describe('Server', () => {
  let server: Server;
  const port = 16789; // test port

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
    // other process that happens to answer 2xx on :6789 (issue #17). The value
    // comes from the shared constant so producer and consumer cannot drift.
    expect(data.service).toBe(NEXTDOG_HEALTH_MARKER);
  });

  it('POST /v1/spans ingests spans and returns 202', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });

    const spans = [
      {
        traceId: 'trace-1',
        spanId: 'span-1',
        name: 'GET /test',
        kind: 'SERVER',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '1050000000',
        attributes: {},
        status: { code: 'OK' },
        serviceName: 'test-app',
      },
    ];

    const res = await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spans }),
    });
    expect(res.status).toBe(202);
  });

  it('POST /v1/spans with malformed JSON returns 400, not a 500/crash', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(typeof data.error).toBe('string');
  });

  it('POST /v1/spans with a non-object body (JSON array) returns 400', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/spans with an empty body returns 400', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/logs with malformed JSON returns 400, not a 500/crash', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'definitely-not-json',
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/logs with a valid body still returns 202 (unchanged happy path)', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logs: [
          {
            type: 'log',
            timestamp: 1,
            data: { timestamp: 1, level: 'info', message: 'hi', attributes: {}, serviceName: 'a' },
          },
        ],
      }),
    });
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.accepted).toBe(1);
  });

  it('POST /api/replay with malformed JSON returns 400, not a 500/crash', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "spanId": ',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/replay with a valid body but missing spanId returns 400 (unchanged)', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('spanId');
  });

  it('GET /api/services returns list of known services', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });

    // Ingest a span first
    await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spans: [
          {
            traceId: 't1',
            spanId: 's1',
            name: 'test',
            kind: 'SERVER',
            startTimeUnixNano: '1000',
            endTimeUnixNano: '2000',
            attributes: {},
            status: { code: 'OK' },
            serviceName: 'my-service',
          },
        ],
      }),
    });

    const res = await fetch(`http://localhost:${port}/api/services`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.services).toContain('my-service');
  });

  it('handles CORS preflight', async () => {
    server = await createServer({ port, dataDir: '/tmp/nextdog-test-server' });
    const res = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
    }>((resolve) => {
      const req = httpRequest(`http://localhost:${port}/v1/spans`, { method: 'OPTIONS' }, (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
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

describe('Server rehydration from FileStore on boot', () => {
  let server: Server;
  let dataDir: string;
  const port = 16791;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nextdog-rehydrate-'));
    // Simulate a prior sidecar run: NDJSON already on disk (spans + logs, multiple services).
    const lines = [
      JSON.stringify({
        type: 'span',
        timestamp: 1,
        data: {
          traceId: 't1',
          spanId: 's1',
          name: 'GET /a',
          kind: 'SERVER',
          startTimeUnixNano: '1000n',
          endTimeUnixNano: '2000n',
          attributes: {},
          status: { code: 'OK' },
          serviceName: 'web-app',
        },
      }),
      JSON.stringify({
        type: 'span',
        timestamp: 2,
        data: {
          traceId: 't2',
          spanId: 's2',
          name: 'GET /b',
          kind: 'SERVER',
          startTimeUnixNano: '3000n',
          endTimeUnixNano: '4000n',
          attributes: {},
          status: { code: 'OK' },
          serviceName: 'api-worker',
        },
      }),
      JSON.stringify({
        type: 'log',
        timestamp: 3,
        data: {
          timestamp: 3,
          level: 'info',
          message: 'hello from disk',
          attributes: {},
          serviceName: 'web-app',
        },
      }),
    ];
    // Use an hourly filename the FileStore would recognize.
    const now = new Date();
    const fn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}.ndjson`;
    await writeFile(join(dataDir, fn), `${lines.join('\n')}\n`);
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  it('seeds /api/services from persisted events on startup (issue #16)', async () => {
    server = await createServer({ port, dataDir });
    const res = await fetch(`http://localhost:${port}/api/services`);
    const data = await res.json();
    expect(data.services.sort()).toEqual(['api-worker', 'web-app']);
  });

  it('GET /api/events returns spans AND logs from history (issue #8)', async () => {
    server = await createServer({ port, dataDir });
    const res = await fetch(`http://localhost:${port}/api/events`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const types = (data.events as { type: string }[]).map((e) => e.type).sort();
    expect(types).toEqual(['log', 'span', 'span']);
    const log = (data.events as { type: string; data: { message?: string } }[]).find(
      (e) => e.type === 'log',
    );
    expect(log?.data.message).toBe('hello from disk');
  });

  it('GET /api/events?type=log returns only logs', async () => {
    server = await createServer({ port, dataDir });
    const res = await fetch(`http://localhost:${port}/api/events?type=log`);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].type).toBe('log');
  });

  it('GET /api/events?since= returns only newer events (live catch-up)', async () => {
    server = await createServer({ port, dataDir });
    const res = await fetch(`http://localhost:${port}/api/events?since=2`);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].timestamp).toBe(3);
  });

  it('GET /api/events?before= returns only older events (load-older paging)', async () => {
    server = await createServer({ port, dataDir });
    const res = await fetch(`http://localhost:${port}/api/events?before=3`);
    const data = await res.json();
    expect(data.events.map((e: { timestamp: number }) => e.timestamp)).toEqual([1, 2]);
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
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

describe('Server replay — editable headers for auth (#60)', () => {
  let server: Server;
  let target: Server;
  let targetPort: number;
  let dataDir: string;
  const port = 16792;

  // A target endpoint that requires Authorization: 200 with the right bearer
  // token, 401 without it. Stands in for an authed app route (e.g. PUT
  // /api/questions/[id]). It echoes the request body so we can assert the edited
  // body round-trips too.
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nextdog-replay-'));
    target = httpCreateServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        if (req.headers.authorization === 'Bearer s3cret-token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, echoedBody: body }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
        }
      });
    });
    await new Promise<void>((resolve) => target.listen(0, () => resolve()));
    targetPort = (target.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (target) await new Promise<void>((resolve) => target.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  // Seed a captured SERVER span pointing at the target. By default NO
  // authorization header is present (an unauthenticated capture). Pass an
  // `authorization` to simulate the store-but-don't-egress posture (#60), where
  // the token is captured verbatim and available to one-click Replay.
  async function seedSpan(authorization?: string) {
    await fetch(`http://localhost:${port}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spans: [
          {
            traceId: 't-auth',
            spanId: 'span-auth',
            name: 'PUT /api/questions/123',
            kind: 'SERVER',
            startTimeUnixNano: '1000',
            endTimeUnixNano: '2000',
            attributes: {
              'http.method': 'PUT',
              'http.target': '/api/questions/123',
              'http.host': `localhost:${targetPort}`,
              'http.scheme': 'http',
              'http.request.header.content-type': 'application/json',
              ...(authorization ? { 'http.request.header.authorization': authorization } : {}),
              'http.request.body': '{"title":"updated"}',
            },
            status: { code: 'OK' },
            serviceName: 'app',
          },
        ],
      }),
    });
  }

  it('prepareOnly returns the reconstructed request (no auth header) without sending it', async () => {
    server = await createServer({ port, dataDir });
    await seedSpan();

    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spanId: 'span-auth', prepareOnly: true }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.method).toBe('PUT');
    expect(data.url).toBe(`http://localhost:${targetPort}/api/questions/123`);
    expect(data.body).toBe('{"title":"updated"}');
    expect(data.headers['content-type']).toBe('application/json');
    // Auth was stripped at capture — the prefill must not invent one.
    expect(data.headers.authorization).toBeUndefined();
    // It was NOT sent: no response status comes back.
    expect(data.status).toBeUndefined();
  });

  it('one-click replay (no auth) still reaches the endpoint — returns its 401', async () => {
    server = await createServer({ port, dataDir });
    await seedSpan();

    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spanId: 'span-auth' }),
    });

    expect(res.status).toBe(200); // the replay itself succeeded
    const data = await res.json();
    expect(data.status).toBe(401); // endpoint rejected — this capture had no token
  });

  it('one-click replay re-sends the captured token and authenticates (200) (#60)', async () => {
    server = await createServer({ port, dataDir });
    await seedSpan('Bearer s3cret-token'); // token captured verbatim, store-but-dont-egress

    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spanId: 'span-auth' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    // The stored token reached the endpoint server-side → authenticated.
    expect(data.status).toBe(200);
    expect(JSON.parse(data.body).ok).toBe(true);
  });

  it('prepareOnly pre-fills the captured Authorization for override (#60)', async () => {
    server = await createServer({ port, dataDir });
    await seedSpan('Bearer s3cret-token');

    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spanId: 'span-auth', prepareOnly: true }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    // Editor pre-fills the captured token so an expired one can be overridden.
    expect(data.headers.authorization).toBe('Bearer s3cret-token');
    expect(data.status).toBeUndefined(); // not sent
  });

  it('edited replay with a pasted Authorization header reaches the endpoint authenticated (200)', async () => {
    server = await createServer({ port, dataDir });
    await seedSpan();

    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          method: 'PUT',
          url: `http://localhost:${targetPort}/api/questions/123`,
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer s3cret-token',
          },
          body: '{"title":"updated"}',
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe(200); // authenticated — the pasted token reached the endpoint
    const echoed = JSON.parse(data.body);
    expect(echoed.ok).toBe(true);
    expect(echoed.echoedBody).toBe('{"title":"updated"}');
  });

  it('never persists a pasted Authorization token to disk', async () => {
    server = await createServer({ port, dataDir });
    await seedSpan();

    await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          method: 'PUT',
          url: `http://localhost:${targetPort}/api/questions/123`,
          headers: { authorization: 'Bearer s3cret-token' },
        },
      }),
    });

    // Scan everything the sidecar has on disk: the token must appear nowhere.
    const files = await readdir(dataDir).catch(() => [] as string[]);
    for (const f of files) {
      const content = await readFile(join(dataDir, f), 'utf8');
      expect(content).not.toContain('s3cret-token');
    }
  });

  it('rejects an edited request with no url', async () => {
    server = await createServer({ port, dataDir });

    const res = await fetch(`http://localhost:${port}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: { method: 'GET' } }),
    });

    expect(res.status).toBe(400);
  });
});
