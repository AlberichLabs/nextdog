/**
 * END-TO-END proof of the MCP debug loop (PRD success criterion).
 *
 * Everything below is REAL — no mocked SidecarClient, no fixtures:
 *   - a real `@nextdog/core` sidecar process (scratch port + scratch data dir),
 *   - the real `examples/next` app under `next dev`, instrumented via the real
 *     `@nextdog/next` package and pointed at that sidecar,
 *   - the real `@nextdog/mcp` stdio server (`dist/cli.js`), driven over a real
 *     `StdioClientTransport` (JSON-RPC over stdio) — the exact process an AI
 *     coding agent spawns.
 *
 * It drives the planted `checkout` 500 scenario through the full loop:
 *   drive (replay_request) -> observe deterministically (wait_for_event)
 *   -> assert RED (the 500 telemetry) -> apply the fix -> assert GREEN,
 * and additionally proves the slow-endpoint and bad-response-shape scenarios.
 *
 * COST / CI: booting `next dev` is heavy (compile-on-first-request) and not
 * something the fast unit suite should pay on every run, so this is GATED behind
 * `NEXTDOG_E2E`. Run it with:  `pnpm e2e`  (from the repo root — builds first),
 * or  `pnpm --filter @nextdog/mcp run test:e2e`  (after `pnpm build`).
 * The default `pnpm test` discovers and SKIPS it, so it never flakes CI.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const E2E = Boolean(process.env.NEXTDOG_E2E);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const CORE_CLI = resolve(REPO_ROOT, 'packages/core/dist/cli.js');
const MCP_CLI = resolve(REPO_ROOT, 'packages/mcp/dist/cli.js');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Grab an OS-assigned free TCP port, then release it. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = netServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | undefined | false>,
  timeoutMs = 60_000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {
      /* keep polling */
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/** Kill a detached child's whole process group (next dev spawns grandchildren). */
function killGroup(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

interface TextContent {
  type: string;
  text: string;
}

// Shared handles for the booted stack.
let sidecar: ChildProcess | undefined;
let app: ChildProcess | undefined;
let mcp: Client | undefined;
let transport: StdioClientTransport | undefined;
let dataDir = '';
let sidecarUrl = '';
let appUrl = '';

/** Call an MCP tool over the real stdio transport and parse its JSON text payload. */
async function tool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!mcp) throw new Error('MCP client not connected');
  const res = await mcp.callTool({ name, arguments: args });
  const text = (res.content as TextContent[])[0]?.text ?? 'null';
  if (res.isError) throw new Error(`MCP tool ${name} errored: ${text}`);
  return JSON.parse(text) as T;
}

async function drive(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${appUrl}${path}`, init);
}

async function setScenarioFixed(scenario: string, fixed: boolean): Promise<void> {
  const res = await drive('/api/scenarios', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario, fixed }),
  });
  expect(res.status).toBe(200);
}

interface TraceSummary {
  traceId: string;
  route?: string;
  statusCode?: number;
  status?: string;
}
interface SpanNode {
  statusCode?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  children: SpanNode[];
}

/** Poll list_recent_traces (a real MCP tool) until the newest trace for a route+status appears. */
async function waitForTrace(
  route: string,
  match: (t: TraceSummary) => boolean,
  label: string,
): Promise<TraceSummary> {
  return waitFor(label, async () => {
    const { traces } = await tool<{ traces: TraceSummary[] }>('list_recent_traces', { route });
    return traces.find(match);
  });
}

describe.skipIf(!E2E)('MCP debug loop — real sidecar + example-next + stdio MCP (e2e)', () => {
  beforeAll(async () => {
    const [sidecarPort, appPort] = await Promise.all([freePort(), freePort()]);
    sidecarUrl = `http://localhost:${sidecarPort}`;
    appUrl = `http://localhost:${appPort}`;
    dataDir = await mkdtemp(resolve(tmpdir(), 'nextdog-e2e-'));

    // 1) Real sidecar on a scratch port + scratch data dir; no idle shutdown, no UI.
    sidecar = spawn(process.execPath, [CORE_CLI], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NEXTDOG_URL: sidecarUrl,
        NEXTDOG_DATA_DIR: dataDir,
        NEXTDOG_UI_DIR: '',
        NEXTDOG_IDLE_MS: '0',
      },
    });
    await waitFor(
      'sidecar /health',
      async () => {
        const body = (await fetch(`${sidecarUrl}/health`).then((r) => r.json())) as {
          service?: string;
        };
        return body.service === 'nextdog';
      },
      30_000,
    );

    // 2) Real example-next under `next dev`, pointed at OUR sidecar (it adopts it).
    app = spawn('pnpm', ['--filter', 'example-next', 'dev'], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXTDOG_URL: sidecarUrl,
        NEXTDOG_SERVICE_NAME: 'example-next',
        PORT: String(appPort),
      },
    });
    await waitFor(
      'example-next ready',
      async () => (await fetch(`${appUrl}/`).then((r) => r.status)) === 200,
      120_000,
    );

    // 3) The real MCP stdio server, spawned exactly as an agent would.
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_CLI],
      env: { ...process.env, NEXTDOG_URL: sidecarUrl } as Record<string, string>,
    });
    mcp = new Client({ name: 'e2e-agent', version: '0.0.0' });
    await mcp.connect(transport);

    // Warm each scenario route so Turbopack has compiled it (first hit is slow),
    // and confirm telemetry is flowing end-to-end before the assertions begin.
    await Promise.all([
      drive('/api/scenarios/checkout').catch(() => undefined),
      drive('/api/scenarios/report').catch(() => undefined),
      drive('/api/scenarios/profile').catch(() => undefined),
    ]);
    await waitFor('telemetry flowing', async () => {
      const { traces } = await tool<{ traces: TraceSummary[] }>('list_recent_traces', {});
      return traces.length > 0;
    });
  }, 180_000);

  afterAll(async () => {
    try {
      await transport?.close();
    } catch {
      /* ignore */
    }
    killGroup(app);
    // Ask the sidecar to flush + release the port, then hard-kill as a fallback.
    try {
      await fetch(`${sidecarUrl}/shutdown`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    killGroup(sidecar);
    await sleep(500);
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }, 30_000);

  it('drives the checkout 500 loop: reproduce -> assert RED -> fix -> assert GREEN', async () => {
    // Ensure we start from the BUGGY code path.
    await setScenarioFixed('checkout', false);

    // A user hits the bug (the original request that lands in telemetry).
    const first = await drive('/api/scenarios/checkout');
    expect(first.status).toBe(500);

    // CORRELATE: the real get_errors tool surfaces the 500 + its route.
    const errBefore = await waitForTrace(
      '/api/scenarios/checkout',
      (t) => t.statusCode === 500,
      'checkout 500 trace',
    );
    const { errors } = await tool<{ errors: Array<{ spanId?: string; route?: string }> }>(
      'get_errors',
      {},
    );
    const checkoutError = errors.find((e) => e.route === '/api/scenarios/checkout');
    expect(checkoutError?.spanId).toBeTruthy();

    // The captured error log names the exact failing property + handler — the
    // telemetry->code hop (Next dev stacks are bundled paths, so message+route+fn
    // are what pin the line; source-map remap of frames is a known follow-up).
    const { results } = await tool<{ results: Array<{ data: { message?: string } }> }>(
      'search_logs',
      { filter: 'level:error route:/api/scenarios/checkout' },
    );
    expect(results.some((r) => String(r.data.message).includes('percentOff'))).toBe(true);

    // DRIVE: reproduce by replaying the captured request through the sidecar.
    const spanId = checkoutError?.spanId as string;
    const redReplay = await tool<{ status: number }>('replay_request', { spanId });
    expect(redReplay.status).toBe(500);

    // OBSERVE deterministically: wait for the resulting ERROR event (no snapshot race).
    const waited = await tool<{ matched: boolean }>('wait_for_event', {
      predicate: 'route:/api/scenarios/checkout status:ERROR',
      timeoutMs: 15_000,
    });
    expect(waited.matched).toBe(true);

    // ASSERT RED: there is at least one 500 on the route.
    const red = await tool<{ pass: boolean; actual: number }>('assert', {
      filter: 'route:/api/scenarios/checkout statusCode:500',
      expect: { min: 1 },
    });
    expect(red.pass).toBe(true);
    expect(errBefore.statusCode).toBe(500);

    // APPLY THE FIX (the code change, flipped deterministically).
    await setScenarioFixed('checkout', true);

    // Scope the GREEN check to a labeled run so the historical 500s can't pollute it.
    const run = await tool<{ label: string; header: Record<string, string> }>('begin_run', {});

    // DRIVE the fix: an edited replay stamped with the run header -> now 200.
    const greenReplay = await tool<{ status: number }>('replay_request', {
      request: {
        method: 'GET',
        url: `${appUrl}/api/scenarios/checkout`,
        headers: run.header,
      },
    });
    expect(greenReplay.status).toBe(200);

    // OBSERVE + ASSERT GREEN: this run's events are all 200s, no ERROR.
    await tool('wait_for_event', {
      predicate: 'route:/api/scenarios/checkout statusCode:200',
      timeoutMs: 15_000,
    });
    const scoped = await waitFor('run scoped to the fixed request', async () => {
      const r = await tool<{ count: number; events: Array<{ data: { statusCode?: number } }> }>(
        'get_run',
        { label: run.label },
      );
      return r.count > 0 ? r : undefined;
    });
    expect(scoped.events.every((e) => e.data.statusCode !== 500)).toBe(true);
    expect(scoped.events.some((e) => e.data.statusCode === 200)).toBe(true);
  }, 90_000);

  it('proves the slow-endpoint scenario: ~1.5s RED -> fast GREEN (get_trace durations)', async () => {
    await setScenarioFixed('report', false);
    await drive('/api/scenarios/report');
    const slowTrace = await waitForTrace(
      '/api/scenarios/report',
      (t) => t.statusCode === 200,
      'report slow trace',
    );
    const slow = await tool<{ spanTree: SpanNode[] }>('get_trace', { traceId: slowTrace.traceId });
    const slowRoot = slow.spanTree.find((n) => n.statusCode === 200) ?? slow.spanTree[0];
    expect(slowRoot?.durationMs ?? 0).toBeGreaterThan(1000);

    await setScenarioFixed('report', true);
    const fixedRes = await drive('/api/scenarios/report');
    expect(fixedRes.status).toBe(200);
    const fastTrace = await waitFor('report fast trace', async () => {
      const { traces } = await tool<{ traces: TraceSummary[] }>('list_recent_traces', {
        route: '/api/scenarios/report',
      });
      // newest first; find one distinctly faster than the slow one
      for (const t of traces) {
        const tr = await tool<{ spanTree: SpanNode[] }>('get_trace', { traceId: t.traceId });
        const root = tr.spanTree.find((n) => n.statusCode === 200) ?? tr.spanTree[0];
        if ((root?.durationMs ?? Number.POSITIVE_INFINITY) < 900) return root;
      }
      return undefined;
    });
    expect(fastTrace.durationMs ?? 0).toBeLessThan(900);
  }, 60_000);

  it('proves the bad-response-shape scenario: missing "email" RED -> present GREEN', async () => {
    // Read the captured response body of ONE freshly-driven profile request via run
    // scoping (begin_run -> stamped replay_request -> get_run), so the assertion is
    // pinned to the EXACT request we drove rather than "whatever list_recent_traces
    // calls newest". (Trace summaries are ordered by sidecar INGEST time, so the
    // buggy and fixed drives here — which flush in the same batch — can tie; run
    // scoping sidesteps that ambiguity and is the same correlation the checkout
    // GREEN check above relies on.)
    const drivenProfileEmailPresent = async (): Promise<boolean> => {
      const run = await tool<{ label: string; header: Record<string, string> }>('begin_run', {});
      const replay = await tool<{ status: number }>('replay_request', {
        request: { method: 'GET', url: `${appUrl}/api/scenarios/profile`, headers: run.header },
      });
      // A bad response SHAPE is still a 200 — exactly the failure a status check misses.
      expect(replay.status).toBe(200);
      const withBody = await waitFor('profile run captured with a body', async () => {
        const r = await tool<{
          count: number;
          events: Array<{ data: { attributes: Record<string, unknown> } }>;
        }>('get_run', { label: run.label });
        const bodied = r.events.filter(
          (e) => typeof e.data.attributes['http.response.body'] === 'string',
        );
        return bodied.length > 0 ? bodied : undefined;
      });
      const body = JSON.parse(String(withBody[0].data.attributes['http.response.body'])) as {
        email?: string;
      };
      return typeof body.email === 'string' && body.email.length > 0;
    };

    // ASSERT RED: the buggy path drops "email" from the captured response body.
    await setScenarioFixed('profile', false);
    expect(await drivenProfileEmailPresent()).toBe(false);

    // APPLY THE FIX, then ASSERT GREEN: "email" is present in the captured body.
    await setScenarioFixed('profile', true);
    expect(await drivenProfileEmailPresent()).toBe(true);
  }, 60_000);
});
