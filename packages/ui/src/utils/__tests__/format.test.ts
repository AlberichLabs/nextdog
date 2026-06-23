import { describe, expect, it } from 'vitest';
import type { SSEEvent } from '../../hooks/use-sse.js';
import { formatSpanDuration, parseNano, spanDurationMs } from '../format.js';

function span(data: Partial<SSEEvent['data']>): SSEEvent {
  return {
    type: 'span',
    timestamp: 1,
    data: {
      name: 'GET /x',
      serviceName: 'web',
      attributes: {},
      ...data,
    },
  };
}

describe('parseNano', () => {
  it('parses a plain integer string', () => {
    expect(parseNano('1000000000')).toBe(1000000000n);
  });

  it("parses the server's 'n'-suffixed serialization", () => {
    expect(parseNano('1500000000n')).toBe(1500000000n);
  });

  it('parses a bigint as-is', () => {
    expect(parseNano(1000000000n)).toBe(1000000000n);
  });

  it('returns 0n for undefined / empty', () => {
    expect(parseNano(undefined)).toBe(0n);
    expect(parseNano('')).toBe(0n);
  });

  // Issue #44: a truthy garbage string reached an unguarded BigInt() and threw
  // SyntaxError. It must degrade to 0n instead of throwing (mirrors the MCP
  // durationMs try/catch). This protects live/SSE data too, not just imports.
  it('returns 0n for a non-numeric string instead of throwing', () => {
    expect(() => parseNano('not-a-number')).not.toThrow();
    expect(parseNano('not-a-number')).toBe(0n);
  });

  it('returns 0n for a decimal / non-integer string', () => {
    expect(() => parseNano('1.5')).not.toThrow();
    expect(parseNano('1.5')).toBe(0n);
  });
});

describe('spanDurationMs', () => {
  it('computes duration from valid nanos', () => {
    expect(spanDurationMs(span({ startTimeUnixNano: '1000000000', endTimeUnixNano: '1500000000' }))).toBe(
      500,
    );
  });

  it('returns 0 when a timing field is missing', () => {
    expect(spanDurationMs(span({ startTimeUnixNano: '1000000000' }))).toBe(0);
  });

  // Issue #44 render-path regression: must not throw on crafted/invalid input.
  it('returns 0 instead of throwing on a non-numeric timing field', () => {
    const evil = span({ startTimeUnixNano: 'not-a-number', endTimeUnixNano: '999' });
    expect(() => spanDurationMs(evil)).not.toThrow();
    expect(spanDurationMs(evil)).toBe(0);
  });
});

describe('formatSpanDuration', () => {
  it('formats a valid duration', () => {
    expect(formatSpanDuration(span({ startTimeUnixNano: '1000000000', endTimeUnixNano: '1500000000' }))).toBe(
      '500.0ms',
    );
  });

  // Issue #44 render-path regression: must not throw on crafted/invalid input.
  it('returns an empty string instead of throwing on a non-numeric timing field', () => {
    const evil = span({ startTimeUnixNano: 'not-a-number', endTimeUnixNano: '999' });
    expect(() => formatSpanDuration(evil)).not.toThrow();
    expect(formatSpanDuration(evil)).toBe('');
  });
});
