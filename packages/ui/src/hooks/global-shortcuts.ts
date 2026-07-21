/**
 * Pure key-binding logic for the app-wide shortcut layer (issue #12).
 *
 * Deliberately free of DOM and Preact so every binding and guard is unit
 * testable in plain node — `use-global-shortcuts.ts` adapts a real
 * KeyboardEvent into a `ShortcutEventLike` and calls `resolveGlobalShortcut`.
 *
 * The per-view `use-keyboard.ts` hook keeps owning `j`/`k`/`Enter`/`Escape`,
 * and `shortcut-help.tsx` keeps owning `?`. This layer only adds the bindings
 * that are app-wide rather than list-local, and returns null for everything
 * else so those handlers (and the host app's own keys) are left alone.
 */

export type GlobalAction = 'focusFilter' | 'prevView' | 'nextView' | 'clearFilter';

/** The slice of a KeyboardEvent the resolver reads, plus focus context. */
export interface ShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True mid-IME composition, when keystrokes belong to the composer. */
  isComposing: boolean;
  /** True when focus is in an INPUT/TEXTAREA/SELECT or contentEditable node. */
  inEditable: boolean;
}

/**
 * Map a keydown to an app-wide action, or null when no binding applies.
 *
 * This overlay is injected into someone else's dev server, so "null" is the
 * important case: the caller only calls preventDefault when we return an
 * action, leaving every other keystroke to the browser and the host app.
 *
 * Rules, in order:
 *  - Nothing fires mid-IME composition.
 *  - Cmd/Ctrl+K focuses the filter from anywhere — the one deliberate
 *    exception to the typing guard, so it refocuses even from inside the input.
 *  - Every other binding is suppressed while the user is typing, so `/`, `[`,
 *    `]` and `X` reach the text field as literal characters.
 *  - Plain bindings require no modifier, which keeps Cmd+[ (browser Back),
 *    Ctrl+/ and friends working as the user expects.
 */
export function resolveGlobalShortcut(e: ShortcutEventLike): GlobalAction | null {
  if (e.isComposing) return null;

  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    return 'focusFilter';
  }

  if (e.inEditable) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;

  switch (e.key) {
    case '/':
      return 'focusFilter';
    case '[':
      return 'prevView';
    case ']':
      return 'nextView';
    // Shift is held, so the browser reports the uppercase 'X'.
    case 'X':
      return e.shiftKey ? 'clearFilter' : null;
    default:
      return null;
  }
}

/**
 * The list views, in the order the header nav renders them. `[`/`]` step
 * through this array; the help sheet's wording assumes this order too.
 */
export const VIEW_PATHS = ['/', '/traces', '/logs'] as const;

/**
 * Resolve the path `[` (direction -1) or `]` (direction +1) should navigate to.
 *
 * Cycling wraps at both ends, so both keys always do something rather than
 * dead-ending on the first/last view. From a non-list route (the full-page
 * `/trace/:traceId` detail view) either key returns to Spans, treating the
 * shortcut as "get me back to a list".
 */
export function resolveViewPath(currentPath: string, direction: -1 | 1): string {
  const index = (VIEW_PATHS as readonly string[]).indexOf(currentPath);
  if (index === -1) return VIEW_PATHS[0];
  const next = (index + direction + VIEW_PATHS.length) % VIEW_PATHS.length;
  return VIEW_PATHS[next];
}
