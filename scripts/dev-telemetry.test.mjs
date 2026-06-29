import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSeed, buildTrace, makeServerSpan } from './dev-telemetry.mjs';

const ONE_SECOND_NANO = 1_000_000_000n;

test('makeServerSpan emits BigInt-parseable nano times and adapter-matching http attributes', () => {
  const span = makeServerSpan({
    service: 'web',
    method: 'GET',
    route: '/x',
    status: 200,
    durationMs: 50,
    startMs: 1_000,
  });

  assert.equal(span.kind, 'SERVER');
  assert.equal(span.serviceName, 'web');
  assert.equal(span.parentSpanId, undefined, 'a SERVER root must have no parent');
  assert.equal(span.attributes['http.method'], 'GET');
  assert.equal(span.attributes['http.route'], '/x');
  assert.equal(span.attributes['http.status_code'], 200);
  assert.equal(span.statusCode, 200);
  assert.match(span.startTimeUnixNano, /^\d+$/, 'nano start is a numeric string');
  assert.match(span.endTimeUnixNano, /^\d+$/, 'nano end is a numeric string');
  // The core ingest route does BigInt(s.startTimeUnixNano) — must not throw.
  assert.ok(BigInt(span.endTimeUnixNano) > BigInt(span.startTimeUnixNano));
});

test('buildTrace nests CLIENT children under a single SERVER root', () => {
  const { spans } = buildTrace({
    service: 'checkout',
    method: 'POST',
    route: '/api/checkout',
    status: 500,
    rootDurationMs: 1_800,
    dbSystem: 'postgresql',
    fetch: true,
    startMs: 1_000,
  });

  const roots = spans.filter((s) => s.kind === 'SERVER');
  assert.equal(roots.length, 1, 'exactly one SERVER root per trace');
  const root = roots[0];
  assert.equal(root.parentSpanId, undefined);

  const children = spans.filter((s) => s !== root);
  assert.ok(children.length >= 1, 'trace has nested children');
  for (const child of children) {
    assert.equal(child.kind, 'CLIENT');
    assert.equal(child.traceId, root.traceId, 'child shares the trace id');
    assert.equal(child.parentSpanId, root.spanId, 'child parents to the SERVER root');
  }
});

test('buildSeed covers every dashboard-exercising edge case', () => {
  const { spans, logs } = buildSeed();
  const servers = spans.filter((s) => s.kind === 'SERVER');

  const statuses = new Set(servers.map((s) => s.attributes['http.status_code']));
  assert.ok(statuses.has(404), 'seed includes a 404');
  assert.ok(statuses.has(500), 'seed includes a 500');

  const methods = new Set(servers.map((s) => s.attributes['http.method']));
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    assert.ok(methods.has(method), `seed includes a ${method}`);
  }

  const services = new Set(spans.map((s) => s.serviceName));
  assert.ok(services.size >= 3, 'seed spans multiple services');

  const hasSlow = servers.some(
    (s) => BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano) > ONE_SECOND_NANO,
  );
  assert.ok(hasSlow, 'seed includes a >1s slow request');

  const dbSystems = new Set(
    spans.filter((s) => s.attributes['db.system']).map((s) => s.attributes['db.system']),
  );
  assert.ok(dbSystems.has('postgresql'), 'seed includes a pg span');
  assert.ok(dbSystems.has('mysql'), 'seed includes a mysql2 span');

  assert.ok(
    spans.some((s) => typeof s.attributes['http.url'] === 'string'),
    'seed includes an outbound fetch/http span',
  );

  const levels = new Set(logs.map((l) => l.data.level));
  assert.ok(levels.has('info'), 'seed has info logs');
  assert.ok(levels.has('warn'), 'seed has warn logs');
  assert.ok(levels.has('error'), 'seed has error logs');

  const errorLog = logs.find((l) => l.data.level === 'error');
  assert.ok(errorLog, 'an error log exists');
  assert.ok(errorLog.data.message.includes('\n    at '), 'error log carries a stack trace');
  assert.equal(errorLog.type, 'log');
  assert.equal(errorLog.data.attributes.runtime, 'server');
});
