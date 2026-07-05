import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../server';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function span(spanId: string, serviceName = 'app') {
  return {
    traceId: `t-${spanId}`,
    spanId,
    name: `GET /${spanId}`,
    kind: 'SERVER',
    startTimeUnixNano: '1000',
    endTimeUnixNano: '2000',
    attributes: {},
    status: { code: 'OK' },
    serviceName,
  };
}

async function ingest(port: number, spanId: string) {
  await fetch(`http://localhost:${port}/v1/spans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spans: [span(spanId)] }),
  });
}

async function eventsOnDisk(dataDir: string, readPort: number): Promise<string[]> {
  // A fresh sidecar over the same data dir sees exactly what was flushed to disk.
  const reader = await createServer({ port: readPort, dataDir, idleMs: 0 });
  try {
    const data = await (await fetch(`http://localhost:${readPort}/api/events`)).json();
    return (data.events as { data: { spanId?: string } }[])
      .map((e) => e.data.spanId)
      .filter((id): id is string => typeof id === 'string');
  } finally {
    await new Promise<void>((resolve) => reader.close(() => resolve()));
  }
}

describe('graceful shutdown (#79)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nextdog-shutdown-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('POST /shutdown flushes buffered events to disk, then exits (lossless)', async () => {
    const port = 16810;
    const onExit = vi.fn();
    // The sidecar closes itself via /shutdown, so we don't hold a handle here.
    await createServer({ port, dataDir, idleMs: 0, onExit });

    // Ingest, then immediately request shutdown — the 2s periodic flush has not
    // run yet, so anything on disk got there via the graceful-shutdown flush.
    await ingest(port, 'pre-upgrade-1');
    await ingest(port, 'pre-upgrade-2');

    const res = await fetch(`http://localhost:${port}/shutdown`, { method: 'POST' });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0), { timeout: 3000 });

    const ids = await eventsOnDisk(dataDir, 16811);
    expect(ids).toContain('pre-upgrade-1');
    expect(ids).toContain('pre-upgrade-2');
  });

  it('exposes gracefulShutdown() that flushes without triggering onExit (signals path)', async () => {
    const port = 16812;
    const onExit = vi.fn();
    const server = await createServer({ port, dataDir, idleMs: 0, onExit });

    await ingest(port, 'sig-1');
    await server.gracefulShutdown();

    // The direct call flushes + closes but leaves exit to the caller (cli signal handler).
    expect(onExit).not.toHaveBeenCalled();
    const ids = await eventsOnDisk(dataDir, 16813);
    expect(ids).toContain('sig-1');
  });

  it('frees the port so a replacement sidecar can bind it (upgrade handoff)', async () => {
    const port = 16814;
    const first = await createServer({ port, dataDir, idleMs: 0, onExit: vi.fn() });
    await ingest(port, 'handoff-1');
    await first.gracefulShutdown();

    // Same port + same data dir — the new sidecar inherits history from disk.
    const second = await createServer({ port, dataDir, idleMs: 0 });
    const data = await (await fetch(`http://localhost:${port}/api/events`)).json();
    const ids = (data.events as { data: { spanId?: string } }[]).map((e) => e.data.spanId);
    expect(ids).toContain('handoff-1');
    await new Promise<void>((resolve) => second.close(() => resolve()));
  });
});

describe('idle self-shutdown (#79)', () => {
  let dataDir: string;
  let servers: Server[];

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nextdog-idle-'));
    servers = [];
  });
  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => {
        if (s.listening) s.close(() => resolve());
        else resolve();
      });
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it('exits after the idle window with no telemetry and no SSE client', async () => {
    const port = 16820;
    const onExit = vi.fn();
    servers.push(await createServer({ port, dataDir, idleMs: 120, onExit }));
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0), { timeout: 3000 });
  });

  it('stays up while telemetry is flowing', async () => {
    const port = 16821;
    const onExit = vi.fn();
    const server = await createServer({ port, dataDir, idleMs: 200, onExit });
    servers.push(server);
    for (let i = 0; i < 6; i++) {
      await ingest(port, `flow-${i}`);
      await sleep(70);
    }
    expect(onExit).not.toHaveBeenCalled();
  });

  it('stays up while a dashboard SSE client is connected', async () => {
    const port = 16822;
    const onExit = vi.fn();
    const server = await createServer({ port, dataDir, idleMs: 150, onExit });
    servers.push(server);

    const controller = new AbortController();
    // Opening the stream resolves once the sidecar flushes the ": connected" head.
    await fetch(`http://localhost:${port}/sse`, { signal: controller.signal });
    await sleep(450); // comfortably beyond the idle window
    expect(onExit).not.toHaveBeenCalled();
    controller.abort();
  });

  it('survives a brief telemetry gap (dev-server restart) without shutting down', async () => {
    const port = 16823;
    const onExit = vi.fn();
    const server = await createServer({ port, dataDir, idleMs: 300, onExit });
    servers.push(server);

    await ingest(port, 'before-restart');
    await sleep(140); // the gap while `next dev` restarts — shorter than the window
    await ingest(port, 'after-restart'); // telemetry resumes
    await sleep(140);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('is disabled when idleMs <= 0 (never self-shuts)', async () => {
    const port = 16824;
    const onExit = vi.fn();
    const server = await createServer({ port, dataDir, idleMs: 0, onExit });
    servers.push(server);
    await sleep(250);
    expect(onExit).not.toHaveBeenCalled();
  });
});
