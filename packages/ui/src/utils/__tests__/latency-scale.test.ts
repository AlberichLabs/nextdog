import { describe, expect, it } from 'vitest';
import {
  buildHeatScale,
  HEAT_ANCHOR_MS,
  HEAT_BUCKETS,
  heatBucket,
  heatFraction,
} from '../latency-scale';

describe('buildHeatScale', () => {
  it('falls back to fixed anchors for an empty sample', () => {
    const s = buildHeatScale([]);
    expect(s.min).toBe(HEAT_ANCHOR_MS[0]);
    expect(s.max).toBe(HEAT_ANCHOR_MS[HEAT_ANCHOR_MS.length - 1]);
  });

  it('ignores non-positive durations', () => {
    const s = buildHeatScale([0, -5, 100, 200]);
    expect(s.min).toBe(100);
  });

  it('uses fastest as cool end and p95 as hot end', () => {
    // 1..100 → min 1, p95 index = floor(100*0.95)=95 → value 96
    const durations = Array.from({ length: 100 }, (_, i) => i + 1);
    const s = buildHeatScale(durations);
    expect(s.min).toBe(1);
    expect(s.max).toBe(96);
  });

  it('does not let a lone outlier wash the scale cool (p95, not max)', () => {
    const durations = [...Array(99).fill(10), 100000];
    const s = buildHeatScale(durations);
    expect(s.max).toBeLessThan(100000);
  });

  it('falls back to anchors when all durations are identical', () => {
    const s = buildHeatScale([50, 50, 50]);
    expect(s.min).toBe(HEAT_ANCHOR_MS[0]);
    expect(s.max).toBe(HEAT_ANCHOR_MS[HEAT_ANCHOR_MS.length - 1]);
  });
});

describe('heatFraction', () => {
  const scale = { min: 0, max: 100 };

  it('clamps below the cool end to 0', () => {
    expect(heatFraction(-10, scale)).toBe(0);
    expect(heatFraction(0, scale)).toBe(0);
  });

  it('clamps above the hot end to 1', () => {
    expect(heatFraction(500, scale)).toBe(1);
  });

  it('interpolates linearly inside the scale', () => {
    expect(heatFraction(50, scale)).toBeCloseTo(0.5, 5);
    expect(heatFraction(25, scale)).toBeCloseTo(0.25, 5);
  });

  it('returns 0 for a degenerate (zero-span) scale', () => {
    expect(heatFraction(50, { min: 100, max: 100 })).toBe(0);
  });
});

describe('heatBucket', () => {
  const scale = { min: 0, max: 100 };

  it('coolest value maps to bucket 0', () => {
    expect(heatBucket(0, scale)).toBe(0);
  });

  it('hottest value stays in the top bucket (no overflow)', () => {
    expect(heatBucket(100, scale)).toBe(HEAT_BUCKETS - 1);
    expect(heatBucket(99999, scale)).toBe(HEAT_BUCKETS - 1);
  });

  it('produces the full range of buckets across the scale', () => {
    const buckets = new Set([0, 20, 40, 60, 80, 100].map((ms) => heatBucket(ms, scale)));
    expect(buckets.size).toBe(HEAT_BUCKETS);
  });
});
