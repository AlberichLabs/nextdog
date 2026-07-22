export interface NextDogOptions {
  serviceName?: string;
  url?: string;
}

/**
 * A minimal, structural view of the parts of a Next config that `withNextDog`
 * reads or augments. It is deliberately *loose*: `experimental` is `unknown`
 * (not `Record<string, unknown>`) so it never narrows Next's real
 * `ExperimentalConfig`, and there is no `[key: string]` index signature — both
 * of those would make Next's own `NextConfig` fail to satisfy this constraint
 * (an interface without an index signature is not assignable to a `Record`).
 *
 * `withNextDog` is generic over this shape so the *caller's* precise config
 * type flows straight through: `withNextDog(config: NextConfig): NextConfig`.
 * That lets consumers `import { withNextDog }` as ESM and keep `tsc --noEmit`
 * green, instead of being forced back to `require()` (issue #98).
 */
export interface NextConfigLike {
  experimental?: unknown;
  env?: Record<string, string | undefined>;
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

export function withNextDog<T extends NextConfigLike>(config: T, options?: NextDogOptions): T {
  if (process.env.NODE_ENV !== 'development') {
    return config;
  }

  const url = options?.url ?? 'http://localhost:6789';
  const serviceName = options?.serviceName ?? 'nextdog-app';

  const nextVersion = detectNextVersion();

  // Next.js 14 requires experimental.instrumentationHook to enable instrumentation.ts.
  // Next.js 15+ has it built-in — setting it causes a deprecation/invalid key warning,
  // so we only add the key for <15 (spread nothing otherwise).
  const experimentalPatch =
    nextVersion > 0 && nextVersion < 15
      ? {
          experimental: {
            ...(config.experimental as Record<string, unknown> | undefined),
            instrumentationHook: true,
          },
        }
      : {};

  // Construct once and re-assert `T` at the boundary: the caller's precise
  // config type flows through unchanged (issue #98), while internally we only
  // ever add our own well-typed keys.
  const result = {
    ...config,
    env: {
      ...config.env,
      NEXTDOG_URL: url,
      NEXTDOG_SERVICE_NAME: serviceName,
    },
    ...experimentalPatch,
  };

  return result as T;
}

/**
 * Compile-time regression guard for issue #98 (no runtime output — type aliases
 * emit no JS, so this adds zero bundle weight).
 *
 * `RealNextConfigShape` mirrors the structure of Next's actual `NextConfig`: an
 * interface with *no* string index signature whose `experimental` is a nested
 * interface (mirroring `ExperimentalConfig`), not a `Record<string, unknown>`.
 * The previous hand-rolled config type could not accept such a value via an ESM
 * `import`, which broke `tsc --noEmit` for adopters.
 *
 * `Expect<T extends true>` fails to type-check when handed anything but `true`.
 * So if `withNextDog`'s parameter constraint (`NextConfigLike`) is ever
 * re-narrowed (e.g. back to `Record<string, unknown>`) such that a real Next
 * config no longer satisfies it, the conditional below becomes `false` and
 * `tsc` fails the build right here.
 */
// A named interface (NOT an inline object literal) is load-bearing here: TS
// grants object *literals* an implicit index signature but named interfaces get
// none, which is exactly why Next's `ExperimentalConfig` interface is not
// assignable to `Record<string, unknown>`. Using a named interface reproduces
// the real failure mode.
interface ExperimentalConfigLike {
  optimizePackageImports?: string[];
}
interface RealNextConfigShape {
  reactStrictMode?: boolean;
  experimental?: ExperimentalConfigLike;
  env?: Record<string, string | undefined>;
}
type Expect<T extends true> = T;
export type NextConfigConstraintAcceptsRealConfig = Expect<
  RealNextConfigShape extends NextConfigLike ? true : false
>;
