import { useMemo, useState, useCallback, useEffect } from 'preact/hooks';
import type { SSEEvent } from './use-sse.js';

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

interface FilterToken {
  negated: boolean;
  key?: string;
  value: string;
  operator: 'AND' | 'OR';
}

function parseTokens(query: string): FilterToken[] {
  if (!query.trim()) return [];
  const tokens: FilterToken[] = [];
  const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  let nextOperator: 'AND' | 'OR' = 'AND';

  for (const part of parts) {
    if (part.toUpperCase() === 'OR') { nextOperator = 'OR'; continue; }
    if (part.toUpperCase() === 'AND') { nextOperator = 'AND'; continue; }

    let negated = false;
    let working = part;

    if (working.startsWith('!') || working.startsWith('-')) {
      negated = true;
      working = working.slice(1);
    }

    const colonIdx = working.indexOf(':');
    if (colonIdx > 0) {
      const key = working.slice(0, colonIdx);
      let value = working.slice(colonIdx + 1);
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      tokens.push({ negated, key, value, operator: nextOperator });
    } else {
      let value = working;
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      tokens.push({ negated, value, operator: nextOperator });
    }
    nextOperator = 'AND';
  }
  return tokens;
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
        event.data.name ?? ''
      ).toLowerCase();
      return route.includes(valueLower);
    }
    case 'status':
      return (event.data.status?.code ?? '').toLowerCase() === valueLower;
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
      return String(event.data.statusCode ?? event.data.attributes['http.status_code'] ?? '') === value;
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
  ].filter(Boolean).join(' ').toLowerCase();

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

function matchesQuery(event: SSEEvent, query: string): boolean {
  const tokens = parseTokens(query);
  if (tokens.length === 0) return true;

  // Group tokens by OR chains
  // e.g. [A, B OR C, D] → [[A], [B, C], [D]]
  // Each group is OR'd internally, groups are AND'd
  const groups: FilterToken[][] = [];
  let currentGroup: FilterToken[] = [];

  for (const token of tokens) {
    if (token.operator === 'OR' && currentGroup.length > 0) {
      currentGroup.push(token);
    } else {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [token];
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Every group must have at least one matching token (AND between groups, OR within)
  return groups.every((group) =>
    group.some((token) => matchesSingleToken(event, token))
  );
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
  if (query) params.set('q', query); else params.delete('q');
  if (services.size > 0) params.set('services', [...services].join(',')); else params.delete('services');
  const qs = params.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : '');
  history.replaceState(null, '', url);
}

export function useEvents(events: SSEEvent[]): UseEventsResult {
  const initial = useMemo(readUrlParams, []);
  const [activeServices, setActiveServices] = useState<Set<string>>(() => new Set(initial.services));
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

  return { filtered, services, activeServices, toggleService, setServices, searchQuery, setSearchQuery };
}
