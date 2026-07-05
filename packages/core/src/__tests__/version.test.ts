import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readCoreVersion } from '../version';

describe('readCoreVersion', () => {
  it("returns @nextdog/core's own package.json version", () => {
    // Read the source-of-truth directly so the test tracks whatever the package
    // is currently versioned at (it is bumped by the release workflow).
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const expected = JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string;
    expect(readCoreVersion()).toBe(expected);
  });

  it('returns a non-empty semver-ish string', () => {
    expect(readCoreVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
