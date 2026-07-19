/**
 * Facet derivation for `describe_telemetry` (issue #90).
 *
 * This is a faithful, standalone MIRROR of `deriveFacets` in
 * `@nextdog/ui`'s `packages/ui/src/utils/facets.ts` — the same convention this
 * package already uses for `matcher.ts`, `filter-query.ts`, `redact.ts` and
 * `types.ts`: the pure logic is duplicated rather than imported so the MCP stays
 * a dependency-free stdio server. `@nextdog/ui` is a Preact/Vite bundle (its
 * `deriveFacets` is typed against a Preact hook's `SSEEvent`) and `@nextdog/core`
 * depends on `@nextdog/ui`, so importing either would drag a UI bundle into this
 * process; the MCP-local reduction avoids that. The critical invariant carried
 * across verbatim is the sensitive / high-cardinality DENY-LIST
 * ({@link ATTR_DENY_SEGMENT}) — without it, introspection would become a
 * credential-leak side channel (#60). `facets.test.ts` pins the deny-list.
 *
 * Follow-up (#90): de-dupe with `@nextdog/ui` by extracting a shared,
 * framework-free util both can consume, if/when the coupling is worth it.
 */
import type { SidecarEvent } from './types';

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

type EventData = SidecarEvent['data'];

interface FacetSpec {
  key: string;
  label: string;
  /** The facet value for an event, or `''` when the event has none. */
  extract: (data: EventData) => string;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/** The named facets — mirror of `NAMED_SPECS` in @nextdog/ui. */
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
 * sensitive — excluded from auto-faceting (ids, timestamps, bodies, headers,
 * secrets, …). VERBATIM mirror of @nextdog/ui's `ATTR_DENY_SEGMENT`.
 */
const ATTR_DENY_SEGMENT =
  /(^|[._-])(id|ids|uuid|guid|ip|port|time|timestamp|nano|dur|duration|body|header|headers|url|cookie|cookies|token|password|secret|stack|hash|size|length|count|query|sql|statement)([._-]|$)/i;

/** Attributes with more distinct values than this are not surfaced as facets. */
const MAX_ATTR_CARDINALITY = 20;

function countValues(events: SidecarEvent[], extract: (d: EventData) => string): Map<string, number> {
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

function attributeFacets(events: SidecarEvent[]): Facet[] {
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
 * Derive the facet list for a set of events. Named facets first (issue order),
 * then bounded common-attribute facets. Facets with no values are omitted.
 */
export function deriveFacets(events: SidecarEvent[], options: DeriveFacetsOptions = {}): Facet[] {
  const named = NAMED_SPECS.map((spec) =>
    toFacet(spec.key, spec.label, countValues(events, spec.extract)),
  ).filter((f): f is Facet => f !== null);

  const attrs = options.includeAttributes === false ? [] : attributeFacets(events);
  return [...named, ...attrs];
}
