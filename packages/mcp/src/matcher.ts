/**
 * Event matcher — ported verbatim from the canonical UI matcher at
 * `packages/ui/src/hooks/use-events.ts` (`matchesField` / `matchesFreetext` /
 * `matchesSingleToken` / `matchesQuery`).
 *
 * The contract of `search_logs` is "the same results the dashboard search bar
 * gives for the same query string". Keeping this a faithful port — same facet
 * keys, same case-folding, same `includes` vs `===` semantics per facet — is what
 * makes that true. The parity test pins it.
 */
import { type FilterToken, groupFilterTokens } from './filter-query';
import type { SidecarEvent } from './types';

function matchesField(event: SidecarEvent, key: string, value: string): boolean {
  const valueLower = value.toLowerCase();
  const { data } = event;

  switch (key) {
    case 'level':
      return (data.level ?? '').toLowerCase() === valueLower;
    case 'service':
      return data.serviceName.toLowerCase() === valueLower;
    case 'route': {
      const route = String(
        data.attributes['http.route'] ?? data.attributes['http.target'] ?? data.name ?? '',
      ).toLowerCase();
      return route.includes(valueLower);
    }
    case 'status':
      return (data.status?.code ?? '').toLowerCase() === valueLower;
    case 'trace':
    case 'traceId':
      return data.traceId === value;
    case 'span':
    case 'spanId':
      return data.spanId === value;
    case 'name':
      return (data.name ?? '').toLowerCase().includes(valueLower);
    case 'message':
      return (data.message ?? '').toLowerCase().includes(valueLower);
    case 'kind':
      return (data.kind ?? '').toLowerCase() === valueLower;
    case 'type':
      return event.type === value;
    case 'runtime':
      return String(data.attributes.runtime ?? '').toLowerCase() === valueLower;
    case 'statusCode':
    case 'status_code':
      return String(data.statusCode ?? data.attributes['http.status_code'] ?? '') === value;
  }

  const attrVal = data.attributes[key];
  if (attrVal !== undefined) {
    return String(attrVal).toLowerCase().includes(valueLower);
  }

  return false;
}

function matchesFreetext(event: SidecarEvent, text: string): boolean {
  const { data } = event;
  const searchText = [
    data.name,
    data.message,
    data.serviceName,
    data.level,
    data.status?.code,
    ...Object.values(data.attributes).map(String),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return searchText.includes(text.toLowerCase());
}

function matchesSingleToken(event: SidecarEvent, token: FilterToken): boolean {
  let matches: boolean;
  if (token.key) {
    matches = matchesField(event, token.key, token.value);
  } else {
    matches = matchesFreetext(event, token.value);
  }
  return token.negated ? !matches : matches;
}

/**
 * Evaluate a Datadog-style query string against an event.
 *
 * `[[A], [B, C], [D]]` — each group is OR'd internally, groups are AND'd.
 * An empty/whitespace query matches everything (same as the dashboard).
 */
export function matchesQuery(event: SidecarEvent, query: string): boolean {
  const groups = groupFilterTokens(query);
  if (groups.length === 0) return true;

  return groups.every((group) => group.some((token) => matchesSingleToken(event, token)));
}
