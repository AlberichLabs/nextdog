import type { ComponentChildren } from 'preact';
import { useState, useRef, useMemo } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse.js';

// ---------------------------------------------------------------------------
// Style constants (defined outside the component)
// ---------------------------------------------------------------------------

const containerStyle = css({
  position: 'relative',
  py: '2', px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  transition: 'all 0.15s ease',
});

const rowStyle = css({
  display: 'flex',
  gap: '6px',
  alignItems: 'stretch',
});

const inputWrapperBase = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1',
  alignItems: 'center',
  minHeight: '32px',
  py: '1', px: '2',
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

const helpBtnStyle = css({
  fontSize: 'md',
  py: '1', px: '2',
  flexShrink: 0,
  position: 'relative',
  borderRadius: '12px',
  fontWeight: 500,
  border: '1px solid token(colors.border.subtle)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'fg.dim',
  _hover: { background: 'surface.hover' },
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

interface FilterToken {
  raw: string;
  negated: boolean;
  key?: string;
  value: string;
  operator: 'AND' | 'OR';
}

function parseTokens(query: string): FilterToken[] {
  if (!query.trim()) return [];
  const tokens: FilterToken[] = [];
  // Split by spaces but preserve quoted strings
  const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  let nextOperator: 'AND' | 'OR' = 'AND';

  for (const part of parts) {
    if (part.toUpperCase() === 'OR') {
      nextOperator = 'OR';
      continue;
    }
    if (part.toUpperCase() === 'AND') {
      nextOperator = 'AND';
      continue;
    }

    let raw = part;
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
      // Strip quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      tokens.push({ raw, negated, key, value, operator: nextOperator });
    } else {
      let value = working;
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      tokens.push({ raw, negated, value, operator: nextOperator });
    }
    nextOperator = 'AND';
  }
  return tokens;
}

function pillColorClass(key?: string, negated?: boolean): string {
  if (negated) return `${pillFilterBase} ${pillNegated}`;
  switch (key) {
    case 'level': return `${pillFilterBase} ${pillLevel}`;
    case 'service': return `${pillFilterBase} ${pillService}`;
    case 'status': return `${pillFilterBase} ${pillStatus}`;
    case 'route':
    case 'name': return `${pillFilterBase} ${pillRoute}`;
    case 'trace':
    case 'traceId': return `${pillFilterBase} ${pillTrace}`;
    default: return pillFilterBase;
  }
}

function removeToken(query: string, tokenRaw: string): string {
  // Remove the token and any adjacent OR/AND operators
  const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
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
  const facets = new Set<string>(['level', 'service', 'status', 'route', 'name', 'message', 'type', 'kind', 'trace']);
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

  const tokens = parseTokens(value);
  const facets = useMemo(() => collectFacets(events ?? []), [events]);

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
        const newQuery = value ? `${value} ${inputValue.trim()}` : inputValue.trim();
        onChange(newQuery);
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
      <div class={`${inputWrapperBase} ${focused ? inputWrapperFocused : ''}`} style="flex:1" onClick={() => inputRef.current?.focus()}>
        {/* Search icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.4">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {tokens.map((token, i) => (
          <span
            key={i}
            class={pillColorClass(token.key, token.negated)}
            onDblClick={(e) => { e.stopPropagation(); editToken(token.raw); }}
            title="Double-click to edit"
          >
            {token.operator === 'OR' && i > 0 && <span class={pillOperatorStyle}>OR</span>}
            {token.negated && <span class={pillNegStyle}>!</span>}
            {token.key && <span class={pillKeyStyle}>{token.key}</span>}
            {token.key && <span class={pillSepStyle}>:</span>}
            <span class={pillValStyle}>{token.value}</span>
            <button class={pillRemoveStyle} onClick={(e) => { e.stopPropagation(); handleRemoveToken(token.raw); }}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          // Stable hook for the global focus-filter shortcut (`/`, cmd/ctrl+k).
          data-nextdog-filter
          class={searchInputStyle}
          placeholder={tokens.length === 0 ? 'Filter... (e.g. level:error, !service:noisy)' : ''}
          value={inputValue}
          onInput={(e) => {
            setInputValue((e.target as HTMLInputElement).value);
            setShowSuggestions(true);
            setSelectedSuggestion(-1);
          }}
          onFocus={() => { setFocused(true); setShowSuggestions(true); }}
          onBlur={() => { setFocused(false); setTimeout(() => setShowSuggestions(false), 150); }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {/* Help icon */}
      <button
        class={css({
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px', flexShrink: 0,
          borderRadius: 'md', border: '1px solid token(colors.border.subtle)',
          background: 'transparent', color: 'fg.dim', cursor: 'pointer',
          fontSize: 'sm', fontFamily: 'mono', transition: 'all 0.15s ease',
          _hover: { background: 'surface.hover', color: 'fg.bright' },
        })}
        onClick={() => setShowHelp((v) => !v)}
        title="Filter syntax help"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" /><path d="M9 9a3 3 0 015.12 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      {rightSlot}
      </div>
      {showHelp && (
        <div class={helpPanelStyle}>
          <div class={helpTitleStyle}>Filter Syntax</div>
          <div class={helpBodyStyle}>
            <div><span class={helpKeywordStyle}>key:value</span> — filter by attribute</div>
            <div><span class={helpKeywordStyle}>!key:value</span> — exclude matches</div>
            <div><span class={helpKeywordStyle}>a OR b</span> — match either</div>
            <div><span class={helpKeywordStyle}>text</span> — search name, message, route</div>
            <div class={helpFooterStyle}>Keys: level, service, route, status, name, kind, runtime, traceId</div>
          </div>
        </div>
      )}
      {showSuggestions && suggestions.length > 0 && focused && (
        <div class={suggestionsStyle}>
          {suggestions.map((s, i) => (
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
