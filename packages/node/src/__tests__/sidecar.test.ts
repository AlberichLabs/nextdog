import { NEXTDOG_HEALTH_MARKER } from '@nextdog/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process so the spawn-path test never launches a real, detached
// sidecar that would squat on :6789 after the suite. The mock returns an inert
// child (no real OS process). Every other test stubs fetch and never reaches
// spawn, so this is inert for them.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ pid: undefined, unref: vi.fn() })),
}));

import { _resetForeignOccupantWarnings, ensureSidecar, isHealthy, probeHealth } from '../sidecar';

const mockFetch = vi.fn();

/** A response shaped like a real NextDog `/health` reply (post-#79 it carries a version). */
function nextdogHealth(version = '1.0.0') {
  return {
    ok: true,
    json: () => Promise.resolve({ status: 'ok', service: NEXTDOG_HEALTH_MARKER, version }),
  };
}

/** A 2xx response from some unrelated process squatting on the port. */
function foreignHealth(body: unknown = 'not nextdog') {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('probeHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies a real NextDog /health response as nextdog', async () => {
    mockFetch.mockResolvedValueOnce(nextdogHealth());
    await expect(probeHealth('http://localhost:6789')).resolves.toBe('nextdog');
  });

  it('classifies a 2xx without the signature as foreign', async () => {
    mockFetch.mockResolvedValueOnce(foreignHealth());
    await expect(probeHealth('http://localhost:6789')).resolves.toBe('foreign');
  });

  it('classifies a 2xx whose JSON lacks the marker as foreign', async () => {
    mockFetch.mockResolvedValueOnce(foreignHealth({ status: 'ok' }));
    await expect(probeHealth('http://localhost:6789')).resolves.toBe('foreign');
  });

  it('classifies a non-2xx response as absent', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
    await expect(probeHealth('http://localhost:6789')).resolves.toBe('absent');
  });

  it('classifies a connection failure as absent', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(probeHealth('http://localhost:6789')).resolves.toBe('absent');
  });
});

describe('isHealthy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a real NextDog /health response', async () => {
    mockFetch.mockResolvedValueOnce(nextdogHealth());
    await expect(isHealthy('http://localhost:6789')).resolves.toBe(true);
  });

  it('rejects a 2xx response without the NextDog signature', async () => {
    mockFetch.mockResolvedValueOnce(foreignHealth());
    await expect(isHealthy('http://localhost:6789')).resolves.toBe(false);
  });

  it('rejects a 2xx response whose JSON lacks the marker', async () => {
    mockFetch.mockResolvedValueOnce(foreignHealth({ status: 'ok' }));
    await expect(isHealthy('http://localhost:6789')).resolves.toBe(false);
  });

  it('rejects a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
    await expect(isHealthy('http://localhost:6789')).resolves.toBe(false);
  });
});

describe('ensureSidecar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    _resetForeignOccupantWarnings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ready immediately when a verified same-version sidecar answers', async () => {
    mockFetch.mockResolvedValue(nextdogHealth('1.0.0'));
    // Same installed version → reuse the running sidecar (fast path, no upgrade).
    const result = await ensureSidecar('http://localhost:6789', { installedVersion: '1.0.0' });
    expect(result.ready).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:6789/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not throw if health check fails', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));
    // With every health probe failing and no live sidecar, ensureSidecar falls
    // through to spawning one. child_process.spawn is mocked (see top of file) so
    // the test never leaves a real, detached sidecar squatting on :6789 after the
    // suite — it previously could, since the spawned child is `unref`'d and never
    // reaped. We assert the public contract (resolves, doesn't throw) only.
    await expect(ensureSidecar('http://localhost:6789')).resolves.toBeTruthy();
  });

  it('refuses to adopt a foreign 2xx process and reports not ready', async () => {
    // Every probe returns a non-NextDog 2xx (port squatted by another server).
    mockFetch.mockResolvedValue(foreignHealth());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ensureSidecar('http://localhost:6789');

    expect(result.ready).toBe(false);
    expect(result.foreignOccupant).toBe(true);
    // A clear warning naming the port must be surfaced.
    const warned = warn.mock.calls.flat().join(' ');
    expect(warned).toContain('6789');
    expect(warned.toLowerCase()).toContain('nextdog');
  });
});
