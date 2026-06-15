import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveCoreCliPath, isRealFileUrl } from '../sidecar.js';

/**
 * Builds a throwaway fake project on disk that mirrors the real install layout a
 * first-time user gets when following the README quick-start:
 *
 *   <app>/package.json
 *   <app>/node_modules/@nextdog/node/dist/sidecar.js   (this module on disk)
 *   <app>/node_modules/@nextdog/core/package.json
 *   <app>/node_modules/@nextdog/core/dist/cli.js
 *
 * Paths are realpath-normalized so comparisons hold on macOS, where the temp
 * dir lives under /var -> /private/var.
 */
function makeFakeProject(): { appDir: string; realSidecarUrl: string; coreCliPath: string } {
  const appDir = realpathSync(mkdtempSync(join(tmpdir(), 'nextdog-resolve-')));

  const nodeDist = join(appDir, 'node_modules', '@nextdog', 'node', 'dist');
  mkdirSync(nodeDist, { recursive: true });
  const realSidecarFile = join(nodeDist, 'sidecar.js');
  writeFileSync(realSidecarFile, '// fake sidecar module');

  const coreDir = join(appDir, 'node_modules', '@nextdog', 'core');
  const coreDistDir = join(coreDir, 'dist');
  mkdirSync(coreDistDir, { recursive: true });
  writeFileSync(
    join(coreDir, 'package.json'),
    JSON.stringify({ name: '@nextdog/core', main: './dist/index.js', bin: { nextdog: './dist/cli.js' } })
  );
  const coreCliPath = join(coreDistDir, 'cli.js');
  writeFileSync(coreCliPath, '// fake core cli');

  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'fake-app' }));

  return { appDir, realSidecarUrl: pathToFileURL(realSidecarFile).href, coreCliPath };
}

describe('isRealFileUrl', () => {
  it('accepts a normal file URL (webpack / native ESM)', () => {
    expect(isRealFileUrl(pathToFileURL('/tmp/app/node_modules/@nextdog/node/dist/sidecar.js').href)).toBe(true);
  });

  it('rejects a Turbopack virtual URL carrying a [project] segment', () => {
    // This is the URL shape that broke resolution in issue #15.
    expect(isRealFileUrl(pathToFileURL('/tmp/app/[project]/node_modules/@nextdog/node/dist/sidecar.js').href)).toBe(false);
  });

  it('rejects other bracketed virtual segments and non-file schemes', () => {
    expect(isRealFileUrl(pathToFileURL('/tmp/[turbopack]/x.js').href)).toBe(false);
    expect(isRealFileUrl('webpack-internal:///./node_modules/@nextdog/node/dist/sidecar.js')).toBe(false);
  });
});

describe('resolveCoreCliPath (bundler-agnostic core CLI resolution)', () => {
  it('ignores a Turbopack virtual anchor and resolves core via the real project root', () => {
    // The virtual anchor points into a SEPARATE fake project that contains a
    // decoy @nextdog/core. Pre-fix, resolution trusted the anchor's module graph
    // (issue #15: it produced a non-existent `[project]/...` CLI path). The fix
    // must skip the virtual anchor entirely and resolve via the real project
    // root, returning *this* project's core CLI — never the decoy.
    const decoy = makeFakeProject();
    const real = makeFakeProject();

    const turbopackVirtualUrl = pathToFileURL(
      join(decoy.appDir, '[project]', 'node_modules', '@nextdog', 'node', 'dist', 'sidecar.js')
    ).href;

    const resolved = realpathSync(
      resolveCoreCliPath({ anchorUrl: turbopackVirtualUrl, projectRoot: real.appDir })
    );

    expect(resolved).toBe(realpathSync(real.coreCliPath));
    expect(resolved).not.toContain('[project]');
  });

  it('still resolves under a normal (webpack / native ESM) import.meta.url', () => {
    const { appDir, realSidecarUrl, coreCliPath } = makeFakeProject();

    const resolved = realpathSync(
      resolveCoreCliPath({ anchorUrl: realSidecarUrl, projectRoot: appDir })
    );

    expect(resolved).toBe(realpathSync(coreCliPath));
  });

  it('never returns a path that does not exist on disk', () => {
    const { appDir, coreCliPath } = makeFakeProject();
    const virtual = pathToFileURL(
      join(appDir, '[project]', 'node_modules', '@nextdog', 'node', 'dist', 'sidecar.js')
    ).href;

    const resolved = resolveCoreCliPath({ anchorUrl: virtual, projectRoot: appDir });

    expect(realpathSync(resolved)).toBe(realpathSync(coreCliPath));
  });
});
