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
 * Compare two facet values the way the matcher folds case for the facets the
 * drawer emits (service/method/status/etc. are all case-insensitive). Keeps the
 * "is this value active" check consistent with what the matcher will actually
 * match.
 */
function valuesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Build a `key:value` query token from a facet click, quoting the value when it
 * contains whitespace so it survives `splitParts` as a single token. The result
 * is a token the matcher already understands (e.g. `service:web`,
 * `statusCode:404`, `method:GET`).
 */
export function tokenFor(key: string, value: string): string {
  const v = /\s/.test(value) ? `"${value}"` : value;
  return `${key}:${v}`;
}

/**
 * True when the query already contains a non-negated `key:value` token — i.e.
 * the facet value is currently active. Value comparison is case-insensitive to
 * match the matcher's folding.
 */
export function hasToken(query: string, key: string, value: string): boolean {
  return parseFilterTokens(query).some(
    (t) => !t.negated && t.key === key && valuesEqual(t.value, value),
  );
}

/** Serialize tokens back to a query string, re-inserting `OR` between OR-joined
 *  tokens. Inverse of `parseFilterTokens` for the subset of queries the facet
 *  drawer produces (no free-standing `AND` keywords). */
function serializeTokens(tokens: FilterToken[]): string {
  const parts: string[] = [];
  tokens.forEach((t, i) => {
    if (i > 0 && t.operator === 'OR') parts.push('OR');
    parts.push(t.raw);
  });
  return parts.join(' ');
}

/**
 * Add or remove a `key:value` facet token, returning the new query — the single
 * source of truth for what a facet click does to the search bar.
 *
 * - If the value is already present (non-negated), it is removed. Removing the
 *   head of an OR group promotes the next member to a fresh group head so the
 *   grammar never dangles a leading `OR`.
 * - Otherwise it is added. If a non-negated token for the same key already
 *   exists, the new token is OR-joined into that key's group (Datadog's
 *   same-facet-OR semantics: `service:web OR service:api`); different keys are
 *   AND-joined (a new group).
 */
export function toggleToken(query: string, key: string, value: string): string {
  const tokens = parseFilterTokens(query);
  const idx = tokens.findIndex(
    (t) => !t.negated && t.key === key && valuesEqual(t.value, value),
  );

  if (idx >= 0) {
    const removed = tokens[idx];
    const next = tokens.slice();
    next.splice(idx, 1);
    // If we removed a group head and the following token OR-joined it, promote
    // that token to a fresh head so it isn't left dangling as a leading `OR`.
    if (removed.operator !== 'OR' && next[idx]?.operator === 'OR') {
      next[idx] = { ...next[idx], operator: 'AND' };
    }
    return serializeTokens(next);
  }

  const raw = tokenFor(key, value);

  // OR-merge into an existing same-key group if one exists, keeping the new
  // token contiguous with the rest of that key's values.
  let lastSame = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].negated && tokens[i].key === key) lastSame = i;
  }
  if (lastSame >= 0) {
    const newToken: FilterToken = { raw, negated: false, key, value, operator: 'OR' };
    const next = tokens.slice();
    next.splice(lastSame + 1, 0, newToken);
    return serializeTokens(next);
  }

  return query ? `${query} ${raw}` : raw;
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
