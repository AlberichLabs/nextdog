import { describe, expect, it } from 'vitest';
import { SidecarClient } from '../client';
import { describeTelemetry } from '../tools';
import type { SidecarEvent } from '../types';
import { makeFetch } from './fixtures';

const credSpan: SidecarEvent = {
  type: 'span',
  timestamp: 5000,
  data: {
    traceId: 'trace-cred',
    spanId: 'cred-root',
    name: 'POST /api/login',
    kind: 'SERVER',
    serviceName: 'auth',
    status: { code: 'OK' },
    statusCode: 200,
    attributes: {
      'http.method': 'POST',
      'http.route': '/api/login',
      // A credential header attribute (stripped by the #60 egress redactor) …
      'http.request.header.authorization': 'Bearer super-secret-token',
      // … and a sensitive-by-name attribute (denied by the facet deny-list).
      api_token: 'sk_live_leak',
      tenant: 'acme',
    },
  },
};

function client(events: SidecarEvent[]) {
  return new SidecarClient({ fetchImpl: makeFetch(events).fetchImpl });
}

describe('describe_telemetry (#90)', () => {
  it('returns services plus facets with observed values and counts', async () => {
    const res = await describeTelemetry(client());
    expect(res.services.sort()).toEqual(['payments', 'web']);
    const service = res.facets.find((f) => f.key === 'service');
    expect(service?.values.find((v) => v.value === 'web')?.count).toBeGreaterThan(0);
    const route = res.facets.find((f) => f.key === 'route');
    expect(route?.values.map((v) => v.value)).toContain('/api/checkout');
  });

  it('never surfaces a credential-bearing attribute (deny-list + #60 redaction)', async () => {
    const res = await describeTelemetry(client([credSpan]));
    const keys = res.facets.map((f) => f.key);
    expect(keys).not.toContain('api_token');
    expect(keys).not.toContain('http.request.header.authorization');
    const json = JSON.stringify(res);
    expect(json).not.toContain('super-secret-token');
    expect(json).not.toContain('sk_live_leak');
    // A non-sensitive custom attribute is still discoverable.
    expect(keys).toContain('tenant');
  });

  it('reads events through the redacting loadEvents chokepoint (#60)', async () => {
    // Even though the credential lives on the event, it must not egress.
    const res = await describeTelemetry(client([credSpan]));
    expect(JSON.stringify(res)).not.toContain('super-secret-token');
  });
});
