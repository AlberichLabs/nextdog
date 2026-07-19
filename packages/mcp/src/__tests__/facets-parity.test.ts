import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SOURCE-LEVEL PARITY GUARD for the two hand-kept mirrors of `deriveFacets`:
 *
 *   - `packages/ui/src/utils/facets.ts`   (typed against Preact's `SSEEvent`)
 *   - `packages/mcp/src/facets.ts`        (typed against the MCP's `SidecarEvent`)
 *
 * The duplication is deliberate and is NOT being de-duped (#94): every route to a
 * shared module either gives `@nextdog/mcp` a `@nextdog` workspace runtime dep
 * (it is intentionally kept ZERO-dep — see `.github/workflows/publish.yml`),
 * forces `mcp`'s `tsc` build onto a bundler, or inverts the publish graph.
 *
 * The reduction logic in the two files is meant to be BYTE-identical apart from
 * one legitimate difference — the event *type annotation* (`SSEEvent` vs
 * `SidecarEvent`) and its import. This guard reads both files from disk, cancels
 * ONLY that difference, and asserts the shared surface is identical so the two
 * mirrors cannot silently drift (a deny-list edit on one side, a changed sort,
 * a tweaked cardinality cap, …). It replaces the informal "keep these in sync"
 * comment with something CI enforces.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_FACETS = path.resolve(here, '../../../ui/src/utils/facets.ts');
const MCP_FACETS = path.resolve(here, '../facets.ts');

const DIVERGENCE_MESSAGE =
  'facets.ts mirrors have diverged — update BOTH ' +
  'packages/ui/src/utils/facets.ts and packages/mcp/src/facets.ts so their ' +
  'deriveFacets reduction (extractors, ATTR_DENY_SEGMENT, MAX_ATTR_CARDINALITY, ' +
  'ordering) stays identical. The only sanctioned difference is the event type ' +
  'annotation (SSEEvent vs SidecarEvent). See #94.';

/**
 * Reduce a facets source file to just its shared reduction surface, cancelling
 * the one sanctioned difference. Intentionally STRICT: it does not touch
 * indentation or token spacing, so any real logic edit (a changed operator,
 * value, regex segment, or reordered branch) still shows up as a mismatch. The
 * only things removed are the event-type token (normalized to a placeholder),
 * doc/comment prose (carries no logic), and blank lines.
 */
function sharedSurface(src: string): string {
  let s = src;

  // Drop the UI-only `filterFacets` helper: it has no MCP mirror and is not
  // part of the shared reduction surface.
  const filterIdx = s.indexOf('export function filterFacets');
  if (filterIdx !== -1) s = s.slice(0, filterIdx);

  // Start at the first shared declaration; this excludes the differing file
  // header comment AND the differing `import type { … }` line above it (the
  // import paths legitimately differ: '../hooks/use-sse' vs './types').
  const start = s.indexOf('export interface FacetValue');
  if (start === -1) throw new Error('facets parity guard: could not find shared-surface start marker');
  s = s.slice(start);

  // The ONE sanctioned logic difference: the event type annotation token, used
  // in `type EventData = X['data']` and the `X[]` function signatures.
  s = s.replace(/\bSSEEvent\b/g, '__EVENT__').replace(/\bSidecarEvent\b/g, '__EVENT__');

  // Strip block comments (the JSDoc prose diverges by design) and full-line
  // `//` comments. Neither carries logic, so removing them cannot mask an edit.
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/^[ \t]*\/\/.*$/gm, '');

  // Drop blank lines and trailing whitespace only. Every remaining code line is
  // compared verbatim, indentation included.
  return s
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');
}

describe('deriveFacets source parity (ui ⇄ mcp mirrors, #94)', () => {
  const uiSrc = readFileSync(UI_FACETS, 'utf8');
  const mcpSrc = readFileSync(MCP_FACETS, 'utf8');

  it('keeps the two deriveFacets mirrors byte-identical on their shared surface', () => {
    expect(sharedSurface(mcpSrc), DIVERGENCE_MESSAGE).toBe(sharedSurface(uiSrc));
  });

  it('explicitly pins the credential-leak deny-list in BOTH mirrors', () => {
    // Belt-and-suspenders on top of the behavioural pin in `facets.test.ts`:
    // the sensitive-attribute deny-list must be present at the source level in
    // each file so introspection can never become a credential-leak side
    // channel (#60/#90). Parity above guarantees they are the SAME regex.
    const denyLine =
      /const ATTR_DENY_SEGMENT =\s*\/\(\^\|\[\._-\]\)\(id\|ids\|uuid\|guid\|ip\|port\|time\|timestamp\|nano\|dur\|duration\|body\|header\|headers\|url\|cookie\|cookies\|token\|password\|secret\|stack\|hash\|size\|length\|count\|query\|sql\|statement\)\(\[\._-\]\|\$\)\/i;/;
    expect(uiSrc, 'ui deny-list drifted from the pinned form').toMatch(denyLine);
    expect(mcpSrc, 'mcp deny-list drifted from the pinned form').toMatch(denyLine);
    for (const secret of ['token', 'password', 'secret']) {
      expect(uiSrc).toContain(`|${secret}|`);
      expect(mcpSrc).toContain(`|${secret}|`);
    }
  });

  it('actually FAILS when a mirror diverges (guard self-test)', () => {
    // Prove the guard would catch drift, not just pass vacuously. Each mutation
    // is a real logic change to one mirror; the normalized surfaces must differ.
    const cardinalityDrift = mcpSrc.replace(
      'const MAX_ATTR_CARDINALITY = 20;',
      'const MAX_ATTR_CARDINALITY = 21;',
    );
    expect(cardinalityDrift).not.toBe(mcpSrc);
    expect(sharedSurface(cardinalityDrift)).not.toBe(sharedSurface(uiSrc));

    const denyListDrift = mcpSrc.replace('|secret|', '|');
    expect(denyListDrift).not.toBe(mcpSrc);
    expect(sharedSurface(denyListDrift)).not.toBe(sharedSurface(uiSrc));

    const sortDrift = mcpSrc.replace(
      'b.count - a.count || a.value.localeCompare(b.value)',
      'a.count - b.count || a.value.localeCompare(b.value)',
    );
    expect(sortDrift).not.toBe(mcpSrc);
    expect(sharedSurface(sortDrift)).not.toBe(sharedSurface(uiSrc));
  });

  it('ignores a comment-only edit (guard is not over-strict)', () => {
    const commentOnly = mcpSrc.replace(
      'mirror of `NAMED_SPECS` in @nextdog/ui.',
      'MIRROR of the ui NAMED_SPECS.',
    );
    expect(commentOnly).not.toBe(mcpSrc);
    expect(sharedSurface(commentOnly)).toBe(sharedSurface(uiSrc));
  });
});
