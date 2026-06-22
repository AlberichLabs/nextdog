/**
 * Single entry point an adapter calls (after `provider.register()`) to turn on
 * all of nextdog's auto-instrumentations:
 *   - outbound fetch/HTTP  (#4) — zero new deps, always on
 *   - database queries     (#5) — zero new deps, only patches a driver that is
 *                                 actually installed (pg / mysql2)
 *
 * Everything here uses only `@opentelemetry/api` plus optional, lazily-loaded
 * drivers, so nothing new ships in a consumer's production bundle.
 */

import { registerDbInstrumentation } from './instrument-db.js';
import { instrumentOutboundHttp } from './instrument-fetch.js';

export interface InstrumentationHandle {
  /** Restore all patched globals/drivers (used in tests / teardown). */
  restore: () => void;
}

/**
 * Register outbound-HTTP and DB instrumentation. Safe to call once at startup.
 * Returns a handle whose `restore()` undoes every patch. DB drivers load
 * asynchronously; if a driver isn't installed it is silently skipped.
 */
export function registerInstrumentations(): InstrumentationHandle {
  const restores: Array<() => void> = [];

  // Outbound fetch/HTTP — synchronous, always available.
  restores.push(instrumentOutboundHttp());

  // DB drivers — async/optional. Resolve in the background; collect its restore.
  let dbRestore: (() => void) | undefined;
  registerDbInstrumentation()
    .then((restore) => {
      dbRestore = restore;
    })
    .catch(() => {
      /* best-effort: a driver that fails to load is simply not instrumented */
    });

  return {
    restore: () => {
      for (const r of restores) r();
      dbRestore?.();
    },
  };
}
