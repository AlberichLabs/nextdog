import { afterEach, describe, expect, it, vi } from 'vitest';
import { withNextDog } from '../index';

// Mock require to control Next.js version detection
vi.mock('next/package.json', () => ({ default: { version: '16.2.1' } }));

describe('withNextDog', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('injects env vars in development', () => {
    process.env.NODE_ENV = 'development';
    const config = withNextDog({ reactStrictMode: true });
    expect(config.env).toEqual(expect.objectContaining({ NEXTDOG_URL: 'http://localhost:6789' }));
    expect(config.env.NEXTDOG_SERVICE_NAME).toBeDefined();
    expect(config.reactStrictMode).toBe(true);
  });

  it('passes config through unchanged in production', () => {
    process.env.NODE_ENV = 'production';
    const input = { reactStrictMode: true, images: { domains: ['example.com'] } };
    const config = withNextDog(input);
    expect(config).toEqual(input);
    expect(config.experimental).toBeUndefined();
  });

  it('allows custom service name', () => {
    process.env.NODE_ENV = 'development';
    const config = withNextDog({ reactStrictMode: true }, { serviceName: 'my-api' });
    expect(config.env.NEXTDOG_SERVICE_NAME).toBe('my-api');
  });

  it('allows custom sidecar URL', () => {
    process.env.NODE_ENV = 'development';
    const config = withNextDog({}, { url: 'http://localhost:9999' });
    expect(config.env.NEXTDOG_URL).toBe('http://localhost:9999');
  });

  it('does NOT set experimental.instrumentationHook for Next.js 16+', () => {
    process.env.NODE_ENV = 'development';
    const config = withNextDog({});
    expect(config.experimental?.instrumentationHook).toBeUndefined();
  });

  it('preserves a caller-supplied experimental block on Next.js 16+ (issue #98)', () => {
    process.env.NODE_ENV = 'development';
    const config = withNextDog({
      reactStrictMode: true,
      experimental: { optimizePackageImports: ['lodash'] },
    });
    // On Next 16 we add no experimental key of our own, so the caller's survives.
    expect(config.experimental).toEqual({ optimizePackageImports: ['lodash'] });
    expect(config.reactStrictMode).toBe(true);
    expect(config.env.NEXTDOG_URL).toBe('http://localhost:6789');
  });
});
