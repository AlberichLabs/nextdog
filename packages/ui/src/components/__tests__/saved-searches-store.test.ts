import { describe, it, expect, beforeEach } from 'vitest';
import {
  SavedSearchStore,
  RECENT_LIMIT,
  SAVED_KEY,
  RECENT_KEY,
  type StorageLike,
} from '../saved-searches-store.js';

/** Minimal in-memory Storage stand-in (tests run in node, no DOM localStorage). */
function memoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

describe('SavedSearchStore — saved searches', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let store: SavedSearchStore;

  beforeEach(() => {
    storage = memoryStorage();
    store = new SavedSearchStore(storage);
  });

  it('saves a named search with query and services', () => {
    const saved = store.save({ name: 'Checkout errors', query: 'status:ERROR', services: ['web'] });
    expect(saved.id).toBeTruthy();
    expect(store.getSaved()).toHaveLength(1);
    expect(store.getSaved()[0]).toMatchObject({
      name: 'Checkout errors',
      query: 'status:ERROR',
      services: ['web'],
    });
  });

  it('persists saved searches to storage under the nextdog: key', () => {
    store.save({ name: 'Errors', query: 'level:error', services: [] });
    expect(storage.getItem(SAVED_KEY)).toBeTruthy();
    expect(SAVED_KEY).toBe('nextdog:saved-searches');
  });

  it('renames a saved search', () => {
    const saved = store.save({ name: 'old', query: 'q', services: [] });
    store.rename(saved.id, 'new');
    expect(store.getSaved()[0].name).toBe('new');
  });

  it('ignores rename of an unknown id', () => {
    store.save({ name: 'keep', query: 'q', services: [] });
    store.rename('does-not-exist', 'nope');
    expect(store.getSaved()[0].name).toBe('keep');
  });

  it('deletes a saved search', () => {
    const a = store.save({ name: 'a', query: 'qa', services: [] });
    store.save({ name: 'b', query: 'qb', services: [] });
    store.delete(a.id);
    const remaining = store.getSaved();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('b');
  });

  it('round-trips saved searches through storage', () => {
    store.save({ name: 'Slow checkout', query: 'route:/api/checkout', services: ['web', 'worker'] });
    const reloaded = new SavedSearchStore(storage);
    expect(reloaded.getSaved()).toHaveLength(1);
    expect(reloaded.getSaved()[0]).toMatchObject({
      name: 'Slow checkout',
      query: 'route:/api/checkout',
      services: ['web', 'worker'],
    });
  });

  it('notifies subscribers on change', () => {
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.save({ name: 'x', query: 'q', services: [] });
    expect(calls).toBeGreaterThan(0);
  });
});

describe('SavedSearchStore — recent ring', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let store: SavedSearchStore;

  beforeEach(() => {
    storage = memoryStorage();
    store = new SavedSearchStore(storage);
  });

  it('records a recent search', () => {
    store.recordRecent({ query: 'level:error', services: [] });
    expect(store.getRecent()).toHaveLength(1);
    expect(store.getRecent()[0]).toMatchObject({ query: 'level:error', services: [] });
  });

  it('orders most-recent-first', () => {
    store.recordRecent({ query: 'first', services: [] });
    store.recordRecent({ query: 'second', services: [] });
    expect(store.getRecent().map((r) => r.query)).toEqual(['second', 'first']);
  });

  it('de-dupes identical query+services, moving the existing entry to the front', () => {
    store.recordRecent({ query: 'level:error', services: ['web'] });
    store.recordRecent({ query: 'other', services: [] });
    store.recordRecent({ query: 'level:error', services: ['web'] });
    const recent = store.getRecent();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ query: 'level:error', services: ['web'] });
    expect(recent[1]).toMatchObject({ query: 'other' });
  });

  it('treats service order as insignificant for de-dupe', () => {
    store.recordRecent({ query: 'q', services: ['web', 'worker'] });
    store.recordRecent({ query: 'q', services: ['worker', 'web'] });
    expect(store.getRecent()).toHaveLength(1);
  });

  it('caps the ring at RECENT_LIMIT, dropping the oldest', () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i++) {
      store.recordRecent({ query: `q${i}`, services: [] });
    }
    const recent = store.getRecent();
    expect(recent).toHaveLength(RECENT_LIMIT);
    // newest first; the oldest (q0..q4) were dropped
    expect(recent[0].query).toBe(`q${RECENT_LIMIT + 4}`);
    expect(recent.find((r) => r.query === 'q0')).toBeUndefined();
  });

  it('ignores empty recent entries (no query and no services)', () => {
    store.recordRecent({ query: '   ', services: [] });
    store.recordRecent({ query: '', services: [] });
    expect(store.getRecent()).toHaveLength(0);
  });

  it('persists the recent ring under the nextdog: key and round-trips', () => {
    store.recordRecent({ query: 'level:warn', services: ['api'] });
    expect(storage.getItem(RECENT_KEY)).toBeTruthy();
    expect(RECENT_KEY).toBe('nextdog:recent-searches');
    const reloaded = new SavedSearchStore(storage);
    expect(reloaded.getRecent()[0]).toMatchObject({ query: 'level:warn', services: ['api'] });
  });

  it('clears the recent ring', () => {
    store.recordRecent({ query: 'a', services: [] });
    store.clearRecent();
    expect(store.getRecent()).toHaveLength(0);
  });
});

describe('SavedSearchStore — resilience', () => {
  it('tolerates corrupt stored JSON', () => {
    const storage = memoryStorage();
    storage.setItem(SAVED_KEY, '{not json');
    storage.setItem(RECENT_KEY, 'garbage');
    const store = new SavedSearchStore(storage);
    expect(store.getSaved()).toEqual([]);
    expect(store.getRecent()).toEqual([]);
  });

  it('works without any storage (storage-less construction)', () => {
    const store = new SavedSearchStore(undefined);
    const saved = store.save({ name: 'x', query: 'q', services: [] });
    expect(store.getSaved()).toHaveLength(1);
    store.recordRecent({ query: 'r', services: [] });
    expect(store.getRecent()).toHaveLength(1);
    store.delete(saved.id);
    expect(store.getSaved()).toHaveLength(0);
  });
});
