import type { NextDogEvent } from './types';

export class RingBuffer {
  private buffer: (NextDogEvent | undefined)[];
  private head = 0;
  private count = 0;
  private pending: NextDogEvent[] = [];

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(event: NextDogEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.pending.push(event);
  }

  getAll(): NextDogEvent[] {
    if (this.count === 0) return [];
    const result: NextDogEvent[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx]!);
    }
    return result;
  }

  getLast(n: number): NextDogEvent[] {
    const all = this.getAll();
    return all.slice(-Math.min(n, all.length));
  }

  drain(): NextDogEvent[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }
}
