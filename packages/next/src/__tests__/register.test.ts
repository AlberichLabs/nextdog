import { afterEach, describe, expect, it, vi } from 'vitest';

describe('register', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('does nothing in production', async () => {
    process.env.NODE_ENV = 'production';
    vi.mock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: vi.fn(),
      BatchSpanProcessor: vi.fn(),
    }));
    await import('../register');
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    expect(NodeTracerProvider).not.toHaveBeenCalled();
  });
});
