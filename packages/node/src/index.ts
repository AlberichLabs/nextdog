export { patchConsole } from './console-patch';
export { NextDogExporter } from './exporter';
export {
  instrumentMysql2Module,
  instrumentPgModule,
  registerDbInstrumentation,
} from './instrument-db';
export { instrumentOutboundHttp } from './instrument-fetch';
export type { InstrumentationHandle } from './instrumentation';
export { registerInstrumentations } from './instrumentation';
export type { RequestMetadata } from './request-capture';
export { getRequestMetadata, startRequestCapture } from './request-capture';
export type { RequestContext } from './request-context';
export {
  createRequestContext,
  getRequestContext,
  requestContextStorage,
} from './request-context';
export { SENSITIVE_HEADERS } from './sensitive-headers';
export { ensureSidecar } from './sidecar';
