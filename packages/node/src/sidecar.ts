import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
 * A classified `${url}/health` probe. When `kind` is `nextdog`, `version` carries
 * the sidecar's self-reported build (from its `/health` payload) — or `undefined`
 * for a pre-#79 sidecar that predates the version handshake. `version` is only ever
 * present for `nextdog`.
 */
export interface SidecarProbe {
  kind: ProbeResult;
  version?: string;
}

/**
 * Single source of truth for reading and classifying `${url}/health`, including the
 * sidecar's advertised version. {@link probeHealth}, {@link isHealthy} and
 * {@link isForeignOccupant} are thin views over this so the fetch/timeout/JSON/marker
 * logic lives in exactly one place.
 *
 * @internal exported for testing.
 */
export async function probeSidecar(url: string): Promise<SidecarProbe> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return { kind: 'absent' };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: 'foreign' }; // 2xx, but not even JSON — something else holds the port.
    }
    if (typeof body !== 'object' || body === null) return { kind: 'foreign' };
    const marked = (body as { service?: unknown }).service === NEXTDOG_HEALTH_MARKER;
    if (!marked) return { kind: 'foreign' };
    const rawVersion = (body as { version?: unknown }).version;
    return { kind: 'nextdog', version: typeof rawVersion === 'string' ? rawVersion : undefined };
  } catch {
    return { kind: 'absent' }; // connection refused / aborted — port is free, not foreign.
  }
}

/**
 * Classification-only view over {@link probeSidecar}.
 *
 * @internal exported for testing.
 */
export async function probeHealth(url: string): Promise<ProbeResult> {
  return (await probeSidecar(url)).kind;
}

/**
 * Compare two `x.y.z` versions, ignoring any prerelease/build suffix on the
 * release core. Returns -1 if `a < b`, 1 if `a > b`, 0 if equal (or unparseable —
 * an ambiguous compare must never trigger a churny "upgrade").
 *
 * @internal exported for testing.
 */
export function compareVersions(a: string, b: string): number {
  const core = (v: string) =>
    v
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number(n));
  const pa = core(a);
  const pb = core(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Decide whether an already-running sidecar (`running`, from its `/health`) should
 * be auto-upgraded to the `installed` `@nextdog/core` build. Upgrade only when the
 * running sidecar is strictly older, or when it predates the version handshake and
 * reports no version at all. Never downgrade, and never churn when we cannot tell
 * what the installed target is.
 *
 * @internal exported for testing.
 */
export function shouldUpgrade(running: string | undefined, installed: string | undefined): boolean {
  if (!installed) return false; // can't determine the target — leave the running one alone
  if (!running) return true; // pre-#79 sidecar with no version → stale, upgrade it
  return compareVersions(running, installed) < 0;
}

/**
 * Read the version of the installed `@nextdog/core` — the build that would be
 * spawned as the sidecar. Resolves `@nextdog/core/package.json` through the same
 * bundler-robust strategy as {@link resolveCoreCliPath}, then reads its `version`.
 * Returns `undefined` if it cannot be resolved (in which case we never upgrade).
 *
 * @internal exported for testing.
 */
export function resolveInstalledCoreVersion(
  opts: { anchorUrl?: string; projectRoot?: string } = {},
): string | undefined {
  const anchorUrl = opts.anchorUrl ?? import.meta.url;
  const projectRoot = opts.projectRoot ?? process.cwd();

  const candidates: string[] = [];
  const tryResolve = (fromUrl: string): void => {
    try {
      candidates.push(createRequire(fromUrl).resolve('@nextdog/core/package.json'));
    } catch {
      // not resolvable from this anchor
    }
  };

  if (isRealFileUrl(anchorUrl)) tryResolve(anchorUrl);
  tryResolve(pathToFileURL(join(projectRoot, 'package.json')).href);

  // Last resort: walk up node_modules from the project root.
  let dir = projectRoot;
  for (;;) {
    candidates.push(join(dir, 'node_modules', '@nextdog', 'core', 'package.json'));
    const parent = parsePath(dir).dir;
    if (parent === dir) break;
    dir = parent;
  }

  for (const pkgPath of candidates) {
    try {
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // unreadable/malformed — try the next candidate
    }
  }
  return undefined;
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

/**
 * Ask the sidecar at `url` to shut down gracefully (flush → release port → exit)
 * via its `/shutdown` control endpoint, then wait until the port is actually free.
 * The request may be interrupted as the process tears itself down mid-response — we
 * treat that as success and confirm by polling until nothing answers `/health`.
 * Returns whether the port became free within `timeoutMs`.
 */
async function shutdownAndAwaitPortFree(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    await fetch(`${url}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // Socket dropped as the sidecar exited — expected; the poll below is the truth.
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await probeSidecar(url)).kind === 'absent') return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function ensureSidecar(
  url: string,
  opts: { installedVersion?: string } = {},
): Promise<SidecarStatus> {
  const probe = await probeSidecar(url);

  if (probe.kind === 'nextdog') {
    const installed = opts.installedVersion ?? resolveInstalledCoreVersion();
    // Same (or newer) version — reuse the running sidecar. This is the fast path
    // that intentionally survives a `next dev` restart (the detached sidecar keeps
    // running and we re-adopt it).
    if (!shouldUpgrade(probe.version, installed)) {
      return { ready: true, foreignOccupant: false };
    }

    // Version mismatch — LOSSLESS auto-upgrade. Signal the old sidecar to flush and
    // release the port, wait for the handoff, then spawn the installed build on the
    // SAME port + NEXTDOG_DATA_DIR so it inherits all history from the shared store.
    console.warn(`[nextdog] upgrading sidecar ${probe.version ?? 'unknown'} → ${installed}`);
    const freed = await shutdownAndAwaitPortFree(url);
    if (!freed) {
      // Couldn't reclaim the port — the old sidecar still works, so keep using it
      // rather than fighting over :6789.
      console.warn('[nextdog] could not free the old sidecar; continuing with the running one');
      return { ready: true, foreignOccupant: false };
    }
    // fall through to spawn a fresh sidecar on the freed port
  } else if (probe.kind === 'foreign') {
    // The port answers 2xx but without the NextDog signature: a foreign process
    // holds it. Do not adopt it; warn once and tell the caller to skip telemetry.
    warnForeignOccupant(url);
    return { ready: false, foreignOccupant: true };
  } else {
    // Nothing answering. A sidecar we spawned may still be booting — if its PID is
    // alive, wait for it to become healthy before spawning a duplicate.
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
  }

  // Spawn a new sidecar (fresh start, or the freshly-freed port after an upgrade).
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
