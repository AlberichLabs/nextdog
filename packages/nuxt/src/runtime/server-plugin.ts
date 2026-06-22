import { patchConsole } from '@nextdog/node/console-patch';
import { NextDogExporter } from '@nextdog/node/exporter';
import { registerInstrumentations } from '@nextdog/node/instrumentation';
import { startRequestCapture } from '@nextdog/node/request-capture';
import { ensureSidecar } from '@nextdog/node/sidecar';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// Nitro globals — declared here since we compile with tsc, not Nuxt's build
declare function defineNitroPlugin(handler: (nitro: any) => void | Promise<void>): any;
declare function useRuntimeConfig(): { nextdog: { url: string; serviceName: string } };

export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig();
  const { url, serviceName } = config.nextdog;

  const status = await ensureSidecar(url);

  // A foreign process holds the port — refuse to send telemetry to it (issue
  // #17). ensureSidecar already warned the user.
  if (status.foreignOccupant) {
    return;
  }

  // Capture request headers/cookies/body for replay
  startRequestCapture();

  const provider = new NodeTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [new BatchSpanProcessor(new NextDogExporter(url))],
  });
  provider.register();

  // Auto-instrument outbound fetch/HTTP (#4) and DB queries (#5).
  registerInstrumentations();

  patchConsole(url, serviceName);

  console.log(`[nextdog] nuxt instrumentation registered for "${serviceName}" → ${url}`);
});
