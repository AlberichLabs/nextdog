import { css } from 'styled-system/css';
import { token } from 'styled-system/tokens';
import type { SSEEvent } from '../hooks/use-sse.js';

const COLORS = [
  token('colors.accent'),
  token('colors.blue'),
  token('colors.green'),
  token('colors.yellow'),
  token('colors.red'),
];

const waterfallStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  padding: '2',
  fontSize: 'md',
});

const waterfallRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  padding: '1',
  borderRadius: 'sm',
  _hover: {
    bg: 'surface.hover',
  },
});

const waterfallLabelStyle = css({
  width: '200px',
  minWidth: '200px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'fg',
  fontSize: 'sm',
});

const waterfallBarContainerStyle = css({
  flex: 1,
  position: 'relative',
  height: '16px',
  bg: 'surface.panel',
  borderRadius: 'sm',
});

const waterfallBarStyle = css({
  position: 'absolute',
  top: 0,
  height: '100%',
  borderRadius: 'sm',
  opacity: 0.8,
});

const waterfallDurationStyle = css({
  width: '70px',
  minWidth: '70px',
  textAlign: 'right',
  color: 'fg.dim',
  fontSize: 'sm',
});

const serviceNameStyle = css({
  color: 'fg.dim',
  fontSize: 'sm',
});

interface WaterfallProps {
  spans: SSEEvent[];
  onSpanClick?: (event: SSEEvent) => void;
}

interface SpanTiming {
  name: string;
  startNano: bigint;
  endNano: bigint;
  durationMs: number;
  depth: number;
  color: string;
  serviceName: string;
  source: SSEEvent;
}

function buildTimings(spans: SSEEvent[]): {
  timings: SpanTiming[];
  minNano: bigint;
  maxNano: bigint;
} {
  const timed = spans.filter((s) => s.data.startTimeUnixNano && s.data.endTimeUnixNano);
  if (timed.length === 0) return { timings: [], minNano: 0n, maxNano: 0n };

  const childMap = new Map<string, SSEEvent[]>();
  const spanMap = new Map<string, SSEEvent>();

  for (const s of timed) {
    if (s.data.spanId) spanMap.set(s.data.spanId, s);
    const pid = s.data.parentSpanId;
    if (pid) {
      if (!childMap.has(pid)) childMap.set(pid, []);
      childMap.get(pid)!.push(s);
    }
  }

  const depths = new Map<string, number>();
  const roots = timed.filter((s) => !s.data.parentSpanId || !spanMap.has(s.data.parentSpanId));

  function assignDepth(spanId: string, depth: number) {
    depths.set(spanId, depth);
    for (const child of childMap.get(spanId) ?? []) {
      if (child.data.spanId) assignDepth(child.data.spanId, depth + 1);
    }
  }
  for (const root of roots) {
    if (root.data.spanId) assignDepth(root.data.spanId, 0);
  }

  const ordered: SSEEvent[] = [];
  function dfs(spanId: string) {
    const span = spanMap.get(spanId);
    if (span) ordered.push(span);
    for (const child of childMap.get(spanId) ?? []) {
      if (child.data.spanId) dfs(child.data.spanId);
    }
  }
  for (const root of roots) {
    if (root.data.spanId) dfs(root.data.spanId);
  }

  let minNano = BigInt('9999999999999999999');
  let maxNano = 0n;

  const timings: SpanTiming[] = ordered.map((s, i) => {
    const startNano = BigInt(String(s.data.startTimeUnixNano).replace('n', ''));
    const endNano = BigInt(String(s.data.endTimeUnixNano).replace('n', ''));
    if (startNano < minNano) minNano = startNano;
    if (endNano > maxNano) maxNano = endNano;
    return {
      name: String(
        s.data.attributes['http.route'] ?? s.data.attributes['http.target'] ?? s.data.name,
      ),
      startNano,
      endNano,
      durationMs: Number(endNano - startNano) / 1_000_000,
      depth: depths.get(s.data.spanId ?? '') ?? 0,
      color: COLORS[i % COLORS.length],
      serviceName: s.data.serviceName,
      source: s,
    };
  });

  return { timings, minNano, maxNano };
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function Waterfall({ spans, onSpanClick }: WaterfallProps) {
  const { timings, minNano, maxNano } = buildTimings(spans);
  const totalNano = maxNano - minNano;

  if (timings.length === 0)
    return (
      <div
        className={css({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: 'fg.dim',
          fontSize: 'xl',
        })}
      >
        No timing data available
      </div>
    );

  return (
    <div className={waterfallStyle}>
      {timings.map((t, i) => {
        const leftPct =
          totalNano > 0n ? Number(((t.startNano - minNano) * 10000n) / totalNano) / 100 : 0;
        const widthPct =
          totalNano > 0n
            ? Math.max(0.5, Number(((t.endNano - t.startNano) * 10000n) / totalNano) / 100)
            : 100;
        return (
          <div
            key={i}
            className={waterfallRowStyle}
            style={`padding-left:${t.depth * 16}px;${onSpanClick ? 'cursor:pointer' : ''}`}
            onClick={() => onSpanClick?.(t.source)}
          >
            <span className={waterfallLabelStyle} title={t.name}>
              <span className={serviceNameStyle}>{t.serviceName} </span>
              {t.name}
            </span>
            <div className={waterfallBarContainerStyle}>
              <div
                className={waterfallBarStyle}
                style={`left:${leftPct}%;width:${widthPct}%;background:${t.color}`}
              />
            </div>
            <span className={waterfallDurationStyle}>{formatDuration(t.durationMs)}</span>
          </div>
        );
      })}
    </div>
  );
}
