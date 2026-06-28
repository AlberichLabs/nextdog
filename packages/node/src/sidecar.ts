import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, parse as parsePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NEXTDOG_HEALTH_MARKER } from '@nextdog/core';

const NEXTDOG_DIR = join(homedir(), '.nextdog');
const PID_FILE = join(NEXTDOG_DIR, 'nextdog.pid');
const LOG_FILE = join(NEXTDOG_DIR, 'sidecar.log');

const PROBE_TIMEOUT_MS = 2000;

/**
 * Classification of whatever is (or isn't) listening at `${url}/health`:
 *
 * - `nextdog`:  a 2xx whose JSON body carries the NextDog `service` signature —
 *               a genuine sidecar, safe to adopt.
 * - `foreign`:  a 2xx that does NOT carry the signature (non-JSON, or JSON
 *               without the marker) — some unrelated process holds the port.
 * - `absent`:   nothing usable answered (connection refused, timeout, non-2xx).
 */
type ProbeResult = 'nextdog' | 'foreign' | 'absent';

/**
 * Single source of truth for reading and classifying `${url}/health`. Both
 * {@link isHealthy} and {@link isForeignOccupant} are thin views over this so
 * the fetch/timeout/JSON/marker logic lives in exactly one place.
 *
 * @internal exported for testing.
 */
export async function probeHealth(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return 'absent';
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return 'foreign'; // 2xx, but not even JSON — something else holds the port.
    }
    const marked =
      typeof body === 'object' &&
      body !== null &&
      (body as { service?: unknown }).service === NEXTDOG_HEALTH_MARKER;
    return marked ? 'nextdog' : 'foreign';
  } catch {
    return 'absent'; // connection refused / aborted — port is free, not foreign.
  }
}

/**
 * Whether `${url}/health` is answered by a genuine NextDog sidecar. A 2xx alone
 * is NOT enough: the body must be JSON carrying the `service: "nextdog"`
 * signature, so we never silently ship telemetry to a foreign process (#17).
 *
 * @internal exported for testing.
 */
export async function isHealthy(url: string): Promise<boolean> {
  return (await probeHealth(url)) === 'nextdog';
}

/**
 * Whether `${url}/health` is answered by a process that is NOT a NextDog
 * sidecar (a 2xx lacking the signature). Distinguishes "foreign occupant" from
 * "nothing listening" — the latter returns false.
 */
async function isForeignOccupant(url: string): Promise<boolean> {
  return (await probeHealth(url)) === 'foreign';
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(): Promise<number | null> {
  try {
    const content = await readFile(PID_FILE, 'utf-8');
    const pid = Number(content.trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * A `file://` URL points at a real on-disk location only if none of its path
 * segments is a bundler-virtual placeholder. Turbopack rewrites a bundled
 * module's `import.meta.url` to a virtual URL carrying a literal `[project]`
 * segment (and similar `[...]` markers), so `createRequire()` on that URL
 * resolves dependencies to non-existent `[project]/node_modules/...` paths.
 * See issue #15.
 *
 * @internal exported for testing.
 */
export function isRealFileUrl(url: string): boolean {
  if (!url.startsWith('file:')) return false;
  let p: string;
  try {
    p = fileURLToPath(url);
  } catch {
    return false;
  }
  // Reject any virtual `[...]` path segment (e.g. Turbopack's `[project]`).
  return !/\[[^/\\]+\]/.test(p);
}

function coreCliFromPackageJson(corePkgPath: string): string {
  return join(dirname(corePkgPath), 'dist', 'cli.js');
}

/**
 * Resolve the absolute path to the `@nextdog/core` CLI (`dist/cli.js`) in a way
 * that works regardless of the bundler the host dev server uses.
 *
 * Resolution order, returning the first candidate that exists on disk:
 *  1. `createRequire(anchorUrl)` — the module's own `import.meta.url`, but only
 *     when it is a real on-disk URL (skipped under Turbopack's virtual URL).
 *  2. `createRequire(<projectRoot>/package.json)` — resolves through the real
 *     `node_modules` graph of the user's project, independent of any bundler.
 *  3. A direct walk up the `node_modules` chain from the project root.
 *
 * Each candidate is validated against the filesystem before being returned, so
 * a bundler that hands us a plausible-but-wrong path never makes it through.
 *
 * @internal exported for testing.
 */
export function resolveCoreCliPath(
  opts: { anchorUrl?: string; projectRoot?: string } = {},
): string {
  const anchorUrl = opts.anchorUrl ?? import.meta.url;
  const projectRoot = opts.projectRoot ?? process.cwd();

  const tried: string[] = [];

  const tryRequire = (fromUrl: string): string | undefined => {
    let req: NodeJS.Require;
    try {
      req = createRequire(fromUrl);
    } catch {
      return undefined;
    }
    for (const spec of ['@nextdog/core/package.json', '@nextdog/core/dist/cli.js']) {
      try {
        const resolved = req.resolve(spec);
        const cli = spec.endsWith('package.json') ? coreCliFromPackageJson(resolved) : resolved;
        tried.push(cli);
        if (existsSync(cli)) return cli;
      } catch {
        // not resolvable from this anchor — try the next spec/anchor
      }
    }
    return undefined;
  };

  // 1. The module's own location — but only if it's a real, non-virtual URL.
  //    Under Turbopack this is virtual and is skipped so we don't resolve to a
  //    bogus `[project]/node_modules/...` path.
  if (isRealFileUrl(anchorUrl)) {
    const fromAnchor = tryRequire(anchorUrl);
    if (fromAnchor) return fromAnchor;
  }

  // 2. Resolve through the real project root's module graph. `process.cwd()` is
  //    the user's project directory and is never virtualized by a bundler.
  const fromProject = tryRequire(pathToFileURL(join(projectRoot, 'package.json')).href);
  if (fromProject) return fromProject;

  // 3. Last-resort: walk up node_modules from the project root and probe for an
  //    installed @nextdog/core (covers hoisted and nested layouts).
  let dir = projectRoot;
  for (;;) {
    const cli = join(dir, 'node_modules', '@nextdog', 'core', 'dist', 'cli.js');
    tried.push(cli);
    if (existsSync(cli)) return cli;
    const parent = parsePath(dir).dir;
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    '@nextdog/core not found. Make sure it is installed: npm install @nextdog/core' +
      (tried.length ? ` (looked in: ${tried.join(', ')})` : ''),
  );
}

/**
 * Outcome of {@link ensureSidecar}.
 *
 * - `ready`: a verified NextDog sidecar is reachable; telemetry is safe to send.
 * - `foreignOccupant`: the configured port is held by a non-NextDog process, so
 *   we refused to adopt it. Callers should NOT register telemetry — it would be
 *   shipped to an unknown local process.
 */
export interface SidecarStatus {
  ready: boolean;
  foreignOccupant: boolean;
}

async function spawnSidecar(url: string): Promise<void> {
  const coreCliPath = resolveCoreCliPath();

  await mkdir(NEXTDOG_DIR, { recursive: true });

  // Write sidecar stdout/stderr to a log file for debugging
  const logFd = await open(LOG_FILE, 'a');

  const child = spawn('node', [coreCliPath], {
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    env: { ...process.env, NEXTDOG_URL: url },
  });
  child.unref();

  // Close our handle — the child process has its own fd now
  await logFd.close();

  if (child.pid) {
    await writeFile(PID_FILE, String(child.pid), 'utf-8');
  }

  // Wait for the sidecar to become healthy (up to 3 seconds)
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isHealthy(url)) return;
  }

  console.warn(`[nextdog] sidecar spawned (PID ${child.pid}) but health check not passing yet`);
  console.warn(`[nextdog] check ${LOG_FILE} for sidecar logs`);
}

/** Track ports we've already warned about so the foreign-occupant notice fires once. */
const warnedForeignPorts = new Set<string>();

function warnForeignOccupant(url: string): void {
  if (warnedForeignPorts.has(url)) return;
  warnedForeignPorts.add(url);
  console.warn(
    `[nextdog] ${url} is already in use by a process that is NOT a NextDog sidecar ` +
      `(its /health response lacks the NextDog signature).`,
  );
  console.warn(
    `[nextdog] refusing to adopt it — no telemetry will be sent and no dashboard will start. ` +
      `Free the port, or set NEXTDOG_URL to a different port.`,
  );
}

/** Exposed for tests so each case starts from a clean warning state. */
export function _resetForeignOccupantWarnings(): void {
  warnedForeignPorts.clear();
}

export async function ensureSidecar(url: string): Promise<SidecarStatus> {
  // Already running and healthy — fast path
  if (await isHealthy(url)) return { ready: true, foreignOccupant: false };

  // The port answers 2xx but without the NextDog signature: a foreign process
  // holds it. Do not adopt it; warn once and tell the caller to skip telemetry.
  if (await isForeignOccupant(url)) {
    warnForeignOccupant(url);
    return { ready: false, foreignOccupant: true };
  }

  // PID file exists and process is alive — wait for it to become healthy
  const pid = await readPid();
  if (pid && (await isProcessRunning(pid))) {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isHealthy(url)) return { ready: true, foreignOccupant: false };
    }
    console.warn(`[nextdog] sidecar process ${pid} is running but not responding at ${url}`);
    console.warn(`[nextdog] check ${LOG_FILE} for sidecar logs`);
    return { ready: false, foreignOccupant: false };
  }

  // No sidecar running — spawn one
  try {
    await spawnSidecar(url);
  } catch (err) {
    console.warn('[nextdog] failed to spawn sidecar:', (err as Error).message);
    console.warn('[nextdog] you can start it manually with: npx nextdog');
    return { ready: false, foreignOccupant: false };
  }

  // Confirm the thing now answering is genuinely our sidecar (a foreign process
  // could have bound the port in the race window).
  if (await isHealthy(url)) return { ready: true, foreignOccupant: false };
  if (await isForeignOccupant(url)) {
    warnForeignOccupant(url);
    return { ready: false, foreignOccupant: true };
  }
  return { ready: false, foreignOccupant: false };
}
