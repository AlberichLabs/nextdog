import { addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

export interface NextDogOptions {
  serviceName?: string;
  url?: string;
}

const DEFAULT_OPTIONS = {
  serviceName: 'nextdog-app',
  url: 'http://localhost:6789',
} as const;

export default defineNuxtModule<NextDogOptions>({
  meta: {
    name: '@nextdog/nuxt',
    configKey: 'nextdog',
  },
  defaults: { ...DEFAULT_OPTIONS },
  setup(options, nuxt) {
    // Dev only — no overhead in production
    if (!nuxt.options.dev) return;

    const { resolve } = createResolver(import.meta.url);

    // Inject config for the runtime server plugin via Nitro's runtimeConfig.
    // `defaults` above guarantees these at runtime; fall back to the same
    // defaults so the declared-optional type needs no non-null assertion.
    nuxt.options.runtimeConfig.nextdog = {
      url: options.url ?? DEFAULT_OPTIONS.url,
      serviceName: options.serviceName ?? DEFAULT_OPTIONS.serviceName,
    };

    // Register the Nitro server plugin (runs on server startup)
    addServerPlugin(resolve('./runtime/server-plugin'));
  },
});
