import { describe, expect, it } from 'vitest';
import { NEXTDOG_HEALTH_MARKER, NEXTDOG_HEALTH_SERVICE_FIELD } from '../health.js';
import * as core from '../index.js';

describe('health marker', () => {
  it('is the stable "nextdog" service signature', () => {
    expect(NEXTDOG_HEALTH_MARKER).toBe('nextdog');
    expect(NEXTDOG_HEALTH_SERVICE_FIELD).toBe('service');
  });

  it('is re-exported from the package entry point for consumers', () => {
    // @nextdog/node imports this from the package root, so the public surface
    // must expose it — otherwise producer and consumer can silently drift.
    expect(core.NEXTDOG_HEALTH_MARKER).toBe(NEXTDOG_HEALTH_MARKER);
    expect(core.NEXTDOG_HEALTH_SERVICE_FIELD).toBe(NEXTDOG_HEALTH_SERVICE_FIELD);
  });
});
