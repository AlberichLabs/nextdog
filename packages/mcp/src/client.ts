/**
 * Thin read-only HTTP client for the running NextDog sidecar.
 *
 * Data source: the sidecar's HTTP API (default `http://localhost:6789`). The
 * sidecar must be running — it is normally spawned automatically by the framework
 * adapter inside the user's dev server. When it is not reachable we throw a
 * {@link SidecarUnavailableError} with a clear, actionable message rather than
 * letting a raw `fetch` rejection crash the MCP process; tool handlers turn that
 * into a clean MCP tool error.
 *
 * Endpoints used (all GET, all already exist in `@nextdog/core`'s server):
 *   - `/api/events`   → `{ events: SidecarEvent[] }`  (spans AND logs; used for
 *                       search, trace reconstruction, and correlated logs)
 *   - `/api/spans`    → `{ spans: SpanData[] }`        (recent spans)
 *   - `/api/services` → `{ services: string[] }`
 *   - `/health`       → liveness probe
 */
import type { SidecarEvent } from './types';

export const DEFAULT_SIDECAR_URL = 'http://localhost:6789';

/** Thrown when the sidecar cannot be reached or returns a non-2xx response. */
export class SidecarUnavailableError extends Error {
  constructor(
    public readonly baseUrl: string,
    public readonly cause?: unknown,
  ) {
    super(
      `Could not reach the NextDog sidecar at ${baseUrl}. ` +
        `Make sure your dev server is running with NextDog enabled (the sidecar ` +
        `normally starts automatically), or set NEXTDOG_URL to the correct address.`,
    );
    this.name = 'SidecarUnavailableError';
  }
}

export interface EventQuery {
  service?: string;
  traceId?: string;
  /** 'span' | 'log' — narrow to one event type. */
  type?: 'span' | 'log';
  /** Only events strictly newer than this epoch-ms timestamp. */
  since?: number;
  /** Only events strictly older than this epoch-ms timestamp. */
  before?: number;
  /** Cap on returned events (server returns the most recent `last`). */
  last?: number;
}

/** Payload for `POST /api/replay` — the sidecar's three replay modes (#86). */
export interface ReplayPayload {
  /** Replay a captured request by span id (one-click or, with `prepareOnly`, dry-run). */
  spanId?: string;
  /** With `spanId`: reconstruct the request and return it WITHOUT sending. */
  prepareOnly?: boolean;
  /** Edited replay: send exactly this request (overrides `spanId`). */
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

/** Live response of a sent replay (`performReplay`'s shape, `core/src/server.ts:204`). */
export interface ReplaySendResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  url: string;
  method: string;
}

/** Reconstructed request returned by `prepareOnly` (no send). */
export interface ReplayPreparedResult {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type ReplayResult = ReplaySendResult | ReplayPreparedResult;

export interface SidecarClientOptions {
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Injectable fetch for testing. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class SidecarClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SidecarClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_SIDECAR_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new SidecarUnavailableError(this.baseUrl, err);
    }

    if (!res.ok) {
      throw new SidecarUnavailableError(this.baseUrl, new Error(`HTTP ${res.status}`));
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new SidecarUnavailableError(this.baseUrl, err);
    }
  }

  /**
   * POST a JSON body and parse the JSON response. Mirrors {@link getJson}'s
   * timeout/error handling: a network failure, timeout, non-2xx status, or
   * unparseable body all become a {@link SidecarUnavailableError} so the tool
   * layer turns it into a clean MCP error instead of crashing.
   */
  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new SidecarUnavailableError(this.baseUrl, err);
    }

    if (!res.ok) {
      throw new SidecarUnavailableError(this.baseUrl, new Error(`HTTP ${res.status}`));
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new SidecarUnavailableError(this.baseUrl, err);
    }
  }

  /**
   * Replay a captured request via the sidecar's `POST /api/replay` — the same
   * endpoint the dashboard Replay button uses. The captured credential headers
   * flow disk→endpoint server-side and never reach us for a sent replay; for a
   * `prepareOnly` echo the tool layer strips them before egress (#60/#86).
   */
  async replay(payload: ReplayPayload): Promise<ReplayResult> {
    return this.postJson<ReplayResult>('/api/replay', payload);
  }

  /** Liveness check. Returns true only if the sidecar answers 2xx on `/health`. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.getJson<unknown>('/health');
      return true;
    } catch {
      return false;
    }
  }

  /** Distinct service names known to the sidecar. */
  async services(): Promise<string[]> {
    const body = await this.getJson<{ services?: string[] }>('/api/services');
    return body.services ?? [];
  }

  /**
   * Query events (spans AND logs) from the sidecar's full history (`/api/events`).
   * This is the workhorse used by every tool: it returns the unified event
   * envelope the matcher consumes.
   */
  async events(query: EventQuery = {}): Promise<SidecarEvent[]> {
    const params = new URLSearchParams();
    if (query.service) params.set('service', query.service);
    if (query.traceId) params.set('traceId', query.traceId);
    if (query.type) params.set('type', query.type);
    if (query.since !== undefined) params.set('since', String(query.since));
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.last !== undefined) params.set('last', String(query.last));
    const qs = params.toString();
    const body = await this.getJson<{ events?: SidecarEvent[] }>(
      `/api/events${qs ? `?${qs}` : ''}`,
    );
    return body.events ?? [];
  }
}
