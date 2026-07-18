/**
 * Theme-aware heat-bar styling for the latency scale (issue #82).
 *
 * The pure bucketing lives in utils/latency-scale.ts; this is the single place
 * that binds a bucket to color. Colors come from the existing panda semantic
 * status tokens (green / yellow / orange / red) — each already has a tuned
 * dark AND light value (see styles/theme-colors.ts, WCAG-checked), so the heat
 * scale works in both themes for free and stays on the token system.
 *
 * This green→amber→red data-viz ramp is intentionally distinct from the single
 * teal UI accent: it never uses `accent`, so the chrome/accent discipline is
 * untouched.
 */
import { css } from 'styled-system/css';
import { token } from 'styled-system/tokens';
import { HEAT_BUCKETS } from '../utils/latency-scale';

/** Token color name per bucket, coolest → hottest. */
const BUCKET_TOKEN = ['green', 'yellow', 'orange', 'red', 'red'] as const;

/** Waterfall bar fill opacity per bucket — the top (red) bucket reads hotter. */
const BUCKET_BAR_OPACITY = [0.75, 0.78, 0.82, 0.85, 0.95] as const;

/**
 * A theme-aware color for a heat bucket, as a `token(colors.*)` reference so it
 * resolves per-theme at runtime. Used for the waterfall span bars.
 */
export function heatColor(bucket: number): string {
  const b = clampBucket(bucket);
  return token(`colors.${BUCKET_TOKEN[b]}`);
}

/** Fill opacity for a heat bucket's waterfall bar. */
export function heatBarOpacity(bucket: number): number {
  return BUCKET_BAR_OPACITY[clampBucket(bucket)];
}

function clampBucket(bucket: number): number {
  if (bucket < 0) return 0;
  if (bucket >= HEAT_BUCKETS) return HEAT_BUCKETS - 1;
  return bucket;
}

/* ── List duration heat cell ──────────────────────────────────────────────
 * A small heat bar tucked under the duration value in the Spans/Traces/Logs
 * lists. Text stays the token-driven duration color (percentile emphasis is
 * preserved); the bar underneath encodes the same latency on the shared scale.
 */

const heatCellStyle = css({
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '2px',
  width: '100%',
});

const heatTrackStyle = css({
  position: 'relative',
  width: '100%',
  height: '3px',
  borderRadius: 'full',
  // Faint neutral trough so an empty/short bar still reads as a track.
  background: 'token(colors.border.subtle)',
  overflow: 'hidden',
});

/** Class for the heat-cell wrapper (column: value on top, bar below). */
export const heatCellClass = heatCellStyle;
/** Class for the heat-bar track. */
export const heatTrackClass = heatTrackStyle;

/**
 * Inline style for the filled portion of a heat bar. `fraction` (0–1) sets the
 * width so the bar length also encodes latency; `bucket` sets the color.
 */
export function heatFillStyle(bucket: number, fraction: number): string {
  const width = Math.max(4, Math.round(fraction * 100));
  return `position:absolute;left:0;top:0;bottom:0;width:${width}%;background:${heatColor(bucket)};opacity:0.85;border-radius:inherit`;
}
