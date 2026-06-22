import { describe, expect, it } from 'vitest';
import { type EmptyStateInput, selectEmptyState } from '../empty-state-logic.js';

const base: EmptyStateInput = {
  connected: false,
  everReceived: false,
  filterActive: false,
  hasVisibleEvents: false,
};

describe('selectEmptyState — branch table', () => {
  it('not connected, never received → disconnected (setup checklist)', () => {
    expect(selectEmptyState({ ...base, connected: false })).toBe('disconnected');
  });

  it('connected, never received → connected-idle (nudge first request)', () => {
    expect(selectEmptyState({ ...base, connected: true })).toBe('connected-idle');
  });

  it('connected, received events, filter hides all → filter-empty', () => {
    expect(
      selectEmptyState({
        connected: true,
        everReceived: true,
        filterActive: true,
        hasVisibleEvents: false,
      }),
    ).toBe('filter-empty');
  });

  it('events visible → populated regardless of other flags', () => {
    expect(
      selectEmptyState({
        connected: true,
        everReceived: true,
        filterActive: true,
        hasVisibleEvents: true,
      }),
    ).toBe('populated');
    expect(selectEmptyState({ ...base, hasVisibleEvents: true })).toBe('populated');
  });

  it('received events, no filter, none visible → connected-idle, not filter-empty', () => {
    // e.g. user cleared all events: nothing is filtered out, so guide them to
    // generate fresh traffic rather than blame a filter.
    expect(
      selectEmptyState({
        connected: true,
        everReceived: true,
        filterActive: false,
        hasVisibleEvents: false,
      }),
    ).toBe('connected-idle');
  });

  it('filter active but nothing ever received → disconnected/idle, not filter-empty', () => {
    // A filter can be present from the URL on first load before any event
    // arrives; "no events yet" must win over "filter hides everything".
    expect(selectEmptyState({ ...base, connected: false, filterActive: true })).toBe(
      'disconnected',
    );
    expect(selectEmptyState({ ...base, connected: true, filterActive: true })).toBe(
      'connected-idle',
    );
  });

  it('connection dropped after events arrived, filter active → still filter-empty', () => {
    expect(
      selectEmptyState({
        connected: false,
        everReceived: true,
        filterActive: true,
        hasVisibleEvents: false,
      }),
    ).toBe('filter-empty');
  });
});
