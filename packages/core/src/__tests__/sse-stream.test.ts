import type { ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RingBuffer } from '../ring-buffer.js';
import { SSEStream } from '../sse-stream.js';
import type { NextDogEvent } from '../types.js';

const makeEvent = (id: number): NextDogEvent => ({
  type: 'span',
  timestamp: id,
  data: {
    traceId: `trace-${id}`,
    spanId: `span-${id}`,
    name: `span-${id}`,
    kind: 'SERVER' as const,
    startTimeUnixNano: BigInt(id * 1000000),
    endTimeUnixNano: BigInt(id * 1000000 + 500000),
    attributes: {},
    status: { code: 'OK' as const },
    serviceName: 'test',
  },
});

function mockResponse(): ServerResponse & { chunks: string[] } {
  const chunks: string[] = [];
  const stream = new PassThrough();
  const res = Object.assign(stream, {
    chunks,
    writeHead: vi.fn(),
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    on: vi.fn().mockReturnThis(),
  });
  return res as unknown as ServerResponse & { chunks: string[] };
}

describe('SSEStream', () => {
  let ringBuffer: RingBuffer;

  beforeEach(() => {
    ringBuffer = new RingBuffer(100);
  });

  it('sends backfill from RingBuffer on connect', () => {
    ringBuffer.push(makeEvent(1));
    ringBuffer.push(makeEvent(2));

    const sse = new SSEStream(ringBuffer);
    const res = mockResponse();
    sse.addClient(res);

    // Should have sent 2 backfill events
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
      }),
    );
    // Each event = "data: {...}\n\n"
    const dataChunks = res.chunks.filter((c) => c.startsWith('data:'));
    expect(dataChunks).toHaveLength(2);
  });

  it('flushes an opening comment so an idle client connects with zero backfill', () => {
    // With an empty ring buffer the stream writes no `data:` frames. Node will
    // not flush the response status line to the socket until something is
    // written, so the browser EventSource never fires `onopen` and the UI can't
    // tell "connected but idle" from "not connected at all" (issue #11). An
    // initial SSE comment forces the headers out immediately and is ignored by
    // the EventSource parser.
    const sse = new SSEStream(ringBuffer);
    const res = mockResponse();
    sse.addClient(res);

    expect(res.chunks.length).toBeGreaterThan(0);
    expect(res.chunks[0].startsWith(':')).toBe(true);
    // The comment must not be parsed as a data frame.
    expect(res.chunks.filter((c) => c.startsWith('data:'))).toHaveLength(0);
  });

  it('broadcasts new events to connected clients', () => {
    const sse = new SSEStream(ringBuffer);
    const res = mockResponse();
    sse.addClient(res);

    sse.broadcast(makeEvent(99));

    const dataChunks = res.chunks.filter((c) => c.startsWith('data:'));
    expect(dataChunks).toHaveLength(1);
    expect(dataChunks[0]).toContain('trace-99');
  });

  it('removes client on close', () => {
    const sse = new SSEStream(ringBuffer);
    const res = mockResponse();
    sse.addClient(res);

    expect(sse.clientCount).toBe(1);
    sse.removeClient(res);
    expect(sse.clientCount).toBe(0);
  });
});
