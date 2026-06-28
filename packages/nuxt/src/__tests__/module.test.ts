import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @nuxt/kit before importing module
const mockAddServerPlugin = vi.fn();
const mockResolve = vi.fn((path: string) => `/resolved${path}`);

vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (definition: any) => definition,
  addServerPlugin: (...args: any[]) => mockAddServerPlugin(...args),
  createResolver: () => ({ resolve: mockResolve }),
}));

import moduleDefinition from '../module';

function createNuxtMock(overrides: Record<string, any> = {}) {
  return {
    options: {
      dev: true,
      runtimeConfig: {} as Record<string, any>,
      ...overrides,
    },
  };
}

describe('@nextdog/nuxt module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct meta', () => {
    expect(moduleDefinition.meta).toEqual({
      name: '@nextdog/nuxt',
      configKey: 'nextdog',
    });
  });

  it('has sensible defaults', () => {
    expect(moduleDefinition.defaults).toEqual({
      serviceName: 'nextdog-app',
      url: 'http://localhost:6789',
    });
  });

  it('adds server plugin and sets runtimeConfig in dev mode', () => {
    const nuxt = createNuxtMock();
    const options = { serviceName: 'my-app', url: 'http://localhost:9999' };

    moduleDefinition.setup!(options, nuxt as any);

    // Should set runtimeConfig
    expect(nuxt.options.runtimeConfig.nextdog).toEqual({
      url: 'http://localhost:9999',
      serviceName: 'my-app',
    });

    // Should add server plugin
    expect(mockAddServerPlugin).toHaveBeenCalledTimes(1);
    expect(mockAddServerPlugin).toHaveBeenCalledWith(expect.stringContaining('server-plugin'));
  });

  it('uses default options when none provided', () => {
    const nuxt = createNuxtMock();
    const defaults = moduleDefinition.defaults as Record<string, string>;

    moduleDefinition.setup!(defaults, nuxt as any);

    expect(nuxt.options.runtimeConfig.nextdog).toEqual({
      url: 'http://localhost:6789',
      serviceName: 'nextdog-app',
    });
  });

  it('no-ops in production', () => {
    const nuxt = createNuxtMock({ dev: false });

    moduleDefinition.setup!({ serviceName: 'app', url: 'http://localhost:6789' }, nuxt as any);

    // Should NOT set runtimeConfig or add plugin
    expect(nuxt.options.runtimeConfig.nextdog).toBeUndefined();
    expect(mockAddServerPlugin).not.toHaveBeenCalled();
  });
});
