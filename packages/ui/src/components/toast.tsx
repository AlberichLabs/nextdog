import type { FunctionComponent } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import { token } from 'styled-system/tokens';
import type { Toast, ToastInput } from './toast-store.js';
import { ToastStore } from './toast-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { Toast } from './toast-store.js';

export interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: string) => void;
  onOpenTrace?: (traceId: string) => void;
  /** Pause/resume auto-dismiss while the user hovers the stack. */
  onPause?: () => void;
  onResume?: () => void;
  /**
   * Hide the stack while a detail pane / right rail is open so toasts never
   * overlap the thing the user just opened (issue #19).
   */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Preact binding for {@link ToastStore}. All dismiss/timeout/cap/pause logic
 * lives in the (DOM-free, unit-tested) store; this hook only mirrors its state
 * into Preact and exposes stable callbacks.
 */
export function useToasts() {
  const storeRef = useRef<ToastStore>();
  if (!storeRef.current) storeRef.current = new ToastStore();
  const store = storeRef.current;

  const [toasts, setToasts] = useState<Toast[]>(store.getToasts());

  useEffect(() => {
    const unsubscribe = store.subscribe((next) => setToasts(next));
    return () => {
      unsubscribe();
      store.clear();
    };
  }, [store]);

  const addToast = useCallback((toast: ToastInput) => store.add(toast), [store]);
  const removeToast = useCallback((id: string) => store.remove(id), [store]);
  const pauseToasts = useCallback(() => store.pauseAll(), [store]);
  const resumeToasts = useCallback(() => store.resumeAll(), [store]);

  return { toasts, addToast, removeToast, pauseToasts, resumeToasts } as const;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<Toast['type'], string> = {
  warning: token('colors.yellow'),
  error: token('colors.red'),
  info: token('colors.accent'),
};

const cardBaseStyle = css({
  background: 'surface.panel',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'md',
  py: '2',
  px: '3',
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  animation: 'toast-slide-in 0.2s ease-out',
  maxWidth: '360px',
  boxSizing: 'border-box',
});

const messageStyle = css({
  fontFamily: 'mono',
  fontSize: 'md',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const durationStyle = css({
  fontFamily: 'mono',
  fontSize: 'sm',
  color: 'fg.dim',
  flexShrink: 0,
});

const closeButtonStyle = css({
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  fontSize: 'xl',
  color: 'fg.dim',
  flexShrink: 0,
  _hover: { color: 'fg.bright' },
});

const containerStyle = css({
  position: 'fixed',
  bottom: '4',
  right: '4',
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  // Below the detail pane (zIndex 101) and its backdrop (100) so toasts never
  // sit on top of the slide-in pane / right rail — see issue #19.
  zIndex: 50,
  pointerEvents: 'auto',
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const ToastCard: FunctionComponent<{
  toast: Toast;
  onClose: () => void;
  onOpenTrace?: (traceId: string) => void;
}> = ({ toast, onClose, onOpenTrace }) => {
  const clickable = !!toast.traceId && !!onOpenTrace;

  return (
    <div
      role="alert"
      onClick={clickable ? () => onOpenTrace!(toast.traceId!) : undefined}
      className={cardBaseStyle}
      style={{
        borderLeft: `3px solid ${TYPE_COLORS[toast.type]}`,
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* Message */}
      <span className={messageStyle}>{toast.message}</span>

      {/* Duration badge */}
      {toast.duration && <span className={durationStyle}>{toast.duration}</span>}

      {/* Close button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Dismiss"
        className={closeButtonStyle}
      >
        ×
      </button>
    </div>
  );
};

export const ToastContainer: FunctionComponent<ToastContainerProps> = ({
  toasts,
  removeToast,
  onOpenTrace,
  onPause,
  onResume,
  hidden,
}) => {
  const isHidden = hidden || toasts.length === 0;

  // If the stack is hovered (paused) and then hides — e.g. the user clicks a
  // toast to open the detail pane — onMouseLeave never fires, so resume here to
  // avoid leaving every toast frozen forever. Runs on unmount too.
  useEffect(() => {
    if (isHidden) onResume?.();
    return () => onResume?.();
  }, [isHidden, onResume]);

  if (isHidden) return null;

  return (
    <div className={containerStyle} onMouseEnter={onPause} onMouseLeave={onResume}>
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onClose={() => removeToast(toast.id)}
          onOpenTrace={onOpenTrace}
        />
      ))}
    </div>
  );
};
