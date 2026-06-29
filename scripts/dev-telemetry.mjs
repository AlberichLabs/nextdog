#!/usr/bin/env node
/**
 * NextDog dev-only telemetry generator.
 *
 * Emits realistic telemetry to a running sidecar's ingest endpoints
 * (`POST /v1/spans`, `POST /v1/logs`) using the EXACT attribute keys the
 * adapters/exporter produce (`@nextdog/node`): `http.method`, `http.route`,
 * `http.status_code`, `db.system`, `db.statement`, `http.url`, correlated
 * `console.*` logs, etc. — so the data renders identically to a real app
 * across the Requests / Spans / Traces / Logs views.
 *
 * Two modes:
 *   - default (seed): post a solid baseline once and exit.
 *   - `--live`:       seed once, then trickle a new event every ~1-3s
 *                     (with occasional slow/error events) so the live tail
 *                     visibly moves and the 2000-event cap can be exercised.
 *
 * Usage:
 *   node scripts/dev-telemetry.mjs [--url http://localhost:6799] [--live]
 *
 * This file is NOT part of any published package — it ships nothing.
 */
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://localhost:6789';
const SERVICES = ['web', 'api-gateway', 'checkout', 'worker'];
const NANOS_PER_MS = 1_000_000n;
const SLOW_MS = 1_000;
const BATCH = 200;
const SEED_FILL = 40;
const SEED_HORIZON_MS = 5 * 60 * 1000;

const HEX = '0123456789abcdef';
function randomHex(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += HEX[Math.floor(Math.random() * 16)];
  return out;
}

export function randomTraceId() {
  return randomHex(32);
}

export function randomSpanId() {
  return randomHex(16);
}

function msToNano(ms) {
  return (BigInt(Math.round(ms)) * NANOS_PER_MS).toString();
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** A child span's duration as a fraction of the root window (with jitter). */
function segmentMs(rootDurationMs, fraction) {
  return Math.max(1, Math.round(rootDurationMs * fraction * (0.5 + Math.random())));
}

function sampleStack() {
  return [
    'Error: payment provider request timed out',
    '    at chargeCard (/app/src/checkout/charge.ts:42:11)',
    '    at processOrder (/app/src/checkout/order.ts:88:7)',
    '    at async POST (/app/app/api/checkout/route.ts:15:3)',
  ].join('\n');
}

const DB_STATEMENTS = {
  GET: [
    { text: 'SELECT id, email, name FROM users WHERE id = $1', rows: 1, params: 1 },
    {
      text: 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      rows: 18,
      params: 1,
    },
    { text: 'SELECT count(*) FROM products WHERE in_stock = true', rows: 1, params: 0 },
  ],
  POST: [
    {
      text: 'INSERT INTO orders (user_id, total_cents, status) VALUES ($1, $2, $3) RETURNING id',
      rows: 1,
      params: 3,
    },
    {
      text: 'INSERT INTO audit_log (actor, action, payload) VALUES ($1, $2, $3)',
      rows: 1,
      params: 3,
    },
  ],
  PUT: [
    { text: 'UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2', rows: 1, params: 2 },
  ],
  DELETE: [{ text: 'DELETE FROM sessions WHERE token = $1', rows: 1, params: 1 }],
};

const OUTBOUND = [
  { method: 'POST', url: 'https://api.stripe.com/v1/charges', status: 200 },
  { method: 'GET', url: 'https://api.github.com/repos/cscherban/NextDog', status: 200 },
  { method: 'GET', url: 'https://api.weather.example.com/v1/forecast', status: 503 },
  { method: 'POST', url: 'https://hooks.slack.com/services/T000/B000/xxxx', status: 200 },
];

function pickDbStatements(method) {
  const pool = DB_STATEMENTS[method] ?? DB_STATEMENTS.GET;
  const count = 1 + Math.floor(Math.random() * Math.min(2, pool.length));
  const chosen = [];
  for (let i = 0; i < count; i += 1) chosen.push(pool[i % pool.length]);
  return chosen;
}

export function makeServerSpan({
  service,
  method,
  route,
  status,
  durationMs,
  startMs,
  traceId,
  spanId,
}) {
  const start = startMs ?? Date.now();
  const isError = status >= 500;
  return {
    traceId: traceId ?? randomTraceId(),
    spanId: spanId ?? randomSpanId(),
    name: `${method} ${route}`,
    kind: 'SERVER',
    startTimeUnixNano: msToNano(start),
    endTimeUnixNano: msToNano(start + durationMs),
    attributes: {
      'http.method': method,
      'http.route': route,
      'http.target': route,
      'http.host': 'localhost:3000',
      'http.scheme': 'http',
      'http.status_code': status,
    },
    status: isError ? { code: 'ERROR', message: `HTTP ${status}` } : { code: 'OK' },
    statusCode: status,
    serviceName: service,
  };
}

export function makeDbSpan({
  service,
  system,
  statement,
  rowsAffected,
  paramsCount,
  durationMs,
  startMs,
  traceId,
  parentSpanId,
}) {
  const start = startMs ?? Date.now();
  const attributes = { 'db.system': system, 'db.statement': statement };
  if (rowsAffected !== undefined) attributes['db.rows_affected'] = rowsAffected;
  if (paramsCount !== undefined) attributes['db.params_count'] = paramsCount;
  return {
    traceId,
    parentSpanId,
    spanId: randomSpanId(),
    name: statement,
    kind: 'CLIENT',
    startTimeUnixNano: msToNano(start),
    endTimeUnixNano: msToNano(start + durationMs),
    attributes,
    status: { code: 'OK' },
    serviceName: service,
  };
}

export function makeFetchSpan({
  service,
  method,
  url,
  status,
  durationMs,
  startMs,
  traceId,
  parentSpanId,
}) {
  const start = startMs ?? Date.now();
  const isError = status >= 400;
  return {
    traceId,
    parentSpanId,
    spanId: randomSpanId(),
    name: `${method} ${url}`,
    kind: 'CLIENT',
    startTimeUnixNano: msToNano(start),
    endTimeUnixNano: msToNano(start + durationMs),
    attributes: { 'http.url': url, 'http.method': method, 'http.status_code': status },
    status: isError ? { code: 'ERROR', message: `HTTP ${status}` } : { code: 'OK' },
    statusCode: status,
    serviceName: service,
  };
}

export function makeLog({ service, level, message, traceId, spanId, route, method, requestId }) {
  const attributes = { runtime: 'server' };
  if (method) attributes['http.method'] = method;
  if (route) attributes['http.route'] = route;
  if (requestId) attributes['request.id'] = requestId;
  const timestamp = Date.now();
  return {
    type: 'log',
    timestamp,
    data: { timestamp, level, message, attributes, traceId, spanId, serviceName: service },
  };
}

/**
 * Build one correlated multi-span trace: a SERVER root, nested DB CLIENT spans,
 * an optional outbound fetch CLIENT span, and correlated logs (an info request
 * line plus a warn for slow or an error+stack for 5xx).
 */
export function buildTrace(opts) {
  const {
    service,
    method,
    route,
    status,
    rootDurationMs,
    dbSystem = 'postgresql',
    fetch: withFetch = false,
    startMs = Date.now(),
  } = opts;

  const traceId = randomTraceId();
  const rootSpanId = randomSpanId();

  const spans = [
    makeServerSpan({
      service,
      method,
      route,
      status,
      durationMs: rootDurationMs,
      startMs,
      traceId,
      spanId: rootSpanId,
    }),
  ];
  const logs = [
    makeLog({
      service,
      level: 'info',
      message: `${method} ${route} → ${status} (${rootDurationMs}ms)`,
      traceId,
      spanId: rootSpanId,
      route,
      method,
      requestId: randomHex(8),
    }),
  ];

  let cursor = startMs + segmentMs(rootDurationMs, 0.08);
  for (const stmt of pickDbStatements(method)) {
    const durationMs = segmentMs(rootDurationMs, 0.25);
    spans.push(
      makeDbSpan({
        service,
        system: dbSystem,
        statement: stmt.text,
        rowsAffected: stmt.rows,
        paramsCount: stmt.params,
        durationMs,
        startMs: cursor,
        traceId,
        parentSpanId: rootSpanId,
      }),
    );
    cursor += durationMs + 2;
  }

  if (withFetch) {
    const durationMs = segmentMs(rootDurationMs, 0.3);
    const ext = pick(OUTBOUND);
    spans.push(
      makeFetchSpan({
        service,
        method: ext.method,
        url: ext.url,
        status: ext.status,
        durationMs,
        startMs: cursor,
        traceId,
        parentSpanId: rootSpanId,
      }),
    );
  }

  if (status >= 500) {
    logs.push(
      makeLog({
        service,
        level: 'error',
        message: `Unhandled error handling ${method} ${route}\n${sampleStack()}`,
        traceId,
        spanId: rootSpanId,
        route,
        method,
      }),
    );
  } else if (rootDurationMs > SLOW_MS) {
    logs.push(
      makeLog({
        service,
        level: 'warn',
        message: `slow request: ${method} ${route} took ${rootDurationMs}ms`,
        traceId,
        spanId: rootSpanId,
        route,
        method,
      }),
    );
  }

  return { spans, logs, traceId, rootSpanId };
}

const RANDOM_ROUTES = [
  { method: 'GET', route: '/' },
  { method: 'GET', route: '/dashboard' },
  { method: 'GET', route: '/api/products' },
  { method: 'GET', route: '/api/users/42' },
  { method: 'POST', route: '/api/orders' },
  { method: 'POST', route: '/login' },
  { method: 'PUT', route: '/api/users/42' },
  { method: 'DELETE', route: '/api/orders/7' },
];

function randomTraceOpts(startMs) {
  const base = pick(RANDOM_ROUTES);
  const roll = Math.random();
  let status = 200;
  if (roll > 0.94) status = 500;
  else if (roll > 0.86) status = 404;
  else if (base.method === 'POST') status = 201;
  else if (base.method === 'DELETE') status = 204;

  // Mostly fast, with a fat tail of slow (>1s) requests.
  const rootDurationMs =
    Math.random() > 0.85
      ? 1_100 + Math.floor(Math.random() * 1_800)
      : 8 + Math.floor(Math.random() * 240);

  return {
    service: pick(SERVICES),
    method: base.method,
    route: base.route,
    status,
    rootDurationMs,
    dbSystem: Math.random() > 0.5 ? 'postgresql' : 'mysql',
    fetch: Math.random() > 0.6,
    startMs,
  };
}

/**
 * A baseline batch that DELIBERATELY covers every dashboard-exercising case:
 * 404 + 500, GET/POST/PUT/DELETE, a >1s slow request, pg + mysql2 DB spans,
 * an outbound fetch span, and correlated info/warn/error logs (with a stack).
 */
export function buildSeed() {
  const now = Date.now();
  const guaranteed = [
    {
      service: 'api-gateway',
      method: 'GET',
      route: '/api/users/42',
      status: 200,
      rootDurationMs: 35,
      dbSystem: 'postgresql',
    },
    {
      service: 'api-gateway',
      method: 'GET',
      route: '/api/missing',
      status: 404,
      rootDurationMs: 11,
      dbSystem: 'postgresql',
    },
    {
      service: 'checkout',
      method: 'POST',
      route: '/api/checkout',
      status: 500,
      rootDurationMs: 1_850,
      dbSystem: 'postgresql',
      fetch: true,
    },
    {
      service: 'web',
      method: 'GET',
      route: '/dashboard',
      status: 200,
      rootDurationMs: 1_450,
      dbSystem: 'mysql',
    },
    {
      service: 'worker',
      method: 'PUT',
      route: '/api/jobs/sync',
      status: 204,
      rootDurationMs: 220,
      dbSystem: 'mysql',
    },
    {
      service: 'api-gateway',
      method: 'DELETE',
      route: '/api/sessions/abc',
      status: 200,
      rootDurationMs: 38,
      dbSystem: 'postgresql',
    },
  ];

  const spans = [];
  const logs = [];
  const emit = (opts) => {
    const startMs = now - Math.floor(Math.random() * SEED_HORIZON_MS);
    const trace = buildTrace({ ...opts, startMs });
    spans.push(...trace.spans);
    logs.push(...trace.logs);
  };

  for (const opts of guaranteed) emit(opts);
  for (let i = 0; i < SEED_FILL; i += 1)
    emit(randomTraceOpts(now - Math.floor(Math.random() * SEED_HORIZON_MS)));

  return { spans, logs };
}

async function post(url, path, body) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
}

async function postSpans(url, spans) {
  for (let i = 0; i < spans.length; i += BATCH) {
    await post(url, '/v1/spans', { spans: spans.slice(i, i + BATCH) });
  }
}

async function postLogs(url, logs) {
  for (let i = 0; i < logs.length; i += BATCH) {
    await post(url, '/v1/logs', { logs: logs.slice(i, i + BATCH) });
  }
}

async function waitForSidecar(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {
      /* sidecar not up yet — retry */
    }
    await sleep(250);
  }
  return false;
}

async function seed(url) {
  const { spans, logs } = buildSeed();
  await postSpans(url, spans);
  await postLogs(url, logs);
  console.log(`[dev-telemetry] seeded ${spans.length} spans + ${logs.length} logs → ${url}`);
}

async function runLive(url) {
  console.log('[dev-telemetry] live trickle started — a new event every ~1-3s');
  let running = true;
  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    const trace = buildTrace(randomTraceOpts(Date.now()));
    try {
      await postSpans(url, trace.spans);
      if (trace.logs.length > 0) await postLogs(url, trace.logs);
    } catch (err) {
      console.warn(`[dev-telemetry] post failed: ${err.message}`);
    }
    await sleep(1_000 + Math.floor(Math.random() * 2_000));
  }
}

function parseArgs(argv) {
  const args = { url: process.env.NEXTDOG_URL ?? DEFAULT_URL, live: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live') {
      args.live = true;
    } else if (arg === '--url') {
      i += 1;
      args.url = argv[i];
    } else if (arg.startsWith('--url=')) {
      args.url = arg.slice('--url='.length);
    }
  }
  return args;
}

async function main() {
  const { url, live } = parseArgs(process.argv.slice(2));
  const ready = await waitForSidecar(url);
  if (!ready) {
    console.error(`[dev-telemetry] sidecar at ${url} never became reachable`);
    process.exit(1);
  }
  await seed(url);
  if (live) await runLive(url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[dev-telemetry]', err);
    process.exit(1);
  });
}
