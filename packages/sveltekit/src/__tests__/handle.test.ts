import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withNextDog } from '../index';

function makeEvent(method = 'GET', pathname = '/api/test', routeId: string | null = '/api/test') {
  return {
    request: new Request(`http://localhost${pathname}`, { method }),
    url: new URL(`http://localhost${pathname}`),
    route: { id: routeId },
  };
}

describe('withNextDog', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const handle = withNextDog();
    expect(typeof handle).toBe('function');
  });

  it('no-ops in production', async () => {
    process.env.NODE_ENV = 'production';
    const handle = withNextDog();
    const event = makeEvent();
    const mockResponse = new Response('ok', { status: 200 });
    const resolve = vi.fn().mockResolvedValue(mockResponse);

    const result = await handle({ event, resolve });

    expect(resolve).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });
});

describe('withNextDog — instrumented requests', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('creates spans with correct attributes', async () => {
    const mockSpan = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((_name: string, fn: (span: typeof mockSpan) => unknown) =>
        fn(mockSpan),
      ),
    };

    vi.doMock('@opentelemetry/api', () => ({
      trace: {
        getTracer: () => mockTracer,
        getActiveSpan: () => null,
        getSpan: () => null,
      },
      context: { active: () => ({}) },
      SpanStatusCode: { ERROR: 2 },
    }));

    vi.doMock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: vi.fn().mockImplementation(() => ({
        register: vi.fn(),
      })),
      BatchSpanProcessor: vi.fn(),
    }));

    vi.doMock('@opentelemetry/resources', () => ({
      Resource: vi.fn().mockImplementation(() => ({})),
    }));

    vi.doMock('@opentelemetry/semantic-conventions', () => ({
      ATTR_SERVICE_NAME: 'service.name',
    }));

    vi.doMock('@nextdog/node/exporter', () => ({
      NextDogExporter: vi.fn(),
    }));

    vi.doMock('@nextdog/node/sidecar', () => ({
      ensureSidecar: vi.fn().mockResolvedValue({ ready: true, foreignOccupant: false }),
    }));

    vi.doMock('@nextdog/node/console-patch', () => ({
      patchConsole: vi.fn(),
    }));

    vi.doMock('@nextdog/node/request-capture', () => ({
      startRequestCapture: vi.fn(),
    }));

    // Re-import to pick up mocks
    const { withNextDog: createHandle } = await import('../index');
    const handle = createHandle({ url: 'http://localhost:6789', serviceName: 'test-app' });

    const event = makeEvent('POST', '/api/data', '/api/data');
    const mockResponse = new Response('created', { status: 201 });
    const resolve = vi.fn().mockResolvedValue(mockResponse);

    const result = await handle({ event, resolve });

    expect(result).toBe(mockResponse);
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('POST /api/data', expect.any(Function));
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.method', 'POST');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.route', '/api/data');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.target', '/api/data');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 201);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('sets error status on 4xx/5xx responses', async () => {
    const mockSpan = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((_name: string, fn: (span: typeof mockSpan) => unknown) =>
        fn(mockSpan),
      ),
    };

    vi.doMock('@opentelemetry/api', () => ({
      trace: {
        getTracer: () => mockTracer,
        getActiveSpan: () => null,
        getSpan: () => null,
      },
      context: { active: () => ({}) },
      SpanStatusCode: { ERROR: 2 },
    }));

    vi.doMock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: vi.fn().mockImplementation(() => ({
        register: vi.fn(),
      })),
      BatchSpanProcessor: vi.fn(),
    }));

    vi.doMock('@opentelemetry/resources', () => ({
      Resource: vi.fn().mockImplementation(() => ({})),
    }));

    vi.doMock('@opentelemetry/semantic-conventions', () => ({
      ATTR_SERVICE_NAME: 'service.name',
    }));

    vi.doMock('@nextdog/node/exporter', () => ({
      NextDogExporter: vi.fn(),
    }));

    vi.doMock('@nextdog/node/sidecar', () => ({
      ensureSidecar: vi.fn().mockResolvedValue({ ready: true, foreignOccupant: false }),
    }));

    vi.doMock('@nextdog/node/console-patch', () => ({
      patchConsole: vi.fn(),
    }));

    vi.doMock('@nextdog/node/request-capture', () => ({
      startRequestCapture: vi.fn(),
    }));

    const { withNextDog: createHandle } = await import('../index');
    const handle = createHandle();

    const event = makeEvent('GET', '/api/missing');
    const mockResponse = new Response('not found', { status: 404 });
    const resolve = vi.fn().mockResolvedValue(mockResponse);

    await handle({ event, resolve });

    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('sets error status and rethrows on exceptions', async () => {
    const mockSpan = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((_name: string, fn: (span: typeof mockSpan) => unknown) =>
        fn(mockSpan),
      ),
    };

    vi.doMock('@opentelemetry/api', () => ({
      trace: {
        getTracer: () => mockTracer,
        getActiveSpan: () => null,
        getSpan: () => null,
      },
      context: { active: () => ({}) },
      SpanStatusCode: { ERROR: 2 },
    }));

    vi.doMock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: vi.fn().mockImplementation(() => ({
        register: vi.fn(),
      })),
      BatchSpanProcessor: vi.fn(),
    }));

    vi.doMock('@opentelemetry/resources', () => ({
      Resource: vi.fn().mockImplementation(() => ({})),
    }));

    vi.doMock('@opentelemetry/semantic-conventions', () => ({
      ATTR_SERVICE_NAME: 'service.name',
    }));

    vi.doMock('@nextdog/node/exporter', () => ({
      NextDogExporter: vi.fn(),
    }));

    vi.doMock('@nextdog/node/sidecar', () => ({
      ensureSidecar: vi.fn().mockResolvedValue({ ready: true, foreignOccupant: false }),
    }));

    vi.doMock('@nextdog/node/console-patch', () => ({
      patchConsole: vi.fn(),
    }));

    vi.doMock('@nextdog/node/request-capture', () => ({
      startRequestCapture: vi.fn(),
    }));

    const { withNextDog: createHandle } = await import('../index');
    const handle = createHandle();

    const event = makeEvent();
    const resolve = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(handle({ event, resolve })).rejects.toThrow('boom');
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2, message: 'boom' });
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
