import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { computeRange, scrollOffsetForIndex, type VirtualRange } from '../utils/virtual-window';

/** Rows rendered above and below the visible window to cover fast scrolling. */
const DEFAULT_OVERSCAN = 8;

/**
 * Fallback row height (px) used before a real row has been measured. Both list
 * rows are single-line, fixed-height (~30px: 12px font + 12px py + 1px border).
 * The first real measurement replaces this, so it only affects the very first
 * paint of an empty/just-mounted list.
 */
const ESTIMATED_ROW_HEIGHT = 30;

export interface UseVirtualListResult {
  /** Attach to the scroll container. */
  scrollRef: { current: HTMLDivElement | null };
  /** Wire to the scroll container's `onScroll` to track position. */
  onScroll: () => void;
  /** Attach to the first rendered row so its height can be measured. */
  rowRef: (el: HTMLElement | null) => void;
  /** Indices/spacers to render for the current scroll position. */
  range: VirtualRange;
  /** Scroll row `index` into view (no-op when already visible). */
  scrollToIndex: (index: number) => void;
  /** Imperatively jump the container to the bottom (for live-tail). */
  scrollToBottom: () => void;
}

/**
 * Hand-rolled fixed-height virtualizer (issue #9). No runtime dependency — pure
 * client code, so it adds $0/mo and nothing breaks if the repo is untouched for
 * a month. The windowing math lives in `utils/virtual-window.ts`; this hook owns
 * the DOM measurement and scroll wiring.
 */
export function useVirtualList(
  itemCount: number,
  overscan = DEFAULT_OVERSCAN,
): UseVirtualListResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);

  // Measure the viewport height and keep it current as the window resizes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track the scroll position. Reads directly off the event target so it stays
  // correct even when the list is also being scrolled imperatively.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  // Measure the real row height off the first rendered row. Only updates state
  // when it actually changes to avoid a render loop.
  const rowRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0) setRowHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
  }, []);

  const range = computeRange(scrollTop, viewportHeight, rowHeight, itemCount, overscan);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const next = scrollOffsetForIndex(index, rowHeight, el.clientHeight, el.scrollTop, itemCount);
      if (next !== null) {
        el.scrollTop = next;
        setScrollTop(next);
      }
    },
    [rowHeight, itemCount],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, []);

  return { scrollRef, onScroll: handleScroll, rowRef, range, scrollToIndex, scrollToBottom };
}
