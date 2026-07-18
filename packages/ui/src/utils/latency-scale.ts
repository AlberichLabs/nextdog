/**
 * Shared latency → heat scale.
 *
 * Maps a request/span duration onto a cool→warm bucket so slowness reads by
 * COLOR before the eye parses the number. Used by the list duration cells and
 * the waterfall span bars (issue #82) so both speak the same visual language.
 *
 * This is intentionally PURE (no DOM, no panda import): it returns a bucket
 * index and a 0–1 normalized position. The actual colors — which must be
 * theme-aware (dark + light) — live in the style layer (styles/latency-heat.ts),
 * which is the single place that touches panda tokens. That split keeps this
 * logic unit-testable and keeps the data-viz palette out of the pure module.
 *
 * Data-viz semantics are deliberately SEPARATE from the single teal UI accent:
 * this scale is green→amber→red, never teal, so the chrome accent discipline
 * stays intact.
 */

/** Number of heat buckets (0 = fastest/cool … 4 = slowest/hot). */
export const HEAT_BUCKETS = 5;

/**
 * Fixed reference thresholds (ms) used when there is no meaningful distribution
 * to scale against (e.g. every row has the same duration, or a lone span). These
 * are human-perception anchors for a local dev server, NOT SLOs:
 *   <20ms trivially fast · ~100ms snappy · ~500ms noticeable · ≥1s slow (matches
 *   the slow-request toast threshold, SLOW_REQUEST_MS).
 * Taste-fork (#82): thresholds chosen so a typical fast local handler sits cool
 * and anything crossing the 1s toast line is unmistakably hot.
 */
export const HEAT_ANCHOR_MS = [20, 100, 500, 1000] as const;

export interface HeatScale {
  /** Lower bound of the scale (ms). */
  min: number;
  /** Upper bound of the scale (ms). */
  max: number;
}

/**
 * Build a heat scale from a set of durations. Uses p95 as the hot end so a
 * handful of pathological outliers don't wash the whole list cool, and the
 * fastest observed value as the cool end. Falls back to the fixed anchors when
 * the sample is empty or degenerate (all-equal / single value).
 */
export function buildHeatScale(durationsMs: number[]): HeatScale {
  const sorted = durationsMs.filter((d) => d > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { min: HEAT_ANCHOR_MS[0], max: HEAT_ANCHOR_MS[HEAT_ANCHOR_MS.length - 1] };
  }
  const min = sorted[0];
  const p95 = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)];
  // Degenerate spread (one value, or all identical): scale against the fixed
  // anchors instead so a uniform list still tints by absolute slowness.
  if (p95 <= min) {
    return { min: HEAT_ANCHOR_MS[0], max: HEAT_ANCHOR_MS[HEAT_ANCHOR_MS.length - 1] };
  }
  return { min, max: p95 };
}

/**
 * Normalize a duration to 0–1 within a scale (clamped). 0 = cool end, 1 = hot.
 */
export function heatFraction(ms: number, scale: HeatScale): number {
  if (!(ms > 0)) return 0;
  const span = scale.max - scale.min;
  if (span <= 0) return 0;
  const f = (ms - scale.min) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Bucket a duration into [0, HEAT_BUCKETS-1] within a scale. 0 = coolest.
 */
export function heatBucket(ms: number, scale: HeatScale): number {
  const f = heatFraction(ms, scale);
  const b = Math.floor(f * HEAT_BUCKETS);
  return b >= HEAT_BUCKETS ? HEAT_BUCKETS - 1 : b;
}
