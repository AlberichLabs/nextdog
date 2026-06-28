import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { normalizeExpression, parseFilterTokens } from '../utils/filter-query';

// ---------------------------------------------------------------------------
// Style constants (defined outside the component)
// ---------------------------------------------------------------------------

const containerStyle = css({
  position: 'relative',
  py: '2',
  px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  transition: 'all 0.15s ease',
});

const inputWrapperBase = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1',
  alignItems: 'center',
  minHeight: '32px',
  py: '1',
  px: '2',
  background: 'surface.bg',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'sm',
  cursor: 'text',
  flex: 1,
});

const inputWrapperFocused = css({
  borderColor: 'accent',
});

const searchInputStyle = css({
  flex: 1,
  minWidth: '120px',
  border: 'none',
  background: 'transparent',
  color: 'fg',
  fontFamily: 'mono',
  fontSize: 'md',
  outline: 'none',
  padding: '2px 0',
  _placeholder: {
    color: 'fg.dim',
    opacity: 0.6,
  },
});

const helpPanelStyle = css({
  marginTop: '6px',
  padding: '10px 12px',
  background: 'surface.panel',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'sm',
  fontSize: 'sm',
  fontFamily: 'mono',
});

const helpTitleStyle = css({
  fontWeight: 600,
  color: 'fg.bright',
  marginBottom: '6px',
});

const helpBodyStyle = css({
  color: 'fg.dim',
  lineHeight: 1.8,
});

const helpKeywordStyle = css({ color: 'fg' });

const helpFooterStyle = css({
  marginTop: '1',
  color: 'fg.dim',
});

// -- pill styles --

const pillFilterBase = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  padding: '1px 6px',
  borderRadius: 'sm',
  fontFamily: 'mono',
  fontSize: 'sm',
  background: 'rgba(108, 92, 231, 0.15)',
  border: '1px solid rgba(108, 92, 231, 0.3)',
  color: 'fg',
  whiteSpace: 'nowrap',
});

const pillNegated = css({
  background: 'rgba(225, 112, 85, 0.15)',
  borderColor: 'rgba(225, 112, 85, 0.3)',
});

const pillLevel = css({
  background: 'rgba(116, 185, 255, 0.15)',
  borderColor: 'rgba(116, 185, 255, 0.3)',
});

const pillService = css({
  background: 'rgba(0, 184, 148, 0.15)',
  borderColor: 'rgba(0, 184, 148, 0.3)',
});

const pillStatus = css({
  background: 'rgba(253, 203, 110, 0.15)',
  borderColor: 'rgba(253, 203, 110, 0.3)',
});

const pillRoute = css({
  background: 'rgba(108, 92, 231, 0.15)',
  borderColor: 'rgba(108, 92, 231, 0.3)',
});

const pillTrace = css({
  background: 'rgba(136, 136, 136, 0.15)',
  borderColor: 'rgba(136, 136, 136, 0.3)',
});

const pillKeyStyle = css({ color: 'fg.dim' });

const pillSepStyle = css({ color: 'fg.dim', margin: '0 1px' });

const pillValStyle = css({ color: 'fg.bright' });

const pillNegStyle = css({ color: 'red', fontWeight: 600, marginRight: '2px' });

const pillOperatorStyle = css({
  fontSize: '9px',
  fontWeight: 700,
  color: 'yellow',
  marginRight: '1',
  textTransform: 'uppercase',
});

const pillRemoveStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  height: '14px',
  marginLeft: '2px',
  border: 'none',
  borderRadius: '2px',
  background: 'transparent',
  color: 'fg.dim',
  cursor: 'pointer',
  fontSize: 'xs',
  lineHeight: 1,
  padding: 0,
  _hover: {
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'fg.bright',
  },
});

// Subtle "press Enter to apply" affordance — filtering is commit-on-Enter, not
// live, which surprised a reviewer into thinking it was broken (issue #21).
const enterHintStyle = css({
  flexShrink: 0,
  marginLeft: 'auto',
  paddingLeft: '6px',
  fontFamily: 'mono',
  fontSize: '10px',
  color: 'fg.dim',
  opacity: 0.7,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  pointerEvents: 'none',
});

const enterHintKbd = css({
  padding: '0 3px',
  borderRadius: '3px',
  border: '1px solid token(colors.border.subtle)',
  background: 'surface.panel',
  color: 'fg',
});

const enterHintOr = css({
  color: 'yellow',
  fontWeight: 700,
});

const suggestionsStyle = css({
  position: 'absolute',
  left: '4',
  right: '4',
  top: 'calc(100% - 2px)',
  background: 'surface.panel',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: '0 0 token(radii.sm) token(radii.sm)',
  zIndex: 50,
  maxHeight: '200px',
  overflowY: 'auto',
});

const suggestionStyle = css({
  padding: '6px 12px',
  fontFamily: 'mono',
  fontSize: 'md',
  color: 'fg.dim',
  cursor: 'pointer',
  _hover: {
    background: 'surface.hover',
    color: 'fg.bright',
  },
});

const suggestionSelectedStyle = css({
  background: 'surface.hover',
  color: 'fg.bright',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  events?: SSEEvent[];
  rightSlot?: ComponentChildren;
}

function pillColorClass(key?: string, negated?: boolean): string {
  if (negated) return `${pillFilterBase} ${pillNegated}`;
  switch (key) {
    case 'level':
      return `${pillFilterBase} ${pillLevel}`;
    case 'service':
      return `${pillFilterBase} ${pillService}`;
    case 'status':
      return `${pillFilterBase} ${pillStatus}`;
    case 'route':
    case 'name':
      return `${pillFilterBase} ${pillRoute}`;
    case 'trace':
    case 'traceId':
      return `${pillFilterBase} ${pillTrace}`;
    default:
      return pillFilterBase;
  }
}

function removeToken(query: string, tokenRaw: string): string {
  // Remove the token and any adjacent OR/AND operators
  const parts: string[] = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const idx = parts.indexOf(tokenRaw);
  if (idx === -1) return query;

  // Remove the token
  parts.splice(idx, 1);
  // Clean up orphaned OR/AND
  if (idx > 0 && parts[idx - 1]?.toUpperCase() === 'OR') {
    parts.splice(idx - 1, 1);
  } else if (idx < parts.length && parts[idx]?.toUpperCase() === 'OR') {
    parts.splice(idx, 1);
  }
  if (idx > 0 && parts[idx - 1]?.toUpperCase() === 'AND') {
    parts.splice(idx - 1, 1);
  }

  return parts.join(' ');
}

// Collect known facets from events for autocomplete
function collectFacets(events: SSEEvent[]): string[] {
  const facets = new Set<string>([
    'level',
    'service',
    'status',
    'statusCode',
    'method',
    'route',
    'name',
    'message',
    'type',
    'kind',
    'trace',
  ]);
  for (const e of events.slice(-200)) {
    for (const key of Object.keys(e.data.attributes)) {
      facets.add(key);
    }
  }
  return [...facets].sort();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchBar({ value, onChange, events, rightSlot }: SearchBarProps) {
  const [focused, setFocused] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const tokens = parseFilterTokens(value);
  const facets = useMemo(() => collectFacets(events ?? []), [events]);

  // True while the input holds an OR expression that has not yet been committed —
  // surfaces the "press Enter" hint so the user knows the OR group isn't live yet.
  const pendingOr = /\bor\b/i.test(inputValue);

  // Filter suggestions based on current input
  const suggestions = useMemo(() => {
    if (!inputValue) return facets.slice(0, 8).map((f) => `${f}:`);
    const lower = inputValue.toLowerCase();
    if (inputValue.includes(':')) return [];
    return facets
      .filter((f) => f.toLowerCase().includes(lower))
      .slice(0, 8)
      .map((f) => `${f}:`);
  }, [inputValue, facets]);

  const editToken = (tokenRaw: string) => {
    onChange(removeToken(value, tokenRaw));
    setInputValue(tokenRaw);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      setSelectedSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      setSelectedSuggestion((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        // Accept selected suggestion
        setInputValue(suggestions[selectedSuggestion]);
        setSelectedSuggestion(-1);
        setShowSuggestions(false);
      } else if (inputValue.trim()) {
        // Commit the full typed expression — including any `OR` between tokens —
        // as one or more pills. The matcher treats `a OR b` as a single OR group;
        // normalizeExpression drops a dangling trailing/leading operator so a
        // half-typed `a OR` doesn't commit an empty token (issue #21).
        const expr = normalizeExpression(inputValue);
        if (expr) {
          const newQuery = value ? `${value} ${expr}` : expr;
          onChange(newQuery);
        }
        setInputValue('');
        setShowSuggestions(false);
        setSelectedSuggestion(-1);
      }
    } else if (e.key === 'Tab' && selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
      // Tab accepts suggestion
      e.preventDefault();
      setInputValue(suggestions[selectedSuggestion]);
      setSelectedSuggestion(-1);
    } else if (e.key === 'Backspace' && !inputValue && tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1];
      onChange(removeToken(value, lastToken.raw));
    } else if (e.key === 'ArrowLeft' && tokens.length > 0) {
      const input = e.target as HTMLInputElement;
      if (input.selectionStart === 0 && input.selectionEnd === 0) {
        e.preventDefault();
        editToken(tokens[tokens.length - 1].raw);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedSuggestion(-1);
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleRemoveToken = (tokenRaw: string) => {
    onChange(removeToken(value, tokenRaw));
  };

  const [showHelp, setShowHelp] = useState(false);

  return (
    <div class={containerStyle}>
      <div class={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: click-to-focus shim around the real <input>; keyboard users focus the input directly (parked 2026-06-28) */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-to-focus shim around the real <input>; keyboard users focus the input directly (parked 2026-06-28) */}
        <div
          class={`${inputWrapperBase} ${focused ? inputWrapperFocused : ''}`}
          style="flex:1"
          onClick={() => inputRef.current?.focus()}
        >
          {/* Search icon */}
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            style="flex-shrink:0;opacity:0.4"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {tokens.map((token, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: double-click-to-edit a filter token; no standard keyboard equivalent (parked 2026-06-28)
            <span
              key={i}
              class={pillColorClass(token.key, token.negated)}
              onDblClick={(e) => {
                e.stopPropagation();
                editToken(token.raw);
              }}
              title="Double-click to edit"
            >
              {token.operator === 'OR' && i > 0 && <span class={pillOperatorStyle}>OR</span>}
              {token.negated && <span class={pillNegStyle}>!</span>}
              {token.key && <span class={pillKeyStyle}>{token.key}</span>}
              {token.key && <span class={pillSepStyle}>:</span>}
              <span class={pillValStyle}>{token.value}</span>
              <button
                type="button"
                class={pillRemoveStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveToken(token.raw);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            class={searchInputStyle}
            placeholder={
              tokens.length === 0
                ? 'Filter... (e.g. level:error, status:ERROR OR statusCode:404)'
                : ''
            }
            value={inputValue}
            onInput={(e) => {
              setInputValue((e.target as HTMLInputElement).value);
              setShowSuggestions(true);
              setSelectedSuggestion(-1);
            }}
            onFocus={() => {
              setFocused(true);
              setShowSuggestions(true);
            }}
            onBlur={() => {
              setFocused(false);
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onKeyDown={handleKeyDown}
          />
          {focused && inputValue.trim() && (
            <span class={enterHintStyle}>
              {pendingOr && <span class={enterHintOr}>OR group · </span>}
              press <span class={enterHintKbd}>Enter</span> to apply
            </span>
          )}
        </div>
        {/* Help icon */}
        <button
          type="button"
          class={css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            flexShrink: 0,
            borderRadius: 'md',
            border: '1px solid token(colors.border.subtle)',
            background: 'transparent',
            color: 'fg.dim',
            cursor: 'pointer',
            fontSize: 'sm',
            fontFamily: 'mono',
            transition: 'all 0.15s ease',
            _hover: { background: 'surface.hover', color: 'fg.bright' },
          })}
          onClick={() => setShowHelp((v) => !v)}
          title="Filter syntax help"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9 9a3 3 0 015.12 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        {rightSlot}
      </div>
      {showHelp && (
        <div class={helpPanelStyle}>
          <div class={helpTitleStyle}>Filter Syntax</div>
          <div class={helpBodyStyle}>
            <div>
              <span class={helpKeywordStyle}>key:value</span> — filter by attribute
            </div>
            <div>
              <span class={helpKeywordStyle}>!key:value</span> — exclude matches
            </div>
            <div>
              <span class={helpKeywordStyle}>a OR b</span> — match either
            </div>
            <div>
              <span class={helpKeywordStyle}>text</span> — search name, message, route
            </div>
            <div class={helpFooterStyle}>
              Keys: level, service, route, status, statusCode, method, name, kind, runtime, traceId
            </div>
            <div class={helpFooterStyle}>
              HTTP: <span class={helpKeywordStyle}>statusCode:404</span>,{' '}
              <span class={helpKeywordStyle}>method:GET</span> (status:404 also works)
            </div>
          </div>
        </div>
      )}
      {showSuggestions && suggestions.length > 0 && focused && (
        <div class={suggestionsStyle}>
          {suggestions.map((s, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: suggestion list is keyboard-navigable via the input (arrow keys + Enter); onMouseDown selects before the input blurs (parked 2026-06-28)
            <div
              key={s}
              class={`${suggestionStyle} ${i === selectedSuggestion ? suggestionSelectedStyle : ''}`}
              onMouseDown={() => handleSuggestionClick(s)}
              onMouseEnter={() => setSelectedSuggestion(i)}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
