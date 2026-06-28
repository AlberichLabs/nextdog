import { afterEach, describe, expect, it } from 'vitest';
import { nextdog } from '../vite';

describe('nextdog vite plugin', () => {
  const originalUrl = process.env.NEXTDOG_URL;
  const originalService = process.env.NEXTDOG_SERVICE_NAME;

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.NEXTDOG_URL = originalUrl;
    } else {
      delete process.env.NEXTDOG_URL;
    }
    if (originalService !== undefined) {
      process.env.NEXTDOG_SERVICE_NAME = originalService;
    } else {
      delete process.env.NEXTDOG_SERVICE_NAME;
    }
  });

  it('returns a plugin with name "nextdog"', () => {
    const plugin = nextdog();
    expect(plugin.name).toBe('nextdog');
  });

  it('sets default env vars in dev mode', () => {
    const plugin = nextdog();
    // Simulate configResolved
    (plugin as any).configResolved({ mode: 'development' });
    expect(process.env.NEXTDOG_URL).toBe('http://localhost:6789');
    expect(process.env.NEXTDOG_SERVICE_NAME).toBe('nextdog-app');
  });

  it('uses custom options when provided', () => {
    const plugin = nextdog({ url: 'http://custom:9999', serviceName: 'my-sveltekit' });
    (plugin as any).configResolved({ mode: 'development' });
    expect(process.env.NEXTDOG_URL).toBe('http://custom:9999');
    expect(process.env.NEXTDOG_SERVICE_NAME).toBe('my-sveltekit');
  });

  it('does not set env vars in production mode', () => {
    delete process.env.NEXTDOG_URL;
    delete process.env.NEXTDOG_SERVICE_NAME;
    const plugin = nextdog();
    (plugin as any).configResolved({ mode: 'production' });
    expect(process.env.NEXTDOG_URL).toBeUndefined();
    expect(process.env.NEXTDOG_SERVICE_NAME).toBeUndefined();
  });
});
