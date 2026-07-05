import { spawn } from 'node:child_process';
import { NEXTDOG_HEALTH_MARKER } from '@nextdog/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process so the spawn path never launches a real detached sidecar.
// A spawned "process" is inert; tests observe only that spawn was invoked.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ pid: undefined, unref: vi.fn() })),
}));

import {
  compareVersions,
  ensureSidecar,
  probeSidecar,
  resolveInstalledCoreVersion,
  shouldUpgrade,
} from '../sidecar';

const mockFetch = vi.fn();

/** A `/health` reply from a genuine NextDog sidecar reporting `version`. */
function nextdogHealth(version?: string) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        status: 'ok',
        service: NEXTDOG_HEALTH_MARKER,
        ...(version !== undefined ? { version } : {}),
      }),
  };
}

describe('compareVersions', () => {
  it('orders by major/minor/patch', () => {
    expect(compareVersions('1.1.4', '1.1.6')).toBe(-1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.1.4', '1.1.4')).toBe(0);
  });
  it('ignores a prerelease suffix on the release core', () => {
    expect(compareVersions('1.1.4-beta.1', '1.1.4')).toBe(0);
  });
});

describe('shouldUpgrade', () => {
  it('reuses when the running sidecar matches the installed version', () => {
    expect(shouldUpgrade('1.1.6', '1.1.6')).toBe(false);
  });
  it('upgrades when the running sidecar is older', () => {
    expect(shouldUpgrade('1.1.4', '1.1.6')).toBe(true);
  });
  it('does not downgrade when the running sidecar is newer', () => {
    expect(shouldUpgrade('1.2.0', '1.1.6')).toBe(false);
  });
  it('upgrades a pre-#79 sidecar that reports no version', () => {
    expect(shouldUpgrade(undefined, '1.1.6')).toBe(true);
  });
  it('does nothing when the installed version is unknown (avoids churn)', () => {
    expect(shouldUpgrade('1.1.4', undefined)).toBe(false);
  });
});

describe('resolveInstalledCoreVersion', () => {
  it('reads the installed @nextdog/core version from its package.json', () => {
    // In this monorepo @nextdog/core is a workspace dependency of @nextdog/node.
    expect(resolveInstalledCoreVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('probeSidecar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the reported version for a genuine sidecar', async () => {
    mockFetch.mockResolvedValueOnce(nextdogHealth('1.2.3'));
    await expect(probeSidecar('http://localhost:6789')).resolves.toEqual({
      kind: 'nextdog',
      version: '1.2.3',
    });
  });

  it('returns kind nextdog with undefined version for a pre-#79 sidecar', async () => {
    mockFetch.mockResolvedValueOnce(nextdogHealth());
    await expect(probeSidecar('http://localhost:6789')).resolves.toEqual({
      kind: 'nextdog',
      version: undefined,
    });
  });

  it('classifies a connection failure as absent', async () => {
    mockFetch.mockRejectedValueOnce(new Error('refused'));
    await expect(probeSidecar('http://localhost:6789')).resolves.toEqual({ kind: 'absent' });
  });
});

describe('ensureSidecar — version-aware lifecycle (#79)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.mocked(spawn).mockClear();
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses a same-version sidecar without shutting it down or spawning', async () => {
    mockFetch.mockResolvedValue(nextdogHealth('0.2.0'));

    const result = await ensureSidecar('http://localhost:6789', { installedVersion: '0.2.0' });

    expect(result).toEqual({ ready: true, foreignOccupant: false });
    expect(spawn).not.toHaveBeenCalled();
    const shutdownCalls = mockFetch.mock.calls.filter(([u]) => String(u).endsWith('/shutdown'));
    expect(shutdownCalls).toHaveLength(0);
  });

  it('lossless auto-upgrade: shuts the old sidecar down, waits for the port, then spawns the new one', async () => {
    let shutdownRequested = false;
    mockFetch.mockImplementation((input: unknown, init: { method?: string } = {}) => {
      const u = String(input);
      if (u.endsWith('/shutdown') && init.method === 'POST') {
        shutdownRequested = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ stopping: true }) });
      }
      // /health probes:
      if (!shutdownRequested) return Promise.resolve(nextdogHealth('0.1.0')); // old sidecar
      if (vi.mocked(spawn).mock.calls.length === 0) {
        return Promise.reject(new Error('connection refused')); // port freed, nothing yet
      }
      return Promise.resolve(nextdogHealth('0.2.0')); // new sidecar is up
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ensureSidecar('http://localhost:6789', { installedVersion: '0.2.0' });

    // The old sidecar was asked to shut down, and a new one was spawned on the same port.
    expect(shutdownRequested).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ready: true, foreignOccupant: false });
    // Loud, version-stamped upgrade log.
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('upgrading sidecar 0.1.0 → 0.2.0');
  });

  it('upgrades a pre-#79 sidecar reporting no version', async () => {
    let shutdownRequested = false;
    mockFetch.mockImplementation((input: unknown, init: { method?: string } = {}) => {
      const u = String(input);
      if (u.endsWith('/shutdown') && init.method === 'POST') {
        shutdownRequested = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (!shutdownRequested) return Promise.resolve(nextdogHealth()); // no version field
      if (vi.mocked(spawn).mock.calls.length === 0) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve(nextdogHealth('0.2.0'));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ensureSidecar('http://localhost:6789', { installedVersion: '0.2.0' });

    expect(shutdownRequested).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.ready).toBe(true);
  });
});
