import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureSidecar, isHealthy, _resetForeignOccupantWarnings } from '../sidecar.js';

const mockFetch = vi.fn();

/** A response shaped like a real NextDog `/health` reply. */
function nextdogHealth() {
  return {
    ok: true,
    json: () => Promise.resolve({ status: 'ok', service: 'nextdog' }),
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

  it('returns ready immediately when a verified sidecar answers', async () => {
    mockFetch.mockResolvedValueOnce(nextdogHealth());
    const result = await ensureSidecar('http://localhost:6789');
    expect(result.ready).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:6789/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('does not throw if health check fails', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));
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
