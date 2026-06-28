import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../event-bus';
import type { NextDogEvent, Span } from '../types';

const makeSpan = (overrides?: Partial<Span>): Span => ({
  traceId: 'trace-1',
  spanId: 'span-1',
  name: 'GET /api/test',
  kind: 'SERVER',
  startTimeUnixNano: 1000000000n,
  endTimeUnixNano: 1050000000n,
  attributes: {},
  status: { code: 'OK' },
  serviceName: 'test-app',
  ...overrides,
});

describe('EventBus', () => {
  it('emits span events to subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('span', handler);

    const event: NextDogEvent = {
      type: 'span',
      timestamp: Date.now(),
      data: makeSpan(),
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('emits log events to subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('log', handler);

    const event: NextDogEvent = {
      type: 'log',
      timestamp: Date.now(),
      data: {
        timestamp: Date.now(),
        level: 'info',
        message: 'hello',
        attributes: {},
        serviceName: 'test-app',
      },
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('supports wildcard * subscription for all events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('*', handler);

    bus.emit({ type: 'span', timestamp: Date.now(), data: makeSpan() });
    bus.emit({
      type: 'log',
      timestamp: Date.now(),
      data: {
        timestamp: Date.now(),
        level: 'info',
        message: 'x',
        attributes: {},
        serviceName: 'a',
      },
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes correctly', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on('span', handler);

    bus.emit({ type: 'span', timestamp: Date.now(), data: makeSpan() });
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    bus.emit({ type: 'span', timestamp: Date.now(), data: makeSpan() });
    expect(handler).toHaveBeenCalledOnce(); // not called again
  });
});
