// Only run in Node.js runtime (not Edge) and development mode
if (
  process.env.NODE_ENV === 'development' &&
  typeof (globalThis as any).EdgeRuntime === 'undefined'
) {
  const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { Resource } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');
  const { NextDogExporter } = await import('./exporter');
  const { ensureSidecar } = await import('./sidecar');
  const { patchConsole } = await import('./console-patch');
  const { startRequestCapture } = await import('./request-capture');
  const { registerInstrumentations } = await import('@nextdog/node/instrumentation');

  const url = process.env.NEXTDOG_URL ?? 'http://localhost:6789';
  const serviceName = process.env.NEXTDOG_SERVICE_NAME ?? 'nextdog-app';

  const status = await ensureSidecar(url);

  // A foreign process holds the port — sending telemetry would ship spans/logs
  // to an unknown local process and no dashboard would ever appear. Skip all
  // instrumentation instead of silently exporting to it (issue #17).
  // ensureSidecar already warned the user.
  if (!status.foreignOccupant) {
    // Capture request headers/cookies/body for replay
    startRequestCapture();

    const provider = new NodeTracerProvider({
      resource: new Resource({ [ATTR_SERVICE_NAME]: serviceName }),
      spanProcessors: [new BatchSpanProcessor(new NextDogExporter(url))],
    });
    provider.register();

    // Auto-instrument outbound fetch/HTTP (#4) and DB queries (#5) so they
    // appear as child spans under the request span in the waterfall.
    registerInstrumentations();

    // Capture console.log/warn/error as log events
    patchConsole(url, serviceName);

    console.log(`[nextdog] instrumentation registered for "${serviceName}" → ${url}`);
  }
}
