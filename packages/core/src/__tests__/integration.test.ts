import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server.js';

describe('Integration: full pipeline', () => {
  let server: Server;
  let dataDir: string;
  const port = 26789;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (dataDir) await rm(dataDir, { recursive: true });
  });

  it('ingests spans, serves via SSE backfill, and flushes to disk', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nextdog-integration-'));
    server = await createServer({ port, dataDir });

    // Ingest 3 spans
    for (let i = 1; i <= 3; i++) {
      await fetch(`http://localhost:${port}/v1/spans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spans: [
            {
              traceId: `trace-${i}`,
              spanId: `span-${i}`,
              name: `op-${i}`,
              kind: 'SERVER',
              startTimeUnixNano: String(i * 1000000),
              endTimeUnixNano: String(i * 1000000 + 500),
              attributes: {},
              status: { code: 'OK' },
              serviceName: 'integration-test',
            },
          ],
        }),
      });
    }

    // Query recent spans from ring buffer
    const recentRes = await fetch(`http://localhost:${port}/api/spans?last=10`);
    const recent = await recentRes.json();
    expect(recent.spans).toHaveLength(3);

    // Services list
    const svcRes = await fetch(`http://localhost:${port}/api/services`);
    const svcs = await svcRes.json();
    expect(svcs.services).toContain('integration-test');

    // Wait for flush interval (2s) + small buffer
    await new Promise((r) => setTimeout(r, 2500));

    // Verify files written to disk
    const files = await readdir(dataDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]).toMatch(/\.ndjson$/);
  }, 10000);
});
