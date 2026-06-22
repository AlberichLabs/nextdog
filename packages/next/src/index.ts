export interface NextDogOptions {
  serviceName?: string;
  url?: string;
}

interface NextConfig {
  experimental?: Record<string, unknown>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Detect installed Next.js major version.
 * Returns 0 if detection fails (safe fallback — won't set experimental flags).
 */
function detectNextVersion(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('next/package.json');
    const major = parseInt(String(pkg.version).split('.')[0], 10);
    return Number.isNaN(major) ? 0 : major;
  } catch {
    return 0;
  }
}

export function withNextDog(config: NextConfig, options?: NextDogOptions): NextConfig {
  if (process.env.NODE_ENV !== 'development') {
    return config;
  }

  const url = options?.url ?? 'http://localhost:6789';
  const serviceName = options?.serviceName ?? 'nextdog-app';

  const nextVersion = detectNextVersion();

  const result: NextConfig = {
    ...config,
    env: {
      ...config.env,
      NEXTDOG_URL: url,
      NEXTDOG_SERVICE_NAME: serviceName,
    },
  };

  // Next.js 14 requires experimental.instrumentationHook to enable instrumentation.ts
  // Next.js 15+ has it built-in — setting it causes a deprecation/invalid key warning
  if (nextVersion > 0 && nextVersion < 15) {
    result.experimental = {
      ...config.experimental,
      instrumentationHook: true,
    };
  }

  return result;
}
