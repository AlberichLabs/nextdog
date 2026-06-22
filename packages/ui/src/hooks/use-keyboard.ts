import { useEffect } from 'preact/hooks';
import { resolveKeyAction, type KeyEventLike } from './keymap.js';

interface KeyboardActions {
  onNext?: () => void;
  onPrev?: () => void;
  onSelect?: () => void;
  onBack?: () => void;
  /** `/` or cmd/ctrl+k — focus the filter input. */
  onFocusFilter?: () => void;
  /** `[` — switch to the Spans view. */
  onViewSpans?: () => void;
  /** `]` — switch to the Logs view. */
  onViewLogs?: () => void;
  /** shift+x — clear the current filter. */
  onClearFilter?: () => void;
}

/** True when focus is in a text-editing context the keymap must not hijack. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const like: KeyEventLike = {
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        inEditable: isEditableTarget(e.target),
      };
      const action = resolveKeyAction(like);
      if (!action) return;

      // Only act if a handler is wired for this action; otherwise leave the
      // event untouched so another listener (e.g. the App-level global hook)
      // can handle it. This is what lets the per-view nav hook and the
      // App-level global hook coexist without preventing each other's keys.
      const fn = {
        next: actions.onNext,
        prev: actions.onPrev,
        select: actions.onSelect,
        back: actions.onBack,
        focusFilter: actions.onFocusFilter,
        viewSpans: actions.onViewSpans,
        viewLogs: actions.onViewLogs,
        clearFilter: actions.onClearFilter,
      }[action];

      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    actions.onNext,
    actions.onPrev,
    actions.onSelect,
    actions.onBack,
    actions.onFocusFilter,
    actions.onViewSpans,
    actions.onViewLogs,
    actions.onClearFilter,
  ]);
}
