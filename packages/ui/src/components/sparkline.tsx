import { useMemo } from 'preact/hooks';
import { token } from 'styled-system/tokens';
import type { SSEEvent } from '../hooks/use-sse.js';

const WIDTH = 80;
const HEIGHT = 24;
const BUCKET_COUNT = 30;
const WINDOW_MS = 60_000;

export function Sparkline({ events }: { events: SSEEvent[] }) {
  const points = useMemo(() => {
    if (events.length === 0) return null;

    const now = Date.now();
    const start = now - WINDOW_MS;
    const bucketSize = WINDOW_MS / BUCKET_COUNT;
    const buckets = new Array<number>(BUCKET_COUNT).fill(0);

    for (const event of events) {
      const t = event.timestamp;
      if (t < start) continue;
      const idx = Math.min(Math.floor((t - start) / bucketSize), BUCKET_COUNT - 1);
      buckets[idx]++;
    }

    const max = Math.max(...buckets, 1);
    const stepX = WIDTH / (BUCKET_COUNT - 1);

    return buckets.map((count, i) => {
      const x = i * stepX;
      const y = HEIGHT - (count / max) * HEIGHT;
      return `${x},${y}`;
    });
  }, [events]);

  if (!points) return null;

  const polylinePoints = points.join(' ');
  const areaPoints = `0,${HEIGHT} ${polylinePoints} ${WIDTH},${HEIGHT}`;
  const greenColor = token('colors.green');

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      <polygon points={areaPoints} fill={greenColor} opacity={0.1} />
      <polyline points={polylinePoints} fill="none" stroke={greenColor} stroke-width="1.5" />
    </svg>
  );
}
