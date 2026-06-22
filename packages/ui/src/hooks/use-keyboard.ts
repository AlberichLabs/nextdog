import { useEffect } from 'preact/hooks';

interface KeyboardActions {
  onNext?: () => void;
  onPrev?: () => void;
  onSelect?: () => void;
  onBack?: () => void;
}

export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'j':
          e.preventDefault();
          actions.onNext?.();
          break;
        case 'k':
          e.preventDefault();
          actions.onPrev?.();
          break;
        case 'Enter':
          e.preventDefault();
          actions.onSelect?.();
          break;
        case 'Escape':
          e.preventDefault();
          actions.onBack?.();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions.onNext, actions.onPrev, actions.onSelect, actions.onBack]);
}
