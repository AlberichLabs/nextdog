import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cold-start init race regression (QA finding #4).
 *
 * The first request triggers an awaited setup (ensureSidecar → provider.register
 * → registerInstrumentations). Concurrent requests arriving during that window
 * must await the SAME in-flight init and only proceed AFTER setup completes —
 * never race past a flag flipped before setup finished.
 *
 * We deliberately do NOT mock @opentelemetry/api. The handler does a fresh
 * `await import('@opentelemetry/api')` on EVERY request, so two concurrent
 * first-window requests issue two concurrent dynamic imports of that specifier;
 * intercepting it with a mock races vitest's module layer and one import can slip
 * through to the real module (flaky). Instead we let the real tracer run and
 * assert the race-relevant invariant through a deterministic seam: ensureSidecar,
 * the FIRST awaited step of init, is held open by a gate. While that gate is
 * closed, init has not completed, so a correct handler — which parks every
 * concurrent request on the in-flight initPromise — must NOT let any request
 * reach the test-owned `resolve`. A buggy handler that merely flips a "started"
 * flag and proceeds without awaiting init would sail past and call `resolve`
 * while the gate is still closed, which this test rejects.
 */
describe('withNextDog — cold-start init race', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('concurrent first-window requests all await completed setup (no race past init)', async () => {
    const order: string[] = [];

    // ensureSidecar is the awaited slow step that holds init open. Two requests
    // both enter the init window concurrently while this gate is closed.
    let releaseSidecar!: () => void;
    const sidecarGate = new Promise<void>((res) => {
      releaseSidecar = res;
    });
    const ensureSidecar = vi.fn(async () => {
      await sidecarGate;
      order.push('ensureSidecar-resolved');
      return { ready: true, foreignOccupant: false };
    });

    const register = vi.fn(() => order.push('provider.register'));
    const registerInstrumentations = vi.fn(() => order.push('registerInstrumentations'));

    vi.doMock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: vi.fn().mockImplementation(() => ({ register })),
      BatchSpanProcessor: vi.fn(),
    }));
    vi.doMock('@opentelemetry/resources', () => ({
      Resource: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('@opentelemetry/semantic-conventions', () => ({ ATTR_SERVICE_NAME: 'service.name' }));
    vi.doMock('@nextdog/node/exporter', () => ({ NextDogExporter: vi.fn() }));
    vi.doMock('@nextdog/node/sidecar', () => ({ ensureSidecar }));
    vi.doMock('@nextdog/node/console-patch', () => ({ patchConsole: vi.fn() }));
    vi.doMock('@nextdog/node/request-capture', () => ({ startRequestCapture: vi.fn() }));
    vi.doMock('@nextdog/node/instrumentation', () => ({ registerInstrumentations }));

    const { withNextDog: createHandle } = await import('../index');
    const handle = createHandle({ url: 'http://localhost:6789', serviceName: 'test-app' });

    const mkEvent = (p: string) => ({
      request: new Request(`http://localhost${p}`, { method: 'GET' }),
      url: new URL(`http://localhost${p}`),
      route: { id: p },
    });
    // The real tracer's startActiveSpan runs resolve inside the active span, so
    // every request calls resolve exactly once. We record the route to prove BOTH
    // requests completed, and use ordering to prove they waited for setup.
    const resolve = vi.fn((ev: { route: { id: string } }) => {
      order.push(`resolve:${ev.route.id}`);
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    // Fire two requests concurrently inside the init window (sidecar still gated).
    const p1 = handle({ event: mkEvent('/a'), resolve });
    const p2 = handle({ event: mkEvent('/b'), resolve });

    // Flush the event loop GENEROUSLY (macrotasks too, so the handler's real
    // `import('@opentelemetry/api')` fully resolves) while init is held open at
    // ensureSidecar. A correct handler parks both requests on the in-flight
    // initPromise, so neither may have reached resolve. A handler that raced past
    // init (the regression) would proceed straight to startActiveSpan → resolve
    // here, despite setup being unfinished → caught by the assertions below.
    const flushEventLoop = async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 0));
        for (let j = 0; j < 10; j++) await Promise.resolve();
      }
    };
    await flushEventLoop();
    expect(register).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();

    // Complete init; now both parked requests may proceed.
    releaseSidecar();
    await Promise.all([p1, p2]);

    // Setup ran exactly once despite two concurrent first-window requests.
    expect(ensureSidecar).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(registerInstrumentations).toHaveBeenCalledTimes(1);

    // Both requests proceeded exactly once each — neither dropped nor doubled.
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(order).toContain('resolve:/a');
    expect(order).toContain('resolve:/b');

    // And BOTH only proceeded AFTER the full setup completed.
    const firstResolveIdx = order.findIndex((o) => o.startsWith('resolve:'));
    expect(order.indexOf('ensureSidecar-resolved')).toBeLessThan(firstResolveIdx);
    expect(order.indexOf('provider.register')).toBeLessThan(firstResolveIdx);
    expect(order.indexOf('registerInstrumentations')).toBeLessThan(firstResolveIdx);
  });
});
