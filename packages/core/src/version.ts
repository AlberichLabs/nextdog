import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The running sidecar's own version, read from `@nextdog/core`'s `package.json`.
 *
 * This is the value the `/health` endpoint advertises so a client
 * (`@nextdog/node`'s sidecar probe) can tell whether an already-running sidecar
 * is the same build it would spawn — the basis for the version-aware auto-upgrade
 * (issue #79).
 *
 * `package.json` sits one directory above both the source module (`src/version.ts`)
 * and its compiled output (`dist/version.js`), so `../package.json` relative to
 * `import.meta.url` resolves correctly whether we are running from `src` (tests)
 * or `dist` (published). Any read/parse failure degrades to `'0.0.0'` rather than
 * throwing — a missing version must never take the sidecar down.
 */
export function readCoreVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
