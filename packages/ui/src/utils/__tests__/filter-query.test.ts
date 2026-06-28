import { describe, expect, it } from 'vitest';
import {
  composeOrExpression,
  type FilterToken,
  groupFilterTokens,
  normalizeExpression,
  parseFilterTokens,
} from '../filter-query';

/** Compact a group into a readable signature for assertions. */
function sig(groups: FilterToken[][]): string[] {
  return groups.map((g) =>
    g.map((t) => `${t.negated ? '!' : ''}${t.key ? `${t.key}:` : ''}${t.value}`).join(' OR '),
  );
}

describe('parseFilterTokens — token extraction', () => {
  it('empty / whitespace query → no tokens', () => {
    expect(parseFilterTokens('')).toEqual([]);
    expect(parseFilterTokens('   ')).toEqual([]);
  });

  it('a single key:value token defaults to the AND operator', () => {
    expect(parseFilterTokens('status:ERROR')).toEqual([
      { raw: 'status:ERROR', negated: false, key: 'status', value: 'ERROR', operator: 'AND' },
    ]);
  });

  it('bare freetext token has no key but keeps its raw form', () => {
    expect(parseFilterTokens('boom')).toEqual([
      { raw: 'boom', negated: false, value: 'boom', operator: 'AND' },
    ]);
  });

  it('raw preserves the original token incl. prefix and quotes', () => {
    expect(parseFilterTokens('!service:noisy')[0].raw).toBe('!service:noisy');
    expect(parseFilterTokens('message:"out of memory"')[0].raw).toBe('message:"out of memory"');
  });

  it('negation via ! or - is captured', () => {
    expect(parseFilterTokens('!service:noisy')[0]).toMatchObject({
      negated: true,
      key: 'service',
      value: 'noisy',
    });
    expect(parseFilterTokens('-service:noisy')[0]).toMatchObject({
      negated: true,
      key: 'service',
      value: 'noisy',
    });
  });

  it('the token after OR carries operator OR', () => {
    const toks = parseFilterTokens('status:ERROR OR statusCode:404');
    expect(toks[0]).toMatchObject({ key: 'status', value: 'ERROR', operator: 'AND' });
    expect(toks[1]).toMatchObject({ key: 'statusCode', value: '404', operator: 'OR' });
  });

  it('OR is case-insensitive', () => {
    expect(parseFilterTokens('a or b')[1].operator).toBe('OR');
    expect(parseFilterTokens('a Or b')[1].operator).toBe('OR');
  });

  it('preserves quoted values containing spaces', () => {
    expect(parseFilterTokens('message:"out of memory"')[0]).toMatchObject({
      key: 'message',
      value: 'out of memory',
    });
  });
});

describe('groupFilterTokens — OR groups the matcher consumes', () => {
  it('a single token → one AND group with one token', () => {
    expect(sig(groupFilterTokens('status:ERROR'))).toEqual(['status:ERROR']);
  });

  it('`a OR b` → a single OR group', () => {
    expect(sig(groupFilterTokens('status:ERROR OR statusCode:404'))).toEqual([
      'status:ERROR OR statusCode:404',
    ]);
  });

  it('mixed `a OR b` then `c` → (a OR b) AND c, i.e. two groups', () => {
    expect(sig(groupFilterTokens('status:ERROR OR statusCode:404 service:web'))).toEqual([
      'status:ERROR OR statusCode:404',
      'service:web',
    ]);
  });

  it('chained OR `a OR b OR c` → one group of three', () => {
    expect(sig(groupFilterTokens('a OR b OR c'))).toEqual(['a OR b OR c']);
  });

  it('multiple AND tokens → one group each', () => {
    expect(sig(groupFilterTokens('service:web status:ERROR'))).toEqual([
      'service:web',
      'status:ERROR',
    ]);
  });
});

describe('groupFilterTokens — malformed input handled gracefully', () => {
  it('trailing OR is dropped (no empty trailing token)', () => {
    expect(sig(groupFilterTokens('status:ERROR OR'))).toEqual(['status:ERROR']);
  });

  it('leading OR is ignored — first token still starts a group', () => {
    expect(sig(groupFilterTokens('OR status:ERROR'))).toEqual(['status:ERROR']);
  });

  it('doubled OR collapses, the next real token joins the group', () => {
    expect(sig(groupFilterTokens('a OR OR b'))).toEqual(['a OR b']);
  });

  it('a lone OR yields no groups', () => {
    expect(groupFilterTokens('OR')).toEqual([]);
    expect(groupFilterTokens('   OR   ')).toEqual([]);
  });
});

describe('composeOrExpression', () => {
  it('joins raw tokens with OR, ignoring blanks', () => {
    expect(composeOrExpression(['status:ERROR', 'statusCode:404'])).toBe(
      'status:ERROR OR statusCode:404',
    );
    expect(composeOrExpression(['a', '', '  ', 'b'])).toBe('a OR b');
  });

  it('round-trips: the composed expression groups back into one OR group', () => {
    const expr = composeOrExpression(['status:ERROR', 'statusCode:404']);
    const groups = groupFilterTokens(expr);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});

describe('normalizeExpression — what the UI commits on Enter', () => {
  it('drops a dangling trailing OR so a half-typed expression is not committed', () => {
    expect(normalizeExpression('status:ERROR OR')).toBe('status:ERROR');
    expect(normalizeExpression('status:ERROR OR ')).toBe('status:ERROR');
  });

  it('drops a leading operator', () => {
    expect(normalizeExpression('OR status:ERROR')).toBe('status:ERROR');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeExpression('status:ERROR    OR    statusCode:404')).toBe(
      'status:ERROR OR statusCode:404',
    );
  });

  it('a lone operator normalizes to empty', () => {
    expect(normalizeExpression('OR')).toBe('');
    expect(normalizeExpression('  AND  ')).toBe('');
  });

  it('leaves a well-formed expression untouched', () => {
    expect(normalizeExpression('status:ERROR OR statusCode:404 service:web')).toBe(
      'status:ERROR OR statusCode:404 service:web',
    );
  });
});

describe('round-trip to the matcher shape', () => {
  it('full OR expression groups into exactly one OR group of two', () => {
    const groups = groupFilterTokens('status:ERROR OR statusCode:404');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});
