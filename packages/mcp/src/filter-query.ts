/**
 * Datadog-style filter grammar — ported verbatim from the canonical UI
 * implementation at `packages/ui/src/utils/filter-query.ts`.
 *
 * It is duplicated rather than imported because `@nextdog/ui` is a Preact bundle
 * built with PandaCSS and not consumable from a plain Node stdio process; the
 * grammar itself is pure and dependency-free. If the UI grammar changes, this
 * copy must be updated in lockstep — the `search_logs` tool's contract is "the
 * same results the dashboard search bar gives", and the matcher test
 * (`grammar-parity.test.ts`) pins that equivalence.
 *
 * Grammar: a single string of space-separated tokens. `OR` (case-insensitive)
 * between two tokens binds them into one group; everything else is AND'd. Tokens
 * within a group are OR'd; groups are AND'd. `!` / `-` prefix negates a token.
 * `key:value` tokens filter a facet; bare tokens are free-text.
 */

export interface FilterToken {
  /** The original token substring as typed (incl. any `!`/`-` prefix and quotes). */
  raw: string;
  /** True when prefixed with `!` or `-` (exclude matches). */
  negated: boolean;
  /** The facet key for `key:value` tokens; absent for free-text tokens. */
  key?: string;
  /** The value (or the free-text term when `key` is absent). */
  value: string;
  /** How this token joins the previous one. `OR` binds it into the previous token's group. */
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
