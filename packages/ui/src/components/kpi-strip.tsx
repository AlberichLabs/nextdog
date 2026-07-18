/**
 * KPI summary strip (issue #82).
 *
 * A slim, dense row of stat cells — throughput (req/s), p95 latency, error rate
 * — derived from the in-memory events already loaded (computeKpis, client-side;
 * no server call). Sits under the header toolbar and updates live with the
 * stream. Intentionally subtle: small mono figures on the panel surface, not a
 * big dashboard header.
 */
import { useMemo } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { formatDurationMs } from '../utils/format';
import { computeKpis } from '../utils/kpi';

const stripStyle = css({
  display: 'flex',
  alignItems: 'stretch',
  gap: '0',
  px: '4',
  height: '30px',
  borderBottom: '1px solid token(colors.border.subtle)',
  background: 'surface.panel',
  fontFamily: 'mono',
  flexShrink: 0,
});

const cellStyle = css({
  display: 'flex',
  alignItems: 'baseline',
  gap: '1.5',
  px: '3',
  borderRight: '1px solid token(colors.border.subtle)',
  _first: { pl: '0' },
});

const labelStyle = css({
  fontSize: 'xs',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'fg.dim',
});

const valueStyle = css({
  fontSize: 'md',
  fontWeight: 600,
  color: 'fg.bright',
});

// Error-rate value tints red once any request has errored — a quiet health
// signal, distinct from the teal chrome accent.
const valueErrStyle = css({
  fontSize: 'md',
  fontWeight: 600,
  color: 'red',
});

function Cell({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={cellStyle}>
      <span className={labelStyle}>{label}</span>
      <span className={alert ? valueErrStyle : valueStyle}>{value}</span>
    </div>
  );
}

function formatThroughput(perSec: number): string {
  if (perSec === 0) return '0/s';
  if (perSec < 0.1) return '<0.1/s';
  if (perSec < 10) return `${perSec.toFixed(1)}/s`;
  return `${Math.round(perSec)}/s`;
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  if (rate === 0) return '0%';
  const pct = rate * 100;
  return pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

interface KpiStripProps {
  events: SSEEvent[];
}

export function KpiStrip({ events }: KpiStripProps) {
  const kpis = useMemo(() => computeKpis(events), [events]);

  return (
    <div className={stripStyle} role="status" aria-label="Traffic summary">
      <Cell label="req/s" value={formatThroughput(kpis.throughputPerSec)} />
      <Cell label="p95" value={kpis.p95Ms === null ? '—' : formatDurationMs(kpis.p95Ms)} />
      <Cell
        label="errors"
        value={formatRate(kpis.errorRate)}
        alert={kpis.errorRate !== null && kpis.errorRate > 0}
      />
    </div>
  );
}
