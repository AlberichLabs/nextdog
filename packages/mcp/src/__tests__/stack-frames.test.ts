import { describe, expect, it } from 'vitest';
import { parseStackFrames } from '../stack-frames';

describe('parseStackFrames (#89)', () => {
  it('parses V8 frames with function, file, line and column', () => {
    const stack = [
      'Error: boom',
      '    at charge (/app/src/payments.ts:42:11)',
      '    at Object.handler (/app/src/routes/checkout.ts:8:3)',
    ].join('\n');
    const frames = parseStackFrames(stack);
    expect(frames).toEqual([
      { function: 'charge', file: '/app/src/payments.ts', line: 42, column: 11 },
      { function: 'Object.handler', file: '/app/src/routes/checkout.ts', line: 8, column: 3 },
    ]);
  });

  it('parses a V8 frame with no column (line only)', () => {
    // Mirrors the repo fixture stack `at charge (payments.ts:42)`.
    const frames = parseStackFrames('Error: card declined\n    at charge (payments.ts:42)');
    expect(frames).toEqual([{ function: 'charge', file: 'payments.ts', line: 42 }]);
  });

  it('parses an anonymous V8 frame (no function, no parens)', () => {
    const frames = parseStackFrames('Error: x\n    at /app/worker.js:3:9');
    expect(frames).toEqual([{ file: '/app/worker.js', line: 3, column: 9 }]);
  });

  it('strips a leading `async ` qualifier from the function name', () => {
    const frames = parseStackFrames('Error: x\n    at async load (/app/a.ts:5:1)');
    expect(frames?.[0]).toEqual({ function: 'load', file: '/app/a.ts', line: 5, column: 1 });
  });

  it('parses Firefox/Safari `func@file:line:col` frames', () => {
    const stack = ['charge@/app/payments.js:42:11', '@/app/main.js:1:0'].join('\n');
    const frames = parseStackFrames(stack);
    expect(frames).toEqual([
      { function: 'charge', file: '/app/payments.js', line: 42, column: 11 },
      { file: '/app/main.js', line: 1, column: 0 },
    ]);
  });

  it('keeps a Windows drive-letter path intact', () => {
    const frames = parseStackFrames('Error: x\n    at run (C:\\app\\a.ts:10:5)');
    expect(frames).toEqual([{ function: 'run', file: 'C:\\app\\a.ts', line: 10, column: 5 }]);
  });

  it('skips non-frame lines but keeps the parseable ones', () => {
    const stack = [
      'Error: partial',
      '    at good (/app/a.ts:1:1)',
      '    ...garbage that is not a frame...',
      '    at also.good (/app/b.ts:2:2)',
    ].join('\n');
    const frames = parseStackFrames(stack);
    expect(frames?.map((f) => f.file)).toEqual(['/app/a.ts', '/app/b.ts']);
  });

  it('returns undefined for an unparseable stack (never throws)', () => {
    expect(parseStackFrames('not a stack at all')).toBeUndefined();
    expect(parseStackFrames('')).toBeUndefined();
    expect(parseStackFrames('Error: only a message, no frames')).toBeUndefined();
  });
});
