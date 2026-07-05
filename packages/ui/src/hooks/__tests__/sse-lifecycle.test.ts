import { describe, expect, it } from 'vitest';
import { initialConnectionState, onSSEOpen } from '../sse-lifecycle';

describe('onSSEOpen — reconnect history reload (#79)', () => {
  it('does not reload history on the first open (the mount load already covers it)', () => {
    const { reloadHistory, state } = onSSEOpen(initialConnectionState);
    expect(reloadHistory).toBe(false);
    expect(state.hasOpened).toBe(true);
  });

  it('reloads full history on a reconnect (a replaced sidecar has an empty ring buffer)', () => {
    // First open — initial mount load territory, no reload.
    const first = onSSEOpen(initialConnectionState);
    // A drop + reconnect (idle window or a version auto-upgrade swapped the process).
    const second = onSSEOpen(first.state);
    expect(second.reloadHistory).toBe(true);
  });

  it('keeps reloading on every subsequent reconnect', () => {
    let s = onSSEOpen(initialConnectionState).state;
    for (let i = 0; i < 3; i++) {
      const next = onSSEOpen(s);
      expect(next.reloadHistory).toBe(true);
      s = next.state;
    }
  });
});
