import { useEffect, useRef } from 'preact/hooks';
import { type GlobalAction, resolveGlobalShortcut } from './global-shortcuts';

export interface GlobalShortcutActions {
  /** `/` or Cmd/Ctrl+K — focus the filter input. */
  onFocusFilter?: () => void;
  /** `[` — step to the previous view. */
  onPrevView?: () => void;
  /** `]` — step to the next view. */
  onNextView?: () => void;
  /** Shift+X — clear the active filter query. */
  onClearFilter?: () => void;
}

/** True when focus sits in a text-editing context we must not hijack. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * Register the app-wide shortcut layer on `window`: focus filter (`/`,
 * Cmd/Ctrl+K), switch view (`[`/`]`), clear filter (Shift+X). Mount once, at
 * the App level.
 *
 * The listener is attached exactly once and reads callbacks through a ref, so
 * re-renders never churn subscriptions and unmount always removes the one
 * listener it added — this ships inside someone else's dev server, where a
 * leaked window listener would outlive the overlay.
 */
export function useGlobalShortcuts(actions: GlobalShortcutActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = resolveGlobalShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        isComposing: e.isComposing,
        inEditable: isEditableTarget(e.target),
      });
      if (!action) return;

      const handlers: Record<GlobalAction, (() => void) | undefined> = {
        focusFilter: actionsRef.current.onFocusFilter,
        prevView: actionsRef.current.onPrevView,
        nextView: actionsRef.current.onNextView,
        clearFilter: actionsRef.current.onClearFilter,
      };
      const fn = handlers[action];
      if (!fn) return;

      // Only swallow the keystroke once we know we're acting on it, so
      // unhandled keys keep their browser/host-app default behaviour.
      e.preventDefault();
      fn();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
