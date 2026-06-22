/**
 * Pure parsing of the filter-bar query string into the OR-group shape the
 * event matcher consumes.
 *
 * The query is a single string of space-separated tokens. `OR` (case-insensitive)
 * between two tokens binds them into one group; everything else is AND'd. The
 * matcher's contract (see `use-events.ts`): tokens within a group are OR'd,
 * groups are AND'd. Both the matcher and the search-bar pill renderer share this
 * module so the UI can express exactly — and only — what the matcher accepts
 * (issue #21).
 *
 * Trailing / leading / doubled `OR` are tolerated rather than producing empty
 * tokens, so a half-typed expression never silently matches nothing.
 */

export interface FilterToken {
  /**
   * The original token substring as typed (incl. any `!`/`-` prefix and quotes).
   * Used by the search bar as a stable identity for pill removal/editing; the
   * matcher ignores it.
   */
  raw: string;
  /** True when prefixed with `!` or `-` (exclude matches). */
  negated: boolean;
  /** The facet key for `key:value` tokens; absent for free-text tokens. */
  key?: string;
  /** The value (or the free-text term when `key` is absent). */
  value: string;
  /**
   * How this token joins the previous one. `OR` binds it into the previous
   * token's group; `AND` (the default) starts a new group.
   */
  operator: 'AND' | 'OR';
}

/** Split on whitespace while keeping `"quoted phrases"` intact. */
function splitParts(query: string): string[] {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

/**
 * Parse a query string into a flat list of tokens, each tagged with the
 * operator that joins it to the previous token.
 */
export function parseFilterTokens(query: string): FilterToken[] {
  if (!query.trim()) return [];

  const tokens: FilterToken[] = [];
  let nextOperator: 'AND' | 'OR' = 'AND';

  for (const part of splitParts(query)) {
    const upper = part.toUpperCase();
    if (upper === 'OR') {
      nextOperator = 'OR';
      continue;
    }
    if (upper === 'AND') {
      nextOperator = 'AND';
      continue;
    }

    let negated = false;
    let working = part;
    if (working.startsWith('!') || working.startsWith('-')) {
      negated = true;
      working = working.slice(1);
    }

    const colonIdx = working.indexOf(':');
    if (colonIdx > 0) {
      tokens.push({
        raw: part,
        negated,
        key: working.slice(0, colonIdx),
        value: stripQuotes(working.slice(colonIdx + 1)),
        operator: nextOperator,
      });
    } else {
      tokens.push({ raw: part, negated, value: stripQuotes(working), operator: nextOperator });
    }

    nextOperator = 'AND';
  }

  return tokens;
}

/**
 * Group parsed tokens into the AND-of-OR-groups shape the matcher evaluates:
 * each inner array is OR'd, the outer arrays are AND'd.
 *
 * A leading/doubled `OR` (where there is no group to attach to) starts a fresh
 * group instead of producing an empty one — so `OR a`, `a OR OR b`, and a lone
 * `OR` are all handled without ever matching nothing unexpectedly.
 */
export function groupFilterTokens(query: string): FilterToken[][] {
  const tokens = parseFilterTokens(query);

  const groups: FilterToken[][] = [];
  let current: FilterToken[] = [];

  for (const token of tokens) {
    if (token.operator === 'OR' && current.length > 0) {
      current.push(token);
    } else {
      if (current.length > 0) groups.push(current);
      current = [token];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

/**
 * Compose raw token strings into a single OR expression, e.g.
 * `['status:ERROR', 'statusCode:404'] -> 'status:ERROR OR statusCode:404'`.
 * Used by the UI to commit a typed multi-token OR expression as one group.
 */
export function composeOrExpression(rawTokens: string[]): string {
  return rawTokens.filter((t) => t.trim()).join(' OR ');
}

/**
 * Normalize a typed expression before it is committed to the query: collapse
 * runs of whitespace and drop a dangling trailing/leading `OR` or `AND` so the
 * committed string is exactly what the matcher will group.
 */
export function normalizeExpression(expr: string): string {
  const parts = splitParts(expr.trim());
  // Drop leading operators.
  while (parts.length && /^(or|and)$/i.test(parts[0])) parts.shift();
  // Drop trailing operators.
  while (parts.length && /^(or|and)$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}
