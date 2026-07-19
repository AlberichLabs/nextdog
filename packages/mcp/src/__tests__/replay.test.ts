import { describe, expect, it, vi } from 'vitest';
import { SidecarClient, SidecarUnavailableError } from '../client';
import { replayRequest } from '../tools';

/**
 * A fake fetch that serves POST /api/replay, mirroring the sidecar's three modes
 * (`packages/core/src/server.ts:427`). The captured span carries credential
 * headers verbatim (store-but-don't-egress, #60) so the credential-strip on the
 * `prepareOnly` echo can be proven.
 */
function makeReplayFetch(): { fetchImpl: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    if (u.pathname !== '/api/replay' || init?.method !== 'POST') {
      return jsonResponse({ error: 'not found' }, 404);
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      spanId?: string;
      prepareOnly?: boolean;
      request?: Record<string, unknown>;
    };
    bodies.push(body);

    // Mode 1 — edited replay: send exactly what was supplied.
    if (body.request !== undefined) {
      return jsonResponse({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
        duration: 12,
        url: String(body.request.url),
        method: String(body.request.method ?? 'GET'),
      });
    }

    if (body.spanId !== 'web-checkout-root') {
      return jsonResponse({ error: 'span not found' }, 404);
    }

    // The reconstructed request the sidecar hands back — WITH captured creds.
    const prepared = {
      method: 'POST',
      url: 'http://localhost:3000/api/checkout',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer super-secret-token',
        cookie: 'session=abc123',
        'x-api-key': 'sk_live_leak',
      },
      body: '{"item":"sku_1"}',
    };

    // Mode 2 — prepareOnly: hand back the reconstructed request, do not send.
    if (body.prepareOnly === true) {
      return jsonResponse(prepared);
    }

    // Mode 3 — one-click replay: send and return the live response.
    return jsonResponse({
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json', 'set-cookie': 'session=refreshed' },
      body: '{"error":"boom"}',
      duration: 34,
      url: prepared.url,
      method: prepared.method,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('replay_request', () => {
  it('one-click replay (spanId only) returns the live response', async () => {
    const { fetchImpl, bodies } = makeReplayFetch();
    const client = new SidecarClient({ fetchImpl });
    const res = (await replayRequest(client, { spanId: 'web-checkout-root' })) as {
      status: number;
      body: string;
    };
    expect(res.status).toBe(500);
    expect(res.body).toBe('{"error":"boom"}');
    // The sidecar received the one-click payload verbatim.
    expect(bodies[0]).toEqual({ spanId: 'web-checkout-root' });
  });

  it('edited replay (request) sends exactly what was supplied', async () => {
    const { fetchImpl, bodies } = makeReplayFetch();
    const client = new SidecarClient({ fetchImpl });
    const res = (await replayRequest(client, {
      request: { method: 'POST', url: 'http://localhost:3000/api/checkout', body: '{"item":"x"}' },
    })) as { status: number; method: string };
    expect(res.status).toBe(200);
    expect(res.method).toBe('POST');
    expect((bodies[0] as { request: unknown }).request).toBeDefined();
  });

  it('prepareOnly returns the reconstructed request but strips credential headers (#60)', async () => {
    const { fetchImpl } = makeReplayFetch();
    const client = new SidecarClient({ fetchImpl });
    const res = (await replayRequest(client, {
      spanId: 'web-checkout-root',
      prepareOnly: true,
    })) as { method: string; url: string; headers: Record<string, string>; body: string };

    expect(res.method).toBe('POST');
    expect(res.url).toBe('http://localhost:3000/api/checkout');
    expect(res.body).toBe('{"item":"sku_1"}');
    // Non-credential headers survive...
    expect(res.headers['content-type']).toBe('application/json');
    // ...credential headers must NOT egress to the agent.
    expect(res.headers.authorization).toBeUndefined();
    expect(res.headers.cookie).toBeUndefined();
    expect(res.headers['x-api-key']).toBeUndefined();
    // And nothing anywhere in the serialized output leaks the token.
    expect(JSON.stringify(res)).not.toContain('super-secret-token');
    expect(JSON.stringify(res)).not.toContain('sk_live_leak');
  });

  it('sidecar-down surfaces SidecarUnavailableError (clean tool error, no crash)', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const client = new SidecarClient({ baseUrl: 'http://localhost:6789', fetchImpl });
    await expect(replayRequest(client, { spanId: 'web-checkout-root' })).rejects.toBeInstanceOf(
      SidecarUnavailableError,
    );
  });
});

describe('SidecarClient.postJson / replay', () => {
  it('POSTs the payload as JSON to /api/replay', async () => {
    const { fetchImpl, bodies } = makeReplayFetch();
    const spy = vi.fn(fetchImpl);
    const client = new SidecarClient({ fetchImpl: spy as unknown as typeof fetch });
    await client.replay({ spanId: 'web-checkout-root', prepareOnly: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:6789/api/replay');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(bodies[0]).toEqual({ spanId: 'web-checkout-root', prepareOnly: true });
  });

  it('passes an abortable timeout signal', async () => {
    const { fetchImpl } = makeReplayFetch();
    const spy = vi.fn(fetchImpl);
    const client = new SidecarClient({ timeoutMs: 999, fetchImpl: spy as unknown as typeof fetch });
    await client.replay({ spanId: 'web-checkout-root', prepareOnly: true });
    const init = spy.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws SidecarUnavailableError on a non-2xx replay response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'span not found' }),
    }) as unknown as typeof fetch;
    const client = new SidecarClient({ fetchImpl });
    await expect(client.replay({ spanId: 'nope' })).rejects.toBeInstanceOf(SidecarUnavailableError);
  });
});
