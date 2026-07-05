/**
 * Tracks whether the SSE stream has opened before, so the dashboard can tell an
 * initial connection apart from a reconnect.
 */
export interface SSEConnectionState {
  hasOpened: boolean;
}

export const initialConnectionState: SSEConnectionState = { hasOpened: false };

/**
 * Handle an SSE `open` event. Returns the next connection state plus whether the
 * caller should reload the full on-disk history.
 *
 * The FIRST open needs no reload — the one-shot history fetch on mount already
 * backfilled it. Every SUBSEQUENT open is a reconnect: the browser's EventSource
 * dropped and re-established `:6789`, which after an idle-shutdown recovery or a
 * version auto-upgrade may now be a brand-new sidecar whose in-memory ring buffer
 * is empty. Its SSE backfill therefore carries none of the inherited history, so we
 * must reload it from disk (`/api/events`) or the dashboard shows a gap where the
 * pre-upgrade data used to be (issue #79).
 */
export function onSSEOpen(state: SSEConnectionState): {
  state: SSEConnectionState;
  reloadHistory: boolean;
} {
  return { state: { hasOpened: true }, reloadHistory: state.hasOpened };
}
