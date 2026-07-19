import { describe, expect, it } from 'vitest';
import { SidecarClient } from '../client';
import { beginRun, getRun, RUN_ATTR, RUN_HEADER } from '../tools';
import type { SidecarEvent } from '../types';
import { makeFetch } from './fixtures';

/** A span stamped with a run label via the captured `x-nextdog-run` request header. */
function stamped(
  spanId: string,
  timestamp: number,
  label: string,
  extra: Record<string, unknown> = {},
): SidecarEvent {
  return {
    type: 'span',
    timestamp,
    data: {
      traceId: spanId,
      spanId,
      name: 'POST /api/checkout',
      kind: 'SERVER',
      serviceName: 'web',
      status: { code: 'OK' },
      statusCode: 200,
      attributes: { 'http.route': '/api/checkout', [RUN_ATTR]: label, ...extra },
    },
  };
}

function unstamped(spanId: string, timestamp: number): SidecarEvent {
  return {
    type: 'span',
    timestamp,
    data: {
      traceId: spanId,
      spanId,
      name: 'GET /api/other',
      kind: 'SERVER',
      serviceName: 'web',
      status: { code: 'OK' },
      statusCode: 200,
      attributes: { 'http.route': '/api/other' },
    },
  };
}

function client(events: SidecarEvent[]) {
  return new SidecarClient({ fetchImpl: makeFetch(events).fetchImpl });
}

describe('begin_run (#91)', () => {
  it('returns a handle with the label and the header to stamp replays with', async () => {
    const run = await beginRun({ label: 'my-repro' });
    expect(run.label).toBe('my-repro');
    expect(run.header).toEqual({ [RUN_HEADER]: 'my-repro' });
    expect(typeof run.startedAt).toBe('number');
  });

  it('generates a collision-resistant label when none is supplied', async () => {
    const a = await beginRun();
    const b = await beginRun();
    expect(a.label).not.toBe(b.label);
    expect(a.header[RUN_HEADER]).toBe(a.label);
  });
});

describe('get_run (#91)', () => {
  // Two overlapping runs, interleaved in time, plus unrelated unstamped traffic.
  const events = [
    stamped('a1', 1000, 'run-a'),
    stamped('b1', 1010, 'run-b'),
    unstamped('x1', 1020),
    stamped('a2', 1030, 'run-a'),
    stamped('b2', 1040, 'run-b'),
  ];

  it('scopes events to a single labeled run', async () => {
    const res = await getRun(client(events), { label: 'run-a' });
    expect(res.events.map((e) => e.data.spanId).sort()).toEqual(['a1', 'a2']);
    expect(res.count).toBe(2);
  });

  it('two overlapping runs do not bleed into each other', async () => {
    const a = await getRun(client(events), { label: 'run-a' });
    const b = await getRun(client(events), { label: 'run-b' });
    expect(a.events.every((e) => e.data.attributes[RUN_ATTR] === 'run-a')).toBe(true);
    expect(b.events.every((e) => e.data.attributes[RUN_ATTR] === 'run-b')).toBe(true);
    expect(a.events.map((e) => e.data.spanId)).not.toContain('b1');
  });

  it('matches the label exactly — a prefix does not bleed (run-1 vs run-12)', async () => {
    const res = await getRun(
      client([stamped('p1', 1, 'run-1'), stamped('p2', 2, 'run-12')]),
      { label: 'run-1' },
    );
    expect(res.events.map((e) => e.data.spanId)).toEqual(['p1']);
  });

  it('falls back gracefully to an empty run when nothing was stamped (no crash)', async () => {
    const res = await getRun(client([unstamped('x1', 1)]), { label: 'never-stamped' });
    expect(res.events).toEqual([]);
    expect(res.count).toBe(0);
  });

  it('inherits #60 redaction — a credential on a run event never egresses', async () => {
    const res = await getRun(
      client([stamped('a1', 1, 'run-a', { 'http.request.header.authorization': 'Bearer leak-me' })]),
      { label: 'run-a' },
    );
    expect(res.count).toBe(1);
    expect(JSON.stringify(res)).not.toContain('leak-me');
  });
});
