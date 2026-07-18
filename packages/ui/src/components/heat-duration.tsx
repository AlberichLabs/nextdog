/**
 * Duration list cell with a latency heat bar (issue #82).
 *
 * Renders the formatted duration (keeping the existing percentile-emphasis text
 * color via `className`) with a thin heat bar underneath, tinted + sized on the
 * shared latency scale so slowness reads by color before number. Used in the
 * Spans and Traces duration columns.
 */
import { heatFraction, type HeatScale, heatBucket } from '../utils/latency-scale';
import { heatCellClass, heatFillStyle, heatTrackClass } from '../styles/latency-heat';

interface HeatDurationProps {
  /** Duration in ms — drives the bar's color and length. */
  durationMs: number;
  /** Preformatted duration string shown as the value. */
  label: string;
  /** The shared per-list heat scale. */
  scale: HeatScale;
  /** Existing duration text className (preserves percentile emphasis). */
  className?: string;
}

export function HeatDuration({ durationMs, label, scale, className }: HeatDurationProps) {
  const bucket = heatBucket(durationMs, scale);
  const fraction = heatFraction(durationMs, scale);
  return (
    <span className={heatCellClass}>
      <span className={className}>{label}</span>
      <span className={heatTrackClass} aria-hidden="true">
        {durationMs > 0 && <span style={heatFillStyle(bucket, fraction)} />}
      </span>
    </span>
  );
}
