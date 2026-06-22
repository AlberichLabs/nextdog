import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cold-start init race regression (QA finding #4).
 *
 * The first request triggers an awaited setup (ensureSidecar → provider.register
 * → registerInstrumentations). Concurrent requests arriving during that window
 * must await the SAME in-flight init and only start their span AFTER setup
 * completes — never race past a flag flipped before setup finished.
 *
 * Isolated in its own file so the vi.doMock graph (esp. @opentelemetry/api,
 * which the handler imports dynamically per request) cannot leak between tests.
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

    // ensureSidecar is the awaited, slow step. We hold it open with a deferred
    // promise so two requests can both enter the init window concurrently.
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

    const mockTracer = {
      startActiveSpan: vi.fn((name: string, fn: (span: unknown) => unknown) => {
        order.push(`startActiveSpan:${name}`);
        const span = { setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
        return fn(span);
      }),
    };

    vi.doMock('@opentelemetry/api', () => ({
      trace: { getTracer: () => mockTracer, getActiveSpan: () => null, getSpan: () => null },
      context: { active: () => ({}) },
      SpanStatusCode: { ERROR: 2 },
    }));
    vi.doMock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: vi.fn().mockImplementation(() => ({ register })),
      BatchSpanProcessor: vi.fn(),
    }));
    vi.doMock('@opentelemetry/resources', () => ({ Resource: vi.fn().mockImplementation(() => ({})) }));
    vi.doMock('@opentelemetry/semantic-conventions', () => ({ ATTR_SERVICE_NAME: 'service.name' }));
    vi.doMock('@nextdog/node/exporter', () => ({ NextDogExporter: vi.fn() }));
    vi.doMock('@nextdog/node/sidecar', () => ({ ensureSidecar }));
    vi.doMock('@nextdog/node/console-patch', () => ({ patchConsole: vi.fn() }));
    vi.doMock('@nextdog/node/request-capture', () => ({ startRequestCapture: vi.fn() }));
    vi.doMock('@nextdog/node/instrumentation', () => ({ registerInstrumentations }));

    const { withNextDog: createHandle } = await import('../index.js');
    const handle = createHandle({ url: 'http://localhost:6789', serviceName: 'test-app' });

    const mkEvent = (p: string) => ({
      request: new Request(`http://localhost${p}`, { method: 'GET' }),
      url: new URL(`http://localhost${p}`),
      route: { id: p },
    });
    const resolve = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    // Fire two requests concurrently inside the init window (sidecar still gated).
    const p1 = handle({ event: mkEvent('/a'), resolve });
    const p2 = handle({ event: mkEvent('/b'), resolve });

    // Give microtasks a chance to run; neither request should have started a
    // span yet because setup has not completed (sidecar gate is still closed).
    await Promise.resolve();
    await Promise.resolve();
    expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();

    releaseSidecar();
    await Promise.all([p1, p2]);

    // Setup must run exactly once despite two concurrent first-window requests.
    expect(ensureSidecar).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(registerInstrumentations).toHaveBeenCalledTimes(1);

    // Both spans started, and BOTH only after setup completed.
    expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(2);
    const firstSpanIdx = order.findIndex((o) => o.startsWith('startActiveSpan:'));
    expect(order.indexOf('ensureSidecar-resolved')).toBeLessThan(firstSpanIdx);
    expect(order.indexOf('provider.register')).toBeLessThan(firstSpanIdx);
    expect(order.indexOf('registerInstrumentations')).toBeLessThan(firstSpanIdx);
  });
});
