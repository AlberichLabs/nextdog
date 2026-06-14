import { useEffect } from 'preact/hooks';

export type GlobalAction = 'focusFilter' | 'prevView' | 'nextView' | 'clearFilter';

/** Structural shape of the bits of a KeyboardEvent the resolver inspects. */
interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string } | null;
}

function isEditableTarget(target: { tagName?: string } | null | undefined): boolean {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/**
 * Map a keydown to a global action, or null if it isn't a shortcut.
 *
 * Pure so it can be unit-tested in plain node without a DOM. Rules:
 * - Cmd/Ctrl+K focuses the filter even while typing in an input (refocus).
 * - Every other binding is suppressed while editing text, so typing `/`, `[`,
 *   `]` or `X` into the filter behaves normally.
 * - Plain bindings ignore other modifiers (Shift is only meaningful for `X`).
 */
export function resolveGlobalShortcut(e: ShortcutEventLike): GlobalAction | null {
  const cmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
  if (cmdK) return 'focusFilter';

  if (isEditableTarget(e.target)) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;

  switch (e.key) {
    case '/': return 'focusFilter';
    case '[': return 'prevView';
    case ']': return 'nextView';
    case 'X': return e.shiftKey ? 'clearFilter' : null;
    default: return null;
  }
}

export interface GlobalShortcutActions {
  onFocusFilter?: () => void;
  onPrevView?: () => void;
  onNextView?: () => void;
  onClearFilter?: () => void;
}

/**
 * Register app-wide keyboard shortcuts on `window`: focus filter (`/`,
 * Cmd/Ctrl+K), switch view (`[`/`]`), clear filter (Shift+X). Mount once.
 */
export function useGlobalShortcuts(actions: GlobalShortcutActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = resolveGlobalShortcut(e);
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case 'focusFilter': actions.onFocusFilter?.(); break;
        case 'prevView': actions.onPrevView?.(); break;
        case 'nextView': actions.onNextView?.(); break;
        case 'clearFilter': actions.onClearFilter?.(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions.onFocusFilter, actions.onPrevView, actions.onNextView, actions.onClearFilter]);
}
