#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseCliCommand, stopSidecar } from './control';
import { createServer } from './server';

const DEFAULT_PORT = 6789;
const DEFAULT_DATA_DIR = join(homedir(), '.nextdog', 'data');
/** Idle window before an unused sidecar shuts itself down. `0` disables it (#79). */
const DEFAULT_IDLE_MS = 60_000;

function resolveIdleMs(): number {
  const raw = process.env.NEXTDOG_IDLE_MS;
  if (raw === undefined) return DEFAULT_IDLE_MS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_IDLE_MS;
}

function resolveUrl(): { url: string; port: number; host: string } {
  const url = process.env.NEXTDOG_URL ?? `http://localhost:${DEFAULT_PORT}`;
  const parsed = new URL(url);
  return { url, port: Number(parsed.port) || DEFAULT_PORT, host: parsed.hostname };
}

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

async function startServer(): Promise<void> {
  const { port, host } = resolveUrl();
  const dataDir = process.env.NEXTDOG_DATA_DIR ?? DEFAULT_DATA_DIR;
  const uiDir = process.env.NEXTDOG_UI_DIR ?? (await resolveUiDir());
  const idleMs = resolveIdleMs();

  const server = await createServer({
    port,
    host,
    dataDir,
    uiDir,
    idleMs,
    // The idle timer and the /shutdown control endpoint decide when to terminate;
    // give them the real process exit.
    onExit: (code) => process.exit(code),
  });

  console.log(`[nextdog] sidecar running at http://${host}:${port}`);
  console.log(`[nextdog] data dir: ${dataDir}`);
  if (idleMs > 0) {
    console.log(
      `[nextdog] idle shutdown after ${idleMs}ms of no telemetry or open dashboard ` +
        `(set NEXTDOG_IDLE_MS=0 to disable)`,
    );
  }
  if (uiDir) {
    console.log(`[nextdog] UI served from: ${uiDir}`);
  } else {
    console.log(`[nextdog] UI not available (run pnpm build in @nextdog/ui)`);
  }

  let shuttingDown = false;
  const onSignal = async () => {
    if (shuttingDown) {
      // Second signal — force exit immediately
      console.log('\n[nextdog] forced exit');
      process.exit(1);
    }
    shuttingDown = true;
    console.log('\n[nextdog] shutting down...');
    // Graceful: flush the buffer to disk (lossless) before releasing the port.
    await server.gracefulShutdown();
    process.exit(0);
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

/** `nextdog stop` — gracefully stop a running sidecar. Returns false only for a
 * foreign occupant (so `restart` knows not to try binding the port). */
async function runStop(): Promise<boolean> {
  const { url } = resolveUrl();
  const result = await stopSidecar(url);
  if (result === 'stopped') {
    console.log(`[nextdog] sidecar at ${url} stopped`);
  } else if (result === 'not-running') {
    console.log(`[nextdog] no sidecar running at ${url}`);
  } else {
    console.log(`[nextdog] ${url} is held by a non-NextDog process — leaving it alone`);
  }
  return result !== 'foreign';
}

async function main() {
  const command = parseCliCommand(process.argv.slice(2));

  if (command === 'stop') {
    await runStop();
    return;
  }

  if (command === 'restart') {
    const canBind = await runStop();
    if (!canBind) return; // a foreign process holds the port — nothing to restart
    await startServer();
    return;
  }

  await startServer();
}

main().catch((err) => {
  console.error('[nextdog] failed to start:', err);
  process.exit(1);
});
