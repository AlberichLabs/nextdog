import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DISMISS_MS, MAX_VISIBLE, ToastStore } from '../toast-store.js';

describe('ToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('adds a toast and notifies subscribers', () => {
    const store = new ToastStore();
    const seen: number[] = [];
    store.subscribe((toasts) => seen.push(toasts.length));

    store.add({ message: 'GET /api/orders', type: 'warning' });

    expect(store.getToasts()).toHaveLength(1);
    expect(store.getToasts()[0].message).toBe('GET /api/orders');
    expect(seen.at(-1)).toBe(1);
  });

  it('auto-dismisses a toast after its timeout', () => {
    const store = new ToastStore();
    const id = store.add({ message: 'slow', type: 'warning' });

    expect(store.getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(store.getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.getToasts()).toHaveLength(0);
    expect(store.getToasts().find((t) => t.id === id)).toBeUndefined();
  });

  it('removes a toast on manual dismiss before the timeout fires', () => {
    const store = new ToastStore();
    const id = store.add({ message: 'slow', type: 'warning' });

    store.remove(id);
    expect(store.getToasts()).toHaveLength(0);

    // The pending timer must not throw or re-remove after manual dismiss.
    expect(() => vi.advanceTimersByTime(AUTO_DISMISS_MS)).not.toThrow();
    expect(store.getToasts()).toHaveLength(0);
  });

  it('caps the visible stack to MAX_VISIBLE, keeping the newest', () => {
    const store = new ToastStore();
    for (let i = 0; i < MAX_VISIBLE + 2; i++) {
      store.add({ message: `toast-${i}`, type: 'info' });
    }

    const toasts = store.getToasts();
    expect(toasts).toHaveLength(MAX_VISIBLE);
    // Newest survive; the two oldest are evicted.
    expect(toasts[0].message).toBe('toast-2');
    expect(toasts.at(-1)!.message).toBe(`toast-${MAX_VISIBLE + 1}`);
  });

  it('does not auto-dismiss an evicted (capped) toast after it is gone', () => {
    const store = new ToastStore();
    const ids: string[] = [];
    for (let i = 0; i < MAX_VISIBLE + 1; i++) {
      ids.push(store.add({ message: `toast-${i}`, type: 'info' }));
    }
    // First toast was evicted by the cap.
    expect(store.getToasts().find((t) => t.id === ids[0])).toBeUndefined();

    // Advancing time must not throw on the evicted toast's timer.
    expect(() => vi.advanceTimersByTime(AUTO_DISMISS_MS)).not.toThrow();
    expect(store.getToasts()).toHaveLength(0);
  });

  it('pauses auto-dismiss while paused, and resumes the remaining time', () => {
    const store = new ToastStore();
    store.add({ message: 'hovered', type: 'warning' });

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1000); // 1s of life left
    store.pauseAll();

    // While paused, time passing must not dismiss the toast.
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 5);
    expect(store.getToasts()).toHaveLength(1);

    store.resumeAll();
    // Only the remaining ~1s should be needed.
    vi.advanceTimersByTime(999);
    expect(store.getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getToasts()).toHaveLength(0);
  });

  it('schedules dismissal for a toast added while paused once resumed', () => {
    const store = new ToastStore();
    store.pauseAll();
    store.add({ message: 'added-while-paused', type: 'info' });

    // Paused: never dismisses on its own.
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
    expect(store.getToasts()).toHaveLength(1);

    store.resumeAll();
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(store.getToasts()).toHaveLength(0);
  });

  it('resumeAll is a no-op when not paused (idempotent)', () => {
    const store = new ToastStore();
    store.add({ message: 'x', type: 'info' });
    store.resumeAll(); // not paused — must not double-schedule or reset the timer

    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(store.getToasts()).toHaveLength(0);
  });

  it('clears all timers on clear() without re-notifying stale state', () => {
    const store = new ToastStore();
    store.add({ message: 'a', type: 'info' });
    store.add({ message: 'b', type: 'info' });

    store.clear();
    expect(store.getToasts()).toHaveLength(0);
    expect(() => vi.advanceTimersByTime(AUTO_DISMISS_MS)).not.toThrow();
    expect(store.getToasts()).toHaveLength(0);
  });
});
