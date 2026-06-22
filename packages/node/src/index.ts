export { patchConsole } from './console-patch.js';
export { NextDogExporter } from './exporter.js';
export {
  instrumentMysql2Module,
  instrumentPgModule,
  registerDbInstrumentation,
} from './instrument-db.js';
export { instrumentOutboundHttp } from './instrument-fetch.js';
export type { InstrumentationHandle } from './instrumentation.js';
export { registerInstrumentations } from './instrumentation.js';
export type { RequestMetadata } from './request-capture.js';
export { getRequestMetadata, startRequestCapture } from './request-capture.js';
export type { RequestContext } from './request-context.js';
export {
  createRequestContext,
  getRequestContext,
  requestContextStorage,
} from './request-context.js';
export { ensureSidecar } from './sidecar.js';
