import { describe, expect, it } from 'vitest';
import { getBrowserPatchScript } from '../browser-patch';

/**
 * These tests execute the generated browser-patch script inside a jsdom-like
 * environment by stubbing the browser globals it relies on (window, navigator,
 * console, document). The script captures console output and buffers logs; we
 * drive a console call and inspect the buffered payload that would be flushed
 * to the sidecar.
 */

interface BufferedLog {
  timestamp: number;
  level: string;
  message: string;
  attributes: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  serviceName: string;
}

interface RunResult {
  logs: BufferedLog[];
}

/**
 * Evaluate the patch script in a controlled sandbox and return the logs that
 * were flushed via navigator.sendBeacon. `metaTraceId` simulates the server
 * having injected a trace id into the document (read on load); pass undefined
 * to simulate a page with no injected id.
 */
function runPatch(opts: {
  metaTraceId?: string;
  metaSpanId?: string;
  drive: (sandboxConsole: Record<string, (...a: unknown[]) => void>) => void;
}): RunResult {
  const flushed: BufferedLog[] = [];

  const listeners: Record<string, Array<(e: unknown) => void>> = {};

  const metaElements: Array<{ name: string; content: string }> = [];
  if (opts.metaTraceId !== undefined) {
    metaElements.push({ name: 'nextdog-trace-id', content: opts.metaTraceId });
  }
  if (opts.metaSpanId !== undefined) {
    metaElements.push({ name: 'nextdog-span-id', content: opts.metaSpanId });
  }

  const sandboxConsole: Record<string, (...a: unknown[]) => void> = {
    debug: () => {},
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const win: Record<string, unknown> = {
    __nextdog_patched: false,
    location: { pathname: '/test' },
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      listeners[type] ??= [];
      listeners[type].push(cb);
    },
    // setInterval is a no-op here; we flush manually.
    setInterval: () => 0,
  };

  const navigatorStub = {
    sendBeacon: (_url: string, blob: { __body: string }) => {
      const parsed = JSON.parse(blob.__body) as { logs: Array<{ data: BufferedLog }> };
      for (const l of parsed.logs) flushed.push(l.data);
      return true;
    },
  };

  const documentStub = {
    querySelector: (selector: string) => {
      // crude attribute selector parser: meta[name="x"]
      const m = /meta\[name="([^"]+)"\]/.exec(selector);
      if (!m) return null;
      const found = metaElements.find((e) => e.name === m[1]);
      return found ? { getAttribute: () => found.content } : null;
    },
  };

  // Blob stub captures the body string for the beacon assertion above.
  class BlobStub {
    __body: string;
    constructor(parts: string[]) {
      this.__body = parts.join('');
    }
  }

  const script = getBrowserPatchScript('http://localhost:6789', 'test-svc');

  // Build a function with the browser globals injected as parameters.
  const fn = new Function(
    'window',
    'navigator',
    'document',
    'console',
    'Blob',
    'setInterval',
    `${script}`,
  );

  fn(win, navigatorStub, documentStub, sandboxConsole, BlobStub, (() => 0) as unknown);

  // Drive user console activity through the (now patched) sandbox console.
  opts.drive(sandboxConsole);

  // Trigger the registered beforeunload flush.
  for (const cb of listeners.beforeunload ?? []) cb({});

  return { logs: flushed };
}

describe('browser-patch trace correlation', () => {
  it('attaches the injected traceId/spanId to a captured log when present', () => {
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const { logs } = runPatch({
      metaTraceId: traceId,
      metaSpanId: spanId,
      drive: (c) => c.log('hello from the browser'),
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('hello from the browser');
    expect(logs[0].traceId).toBe(traceId);
    // a synthetic client span id is attached (distinct, but present)
    expect(logs[0].spanId).toBeTruthy();
    expect(logs[0].attributes['nextdog.server.spanId']).toBe(spanId);
    expect(logs[0].attributes.runtime).toBe('browser');
  });

  it('degrades gracefully to no traceId when no id was injected', () => {
    const { logs } = runPatch({
      drive: (c) => c.error('boom'),
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('boom');
    expect(logs[0].traceId).toBeUndefined();
    expect(logs[0].attributes.runtime).toBe('browser');
  });

  it('does not throw and still buffers when document lacks the injected meta', () => {
    expect(() => runPatch({ drive: (c) => c.warn('careful') })).not.toThrow();
  });
});
