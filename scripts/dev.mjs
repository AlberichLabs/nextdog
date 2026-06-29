#!/usr/bin/env node
/**
 * NextDog one-command local dev harness.
 *
 * `pnpm dev` orchestrates the full local playground against realistic seeded +
 * live telemetry, with NO real app wired in:
 *
 *   1. builds + starts the sidecar (`@nextdog/core` CLI)
 *   2. starts the UI Vite dev server (hot reload), pointed at the sidecar
 *   3. seeds a baseline, then trickles live telemetry (`dev-telemetry.mjs --live`)
 *
 * Isolation: the sidecar runs on a DEV port (not the real :6789) and writes to a
 * scratch `NEXTDOG_DATA_DIR` under `node_modules/.cache`, so it never collides
 * with a real sidecar or touches `~/.nextdog/data`.
 *
 * Dev-only: this file is not part of any published package. Ctrl-C cleanly tears
 * down all three child process groups.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);

const SIDECAR_PORT = process.env.NEXTDOG_DEV_SIDECAR_PORT ?? '6799';
const UI_PORT = process.env.NEXTDOG_DEV_UI_PORT ?? '5273';
const SIDECAR_URL = `http://localhost:${SIDECAR_PORT}`;
const DASHBOARD_URL = `http://localhost:${UI_PORT}`;
const DATA_DIR = join(REPO_ROOT, 'node_modules', '.cache', 'nextdog-dev');

const COLORS = { sidecar: '\x1b[36m', ui: '\x1b[35m', seed: '\x1b[32m' };
const RESET = '\x1b[0m';
const FORCE_KILL_MS = 3_000;

const children = [];
let shuttingDown = false;

function prefixStream(stream, label) {
  let buffered = '';
  const color = COLORS[label] ?? '';
  stream.setEncoding('utf-8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) process.stdout.write(`${color}[${label}]${RESET} ${line}\n`);
  });
}

function start(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  prefixStream(child.stdout, label);
  prefixStream(child.stderr, label);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `\n[dev] "${label}" exited unexpectedly (code=${code} signal=${signal}); shutting down`,
    );
    shutdown(1);
  });
  children.push(child);
  return child;
}

/** Run a command to completion, inheriting stdio. Rejects on a non-zero exit. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function waitForHealth(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body?.service) return true;
      }
    } catch {
      /* sidecar still booting — retry */
    }
    await sleep(250);
  }
  return false;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[dev] shutting down — stopping sidecar, UI and seeder…');
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* group already gone */
    }
  }
  setTimeout(() => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    process.exit(code);
  }, FORCE_KILL_MS).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  console.log('[dev] building @nextdog/core (sidecar)…');
  await run('pnpm', ['--filter', '@nextdog/core', 'build']);

  console.log(`[dev] starting sidecar on ${SIDECAR_URL} (scratch data: ${DATA_DIR})`);
  start('sidecar', process.execPath, [join('packages', 'core', 'dist', 'cli.js')], {
    NEXTDOG_URL: SIDECAR_URL,
    NEXTDOG_DATA_DIR: DATA_DIR,
    // Empty string disables the sidecar's own static UI serving — the UI is
    // served by the Vite dev server below (hot reload), not the built dist.
    NEXTDOG_UI_DIR: '',
  });

  const healthy = await waitForHealth(SIDECAR_URL);
  if (!healthy) {
    console.error('[dev] sidecar did not become healthy in time');
    shutdown(1);
    return;
  }

  console.log(`[dev] starting UI Vite dev server on ${DASHBOARD_URL}`);
  start('ui', 'pnpm', ['--filter', '@nextdog/ui', 'dev'], {
    NEXTDOG_DEV_UI_PORT: UI_PORT,
    // The UI reads this in dev to reach the sidecar's SSE/API cross-origin.
    VITE_NEXTDOG_SIDECAR_URL: SIDECAR_URL,
  });

  console.log('[dev] seeding baseline telemetry, then live trickle…');
  start(
    'seed',
    process.execPath,
    [join('scripts', 'dev-telemetry.mjs'), '--url', SIDECAR_URL, '--live'],
    {},
  );

  console.log(`
  ────────────────────────────────────────────────
   NextDog dev harness is up.

   Dashboard:  ${DASHBOARD_URL}
   Sidecar:    ${SIDECAR_URL}

   (The UI may take a moment to finish its first build.)
   Press Ctrl-C to stop all three.
  ────────────────────────────────────────────────
`);
}

main().catch((err) => {
  console.error('[dev]', err);
  shutdown(1);
});
