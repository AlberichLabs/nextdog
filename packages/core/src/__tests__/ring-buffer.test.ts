import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ring-buffer';
import type { NextDogEvent } from '../types';

const makeEvent = (id: number): NextDogEvent => ({
  type: 'span',
  timestamp: id,
  data: {
    traceId: `trace-${id}`,
    spanId: `span-${id}`,
    name: `span-${id}`,
    kind: 'SERVER',
    startTimeUnixNano: BigInt(id * 1000000),
    endTimeUnixNano: BigInt(id * 1000000 + 500000),
    attributes: {},
    status: { code: 'OK' },
    serviceName: 'test',
  },
});

describe('RingBuffer', () => {
  it('stores and retrieves entries', () => {
    const buf = new RingBuffer(5);
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    const entries = buf.getAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toBe(1);
    expect(entries[1].timestamp).toBe(2);
  });

  it('overwrites oldest when capacity exceeded', () => {
    const buf = new RingBuffer(3);
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));
    buf.push(makeEvent(4)); // overwrites 1

    const entries = buf.getAll();
    expect(entries).toHaveLength(3);
    expect(entries[0].timestamp).toBe(2);
    expect(entries[1].timestamp).toBe(3);
    expect(entries[2].timestamp).toBe(4);
  });

  it('getLast returns N most recent entries', () => {
    const buf = new RingBuffer(10);
    for (let i = 1; i <= 7; i++) buf.push(makeEvent(i));

    const last3 = buf.getLast(3);
    expect(last3).toHaveLength(3);
    expect(last3[0].timestamp).toBe(5);
    expect(last3[1].timestamp).toBe(6);
    expect(last3[2].timestamp).toBe(7);
  });

  it('getLast with N > size returns all entries', () => {
    const buf = new RingBuffer(10);
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    const result = buf.getLast(50);
    expect(result).toHaveLength(2);
  });

  it('drain returns and clears pending entries', () => {
    const buf = new RingBuffer(10);
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    const drained = buf.drain();
    expect(drained).toHaveLength(2);

    const drained2 = buf.drain();
    expect(drained2).toHaveLength(0);

    // getAll still returns everything (drain only clears flush queue)
    expect(buf.getAll()).toHaveLength(2);
  });
});
