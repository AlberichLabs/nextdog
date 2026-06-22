/**
 * Pure keymap dispatch for the global keyboard layer.
 *
 * Kept free of DOM and Preact so the binding logic is unit-testable in
 * isolation (see __tests__/keymap.test.ts). The hook in use-keyboard.ts adapts
 * a real KeyboardEvent into a KeyEventLike and calls resolveKeyAction.
 *
 * Binding choices (issue #12):
 *  - `/` and `cmd/ctrl+k` focus the filter input. `/` is suppressed while the
 *    user is already typing (so it inserts a literal slash); `cmd/ctrl+k` is
 *    the conventional exception that focuses search even from within an input.
 *  - `[` switches to Spans, `]` switches to Logs. Single-key bindings were
 *    chosen over a `g s`/`g l` chord because the existing handler dispatches on
 *    a single keydown with no sequence state — `[`/`]` fit that style with no
 *    new machinery, and read left→right matching the Spans|Logs nav order.
 *  - `shift+x` clears the current filter.
 */

export type KeyAction =
  | 'next'
  | 'prev'
  | 'select'
  | 'back'
  | 'focusFilter'
  | 'viewSpans'
  | 'viewLogs'
  | 'clearFilter';

/** The slice of a KeyboardEvent the keymap needs, plus focus context. */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True when focus is in an INPUT/TEXTAREA or a contentEditable element. */
  inEditable: boolean;
}

/**
 * Resolve a key event to an action, or null if no binding applies.
 *
 * Order matters: the cmd/ctrl+k exception is checked before the editable
 * early-return, since it must fire even while the user is typing in the filter.
 * Every other binding bails out when focus is in an editable element so typing
 * (including a literal `/`, `[`, `]`, or `X`) is never hijacked.
 */
export function resolveKeyAction(e: KeyEventLike): KeyAction | null {
  // cmd/ctrl+k — focus the filter from anywhere, even inside an input.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    return 'focusFilter';
  }

  // Everything below is a global shortcut that must never steal keystrokes
  // from the filter bar (or any other text field).
  if (e.inEditable) return null;

  // No other binding uses a modifier except shift (for shift+x).
  if (e.metaKey || e.ctrlKey || e.altKey) return null;

  switch (e.key) {
    case 'j':
      return 'next';
    case 'k':
      return 'prev';
    case 'Enter':
      return 'select';
    case 'Escape':
      return 'back';
    case '/':
      return 'focusFilter';
    case '[':
      return 'viewSpans';
    case ']':
      return 'viewLogs';
    // shift+x clears the filter; e.key is the uppercase 'X' when shift is held.
    case 'X':
      return e.shiftKey ? 'clearFilter' : null;
    default:
      return null;
  }
}
