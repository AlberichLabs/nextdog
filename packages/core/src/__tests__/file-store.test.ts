import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../file-store';
import { serializeWithBigInt } from '../serialize';
import type { NextDogEvent } from '../types';

const makeEvent = (id: number, serviceName = 'test'): NextDogEvent => ({
  type: 'span',
  timestamp: id,
  data: {
    traceId: `trace-${id}`,
    spanId: `span-${id}`,
    name: `span-${id}`,
    kind: 'SERVER' as const,
    startTimeUnixNano: BigInt(id * 1000000),
    endTimeUnixNano: BigInt(id * 1000000 + 500000),
    attributes: {},
    status: { code: 'OK' as const },
    serviceName,
  },
});

const makeLog = (id: number, serviceName = 'test'): NextDogEvent => ({
  type: 'log',
  timestamp: id,
  data: {
    timestamp: id,
    level: 'info' as const,
    message: `log-${id}`,
    attributes: {},
    serviceName,
  },
});

// Serialize the way FileStore does (BigInt -> "<n>n" strings) so test fixtures
// written directly to disk round-trip through the store's deserializer. Uses the
// same shared helper the store uses, so the test can't drift from production.
const line = (event: NextDogEvent): string => serializeWithBigInt(event);

describe('FileStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nextdog-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('flushes events to NDJSON file', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1), makeEvent(2)]);

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}\.ndjson$/);

    const content = await readFile(join(dir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('span');
    expect(parsed.data.traceId).toBe('trace-1');
  });

  it('reads events back with query filters', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1, 'app-a'), makeEvent(2, 'app-b'), makeEvent(3, 'app-a')]);

    const all = await store.query({});
    expect(all).toHaveLength(3);

    const filtered = await store.query({ service: 'app-a' });
    expect(filtered).toHaveLength(2);
  });

  it('queries by traceId', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1), makeEvent(2), makeEvent(3)]);

    const result = await store.query({ traceId: 'trace-2' });
    expect(result).toHaveLength(1);
    expect(result[0].data.traceId).toBe('trace-2');
  });

  it('filters by event type', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1), makeLog(2), makeEvent(3), makeLog(4)]);

    const spans = await store.query({ type: 'span' });
    expect(spans).toHaveLength(2);
    expect(spans.every((e) => e.type === 'span')).toBe(true);

    const logs = await store.query({ type: 'log' });
    expect(logs).toHaveLength(2);
    expect(logs.every((e) => e.type === 'log')).toBe(true);
  });

  it('filters by since (timestamp, inclusive of newer)', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1), makeEvent(2), makeEvent(3)]);

    const result = await store.query({ since: 2 });
    // since is exclusive — only events strictly newer than 2
    expect(result.map((e) => e.timestamp)).toEqual([3]);
  });

  it('filters by before (timestamp, for load-older paging)', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1), makeEvent(2), makeEvent(3)]);

    const result = await store.query({ before: 3 });
    expect(result.map((e) => e.timestamp)).toEqual([1, 2]);
  });

  it('returns distinct service names via services()', async () => {
    const store = new FileStore(dir);
    await store.flush([
      makeEvent(1, 'app-a'),
      makeLog(2, 'app-b'),
      makeEvent(3, 'app-a'),
      makeLog(4, 'worker'),
    ]);

    const services = await store.services();
    expect([...services].sort()).toEqual(['app-a', 'app-b', 'worker']);
  });

  it('services() returns empty set when no data dir exists yet', async () => {
    const store = new FileStore(join(dir, 'does-not-exist-yet'));
    const services = await store.services();
    expect(services.size).toBe(0);
  });

  // Defensive parsing: persisted NDJSON is read back on every dashboard load and
  // boot. A single malformed or old-schema line must not crash the whole read.
  it('skips malformed lines without crashing query()', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '2026-01-01-00.ndjson'),
      `${[
        line(makeEvent(1, 'app-a')),
        'not valid json at all', // unparseable
        '42', // parses, but not an object
        'null', // parses to null
        '{"type":"span"}', // object, but missing data/timestamp
        '{"type":"mystery","timestamp":9,"data":{"serviceName":"x"}}', // unknown type
        line(makeLog(2, 'app-b')),
        '', // blank line
      ].join('\n')}\n`,
      'utf-8',
    );

    const store = new FileStore(dir);
    const all = await store.query({});
    // Only the two well-formed events survive.
    expect(all.map((e) => e.type).sort()).toEqual(['log', 'span']);
    expect(all.map((e) => e.data.serviceName).sort()).toEqual(['app-a', 'app-b']);
  });

  it('tolerates old-shape lines missing newer optional fields', async () => {
    await mkdir(dir, { recursive: true });
    // Simulates a span persisted before statusCode/parentSpanId existed: the
    // required shape is intact, optional fields absent — must still load.
    const oldSpan = {
      type: 'span',
      timestamp: 7,
      data: {
        traceId: 't',
        spanId: 's',
        name: 'GET /',
        kind: 'SERVER',
        startTimeUnixNano: '1000n',
        endTimeUnixNano: '2000n',
        attributes: {},
        status: { code: 'OK' },
        serviceName: 'legacy',
      },
    };
    await writeFile(join(dir, '2026-01-01-00.ndjson'), `${JSON.stringify(oldSpan)}\n`, 'utf-8');

    const store = new FileStore(dir);
    const all = await store.query({});
    expect(all).toHaveLength(1);
    expect(all[0].data.serviceName).toBe('legacy');
  });

  it('skips malformed lines without crashing services()', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '2026-01-01-00.ndjson'),
      `${[
        line(makeEvent(1, 'app-a')),
        'garbage',
        'null',
        '{"type":"span","timestamp":2}', // no data → no serviceName
        line(makeLog(2, 'worker')),
      ].join('\n')}\n`,
      'utf-8',
    );

    const store = new FileStore(dir);
    const services = await store.services();
    expect([...services].sort()).toEqual(['app-a', 'worker']);
  });

  it('cleans up files older than maxAge', async () => {
    const store = new FileStore(dir);
    await store.flush([makeEvent(1)]);

    const files = await readdir(dir);
    expect(files).toHaveLength(1);

    // Clean with maxAge 0 should remove everything
    await store.cleanup(0);
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });
});
