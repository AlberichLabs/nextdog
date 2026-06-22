import { describe, it, expect } from 'vitest';
import { matchesQuery } from '../matcher.js';
import { groupFilterTokens } from '../filter-query.js';
import { ALL_EVENTS } from './fixtures.js';

/**
 * These assertions pin the ported grammar to the canonical UI semantics
 * (packages/ui/src/utils/filter-query.ts + packages/ui/src/hooks/use-events.ts):
 *   - groups are AND'd, tokens within a group are OR'd
 *   - `!`/`-` negate
 *   - facet keys and their `===` vs `includes` semantics match the UI matcher
 * If the UI grammar changes, update the port and these tests together.
 */

function run(query: string) {
  return ALL_EVENTS.filter((e) => matchesQuery(e, query));
}

describe('grammar grouping parity', () => {
  it('OR binds adjacent tokens into one group', () => {
    expect(groupFilterTokens('a OR b c')).toEqual([
      [
        expect.objectContaining({ value: 'a', operator: 'AND' }),
        expect.objectContaining({ value: 'b', operator: 'OR' }),
      ],
      [expect.objectContaining({ value: 'c', operator: 'AND' })],
    ]);
  });

  it('a leading OR starts a fresh group rather than matching nothing', () => {
    expect(groupFilterTokens('OR a')).toEqual([
      [expect.objectContaining({ value: 'a' })],
    ]);
  });
});

describe('matcher parity', () => {
  it('empty query matches everything', () => {
    expect(run('').length).toBe(ALL_EVENTS.length);
  });

  it('level:error is an exact, case-insensitive facet match', () => {
    expect(run('level:ERROR').map((e) => e.data.message)).toEqual([
      'checkout failed: card declined',
    ]);
  });

  it('route: is a substring facet match', () => {
    const ids = run('route:/api').map((e) => e.data.spanId);
    expect(ids).toContain('web-ok-root');
    expect(ids).toContain('web-checkout-root');
  });

  it('AND across groups narrows', () => {
    // service:web AND level:error -> only the web error log
    const r = run('service:web level:error');
    expect(r.map((e) => e.data.message)).toEqual(['checkout failed: card declined']);
  });

  it('OR within a group widens', () => {
    const r = run('level:error OR level:warn');
    expect(r.map((e) => e.data.message).sort()).toEqual([
      'checkout failed: card declined',
      'retrying charge',
    ]);
  });

  it('negation excludes', () => {
    const r = run('!service:payments');
    expect(r.every((e) => e.data.serviceName !== 'payments')).toBe(true);
  });

  it('free text searches across name/message/attributes', () => {
    const r = run('declined');
    const subjects = r.map((e) => e.data.message ?? e.data.name);
    expect(subjects).toContain('checkout failed: card declined');
    expect(subjects).toContain('charge'); // matched via exception.stacktrace attribute
  });

  it('status:ERROR matches spans by status code field', () => {
    const r = run('status:ERROR');
    expect(r.map((e) => e.data.spanId).sort()).toEqual(
      ['payments-charge', 'web-checkout-root'].sort()
    );
  });
});
