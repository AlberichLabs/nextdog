import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextDogExporter } from '../exporter';
import { startRequestCapture } from '../request-capture';

const mockFetch = vi.fn();

function makeServerSpan(method: string, target: string) {
  return {
    name: `${method} ${target}`,
    spanContext: () => ({ traceId: 'rt1', spanId: 'rs1', traceFlags: 1 }),
    parentSpanId: undefined,
    kind: 1, // SERVER
    startTime: [1711000000, 0] as [number, number],
    endTime: [1711000000, 50000000] as [number, number],
    attributes: { 'http.method': method, 'http.target': target },
    status: { code: 0 },
    resource: { attributes: { 'service.name': 'my-app' } },
    duration: [0, 50000000] as [number, number],
    events: [],
    links: [],
    instrumentationLibrary: { name: 'test' },
    ended: true,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe('NextDogExporter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true, status: 202 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports spans by POSTing to sidecar', async () => {
    const exporter = new NextDogExporter('http://localhost:6789');

    const mockSpan = {
      name: 'GET /api/users',
      spanContext: () => ({ traceId: 'abc123', spanId: 'def456', traceFlags: 1 }),
      parentSpanId: undefined,
      kind: 1,
      startTime: [1711000000, 0] as [number, number],
      endTime: [1711000000, 50000000] as [number, number],
      attributes: { 'http.method': 'GET' },
      status: { code: 0 },
      resource: { attributes: { 'service.name': 'my-app' } },
      duration: [0, 50000000] as [number, number],
      events: [],
      links: [],
      instrumentationLibrary: { name: 'test' },
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };

    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export([mockSpan as any], (result) => resolve(result));
    });

    expect(result.code).toBe(0);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:6789/v1/spans');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0].traceId).toBe('abc123');
    expect(body.spans[0].name).toBe('GET /api/users');
    expect(body.spans[0].serviceName).toBe('my-app');
  });

  it('handles export failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const exporter = new NextDogExporter('http://localhost:6789');

    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export(
        [
          {
            name: 'test',
            spanContext: () => ({ traceId: 't1', spanId: 's1', traceFlags: 1 }),
            parentSpanId: undefined,
            kind: 0,
            startTime: [0, 0] as [number, number],
            endTime: [0, 0] as [number, number],
            attributes: {},
            status: { code: 0 },
            resource: { attributes: {} },
            duration: [0, 0] as [number, number],
            events: [],
            links: [],
            instrumentationLibrary: { name: 'test' },
            ended: true,
            droppedAttributesCount: 0,
            droppedEventsCount: 0,
            droppedLinksCount: 0,
          } as any,
        ],
        (result) => resolve(result),
      );
    });

    expect(result.code).toBe(1);
  });

  it('shutdown resolves cleanly', async () => {
    const exporter = new NextDogExporter('http://localhost:6789');
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });

  it("drops the exporter's own outbound POST to the sidecar but forwards real outbound spans", async () => {
    // Now that nextdog wraps global fetch (outbound-HTTP instrumentation), the
    // exporter\'s own POST to /v1/spans produces a CLIENT span. It MUST be
    // filtered out (by sidecar URL) to avoid a feedback loop, while genuine
    // outbound calls to other hosts must still be forwarded.
    const exporter = new NextDogExporter('http://localhost:6789');

    const mkSpan = (httpUrl: string) => ({
      name: `POST ${httpUrl}`,
      spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
      parentSpanId: 'parent1',
      kind: 2, // CLIENT
      startTime: [0, 0] as [number, number],
      endTime: [0, 1000] as [number, number],
      attributes: { 'http.url': httpUrl, 'http.method': 'POST', 'http.status_code': 200 },
      status: { code: 0 },
      resource: { attributes: { 'service.name': 'app' } },
      duration: [0, 1000] as [number, number],
      events: [],
      links: [],
      instrumentationLibrary: { name: 'test' },
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    });

    await new Promise<{ code: number }>((resolve) => {
      exporter.export(
        [
          mkSpan('http://localhost:6789/v1/spans'), // self → drop
          mkSpan('https://api.stripe.com/v1/charges'), // real outbound → keep
        ] as any,
        resolve,
      );
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0].attributes['http.url']).toBe('https://api.stripe.com/v1/charges');
    // Parent linkage is preserved end-to-end through the exporter.
    expect(body.spans[0].parentSpanId).toBe('parent1');
    expect(body.spans[0].statusCode).toBe(200);
  });

  it('does NOT drop a user fetch to the sidecar host on a different path', async () => {
    // Same host:port as the sidecar but NOT the exporter's own target path.
    // This is a legitimate user request and must be forwarded.
    const exporter = new NextDogExporter('http://localhost:6789');

    const mkSpan = (httpUrl: string) => ({
      name: `GET ${httpUrl}`,
      spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
      parentSpanId: 'parent1',
      kind: 2,
      startTime: [0, 0] as [number, number],
      endTime: [0, 1000] as [number, number],
      attributes: { 'http.url': httpUrl, 'http.method': 'GET', 'http.status_code': 200 },
      status: { code: 0 },
      resource: { attributes: { 'service.name': 'app' } },
      duration: [0, 1000] as [number, number],
      events: [],
      links: [],
      instrumentationLibrary: { name: 'test' },
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    });

    await new Promise<{ code: number }>((resolve) => {
      exporter.export([mkSpan('http://localhost:6789/api/foo')] as any, resolve);
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0].attributes['http.url']).toBe('http://localhost:6789/api/foo');
  });

  it('does NOT drop a user fetch to a textual-prefix-sibling port (:6789x)', async () => {
    // "http://localhost:67890/...".startsWith("http://localhost:6789") is true,
    // so a naive prefix check false-drops apps on port 6789x. Must be forwarded.
    const exporter = new NextDogExporter('http://localhost:6789');

    const mkSpan = (httpUrl: string) => ({
      name: `GET ${httpUrl}`,
      spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
      parentSpanId: 'parent1',
      kind: 2,
      startTime: [0, 0] as [number, number],
      endTime: [0, 1000] as [number, number],
      attributes: { 'http.url': httpUrl, 'http.method': 'GET', 'http.status_code': 200 },
      status: { code: 0 },
      resource: { attributes: { 'service.name': 'app' } },
      duration: [0, 1000] as [number, number],
      events: [],
      links: [],
      instrumentationLibrary: { name: 'test' },
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    });

    await new Promise<{ code: number }>((resolve) => {
      exporter.export([mkSpan('http://localhost:67890/v1/data')] as any, resolve);
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0].attributes['http.url']).toBe('http://localhost:67890/v1/data');
  });

  it('enriches SERVER spans with the captured response status, headers, and body', async () => {
    startRequestCapture();

    // Drive a real request so the capture store records the original response.
    const payload = JSON.stringify({ hello: 'world' });
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };

    await new Promise<void>((resolve, reject) => {
      http
        .request({ host: '127.0.0.1', port, method: 'POST', path: '/api/echo' }, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        })
        .on('error', reject)
        .end('{"q":1}');
    });
    await new Promise<void>((r) => server.close(() => r()));

    const exporter = new NextDogExporter('http://localhost:6789');
    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export([makeServerSpan('POST', '/api/echo') as any], (r) => resolve(r));
    });
    expect(result.code).toBe(0);

    const lastCall = mockFetch.mock.calls.at(-1);
    if (!lastCall) throw new Error('expected at least one fetch call');
    const body = JSON.parse(lastCall[1].body);
    const attrs = body.spans[0].attributes;
    expect(attrs['http.response.status']).toBe(200);
    expect(attrs['http.response.body']).toBe(payload);
    expect(attrs['http.response.header.content-type']).toContain('application/json');
  });

  // store-but-don't-egress (issue #60): credential headers are captured RAW so
  // one-click Replay can re-authenticate. They are redacted at export/MCP, not
  // at capture. The sidecar + dashboard are localhost, so this is not egress.
  it('captures Set-Cookie verbatim on the span (store-but-dont-egress)', async () => {
    startRequestCapture();

    const secret = 'sid=SUPER_SECRET_SESSION; Path=/; HttpOnly';
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': secret,
        'X-Safe': 'visible',
      });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };

    await new Promise<void>((resolve, reject) => {
      http
        .request({ host: '127.0.0.1', port, method: 'GET', path: '/api/login' }, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        })
        .on('error', reject)
        .end();
    });
    await new Promise<void>((r) => server.close(() => r()));

    const exporter = new NextDogExporter('http://localhost:6789');
    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export([makeServerSpan('GET', '/api/login') as any], (r) => resolve(r));
    });
    expect(result.code).toBe(0);

    const lastCall = mockFetch.mock.calls.at(-1);
    if (!lastCall) throw new Error('expected at least one fetch call');
    const body = JSON.parse(lastCall[1].body);
    const attrs = body.spans[0].attributes;
    // Set-Cookie is now STORED raw (redaction happens at the egress boundary).
    expect(attrs['http.response.header.set-cookie']).toBe(secret);
    // Non-sensitive response headers flow through unchanged.
    expect(attrs['http.response.header.x-safe']).toBe('visible');
  });

  it('captures request credential headers verbatim so Replay can re-auth (#60)', async () => {
    startRequestCapture();

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };

    await new Promise<void>((resolve, reject) => {
      http
        .request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: '/api/secure',
            headers: {
              Authorization: 'Bearer s3cret-token',
              'X-Api-Key': 'key-123',
            },
          },
          (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
          },
        )
        .on('error', reject)
        .end();
    });
    await new Promise<void>((r) => server.close(() => r()));

    const exporter = new NextDogExporter('http://localhost:6789');
    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export([makeServerSpan('GET', '/api/secure') as any], (r) => resolve(r));
    });
    expect(result.code).toBe(0);

    const lastCall = mockFetch.mock.calls.at(-1);
    if (!lastCall) throw new Error('expected at least one fetch call');
    const body = JSON.parse(lastCall[1].body);
    const attrs = body.spans[0].attributes;
    // Tokens are kept verbatim on disk so Replay re-authenticates.
    expect(attrs['http.request.header.authorization']).toBe('Bearer s3cret-token');
    expect(attrs['http.request.header.x-api-key']).toBe('key-123');
  });
});
