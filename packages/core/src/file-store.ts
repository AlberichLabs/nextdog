import { appendFile, readdir, readFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NextDogEvent } from './types.js';

function hourlyFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}.ndjson`;
}

function serialize(event: NextDogEvent): string {
  return JSON.stringify(event, (_key, value) =>
    typeof value === 'bigint' ? value.toString() + 'n' : value
  );
}

function deserialize(line: string): NextDogEvent {
  return JSON.parse(line, (_key, value) => {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      return BigInt(value.slice(0, -1));
    }
    return value;
  });
}

export interface QueryOptions {
  service?: string;
  traceId?: string;
  spanId?: string;
  /** Only return events of this type. */
  type?: NextDogEvent['type'];
  /** Only return events with a timestamp strictly greater than this (ms). Enables live "catch-up" paging. */
  since?: number;
  /** Only return events with a timestamp strictly less than this (ms). Enables "load older" paging into history. */
  before?: number;
  last?: number;
}

export class FileStore {
  constructor(private dir: string) {}

  async flush(events: NextDogEvent[]): Promise<void> {
    if (events.length === 0) return;
    await mkdir(this.dir, { recursive: true });
    const filename = hourlyFilename();
    const lines = events.map(e => serialize(e)).join('\n') + '\n';
    await appendFile(join(this.dir, filename), lines, 'utf-8');
  }

  async query(opts: QueryOptions): Promise<NextDogEvent[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir))
      .filter(f => f.endsWith('.ndjson'))
      .sort();

    const results: NextDogEvent[] = [];

    for (const file of files) {
      const content = await readFile(join(this.dir, file), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const event = deserialize(line);
        if (opts.type && event.type !== opts.type) continue;
        if (opts.since !== undefined && event.timestamp <= opts.since) continue;
        if (opts.before !== undefined && event.timestamp >= opts.before) continue;
        if (opts.service && event.data.serviceName !== opts.service) continue;
        if (opts.traceId && ('traceId' in event.data) && event.data.traceId !== opts.traceId) continue;
        if (opts.spanId && ('spanId' in event.data) && event.data.spanId !== opts.spanId) continue;
        results.push(event);
        // Short-circuit: spanId is unique, no need to keep scanning
        if (opts.spanId) return results;
      }
    }

    if (opts.last) return results.slice(-opts.last);
    return results;
  }

  /**
   * Distinct service names present across all persisted events. Used to seed the
   * service registry on boot so `service:` / `!service:` filters work after a restart.
   */
  async services(): Promise<Set<string>> {
    const names = new Set<string>();
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter(f => f.endsWith('.ndjson'));
    } catch {
      // Data dir does not exist yet — no history, no services.
      return names;
    }

    for (const file of files) {
      const content = await readFile(join(this.dir, file), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const event = deserialize(line);
        if (event.data.serviceName) names.add(event.data.serviceName);
      }
    }
    return names;
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.ndjson')) continue;
      // Parse date from filename: YYYY-MM-DD-HH.ndjson
      const match = file.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.ndjson$/);
      if (!match) continue;

      const fileDate = new Date(
        Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4])
      );

      if (now - fileDate.getTime() > maxAgeMs) {
        await unlink(join(this.dir, file));
      }
    }
  }
}
