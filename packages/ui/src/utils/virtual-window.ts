/**
 * Pure windowing math for the dashboard's virtualized scroll lists (issue #9).
 *
 * The Requests and Logs views render every matching row, which becomes a heavy
 * DOM and re-render cost once the SSE buffer fills (up to 2000 events). These
 * helpers compute which rows actually need to be in the DOM for a given scroll
 * position, plus the spacer sizes that keep the scrollbar honest and the
 * scroll-into-view offset for keyboard navigation.
 *
 * Everything here is intentionally dependency-free and side-effect-free so it
 * can be unit tested in isolation; the hook in `use-virtual-list.ts` wires it to
 * real DOM measurements.
 */

export interface VirtualRange {
  /** First row index to render (inclusive). */
  startIndex: number;
  /** Last row index to render (inclusive). -1 when there are no rows. */
  endIndex: number;
  /** Height of the spacer above the rendered rows, in px. */
  paddingTop: number;
  /** Height of the spacer below the rendered rows, in px. */
  paddingBottom: number;
  /** Total scrollable height of all rows, in px. */
  totalHeight: number;
}

/**
 * Given the current scroll position and viewport, compute the slice of rows to
 * render plus the top/bottom spacer heights. `overscan` rows are rendered on
 * each side of the visible window so fast scrolling doesn't flash blank space.
 *
 * Assumes a fixed `rowHeight` (both list rows are single-line, fixed-height —
 * see requests.tsx / log-row.tsx). Non-positive `rowHeight` or `itemCount`
 * collapse to an empty range so callers never divide by zero.
 */
export function computeRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  itemCount: number,
  overscan: number,
): VirtualRange {
  if (itemCount <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  }

  const totalHeight = itemCount * rowHeight;
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const clampedScroll = Math.max(0, Math.min(scrollTop, totalHeight));

  // First fully-or-partially visible row, then pull back by the overscan.
  const firstVisible = Math.floor(clampedScroll / rowHeight);
  const startIndex = Math.max(0, firstVisible - safeOverscan);

  // Number of rows that can be (partially) visible in the viewport.
  const visibleCount = viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) + 1 : 1;
  const lastVisible = firstVisible + visibleCount;
  const endIndex = Math.min(itemCount - 1, lastVisible + safeOverscan);

  const paddingTop = startIndex * rowHeight;
  const paddingBottom = (itemCount - 1 - endIndex) * rowHeight;

  return { startIndex, endIndex, paddingTop, paddingBottom, totalHeight };
}

/**
 * Largest row-height delta (px) treated as sub-pixel rounding noise rather than a
 * genuine layout change. `offsetHeight` is an integer, so two single-line rows
 * whose true heights differ by a fraction of a pixel (e.g. a 31.0px plain row vs a
 * 31.5px row carrying a padded status badge) round to adjacent integers — 31 and
 * 32 — a 1px difference that is not a real size change.
 */
const ROW_HEIGHT_JITTER_PX = 1;

/**
 * Decide the row height to keep after measuring the first rendered row.
 *
 * The virtualizer measures whichever row currently sits at the top of the window
 * to replace its initial estimate. That row's identity changes as you scroll, and
 * adjacent rows can round to heights 1px apart (see {@link ROW_HEIGHT_JITTER_PX}).
 * Naively adopting every measurement makes the height flip 31↔32 on each scroll;
 * because the height feeds back into which row is measured next, that flip never
 * settles — an infinite re-render loop that froze the page while scrolling the
 * flat Spans list (issue #58).
 *
 * Rules:
 *  - a non-positive measurement (row detached / not laid out) is ignored;
 *  - before any real measurement (`settled === false`) the first positive value is
 *    adopted, so the estimate is replaced exactly once;
 *  - once settled, only a change larger than the rounding jitter updates the
 *    height — genuine relayout (font/density change) still adapts, rounding noise
 *    can no longer oscillate.
 */
export function reconcileRowHeight(prev: number, measured: number, settled: boolean): number {
  if (measured <= 0) return prev;
  if (!settled) return measured;
  return Math.abs(measured - prev) > ROW_HEIGHT_JITTER_PX ? measured : prev;
}

/**
 * Compute the scrollTop needed to bring row `index` into view, or `null` if the
 * row is already fully visible (so callers can avoid jittery no-op scrolls).
 *
 * Mirrors native `scrollIntoView({ block: 'nearest' })`: scroll up just enough
 * when the row is above the viewport, down just enough when it's below, and do
 * nothing when it already fits.
 */
export function scrollOffsetForIndex(
  index: number,
  rowHeight: number,
  viewportHeight: number,
  currentScrollTop: number,
  itemCount: number,
): number | null {
  if (index < 0 || index >= itemCount || rowHeight <= 0) return null;

  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const viewTop = currentScrollTop;
  const viewBottom = currentScrollTop + viewportHeight;

  if (rowTop < viewTop) return rowTop; // row above the window — pin it to the top
  if (rowBottom > viewBottom) return rowBottom - viewportHeight; // below — pin to bottom
  return null; // already visible
}
