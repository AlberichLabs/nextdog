import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-node';
import { getRequestMetadata } from './request-capture.js';

const ExportResultCode = { SUCCESS: 0, FAILED: 1 } as const;

/**
 * Headers to never capture. Request cookies ARE kept (under http.request.cookies)
 * because they're needed for replay, but credential-bearing headers — including
 * Set-Cookie on the response side, which mints session secrets — are stripped so
 * they never ship to the sidecar or render in the dashboard.
 */
const SKIP_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'set-cookie',
  'set-cookie2',
]);

const SPAN_KIND_MAP: Record<number, string> = {
  0: 'INTERNAL',
  1: 'SERVER',
  2: 'CLIENT',
  3: 'PRODUCER',
  4: 'CONSUMER',
};

const STATUS_CODE_MAP: Record<number, string> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

function hrtimeToNano(hrtime: [number, number]): string {
  const [seconds, nanos] = hrtime;
  return String(BigInt(seconds) * 1_000_000_000n + BigInt(nanos));
}

function convertSpan(span: ReadableSpan) {
  const ctx = span.spanContext();
  const serviceName = (span.resource?.attributes?.['service.name'] as string) ?? 'unknown';
  const kind = SPAN_KIND_MAP[span.kind] ?? 'INTERNAL';

  // Start with OTel's own attributes
  const attributes: Record<string, string | number | boolean> = {
    ...(span.attributes as Record<string, string | number | boolean>),
  };

  // Enrich SERVER spans with captured request metadata (headers, cookies, body)
  // Correlate by method + URL path (traceId is not available at capture time)
  if (kind === 'SERVER') {
    const reqMethod = String(
      span.attributes['http.method'] ?? span.attributes['http.request.method'] ?? 'GET',
    );
    const reqUrl = String(
      span.attributes['http.target'] ?? span.attributes['url.path'] ?? span.name,
    );
    const metadata = getRequestMetadata(reqMethod, reqUrl);
    if (metadata) {
      // Add request headers as http.request.header.{name}
      for (const [key, value] of Object.entries(metadata.headers)) {
        if (SKIP_HEADERS.has(key.toLowerCase())) continue;
        attributes[`http.request.header.${key.toLowerCase()}`] = value;
      }

      // Add cookies explicitly (critical for replay)
      if (metadata.cookies) {
        attributes['http.request.cookies'] = metadata.cookies;
      }

      // Add request body if present
      if (metadata.body) {
        attributes['http.request.body'] = metadata.body;
      }

      // Add the ORIGINAL response (status, headers, body) captured by the tee.
      // This reflects what the request actually returned — no Replay re-issue.
      if (metadata.responseStatus !== undefined) {
        attributes['http.response.status'] = metadata.responseStatus;
      }
      if (metadata.responseHeaders) {
        for (const [key, value] of Object.entries(metadata.responseHeaders)) {
          if (SKIP_HEADERS.has(key.toLowerCase())) continue;
          attributes[`http.response.header.${key.toLowerCase()}`] = value;
        }
      }
      if (metadata.responseBody) {
        attributes['http.response.body'] = metadata.responseBody;
      }
    }
  }

  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId:
      (span as any).parentSpanId ?? (span as any).parentSpanContext?.spanId ?? undefined,
    name: span.name,
    kind,
    startTimeUnixNano: hrtimeToNano(span.startTime),
    endTimeUnixNano: hrtimeToNano(span.endTime),
    attributes,
    status: {
      code: STATUS_CODE_MAP[span.status.code] ?? 'UNSET',
      message: span.status.message,
    },
    statusCode:
      Number(
        span.attributes['http.status_code'] ?? span.attributes['http.response.status_code'] ?? 0,
      ) || undefined,
    serviceName,
  };
}

export class NextDogExporter implements SpanExporter {
  /** Exact exporter target URLs. NextDog's own outbound POSTs go to these and
   *  ONLY these — so we filter exactly them and never collateral user fetches
   *  that merely share the sidecar origin or a textual-prefix-sibling port. */
  private readonly selfTargets: Set<string>;

  constructor(private url: string) {
    // Normalize trailing slash so e.g. "http://localhost:6789/" matches too.
    const base = url.replace(/\/+$/, '');
    this.selfTargets = new Set([`${base}/v1/spans`, `${base}/v1/logs`]);
  }

  private isNextdogSpan(span: ReadableSpan): boolean {
    const url = String(span.attributes['http.url'] ?? span.attributes['url.full'] ?? '');
    if (!url) return false;
    // Match the exporter's own POST target exactly (ignoring any query/hash),
    // not arbitrary URLs that merely start with the sidecar origin.
    const withoutQuery = url.split(/[?#]/, 1)[0];
    return this.selfTargets.has(withoutQuery);
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const filtered = spans.filter((s) => !this.isNextdogSpan(s));
    if (filtered.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    const converted = filtered.map(convertSpan);

    fetch(`${this.url}/v1/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spans: converted }),
    })
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch(() => resultCallback({ code: ExportResultCode.FAILED }));
  }

  async shutdown(): Promise<void> {}
}
