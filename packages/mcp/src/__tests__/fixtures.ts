import type { SidecarEvent } from '../types';

/**
 * A small multi-service fixture: one healthy GET trace on `web`, one failing
 * POST /api/checkout trace spanning `web` -> `payments` with an error span and a
 * correlated error log, plus a couple of standalone logs.
 */

export const TRACE_OK = 'trace-ok-0001';
export const TRACE_ERR = 'trace-err-0002';

function nano(ms: number): string {
  return `${BigInt(ms) * 1_000_000n}n`;
}

export const spanWebOk: SidecarEvent = {
  type: 'span',
  timestamp: 1000,
  data: {
    traceId: TRACE_OK,
    spanId: 'web-ok-root',
    name: 'GET /api/health',
    kind: 'SERVER',
    startTimeUnixNano: nano(1000),
    endTimeUnixNano: nano(1012),
    serviceName: 'web',
    status: { code: 'OK' },
    statusCode: 200,
    attributes: { 'http.route': '/api/health', 'http.method': 'GET', 'http.status_code': 200 },
  },
};

export const spanWebCheckoutRoot: SidecarEvent = {
  type: 'span',
  timestamp: 2000,
  data: {
    traceId: TRACE_ERR,
    spanId: 'web-checkout-root',
    name: 'POST /api/checkout',
    kind: 'SERVER',
    startTimeUnixNano: nano(2000),
    endTimeUnixNano: nano(2150),
    serviceName: 'web',
    status: { code: 'ERROR', message: 'Internal Server Error' },
    statusCode: 500,
    attributes: { 'http.route': '/api/checkout', 'http.method': 'POST', 'http.status_code': 500 },
  },
};

export const spanPaymentsChild: SidecarEvent = {
  type: 'span',
  timestamp: 2020,
  data: {
    traceId: TRACE_ERR,
    spanId: 'payments-charge',
    parentSpanId: 'web-checkout-root',
    name: 'charge',
    kind: 'CLIENT',
    startTimeUnixNano: nano(2020),
    endTimeUnixNano: nano(2140),
    serviceName: 'payments',
    status: { code: 'ERROR', message: 'card declined' },
    attributes: {
      'db.system': 'stripe',
      'exception.stacktrace': 'Error: card declined\n    at charge (payments.ts:42)',
    },
  },
};

export const logCheckoutError: SidecarEvent = {
  type: 'log',
  timestamp: 2030,
  data: {
    traceId: TRACE_ERR,
    spanId: 'web-checkout-root',
    level: 'error',
    message: 'checkout failed: card declined',
    serviceName: 'web',
    attributes: { code: 'CARD_DECLINED' },
  },
};

export const logWebInfo: SidecarEvent = {
  type: 'log',
  timestamp: 1005,
  data: {
    traceId: TRACE_OK,
    spanId: 'web-ok-root',
    level: 'info',
    message: 'health check ok',
    serviceName: 'web',
    attributes: {},
  },
};

export const logPaymentsWarn: SidecarEvent = {
  type: 'log',
  timestamp: 2025,
  data: {
    level: 'warn',
    message: 'retrying charge',
    serviceName: 'payments',
    attributes: {},
  },
};

export const ALL_EVENTS: SidecarEvent[] = [
  logWebInfo,
  spanWebOk,
  spanWebCheckoutRoot,
  logPaymentsWarn,
  spanPaymentsChild,
  logCheckoutError,
];

/** Build a fake fetch that serves `/api/events`, `/api/services`, `/health`. */
export function makeFetch(events: SidecarEvent[] = ALL_EVENTS): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const u = new URL(url);

    if (u.pathname === '/health') {
      return jsonResponse({ status: 'ok' });
    }
    if (u.pathname === '/api/services') {
      const names = [...new Set(events.map((e) => e.data.serviceName))];
      return jsonResponse({ services: names });
    }
    if (u.pathname === '/api/events') {
      let out = events;
      const type = u.searchParams.get('type');
      const service = u.searchParams.get('service');
      const traceId = u.searchParams.get('traceId');
      const since = u.searchParams.get('since');
      if (type) out = out.filter((e) => e.type === type);
      if (service) out = out.filter((e) => e.data.serviceName === service);
      // Mirror the sidecar's FileStore filter exactly: it excludes events whose
      // traceId is PRESENT and differs; events with no traceId pass through.
      if (traceId) out = out.filter((e) => !('traceId' in e.data) || e.data.traceId === traceId);
      if (since) out = out.filter((e) => e.timestamp > Number(since));
      return jsonResponse({ events: out });
    }
    return jsonResponse({ error: 'not found' }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}
