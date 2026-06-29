/**
 * Facet derivation for the Datadog-style facet drawer (issue #62).
 *
 * Pure, in-memory aggregation over the current events: for each facet key
 * (service, method, statusCode, route, status, level, name, kind, runtime, plus
 * a bounded set of common custom attributes) it counts the distinct values.
 *
 * The value extractors mirror the matcher (`matchesField` in
 * `hooks/use-events.ts`) so that clicking a value and emitting the token
 * `tokenFor(key, value)` filters to exactly the events the facet counted. The
 * round-trip is pinned by `facets.test.ts`.
 */
import type { SSEEvent } from '../hooks/use-sse';

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facet {
  /** The query key the matcher understands (`service`, `statusCode`, …). */
  key: string;
  /** Human label shown in the drawer header. */
  label: string;
  /** Distinct values with counts, sorted by count desc then value asc. */
  values: FacetValue[];
}

export interface DeriveFacetsOptions {
  /** Include bounded common-attribute facets (default true). */
  includeAttributes?: boolean;
}

type EventData = SSEEvent['data'];

interface FacetSpec {
  key: string;
  label: string;
  /** The facet value for an event, or `''` when the event has none. */
  extract: (data: EventData) => string;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * The named facets. Each extractor matches the corresponding `matchesField`
 * branch so the emitted `key:value` token resolves to the same events.
 */
const NAMED_SPECS: readonly FacetSpec[] = [
  { key: 'service', label: 'Service', extract: (d) => str(d.serviceName) },
  {
    key: 'method',
    label: 'Method',
    extract: (d) => str(d.attributes['http.method'] ?? d.attributes['http.request.method']),
  },
  {
    key: 'statusCode',
    label: 'Status Code',
    extract: (d) =>
      str(
        d.statusCode ??
          d.attributes['http.status_code'] ??
          d.attributes['http.response.status_code'],
      ),
  },
  { key: 'status', label: 'Status', extract: (d) => str(d.status?.code) },
  {
    key: 'route',
    label: 'Route',
    extract: (d) => str(d.attributes['http.route'] ?? d.attributes['http.target'] ?? d.name),
  },
  { key: 'level', label: 'Level', extract: (d) => str(d.level) },
  { key: 'name', label: 'Name', extract: (d) => str(d.name) },
  { key: 'kind', label: 'Kind', extract: (d) => str(d.kind) },
  { key: 'runtime', label: 'Runtime', extract: (d) => str(d.attributes.runtime) },
];

/** Attribute keys already represented by a named facet — never double-count. */
const NAMED_ATTR_KEYS: ReadonlySet<string> = new Set([
  'http.method',
  'http.request.method',
  'http.route',
  'http.target',
  'http.status_code',
  'http.response.status_code',
  'runtime',
]);

/**
 * Attribute keys whose *segments* mark them as high-cardinality, noisy, or
 * sensitive — excluded from auto-faceting so the drawer stays a short, useful
 * list (ids, timestamps, request/response bodies, headers, secrets, …).
 */
const ATTR_DENY_SEGMENT =
  /(^|[._-])(id|ids|uuid|guid|ip|port|time|timestamp|nano|dur|duration|body|header|headers|url|cookie|cookies|token|password|secret|stack|hash|size|length|count|query|sql|statement)([._-]|$)/i;

/** Attributes with more distinct values than this are not surfaced as facets. */
const MAX_ATTR_CARDINALITY = 20;

function countValues(events: SSEEvent[], extract: (d: EventData) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    const value = extract(e.data);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function toFacet(key: string, label: string, counts: Map<string, number>): Facet | null {
  if (counts.size === 0) return null;
  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { key, label, values };
}

function attributeFacets(events: SSEEvent[]): Facet[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const e of events) {
    const attrs = e.data.attributes;
    if (!attrs) continue;
    for (const k of Object.keys(attrs)) {
      if (NAMED_ATTR_KEYS.has(k) || ATTR_DENY_SEGMENT.test(k)) continue;
      const value = str(attrs[k]);
      if (!value) continue;
      let counts = byKey.get(k);
      if (!counts) {
        counts = new Map();
        byKey.set(k, counts);
      }
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  const facets: Facet[] = [];
  for (const [k, counts] of byKey) {
    if (counts.size > MAX_ATTR_CARDINALITY) continue;
    const facet = toFacet(k, k, counts);
    if (facet) facets.push(facet);
  }
  facets.sort((a, b) => a.key.localeCompare(b.key));
  return facets;
}

/**
 * Derive the facet list for a set of events. Named facets come first (in the
 * issue's order), followed by bounded common-attribute facets. Facets with no
 * values are omitted entirely.
 */
export function deriveFacets(events: SSEEvent[], options: DeriveFacetsOptions = {}): Facet[] {
  const named = NAMED_SPECS.map((spec) =>
    toFacet(spec.key, spec.label, countValues(events, spec.extract)),
  ).filter((f): f is Facet => f !== null);

  const attrs = options.includeAttributes === false ? [] : attributeFacets(events);
  return [...named, ...attrs];
}

/**
 * Narrow already-derived facets to those matching a free-text search — the
 * client-side filter behind the drawer's search box (issue #66). Purely a
 * *display* filter: counts and ordering are preserved untouched, and the
 * tokens emitted on click are unaffected.
 *
 * A facet whose key/label matches keeps all its values (typing a facet name
 * reveals everything under it); otherwise only values containing the term
 * (case-insensitive substring) are kept, and facets left with no matching
 * values are dropped. An empty/whitespace search returns the input as-is.
 */
export function filterFacets(facets: Facet[], search: string): Facet[] {
  const term = search.trim().toLowerCase();
  if (!term) return facets;

  const result: Facet[] = [];
  for (const facet of facets) {
    if (facet.key.toLowerCase().includes(term) || facet.label.toLowerCase().includes(term)) {
      result.push(facet);
      continue;
    }
    const values = facet.values.filter((v) => v.value.toLowerCase().includes(term));
    if (values.length > 0) result.push({ ...facet, values });
  }
  return result;
}
