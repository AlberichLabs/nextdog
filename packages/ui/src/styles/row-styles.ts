/**
 * Shared row-cell styling for the tabular event views (Spans, Traces).
 *
 * Extracted from the Traces (requests) view so the new flat Spans view renders
 * method / HTTP-status / duration cells identically instead of duplicating the
 * class logic (issue #62). Pure: every export returns a className string or a
 * style constant — no behaviour.
 */
import { css } from 'styled-system/css';

/* ── Method ───────────────────────────────────────────────────────────── */

const methodStyle = css({ fontWeight: '600' });
const methodGetStyle = css({ fontWeight: '600', color: 'green' });
const methodPostStyle = css({ fontWeight: '600', color: 'blue' });
const methodPutStyle = css({ fontWeight: '600', color: 'yellow' });
const methodDeleteStyle = css({ fontWeight: '600', color: 'red' });

export function getMethodClassName(method: string): string {
  const m = method.toUpperCase();
  if (m === 'GET') return methodGetStyle;
  if (m === 'POST') return methodPostStyle;
  if (m === 'PUT') return methodPutStyle;
  if (m === 'DELETE') return methodDeleteStyle;
  return methodStyle;
}

/* ── HTTP status badge ────────────────────────────────────────────────── */

const httpStatusStyle = css({
  fontWeight: '600',
  fontSize: 'sm',
  textAlign: 'center',
  py: '1px',
  px: '1',
  borderRadius: 'sm',
});

// Badge tints. Dark keeps its original punchy tint; light uses a faint tint of
// the (darker) light hue so the colored text stays AA on the light panel — see
// packages/ui/src/styles/theme-colors.ts.
const http2xxStyle = css({
  color: 'green',
  background: 'rgba(0, 184, 148, 0.1)',
  _light: { background: 'rgba(4, 120, 87, 0.06)' },
});

const http3xxStyle = css({
  color: 'blue',
  background: 'rgba(116, 185, 255, 0.1)',
  _light: { background: 'rgba(29, 78, 216, 0.06)' },
});

const http4xxStyle = css({
  color: 'yellow',
  background: 'rgba(253, 203, 110, 0.1)',
  _light: { background: 'rgba(132, 100, 7, 0.06)' },
});

const http5xxStyle = css({
  color: 'red',
  background: 'rgba(225, 112, 85, 0.15)',
  _light: { background: 'rgba(200, 30, 30, 0.06)' },
});

export function getHttpStatusClassName(code: number): string {
  const group = Math.floor(code / 100);
  const base = httpStatusStyle;
  if (group === 2) return `${base} ${http2xxStyle}`;
  if (group === 3) return `${base} ${http3xxStyle}`;
  if (group === 4) return `${base} ${http4xxStyle}`;
  if (group === 5) return `${base} ${http5xxStyle}`;
  return base;
}

/* ── Span/request OK·ERROR status ─────────────────────────────────────── */

export const statusOkStyle = css({ color: 'green' });
export const statusErrorStyle = css({ color: 'red' });

/* ── Duration with percentile emphasis ────────────────────────────────── */

const durationStyle = css({ color: 'fg.dim', textAlign: 'right' });
const durationP90Style = css({ color: 'yellow', fontWeight: '600', textAlign: 'right' });
const durationP99Style = css({ color: 'red', fontWeight: '600', textAlign: 'right' });

export interface Percentiles {
  p50: number;
  p90: number;
  p99: number;
}

export function getDurationClassName(ms: number, p: Percentiles): string {
  if (p.p50 === 0) return durationStyle;
  if (ms >= p.p99) return `${durationStyle} ${durationP99Style}`;
  if (ms >= p.p90) return `${durationStyle} ${durationP90Style}`;
  return durationStyle;
}

/** Compute p50/p90/p99 thresholds from a list of durations (ms). */
export function computePercentiles(durationsMs: number[]): Percentiles {
  const sorted = durationsMs.filter((d) => d > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { p50: 0, p90: 0, p99: 0 };
  const at = (p: number) => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99) };
}
