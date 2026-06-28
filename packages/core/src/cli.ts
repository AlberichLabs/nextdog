#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from './server';

const DEFAULT_PORT = 6789;
const DEFAULT_DATA_DIR = join(homedir(), '.nextdog', 'data');

async function resolveUiDir(): Promise<string | undefined> {
  try {
    const require = createRequire(import.meta.url);
    const uiPkgPath = require.resolve('@nextdog/ui/package.json');
    const uiDir = join(dirname(uiPkgPath), 'dist');
    const s = await stat(uiDir);
    if (s.isDirectory()) return uiDir;
  } catch {
    // UI package not installed or not built
  }
  return undefined;
}

async function main() {
  const url = process.env.NEXTDOG_URL ?? `http://localhost:${DEFAULT_PORT}`;
  const parsed = new URL(url);
  const port = Number(parsed.port) || DEFAULT_PORT;
  const host = parsed.hostname;
  const dataDir = process.env.NEXTDOG_DATA_DIR ?? DEFAULT_DATA_DIR;
  const uiDir = process.env.NEXTDOG_UI_DIR ?? (await resolveUiDir());

  const server = await createServer({ port, host, dataDir, uiDir });
  console.log(`[nextdog] sidecar running at http://${host}:${port}`);
  console.log(`[nextdog] data dir: ${dataDir}`);
  if (uiDir) {
    console.log(`[nextdog] UI served from: ${uiDir}`);
  } else {
    console.log(`[nextdog] UI not available (run pnpm build in @nextdog/ui)`);
  }

  // Track open connections so we can destroy them on shutdown
  const connections = new Set<Socket>();
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) {
      // Second signal — force exit immediately
      console.log('\n[nextdog] forced exit');
      process.exit(1);
    }
    shuttingDown = true;
    console.log('\n[nextdog] shutting down...');

    // Stop accepting new connections
    server.close(() => process.exit(0));

    // Destroy all active connections (SSE clients etc.) after a short grace period
    setTimeout(() => {
      for (const socket of connections) {
        socket.destroy();
      }
    }, 500).unref();

    // Force exit if server.close callback never fires
    setTimeout(() => process.exit(0), 2000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[nextdog] failed to start:', err);
  process.exit(1);
});
