import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { type FilterToken, groupFilterTokens } from '../utils/filter-query';
import type { SSEEvent } from './use-sse';

export interface UseEventsResult {
  filtered: SSEEvent[];
  services: string[];
  activeServices: Set<string>;
  toggleService: (name: string) => void;
  /** Replace the active services selection wholesale (used by saved searches). */
  setServices: (names: string[]) => void;
  searchQuery: string;
  setSearchQuery: (q: string | ((prev: string) => string)) => void;
}

/** The HTTP status code for an event, as a string (`''` when absent). */
function statusCodeValue(data: SSEEvent['data']): string {
  return String(
    data.statusCode ??
      data.attributes['http.status_code'] ??
      data.attributes['http.response.status_code'] ??
      '',
  );
}

/** The HTTP method for an event, lower-cased (`''` when absent). */
function methodValue(data: SSEEvent['data']): string {
  return String(
    data.attributes['http.method'] ?? data.attributes['http.request.method'] ?? '',
  ).toLowerCase();
}

function matchesField(event: SSEEvent, key: string, value: string): boolean {
  const valueLower = value.toLowerCase();

  switch (key) {
    case 'level':
      return (event.data.level ?? '').toLowerCase() === valueLower;
    case 'service':
      return event.data.serviceName.toLowerCase() === valueLower;
    case 'route': {
      const route = String(
        event.data.attributes['http.route'] ??
          event.data.attributes['http.target'] ??
          event.data.name ??
          '',
      ).toLowerCase();
      return route.includes(valueLower);
    }
    case 'method':
      // HTTP method facet, exact case-insensitive (issue #52). Maps to the real
      // `http.method` / `http.request.method` attribute so `method:GET` resolves.
      return methodValue(event.data) === valueLower;
    case 'status':
      // A numeric value to `status:` means the HTTP status code (issue #52) —
      // `status:404` is the intuitive query and must not be a silent dead-end.
      // A non-numeric value keeps the original span OK/ERROR status semantics.
      return /^\d+$/.test(value)
        ? statusCodeValue(event.data) === value
        : (event.data.status?.code ?? '').toLowerCase() === valueLower;
    case 'trace':
    case 'traceId':
      return event.data.traceId === value;
    case 'span':
    case 'spanId':
      return event.data.spanId === value;
    case 'name':
      return (event.data.name ?? '').toLowerCase().includes(valueLower);
    case 'message':
      return (event.data.message ?? '').toLowerCase().includes(valueLower);
    case 'kind':
      return (event.data.kind ?? '').toLowerCase() === valueLower;
    case 'type':
      return event.type === value;
    case 'runtime':
      return String(event.data.attributes.runtime ?? '').toLowerCase() === valueLower;
    case 'statusCode':
    case 'status_code':
      return statusCodeValue(event.data) === value;
  }

  const attrVal = event.data.attributes[key];
  if (attrVal !== undefined) {
    return String(attrVal).toLowerCase().includes(valueLower);
  }

  return false;
}

function matchesFreetext(event: SSEEvent, text: string): boolean {
  const searchText = [
    event.data.name,
    event.data.message,
    event.data.serviceName,
    event.data.level,
    event.data.status?.code,
    ...Object.values(event.data.attributes).map(String),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return searchText.includes(text.toLowerCase());
}

function matchesSingleToken(event: SSEEvent, token: FilterToken): boolean {
  let matches: boolean;
  if (token.key) {
    matches = matchesField(event, token.key, token.value);
  } else {
    matches = matchesFreetext(event, token.value);
  }
  return token.negated ? !matches : matches;
}

// Exported for the matcher unit test; ported verbatim into the MCP matcher
// (packages/mcp/src/matcher.ts), pinned by its grammar-parity test.
export function matchesQuery(event: SSEEvent, query: string): boolean {
  // [[A], [B, C], [D]] — each group is OR'd internally, groups are AND'd.
  // Shared with the search-bar pill renderer so the UI can only ever express
  // what this matcher accepts (issue #21).
  const groups = groupFilterTokens(query);
  if (groups.length === 0) return true;

  // Every group must have at least one matching token (AND between groups, OR within)
  return groups.every((group) => group.some((token) => matchesSingleToken(event, token)));
}

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    query: params.get('q') ?? '',
    services: params.get('services')?.split(',').filter(Boolean) ?? [],
  };
}

function syncUrlParams(query: string, services: Set<string>) {
  const params = new URLSearchParams(window.location.search);
  if (query) params.set('q', query);
  else params.delete('q');
  if (services.size > 0) params.set('services', [...services].join(','));
  else params.delete('services');
  const qs = params.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : '');
  history.replaceState(null, '', url);
}

export function useEvents(events: SSEEvent[]): UseEventsResult {
  const initial = useMemo(readUrlParams, []);
  const [activeServices, setActiveServices] = useState<Set<string>>(
    () => new Set(initial.services),
  );
  const [searchQuery, setSearchQuery] = useState(initial.query);

  // Sync state → URL (debounced via replaceState — no history spam)
  useEffect(() => {
    syncUrlParams(searchQuery, activeServices);
  }, [searchQuery, activeServices]);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.data.serviceName);
    return [...set].sort();
  }, [events]);

  const toggleService = useCallback((name: string) => {
    setActiveServices((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setServices = useCallback((names: string[]) => {
    setActiveServices(new Set(names));
  }, []);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (activeServices.size > 0 && !activeServices.has(e.data.serviceName)) return false;
      return matchesQuery(e, searchQuery);
    });
  }, [events, activeServices, searchQuery]);

  return {
    filtered,
    services,
    activeServices,
    toggleService,
    setServices,
    searchQuery,
    setSearchQuery,
  };
}
