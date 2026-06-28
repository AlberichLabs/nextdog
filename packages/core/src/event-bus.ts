import { EventEmitter } from 'node:events';
import type { NextDogEvent } from './types';

type EventType = NextDogEvent['type'] | '*';
type EventHandler = (event: NextDogEvent) => void;

export class EventBus {
  private emitter = new EventEmitter();

  on(type: EventType, handler: EventHandler): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }

  emit(event: NextDogEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }
}
