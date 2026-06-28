import { describe, expect, it } from 'vitest';
import { flattenObject } from '../console-patch';

describe('flattenObject', () => {
  it('flattens nested objects into dot-notation keys', () => {
    const result = flattenObject({ a: 1, b: { c: 2, d: { e: 3 } } });
    expect(result).toEqual({ a: 1, 'b.c': 2, 'b.d.e': 3 });
  });

  it('leaves arrays and Dates as leaf values (does not descend)', () => {
    const date = new Date('2020-01-01T00:00:00Z');
    const result = flattenObject({ list: [1, 2], when: date });
    expect(result.list).toEqual([1, 2]);
    expect(result.when).toBe(date);
  });

  it('does not stack-overflow on a self-referential (cyclic) object', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj; // direct cycle
    const child: Record<string, unknown> = { parent: obj };
    obj.child = child; // indirect cycle back to obj via child.parent

    let result: Record<string, unknown> | undefined;
    expect(() => {
      result = flattenObject(obj);
    }).not.toThrow();

    // The non-cyclic data still comes through...
    expect(result?.name).toBe('root');
    // ...and the back-references are replaced with a sentinel, not recursed.
    const sentinels = Object.values(result ?? {}).filter((v) => v === '[Circular]');
    expect(sentinels.length).toBeGreaterThan(0);
  });

  it('does not stack-overflow on a pathologically deep object and caps depth', () => {
    // Build an object ~1000 levels deep — would overflow an unguarded recursion.
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let i = 0; i < 1000; i++) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    cursor.leaf = 'bottom';

    let result: Record<string, unknown> | undefined;
    expect(() => {
      result = flattenObject(root);
    }).not.toThrow();

    // Beyond the depth limit, the subtree is summarized as '[Object]' rather than
    // expanded — so the deep 'leaf' value never appears.
    const values = Object.values(result ?? {});
    expect(values).toContain('[Object]');
    expect(JSON.stringify(result)).not.toContain('bottom');
  });
});
