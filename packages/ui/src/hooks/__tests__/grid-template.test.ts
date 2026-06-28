import { describe, expect, it } from 'vitest';
import { buildGridTemplate, type ColumnConfig } from '../use-column-resize';

const columns: ColumnConfig[] = [
  { id: 'time', defaultWidth: 75 },
  { id: 'method', defaultWidth: 55 },
  { id: 'route', defaultWidth: 0 }, // flex
  { id: 'status', defaultWidth: 50 },
  { id: 'duration', defaultWidth: 75 },
  { id: 'service', defaultWidth: 90 },
];

describe('buildGridTemplate', () => {
  it('renders px tracks for fixed columns and 1fr for the flex column', () => {
    expect(buildGridTemplate(columns, {})).toBe('75px 55px 1fr 50px 75px 90px');
  });

  it('honors width overrides', () => {
    expect(buildGridTemplate(columns, { time: 120 })).toBe('120px 55px 1fr 50px 75px 90px');
  });

  it('collapses listed columns to a 0 track so the flex column keeps its width (issue #50)', () => {
    // On a narrow viewport duration + service collapse; the route (flex) track
    // stays 1fr and reclaims the freed width instead of clipping to ~0.
    const template = buildGridTemplate(columns, {}, new Set(['duration', 'service']));
    expect(template).toBe('75px 55px 1fr 50px 0 0');
  });

  it('keeps cell-count == track-count by collapsing (not dropping) tracks (issue #18)', () => {
    const template = buildGridTemplate(columns, {}, new Set(['duration', 'service']));
    expect(template.split(' ')).toHaveLength(columns.length);
  });
});
