// ---------------------------------------------------------------------------
// Pure (DOM-free) state logic for the Preact error boundary (issue #44).
//
// The boundary itself (error-boundary.tsx) is a thin Preact wrapper whose only
// job is to call these functions in componentDidCatch and branch its render on
// `state.error`. Keeping the decision logic here (mirrors empty-state-logic.ts)
// makes it unit-testable in the node-only vitest environment without a DOM, and
// keeps the wrapper trivial enough that typecheck + build + a manual repro cover
// it. No runtime dependencies — this ships inside users' dev servers.
// ---------------------------------------------------------------------------

export interface ErrorBoundaryState {
  /** The caught error, or null when the subtree is healthy. */
  error: Error | null;
}

/** Coerce an arbitrary thrown value into the boundary's error state. */
export function deriveErrorState(thrown: unknown): ErrorBoundaryState {
  if (thrown instanceof Error) return { error: thrown };
  return { error: new Error(typeof thrown === 'string' ? thrown : String(thrown)) };
}

/** The cleared state, used when the user dismisses/retries the fallback. */
export function resetState(): ErrorBoundaryState {
  return { error: null };
}

/** Human-readable message to show in the fallback. */
export function errorMessage(state: ErrorBoundaryState): string {
  const msg = state.error?.message?.trim();
  return msg && msg.length > 0 ? msg : 'An unexpected error occurred.';
}
