// ---------------------------------------------------------------------------
// Framework-agnostic toast store.
//
// Owns toast state, the auto-dismiss timeout, the visible-stack cap, and
// hover-to-pause. Kept free of Preact/DOM so the dismiss/timeout logic is
// unit-testable with plain vitest (see __tests__/toast-store.test.ts). The
// `useToasts` hook in toast.tsx is a thin reactive wrapper around this.
// ---------------------------------------------------------------------------

export interface Toast {
  id: string;
  message: string;
  type: 'warning' | 'error' | 'info';
  traceId?: string;
  duration?: string;
}

export type ToastInput = Omit<Toast, 'id'> & { id?: string };

/** How long a toast stays before it auto-dismisses. */
export const AUTO_DISMISS_MS = 5000;

/** Max toasts shown at once; older ones are evicted so they can't eat the viewport. */
export const MAX_VISIBLE = 3;

type Listener = (toasts: Toast[]) => void;

interface TimerState {
  handle: ReturnType<typeof setTimeout> | null;
  /** Timestamp (ms) at which this toast should dismiss while running. */
  deadline: number;
  /** Remaining ms captured when paused; null while running. */
  remaining: number | null;
}

export class ToastStore {
  private toasts: Toast[] = [];
  private timers = new Map<string, TimerState>();
  private listeners = new Set<Listener>();
  private paused = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getToasts(): Toast[] {
    return this.toasts;
  }

  add(input: ToastInput): string {
    const id = input.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = { ...input, id };

    // Append, then cap to the newest MAX_VISIBLE — evicting (and clearing the
    // timers of) any toasts pushed out so they never linger or fire later.
    const next = [...this.toasts, toast];
    const evicted = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
    for (const t of evicted) this.clearTimer(t.id);
    this.toasts = next.slice(-MAX_VISIBLE);

    this.startTimer(id, AUTO_DISMISS_MS);
    this.emit();
    return id;
  }

  remove(id: string): void {
    if (!this.timers.has(id) && !this.toasts.some((t) => t.id === id)) return;
    this.clearTimer(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  /** Pause auto-dismiss for every toast (e.g. while the user hovers the stack). */
  pauseAll(): void {
    if (this.paused) return;
    this.paused = true;
    const now = Date.now();
    for (const state of this.timers.values()) {
      if (state.handle !== null) {
        clearTimeout(state.handle);
        state.handle = null;
        state.remaining = Math.max(0, state.deadline - now);
      }
    }
  }

  /** Resume auto-dismiss, giving each toast the time it had left when paused. */
  resumeAll(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const [id, state] of this.timers) {
      const remaining = state.remaining ?? AUTO_DISMISS_MS;
      state.remaining = null;
      this.startTimer(id, remaining);
    }
  }

  /** Remove every toast and cancel all pending timers. */
  clear(): void {
    if (this.toasts.length === 0 && this.timers.size === 0) return;
    for (const state of this.timers.values()) {
      if (state.handle !== null) clearTimeout(state.handle);
    }
    this.timers.clear();
    this.toasts = [];
    this.emit();
  }

  private startTimer(id: string, ms: number): void {
    const deadline = Date.now() + ms;
    const handle = this.paused ? null : setTimeout(() => this.remove(id), ms);
    this.timers.set(id, {
      handle,
      deadline,
      remaining: this.paused ? ms : null,
    });
  }

  private clearTimer(id: string): void {
    const state = this.timers.get(id);
    if (state?.handle != null) clearTimeout(state.handle);
    this.timers.delete(id);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.toasts);
  }
}
