import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-node';
import { getRequestMetadata } from './request-capture';

export { SENSITIVE_HEADERS } from './sensitive-headers';

/**
 * Warn at most once if telemetry export to the sidecar starts failing. Without
 * this, a wrong URL or a down sidecar shows up only as "no data in the
 * dashboard" with no clue why; per-export warnings would spam the dev server's
 * console, so we surface it exactly once.
 */
let warnedExportFailure = false;
function warnExportFailureOnce(): void {
  if (warnedExportFailure) return;
  warnedExportFailure = true;
  console.warn(
    '[nextdog] failed to send a trace to the sidecar — is it running? ' +
      'No spans will appear in the dashboard until export succeeds. ' +
      '(This warning is shown once.)',
  );
}

/**
 * Capture posture (issue #60): **store-but-don't-egress**. All headers —
 * including credential-bearing ones (`authorization`, `x-api-key`, cookies,
 * `set-cookie`, …) — are captured and stored VERBATIM so one-click Replay can
 * re-authenticate against your own endpoints. The sidecar and dashboard are
 * localhost, so this is not egress. Those headers are redacted only at the
 * egress boundary (trace export + the MCP server), never stripped at capture.
 * The canonical list of what's sensitive lives in `./sensitive-headers`.
 */

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
      // Surface the real authority (host[:port]) as the canonical http.host so
      // URL display + Replay target the app's actual port on ANY port, not a
      // hardcoded localhost:3000 (issue #78). Only fill it when the span doesn't
      // already carry one, so a value OTel set wins.
      if (metadata.host && attributes['http.host'] === undefined) {
        attributes['http.host'] = metadata.host;
      }

      // Add request headers as http.request.header.{name}. Credential headers are
      // captured verbatim (store-but-don't-egress) — redaction happens at export.
      for (const [key, value] of Object.entries(metadata.headers)) {
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
      .catch(() => {
        warnExportFailureOnce();
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  async shutdown(): Promise<void> {}
}
