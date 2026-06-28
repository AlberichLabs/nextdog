/**
 * Pure state-selection for the first-run / empty experience.
 *
 * The dashboard surfaces three distinct "nothing to show" situations, each of
 * which needs different copy (issue #11):
 *
 *  - `disconnected`    — the sidecar is unreachable (setup not done / port
 *                        conflict). Show the setup checklist.
 *  - `connected-idle`  — connected, but we have never received an event. Nudge
 *                        the dev to generate their first trace.
 *  - `filter-empty`    — events exist, but the current filter hides all of them.
 *                        (Rendered inline by the list views, not the overlay.)
 *  - `populated`       — events are visible; no empty state.
 *
 * Inputs are all derived from existing client state — no extra network calls:
 *  - `connected`     — the SSE connection signal (use-sse).
 *  - `everReceived`  — have we *ever* seen an event this session (latched true
 *                      once any event arrives; survives a manual Clear).
 *  - `filterActive`  — is a search query or service filter currently applied.
 */

export type EmptyStateKind = 'disconnected' | 'connected-idle' | 'filter-empty' | 'populated';

export interface EmptyStateInput {
  /** SSE connection established. */
  connected: boolean;
  /** Any event has been received this session (latches true). */
  everReceived: boolean;
  /** A search query or service filter is currently applied. */
  filterActive: boolean;
  /** Are there events to display right now (post-filter)? */
  hasVisibleEvents: boolean;
}

/**
 * Human label for the sidecar address shown in the disconnected checklist
 * (issue #55): the host:port the dashboard is actually configured to reach,
 * not a hardcoded `:6789`. Returns the URL's authority (host incl. port) so a
 * custom `NEXTDOG_URL`/port is reflected accurately. Empty string when no URL is
 * known, letting the caller fall back to generic copy.
 */
export function sidecarLabel(sidecarUrl?: string): string {
  if (!sidecarUrl) return '';
  try {
    return new URL(sidecarUrl).host;
  } catch {
    return sidecarUrl;
  }
}

export function selectEmptyState(input: EmptyStateInput): EmptyStateKind {
  const { connected, everReceived, filterActive, hasVisibleEvents } = input;

  // Something is showing — not an empty state at all.
  if (hasVisibleEvents) return 'populated';

  // Events have arrived but a filter is hiding them: the diagnostic is about the
  // filter, not the connection — even if the connection has since dropped.
  if (everReceived && filterActive) return 'filter-empty';

  // Nothing visible and no filter to blame: distinguish "can't reach the
  // sidecar" from "connected but no traffic yet".
  return connected ? 'connected-idle' : 'disconnected';
}
