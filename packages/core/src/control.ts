import { NEXTDOG_HEALTH_MARKER } from './health';

const PROBE_TIMEOUT_MS = 2000;

export type CliCommand = 'start' | 'stop' | 'restart';

/**
 * Map `process.argv.slice(2)` to a sidecar CLI command. Anything other than an
 * explicit `stop`/`restart` boots the sidecar (`start`) — the zero-arg `nextdog`
 * invocation and any stray flag must never silently do nothing.
 */
export function parseCliCommand(args: string[]): CliCommand {
  const cmd = args[0];
  if (cmd === 'stop') return 'stop';
  if (cmd === 'restart') return 'restart';
  return 'start';
}

type Occupant = 'nextdog' | 'foreign' | 'absent';

/** Classify whatever answers `${url}/health` (mirrors the client-side probe). */
async function probeOccupant(url: string): Promise<Occupant> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return 'absent';
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return 'foreign';
    }
    const marked =
      typeof body === 'object' &&
      body !== null &&
      (body as { service?: unknown }).service === NEXTDOG_HEALTH_MARKER;
    return marked ? 'nextdog' : 'foreign';
  } catch {
    return 'absent';
  }
}

export type StopResult = 'stopped' | 'not-running' | 'foreign';

/**
 * Gracefully stop a running NextDog sidecar at `url` via its `/shutdown` control
 * endpoint, then wait for the port to be released. Only a process carrying the
 * NextDog `/health` signature is touched — a foreign occupant is left alone
 * (`'foreign'`) and an empty port reports `'not-running'`. The shutdown itself is
 * lossless: the sidecar flushes its buffer before exiting (see server.ts).
 */
export async function stopSidecar(url: string, timeoutMs = 5000): Promise<StopResult> {
  const occupant = await probeOccupant(url);
  if (occupant === 'absent') return 'not-running';
  if (occupant === 'foreign') return 'foreign';

  try {
    await fetch(`${url}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // The socket may drop as the sidecar tears itself down mid-response — that's
    // success, not failure. We confirm by waiting for the port to free below.
  }

  // Wait for the port to actually free so a caller (e.g. `restart`) can rebind it.
  await waitForPortFree(url, timeoutMs);
  return 'stopped';
}

/**
 * Poll `${url}/health` until it stops answering (the sidecar has released the
 * port), or the timeout elapses. Returns whether the port became free.
 */
export async function waitForPortFree(url: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeOccupant(url)) === 'absent') return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return (await probeOccupant(url)) === 'absent';
}
