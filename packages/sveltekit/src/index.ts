/**
 * SvelteKit handle hook types — defined locally to avoid requiring
 * @sveltejs/kit as a build-time dependency (it's a peer dep).
 */
interface ResolveEvent {
  request: Request;
  url: URL;
  route: { id: string | null };
  [key: string]: unknown;
}

type MaybePromise<T> = T | Promise<T>;
type Resolve = (event: ResolveEvent) => MaybePromise<Response>;
type Handle = (input: { event: ResolveEvent; resolve: Resolve }) => MaybePromise<Response>;

export interface NextDogOptions {
  serviceName?: string;
  url?: string;
}

export function withNextDog(options?: NextDogOptions): Handle {
  const url = options?.url ?? process.env.NEXTDOG_URL ?? 'http://localhost:6789';
  const serviceName = options?.serviceName ?? process.env.NEXTDOG_SERVICE_NAME ?? 'nextdog-app';

  let initialized = false;
  // Set when the configured port is held by a non-NextDog process; we then skip
  // all telemetry so we never ship it to an unknown local process (issue #17).
  let disabled = false;

  return async ({ event, resolve }) => {
    if (process.env.NODE_ENV === 'production' || disabled) {
      return resolve(event);
    }

    if (!initialized) {
      initialized = true;

      const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
      const { Resource } = await import('@opentelemetry/resources');
      const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');
      const { NextDogExporter } = await import('@nextdog/node/exporter');
      const { ensureSidecar } = await import('@nextdog/node/sidecar');
      const { patchConsole } = await import('@nextdog/node/console-patch');
      const { startRequestCapture } = await import('@nextdog/node/request-capture');
      const { registerInstrumentations } = await import('@nextdog/node/instrumentation');

      const status = await ensureSidecar(url);
      if (status.foreignOccupant) {
        // ensureSidecar already warned. Disable instrumentation for this process.
        disabled = true;
        return resolve(event);
      }

      const provider = new NodeTracerProvider({
        resource: new Resource({ [ATTR_SERVICE_NAME]: serviceName }),
        spanProcessors: [new BatchSpanProcessor(new NextDogExporter(url))],
      });
      provider.register();

      patchConsole(url, serviceName);
      startRequestCapture();

      // Auto-instrument outbound fetch/HTTP (#4) and DB queries (#5).
      registerInstrumentations();

      console.log(`[nextdog] sveltekit instrumentation registered for "${serviceName}" → ${url}`);
    }

    const { trace } = await import('@opentelemetry/api');
    const tracer = trace.getTracer('nextdog-sveltekit');

    return tracer.startActiveSpan(`${event.request.method} ${event.url.pathname}`, async (span) => {
      try {
        span.setAttribute('http.method', event.request.method);
        span.setAttribute('http.route', event.route?.id ?? event.url.pathname);
        span.setAttribute('http.target', event.url.pathname);

        const response = await resolve(event);

        span.setAttribute('http.status_code', response.status);
        if (response.status >= 400) {
          span.setStatus({ code: 2 }); // ERROR
        }

        return response;
      } catch (err) {
        span.setStatus({ code: 2, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  };
}
