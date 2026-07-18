import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse';
import { findRootSpan } from '../root-span';

function span(data: Partial<SSEEvent['data']>): SSEEvent {
  return {
    type: 'span',
    timestamp: 1,
    data: { name: 'GET /x', serviceName: 'web', attributes: {}, ...data },
  };
}

describe('findRootSpan', () => {
  it('returns null for an empty span list', () => {
    expect(findRootSpan([])).toBeNull();
  });

  it('picks the parent-less SERVER span as the root', () => {
    const child = span({ spanId: 'c', parentSpanId: 'r', kind: 'CLIENT' });
    const root = span({ spanId: 'r', kind: 'SERVER' });
    expect(findRootSpan([child, root])).toBe(root);
  });

  it('ignores a SERVER span that has a parent', () => {
    const nested = span({ spanId: 'n', parentSpanId: 'x', kind: 'SERVER' });
    const first = span({ spanId: 'f', kind: 'CLIENT' });
    // No parent-less SERVER span → falls back to the first span.
    expect(findRootSpan([first, nested])).toBe(first);
  });

  it('falls back to the first span when no SERVER root exists', () => {
    const a = span({ spanId: 'a', kind: 'CLIENT' });
    const b = span({ spanId: 'b', kind: 'INTERNAL' });
    expect(findRootSpan([a, b])).toBe(a);
  });
});
