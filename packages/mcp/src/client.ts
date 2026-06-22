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
import type { SidecarEvent } from './types.js';

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: controller.signal });
    } catch (err) {
      throw new SidecarUnavailableError(this.baseUrl, err);
    } finally {
      clearTimeout(timer);
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
