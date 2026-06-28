// ---------------------------------------------------------------------------
// Framework-agnostic store for saved searches + a recent-search ring.
//
// Owns named saved searches (save/rename/delete) and a capped, de-duped,
// most-recent-first ring of recently-run searches. A "search" is the filter
// bar's full state: the text query plus the active services selection — so
// re-applying an entry restores exactly what the user saw.
//
// Kept free of Preact/DOM (mirrors toast-store.ts) so the ring/cap/de-dupe
// logic is unit-testable with plain vitest. Persistence goes through an
// injectable Storage-like handle (`localStorage` in the browser, a fake in
// tests, or `undefined` for storage-less operation) — no hard dependency on a
// DOM global. The `useSavedSearches` hook in saved-searches.tsx is a thin
// reactive wrapper around this. No runtime dependencies (this ships inside
// users' dev servers).
// ---------------------------------------------------------------------------

/** localStorage key for the named saved searches list. */
export const SAVED_KEY = 'nextdog:saved-searches';
/** localStorage key for the recent-search ring. */
export const RECENT_KEY = 'nextdog:recent-searches';
/** Max entries kept in the recent ring; oldest are dropped past this. */
export const RECENT_LIMIT = 10;

/** The minimal subset of the DOM Storage interface this store needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A filter-bar search: text query + active services selection. */
export interface SearchValue {
  query: string;
  services: string[];
}

export interface SavedSearch extends SearchValue {
  id: string;
  name: string;
}

export type RecentSearch = SearchValue;

type Listener = () => void;

/** Stable identity for de-duping a recent entry: query + sorted services. */
function recentKey(value: SearchValue): string {
  return JSON.stringify([value.query, [...value.services].sort()]);
}

function isEmptyValue(value: SearchValue): boolean {
  return value.query.trim() === '' && value.services.length === 0;
}

function normalizeServices(services: unknown): string[] {
  if (!Array.isArray(services)) return [];
  return services.filter((s): s is string => typeof s === 'string');
}

export class SavedSearchStore {
  private saved: SavedSearch[];
  private recent: RecentSearch[];
  private listeners = new Set<Listener>();

  constructor(private storage: StorageLike | undefined) {
    this.saved = this.readSaved();
    this.recent = this.readRecent();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSaved(): SavedSearch[] {
    return this.saved;
  }

  getRecent(): RecentSearch[] {
    return this.recent;
  }

  /** Save a new named search. Returns the created entry (with its id). */
  save(input: SearchValue & { name: string }): SavedSearch {
    const entry: SavedSearch = {
      id: `ss-${crypto.randomUUID()}`,
      name: input.name,
      query: input.query,
      services: [...input.services],
    };
    this.saved = [...this.saved, entry];
    this.persistSaved();
    this.emit();
    return entry;
  }

  rename(id: string, name: string): void {
    let changed = false;
    this.saved = this.saved.map((s) => {
      if (s.id !== id) return s;
      changed = true;
      return { ...s, name };
    });
    if (!changed) return;
    this.persistSaved();
    this.emit();
  }

  delete(id: string): void {
    const next = this.saved.filter((s) => s.id !== id);
    if (next.length === this.saved.length) return;
    this.saved = next;
    this.persistSaved();
    this.emit();
  }

  /**
   * Record a search in the recent ring: prepended, de-duped by query+services,
   * capped at {@link RECENT_LIMIT}. Empty searches (no query, no services) are
   * ignored so the ring never fills with blanks.
   */
  recordRecent(value: SearchValue): void {
    if (isEmptyValue(value)) return;
    const entry: RecentSearch = { query: value.query, services: [...value.services] };
    const key = recentKey(entry);
    const deduped = this.recent.filter((r) => recentKey(r) !== key);
    this.recent = [entry, ...deduped].slice(0, RECENT_LIMIT);
    this.persistRecent();
    this.emit();
  }

  clearRecent(): void {
    if (this.recent.length === 0) return;
    this.recent = [];
    this.persistRecent();
    this.emit();
  }

  // -- persistence -----------------------------------------------------------

  private readSaved(): SavedSearch[] {
    const parsed = this.read(SAVED_KEY);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .filter(
        (s) =>
          typeof s.id === 'string' && typeof s.name === 'string' && typeof s.query === 'string',
      )
      .map((s) => ({
        id: s.id as string,
        name: s.name as string,
        query: s.query as string,
        services: normalizeServices(s.services),
      }));
  }

  private readRecent(): RecentSearch[] {
    const parsed = this.read(RECENT_KEY);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .filter((r) => typeof r.query === 'string')
      .map((r) => ({ query: r.query as string, services: normalizeServices(r.services) }))
      .slice(0, RECENT_LIMIT);
  }

  private read(key: string): unknown {
    if (!this.storage) return undefined;
    try {
      const raw = this.storage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  private persistSaved(): void {
    this.write(SAVED_KEY, this.saved);
  }

  private persistRecent(): void {
    this.write(RECENT_KEY, this.recent);
  }

  private write(key: string, value: unknown): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked — saved/recent are best-effort niceties */
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
