import { useMemo, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { deriveFacets } from '../utils/facets';
import { hasToken } from '../utils/filter-query';

/* ── Persisted UI state ───────────────────────────────────────────────── */

const COLLAPSED_KEY = 'nextdog:facets-collapsed';
const OPEN_KEY = 'nextdog:facets-open';

/** Facets open by default — the high-signal ones; the rest start collapsed. */
const DEFAULT_OPEN: ReadonlySet<string> = new Set([
  'service',
  'method',
  'statusCode',
  'status',
  'level',
]);

/** How many values to show before a "+N more" expander. */
const VALUE_CAP = 8;

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

/* ── Styles ───────────────────────────────────────────────────────────── */

const s = {
  panel: css({
    flexShrink: 0,
    width: '224px',
    borderRight: '1px solid token(colors.border.subtle)',
    background: 'surface.panel',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }),
  rail: css({
    flexShrink: 0,
    width: '32px',
    borderRight: '1px solid token(colors.border.subtle)',
    background: 'surface.panel',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    py: '2',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '32px',
    px: '3',
    flexShrink: 0,
    borderBottom: '1px solid token(colors.border.subtle)',
    fontSize: 'xs',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'fg.dim',
    background: 'surface.bg',
  }),
  iconBtn: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    border: 'none',
    borderRadius: 'sm',
    background: 'transparent',
    color: 'fg.dim',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    _hover: { background: 'surface.hover', color: 'fg.bright' },
  }),
  railBtn: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: 'sm',
    background: 'transparent',
    color: 'fg.dim',
    cursor: 'pointer',
    _hover: { background: 'surface.hover', color: 'fg.bright' },
  }),
  railLabel: css({
    marginTop: '2',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: 'fg.dim',
    writingMode: 'vertical-rl',
    userSelect: 'none',
  }),
  list: css({
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  }),
  facet: css({
    borderBottom: '1px solid token(colors.border.subtle)',
  }),
  facetHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: '1',
    width: '100%',
    py: '1.5',
    px: '3',
    border: 'none',
    background: 'transparent',
    color: 'fg',
    cursor: 'pointer',
    fontSize: 'sm',
    fontWeight: 600,
    textAlign: 'left',
    transition: 'background 0.12s ease',
    _hover: { background: 'surface.hover' },
  }),
  facetChevron: css({
    fontSize: '9px',
    color: 'fg.dim',
    width: '10px',
    flexShrink: 0,
    transition: 'transform 0.12s ease',
  }),
  facetLabel: css({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  facetCount: css({
    fontSize: '10px',
    color: 'fg.dim',
    fontFamily: 'mono',
  }),
  values: css({
    pb: '1',
  }),
  value: css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    width: '100%',
    py: '1',
    pl: '4',
    pr: '3',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'mono',
    fontSize: 'sm',
    color: 'fg.dim',
    textAlign: 'left',
    transition: 'all 0.1s ease',
    _hover: { background: 'surface.hover', color: 'fg.bright' },
  }),
  valueActive: css({
    color: 'fg.bright',
    background: 'rgba(108, 92, 231, 0.12)',
    _hover: { background: 'rgba(108, 92, 231, 0.18)' },
  }),
  checkbox: css({
    flexShrink: 0,
    width: '12px',
    height: '12px',
    borderRadius: '2px',
    border: '1px solid token(colors.border.strong)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    lineHeight: 1,
    color: 'surface.bg',
  }),
  checkboxOn: css({
    background: 'accent',
    borderColor: 'accent',
  }),
  valueText: css({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  valueCount: css({
    flexShrink: 0,
    fontSize: '10px',
    color: 'fg.dim',
  }),
  moreBtn: css({
    width: '100%',
    py: '1',
    pl: '4',
    pr: '3',
    border: 'none',
    background: 'transparent',
    color: 'accent',
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: 'mono',
    textAlign: 'left',
    _hover: { textDecoration: 'underline' },
  }),
  empty: css({
    p: '3',
    fontSize: 'sm',
    color: 'fg.dim',
    lineHeight: 1.6,
  }),
  // Semantic value colors mirror the rest of the overlay (status/level), kept
  // distinct from the single accent (reserved for the active/selected state).
  ok: css({ color: 'green' }),
  err: css({ color: 'red' }),
  warn: css({ color: 'yellow' }),
  info: css({ color: 'blue' }),
};

/** Tint statusCode/status/level values to match the list views. */
function valueColor(key: string, value: string): string | undefined {
  if (key === 'statusCode') {
    const group = Math.floor(Number(value) / 100);
    if (group === 2) return s.ok;
    if (group === 3) return s.info;
    if (group === 4) return s.warn;
    if (group === 5) return s.err;
    return undefined;
  }
  if (key === 'status') return value === 'ERROR' ? s.err : value === 'OK' ? s.ok : undefined;
  if (key === 'level') {
    if (value === 'error') return s.err;
    if (value === 'warn') return s.warn;
    if (value === 'info') return s.info;
  }
  return undefined;
}

const chevronDown = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
    <title>collapse</title>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const chevronRight = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
    <title>expand</title>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

/* ── Component ────────────────────────────────────────────────────────── */

interface FacetDrawerProps {
  /** Events to derive facet values + counts from (the current view's subset). */
  events: SSEEvent[];
  /** The live search query — drives which values render as active. */
  query: string;
  /** Toggle a `key:value` token in the query. */
  onToggleValue: (key: string, value: string) => void;
}

export function FacetDrawer({ events, query, onToggleValue }: FacetDrawerProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const facets = useMemo(() => deriveFacets(events), [events]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const isOpen = (key: string) => open[key] ?? DEFAULT_OPEN.has(key);

  const toggleOpen = (key: string) => {
    setOpen((prev) => {
      const next = { ...prev, [key]: !isOpen(key) };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className={s.rail}>
        <button
          type="button"
          className={s.railBtn}
          onClick={toggleCollapsed}
          title="Show facets"
          aria-label="Show facets"
        >
          {chevronRight}
        </button>
        <span className={s.railLabel}>Facets</span>
      </div>
    );
  }

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <span>Facets</span>
        <button
          type="button"
          className={s.iconBtn}
          onClick={toggleCollapsed}
          title="Hide facets"
          aria-label="Hide facets"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <title>collapse facets</title>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div className={s.list}>
        {facets.length === 0 ? (
          <div className={s.empty}>
            Facets appear here as events stream in — click a value to filter.
          </div>
        ) : (
          facets.map((facet) => {
            const showAll = expanded[facet.key];
            const visible = showAll ? facet.values : facet.values.slice(0, VALUE_CAP);
            const hiddenCount = facet.values.length - visible.length;
            return (
              <div key={facet.key} className={s.facet}>
                <button type="button" className={s.facetHeader} onClick={() => toggleOpen(facet.key)}>
                  <span className={s.facetChevron}>
                    {isOpen(facet.key) ? chevronDown : chevronRight}
                  </span>
                  <span className={s.facetLabel}>{facet.label}</span>
                  <span className={s.facetCount}>{facet.values.length}</span>
                </button>
                {isOpen(facet.key) && (
                  <div className={s.values}>
                    {visible.map((v) => {
                      const active = hasToken(query, facet.key, v.value);
                      const tint = valueColor(facet.key, v.value);
                      return (
                        <button
                          type="button"
                          key={v.value}
                          className={`${s.value} ${active ? s.valueActive : ''}`}
                          onClick={() => onToggleValue(facet.key, v.value)}
                          title={`${facet.key}:${v.value} (${v.count})`}
                        >
                          <span className={`${s.checkbox} ${active ? s.checkboxOn : ''}`}>
                            {active ? '✓' : ''}
                          </span>
                          <span className={`${s.valueText} ${tint ?? ''}`}>{v.value}</span>
                          <span className={s.valueCount}>{v.count}</span>
                        </button>
                      );
                    })}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        className={s.moreBtn}
                        onClick={() => setExpanded((e) => ({ ...e, [facet.key]: true }))}
                      >
                        +{hiddenCount} more
                      </button>
                    )}
                    {showAll && facet.values.length > VALUE_CAP && (
                      <button
                        type="button"
                        className={s.moreBtn}
                        onClick={() => setExpanded((e) => ({ ...e, [facet.key]: false }))}
                      >
                        Show less
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
