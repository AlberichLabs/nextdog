/**
 * Identity contract for the sidecar's `/health` endpoint.
 *
 * The producer (`createServer`'s `/health` handler) emits `service: NEXTDOG_HEALTH_MARKER`,
 * and every consumer (e.g. `@nextdog/node`'s sidecar probe) requires that exact
 * value before adopting a listener. Defining it once here means producer and
 * consumer can never drift apart — a renamed marker breaks both at compile time
 * rather than silently failing adoption at runtime (issue #17).
 */
export const NEXTDOG_HEALTH_MARKER = 'nextdog';

/** Field on the `/health` JSON body that carries {@link NEXTDOG_HEALTH_MARKER}. */
export const NEXTDOG_HEALTH_SERVICE_FIELD = 'service';
