import { addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

export interface NextDogOptions {
  serviceName?: string;
  url?: string;
}

export default defineNuxtModule<NextDogOptions>({
  meta: {
    name: '@nextdog/nuxt',
    configKey: 'nextdog',
  },
  defaults: {
    serviceName: 'nextdog-app',
    url: 'http://localhost:6789',
  },
  setup(options, nuxt) {
    // Dev only — no overhead in production
    if (!nuxt.options.dev) return;

    const { resolve } = createResolver(import.meta.url);

    // Inject config for the runtime server plugin via Nitro's runtimeConfig
    nuxt.options.runtimeConfig.nextdog = {
      url: options.url!,
      serviceName: options.serviceName!,
    };

    // Register the Nitro server plugin (runs on server startup)
    addServerPlugin(resolve('./runtime/server-plugin'));
  },
});
