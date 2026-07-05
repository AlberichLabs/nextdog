import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as httpCreateServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCliCommand, stopSidecar } from '../control';
import { createServer } from '../server';

describe('parseCliCommand', () => {
  it('defaults to start with no argument', () => {
    expect(parseCliCommand([])).toBe('start');
  });
  it('recognizes stop and restart', () => {
    expect(parseCliCommand(['stop'])).toBe('stop');
    expect(parseCliCommand(['restart'])).toBe('restart');
  });
  it('treats an unknown argument as start (default sidecar boot)', () => {
    expect(parseCliCommand(['--foo'])).toBe('start');
  });
});

describe('stopSidecar (#79 — nextdog stop)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nextdog-control-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('gracefully stops a running NextDog sidecar and reports it stopped', async () => {
    const port = 16840;
    const url = `http://localhost:${port}`;
    // onExit is stubbed so the process isn't killed; gracefulShutdown still closes it.
    await createServer({ port, dataDir, idleMs: 0, onExit: vi.fn() });

    expect(await stopSidecar(url)).toBe('stopped');
    // Port is released: nothing answers /health anymore.
    await expect(
      fetch(`${url}/health`, { signal: AbortSignal.timeout(500) }),
    ).rejects.toBeDefined();
  });

  it('reports not-running when nothing is listening', async () => {
    expect(await stopSidecar('http://localhost:16841')).toBe('not-running');
  });

  it('refuses to stop a foreign process holding the port', async () => {
    const port = 16842;
    const foreign: Server = httpCreateServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not nextdog');
    });
    await new Promise<void>((resolve) => foreign.listen(port, '127.0.0.1', () => resolve()));
    try {
      expect(await stopSidecar(`http://localhost:${port}`)).toBe('foreign');
      // The foreign server is untouched.
      const res = await fetch(`http://localhost:${port}/`);
      expect(await res.text()).toBe('not nextdog');
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });
});
