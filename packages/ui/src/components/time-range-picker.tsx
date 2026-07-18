import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import {
  parseDatetimeLocalValue,
  PRESET_MS,
  RELATIVE_PRESETS,
  type RelativePreset,
  type TimeRangeSelection,
  toDatetimeLocalValue,
} from '../utils/time-window';

interface TimeRangePickerProps {
  selection: TimeRangeSelection;
  onChange: (sel: TimeRangeSelection) => void;
  /** True while the active window keeps tailing live; false while inspecting a fixed past period. */
  live: boolean;
  /** True while the on-disk snapshot for a bounded window is loading. */
  loading?: boolean;
}

// Dense, segmented control matching the overlay's pill aesthetic. Lives in the
// header next to the search/filter controls; the chosen window scopes the set the
// search query + facets then operate on.

const groupStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '0',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'full',
  overflow: 'hidden',
  background: 'transparent',
});

const segBase = css({
  py: '1',
  px: '2',
  fontSize: 'sm',
  fontWeight: 500,
  fontFamily: 'mono',
  border: 'none',
  borderRight: '1px solid token(colors.border.subtle)',
  background: 'transparent',
  color: 'fg.dim',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
  _hover: { background: 'surface.hover', color: 'fg.bright' },
  _last: { borderRight: 'none' },
});

const segActive = css({
  background: 'surface.raised',
  color: 'fg.bright',
});

const modeBadgeBase = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  fontSize: 'xs',
  fontWeight: 600,
  fontFamily: 'mono',
  py: '0.5',
  px: '2',
  borderRadius: 'full',
  whiteSpace: 'nowrap',
});

const modeLive = css({
  color: 'green',
  background: 'rgba(0, 184, 148, 0.12)',
});

const modeHistorical = css({
  color: 'yellow',
  background: 'rgba(253, 203, 110, 0.14)',
});

const popoverStyle = css({
  position: 'fixed',
  zIndex: 200,
  width: '300px',
  background: 'surface.panel',
  border: '1px solid token(colors.border.strong)',
  borderRadius: 'lg',
  boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
  fontSize: 'md',
  fontFamily: 'mono',
  padding: '12px',
  animation: 'fade-in 0.1s ease-out',
});

const fieldRowStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  marginBottom: '2',
});

const labelStyle = css({
  fontSize: 'xs',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'fg.dim',
});

// Wrapper that frames the native datetime-local input so the raw browser
// control blends into the overlay's system instead of sticking out — a bordered,
// panel-tinted field with a calendar glyph the input sits inside (issue #82).
const inputWrapStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '1',
  py: '1',
  px: '2',
  background: 'surface.bg',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'sm',
  transition: 'border-color 0.12s ease',
  _focusWithin: { borderColor: 'accent' },
});

const inputIconStyle = css({
  flexShrink: 0,
  color: 'fg.dim',
  display: 'flex',
});

const inputStyle = css({
  flex: 1,
  minWidth: 0,
  fontFamily: 'mono',
  fontSize: 'sm',
  background: 'transparent',
  border: 'none',
  color: 'fg',
  // Track the theme so the native calendar/spinner glyphs invert correctly in
  // light mode (they were hardcoded dark, showing as dark-on-light artifacts).
  colorScheme: 'dark',
  _light: { colorScheme: 'light' },
  _focus: { outline: 'none' },
});

function CalendarIcon() {
  return (
    <span className={inputIconStyle}>
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    </span>
  );
}

const applyBtnStyle = css({
  py: '1',
  px: '3',
  fontSize: 'sm',
  fontWeight: 600,
  fontFamily: 'mono',
  borderRadius: 'md',
  border: '1px solid token(colors.accent)',
  background: 'accent',
  color: 'white',
  cursor: 'pointer',
  _hover: { opacity: 0.9 },
  _disabled: { opacity: 0.4, cursor: 'not-allowed' },
});

const errorStyle = css({ fontSize: 'xs', color: 'red', marginBottom: '2' });

function presetLabel(sel: TimeRangeSelection): string {
  if (sel.kind === 'preset') return `last ${sel.preset}`;
  return '';
}

function customRangeLabel(from: number, to: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  return `${fmt(from)} → ${fmt(to)}`;
}

export function TimeRangePicker({ selection, onChange, live, loading }: TimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  // Custom-range draft, seeded to the last hour (or the current custom selection).
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []);

  const openCustom = useCallback(() => {
    const now = Date.now();
    if (selection.kind === 'custom') {
      setFromValue(toDatetimeLocalValue(selection.from));
      setToValue(toDatetimeLocalValue(selection.to));
    } else {
      setFromValue(toDatetimeLocalValue(now - PRESET_MS['1h']));
      setToValue(toDatetimeLocalValue(now));
    }
    setError(null);
    setOpen(true);
  }, [selection]);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const close = (e: PointerEvent) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  const selectPreset = (preset: RelativePreset) => {
    setOpen(false);
    onChange({ kind: 'preset', preset });
  };

  const applyCustom = () => {
    const from = parseDatetimeLocalValue(fromValue);
    const to = parseDatetimeLocalValue(toValue);
    if (from === null || to === null) {
      setError('Enter a valid from and to.');
      return;
    }
    if (from >= to) {
      setError('"From" must be before "to".');
      return;
    }
    setError(null);
    setOpen(false);
    onChange({ kind: 'custom', from, to });
  };

  const customActive = selection.kind === 'custom';

  return (
    <div className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
      <div className={groupStyle} role="group" aria-label="Time range">
        {RELATIVE_PRESETS.map((p) => {
          const active = selection.kind === 'preset' && selection.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`${segBase} ${active ? segActive : ''}`}
              onClick={() => selectPreset(p.id)}
              title={`Last ${p.label} (live, rolling)`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          className={`${segBase} ${selection.kind === 'all' ? segActive : ''}`}
          onClick={() => {
            setOpen(false);
            onChange({ kind: 'all' });
          }}
          title="All available history"
        >
          All
        </button>
        <button
          type="button"
          ref={btnRef}
          className={`${segBase} ${customActive ? segActive : ''}`}
          onClick={() => (open ? setOpen(false) : openCustom())}
          title="Custom from–to range (historical)"
        >
          Custom{customActive ? ' ▾' : '…'}
        </button>
      </div>

      {/* Mode badge — make live vs historical unmistakable. */}
      {selection.kind !== 'all' &&
        (live ? (
          <span className={`${modeBadgeBase} ${modeLive}`} title="Live — keeps tailing within the window">
            ● Live · {presetLabel(selection)}
          </span>
        ) : (
          <span
            className={`${modeBadgeBase} ${modeHistorical}`}
            title="Historical — live tail paused; inspecting a fixed period"
          >
            ❚❚ Historical{selection.kind === 'custom' ? ` · ${customRangeLabel(selection.from, selection.to)}` : ''}
          </span>
        ))}
      {loading && (
        <span className={css({ fontSize: 'xs', color: 'fg.dim', fontFamily: 'mono' })}>loading…</span>
      )}

      {open && (
        <div
          ref={popRef}
          className={popoverStyle}
          style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
        >
          <div
            className={css({
              fontSize: 'sm',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'fg.dim',
              marginBottom: '2',
            })}
          >
            Custom range
          </div>
          <div className={fieldRowStyle}>
            <label className={labelStyle} htmlFor="time-range-from">
              From
            </label>
            <div className={inputWrapStyle}>
              <CalendarIcon />
              <input
                id="time-range-from"
                type="datetime-local"
                className={inputStyle}
                value={fromValue}
                onInput={(e) => setFromValue((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div className={fieldRowStyle}>
            <label className={labelStyle} htmlFor="time-range-to">
              To
            </label>
            <div className={inputWrapStyle}>
              <CalendarIcon />
              <input
                id="time-range-to"
                type="datetime-local"
                className={inputStyle}
                value={toValue}
                onInput={(e) => setToValue((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          {error && <div className={errorStyle}>{error}</div>}
          <div
            className={css({
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1',
            })}
          >
            <span className={css({ fontSize: 'xs', color: 'fg.dim' })}>
              Inspects a fixed period (paused).
            </span>
            <button type="button" className={applyBtnStyle} onClick={applyCustom}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
