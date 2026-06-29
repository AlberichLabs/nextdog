import { describe, expect, it } from 'vitest';
import { computeRange, reconcileRowHeight, scrollOffsetForIndex } from '../virtual-window';

describe('computeRange', () => {
  it('renders only the visible window plus overscan, not every row', () => {
    // 1000 rows of 30px, 600px viewport, scrolled to the top.
    const r = computeRange(0, 600, 30, 1000, 5);
    expect(r.startIndex).toBe(0);
    // firstVisible 0; visibleCount = ceil(600/30)+1 = 21; lastVisible 21; +5 overscan → endIndex 26
    expect(r.endIndex).toBe(26);
    const rendered = r.endIndex - r.startIndex + 1;
    expect(rendered).toBeLessThan(40); // nowhere near 1000
  });

  it('spacers + rendered rows reconstruct the full scroll height', () => {
    const rowHeight = 30;
    const itemCount = 1000;
    const r = computeRange(3000, 600, rowHeight, itemCount, 5);
    const renderedRows = r.endIndex - r.startIndex + 1;
    const reconstructed = r.paddingTop + renderedRows * rowHeight + r.paddingBottom;
    expect(reconstructed).toBe(itemCount * rowHeight);
    expect(r.totalHeight).toBe(itemCount * rowHeight);
  });

  it('pulls the start back by the overscan when scrolled into the middle', () => {
    // scrollTop 3000 / 30 = row 100 first visible; overscan 5 → start 95.
    const r = computeRange(3000, 600, 30, 1000, 5);
    expect(r.startIndex).toBe(95);
    expect(r.paddingTop).toBe(95 * 30);
  });

  it('clamps the end index to the last row near the bottom', () => {
    const r = computeRange(30000 - 600, 600, 30, 1000, 5); // scrolled to the very bottom
    expect(r.endIndex).toBe(999);
    expect(r.paddingBottom).toBe(0);
  });

  it('returns an empty range for zero rows', () => {
    const r = computeRange(0, 600, 30, 0, 5);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(-1);
    expect(r.paddingTop).toBe(0);
    expect(r.paddingBottom).toBe(0);
    expect(r.totalHeight).toBe(0);
  });

  it('does not divide by zero when row height is unmeasured (0)', () => {
    const r = computeRange(0, 600, 0, 100, 5);
    expect(r.endIndex).toBe(-1);
    expect(Number.isFinite(r.paddingTop)).toBe(true);
  });

  it('never returns a negative start index above the top', () => {
    const r = computeRange(0, 600, 30, 1000, 50);
    expect(r.startIndex).toBe(0);
  });
});

describe('scrollOffsetForIndex', () => {
  const rowHeight = 30;
  const viewport = 600;
  const itemCount = 1000;

  it('scrolls up to pin a row that is above the window', () => {
    // window at scrollTop 3000 shows rows 100..119; row 50 is above.
    const offset = scrollOffsetForIndex(50, rowHeight, viewport, 3000, itemCount);
    expect(offset).toBe(50 * rowHeight); // 1500
  });

  it('scrolls down to pin a row that is below the window', () => {
    // window at scrollTop 0 shows rows 0..19; row 25 is below.
    const offset = scrollOffsetForIndex(25, rowHeight, viewport, 0, itemCount);
    // rowBottom = 26*30 = 780; new scrollTop = 780 - 600 = 180
    expect(offset).toBe(180);
  });

  it('returns null when the row is already fully visible', () => {
    // window at scrollTop 0 shows rows 0..19; row 10 is visible.
    expect(scrollOffsetForIndex(10, rowHeight, viewport, 0, itemCount)).toBeNull();
  });

  it('returns null for out-of-range indices', () => {
    expect(scrollOffsetForIndex(-1, rowHeight, viewport, 0, itemCount)).toBeNull();
    expect(scrollOffsetForIndex(itemCount, rowHeight, viewport, 0, itemCount)).toBeNull();
  });

  it('handles the last row at the bottom edge', () => {
    const offset = scrollOffsetForIndex(itemCount - 1, rowHeight, viewport, 0, itemCount);
    // rowBottom = 1000*30 = 30000; new scrollTop = 30000 - 600 = 29400
    expect(offset).toBe(29400);
  });
});

describe('reconcileRowHeight', () => {
  it('adopts the first real measurement over the unmeasured estimate', () => {
    // settled=false → take whatever the first rendered row measures, even if it
    // is within a pixel of the 30px estimate.
    expect(reconcileRowHeight(30, 31, false)).toBe(31);
    expect(reconcileRowHeight(30, 32, false)).toBe(32);
  });

  it('ignores a non-positive measurement (detached/unmeasured row)', () => {
    expect(reconcileRowHeight(31, 0, true)).toBe(31);
    expect(reconcileRowHeight(31, -1, false)).toBe(31);
  });

  it('ignores sub-pixel rounding jitter between near-identical rows (issue #58)', () => {
    // offsetHeight rounds a 31.5px badge row to 32 and a 31px plain row to 31.
    // Once settled, a 1px difference is rounding noise, not a real size change —
    // reacting to it flips rowHeight every scroll and drives an infinite
    // re-render loop that freezes the page.
    expect(reconcileRowHeight(31, 32, true)).toBe(31);
    expect(reconcileRowHeight(32, 31, true)).toBe(32);
  });

  it('does NOT oscillate when fed an alternating 31/32 measurement stream', () => {
    // Simulate the scroll loop: the "first rendered row" alternates between a
    // badge row (32) and a plain row (31) as the window slides. A correct
    // reconcile latches a single value; a buggy one flip-flops forever.
    let h = reconcileRowHeight(30, 31, false); // first adoption
    const measurements = [32, 31, 32, 31, 32, 31, 32];
    const seen = new Set<number>([h]);
    for (const m of measurements) {
      h = reconcileRowHeight(h, m, true);
      seen.add(h);
    }
    // The height must settle on exactly one value — never bounce between two.
    expect(seen.size).toBe(1);
    expect(h).toBe(31);
  });

  it('still adopts a genuinely different row height (real relayout)', () => {
    // A real density/font change (well beyond rounding) must still update.
    expect(reconcileRowHeight(31, 44, true)).toBe(44);
    expect(reconcileRowHeight(44, 31, true)).toBe(31);
  });
});
