import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { css } from 'styled-system/css';
import {
  SavedSearchStore,
  type SavedSearch,
  type RecentSearch,
  type SearchValue,
} from './saved-searches-store.js';

// One store shared across views (Spans, Logs) so saved/recent state stays in
// sync and persists through the single localStorage backing.
const sharedStore = new SavedSearchStore(
  typeof localStorage !== 'undefined' ? localStorage : undefined,
);

/**
 * Reactive view over the shared SavedSearchStore. Subscribes for re-render on
 * any change (mirrors the useToasts wrapper in toast.tsx).
 */
export function useSavedSearches() {
  const [saved, setSaved] = useState<SavedSearch[]>(sharedStore.getSaved());
  const [recent, setRecent] = useState<RecentSearch[]>(sharedStore.getRecent());

  useEffect(() => {
    const sync = () => {
      setSaved(sharedStore.getSaved());
      setRecent(sharedStore.getRecent());
    };
    // Catch up to any change between initial render and effect attach.
    sync();
    return sharedStore.subscribe(sync);
  }, []);

  const save = useCallback(
    (input: SearchValue & { name: string }) => sharedStore.save(input),
    [],
  );
  const rename = useCallback((id: string, name: string) => sharedStore.rename(id, name), []);
  const remove = useCallback((id: string) => sharedStore.delete(id), []);
  const recordRecent = useCallback((value: SearchValue) => sharedStore.recordRecent(value), []);
  const clearRecent = useCallback(() => sharedStore.clearRecent(), []);

  return { saved, recent, save, rename, remove, recordRecent, clearRecent } as const;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const triggerStyle = css({
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '28px', height: '28px', flexShrink: 0,
  borderRadius: 'md', border: '1px solid token(colors.border.subtle)',
  background: 'transparent', color: 'fg.dim', cursor: 'pointer',
  transition: 'all 0.15s ease',
  _hover: { background: 'surface.hover', color: 'fg.bright' },
});

const triggerActiveStyle = css({ color: 'yellow' });

const popoverStyle = css({
  position: 'fixed',
  zIndex: 200,
  width: '320px',
  background: 'surface.panel',
  border: '1px solid token(colors.border.strong)',
  borderRadius: 'lg',
  boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
  fontSize: 'md',
  fontFamily: 'mono',
  overflow: 'hidden',
  animation: 'fade-in 0.1s ease-out',
});

const sectionHeaderStyle = css({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  py: '2', px: '3',
  borderBottom: '1px solid token(colors.border.subtle)',
  fontSize: 'xs', fontWeight: '600',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  color: 'fg.dim',
});

const listStyle = css({ maxHeight: '200px', overflowY: 'auto' });

const itemStyle = css({
  display: 'flex', alignItems: 'center', gap: '2',
  py: '1.5', px: '3',
  cursor: 'pointer',
  transition: 'background 0.1s ease',
  _hover: { background: 'surface.hover' },
});

const itemMainStyle = css({
  flex: 1, minWidth: 0,
  display: 'flex', flexDirection: 'column', gap: '0.5',
});

const itemNameStyle = css({
  color: 'fg.bright',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
});

const itemQueryStyle = css({
  fontSize: 'xs', color: 'fg.dim',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
});

const itemActionStyle = css({
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'fg.dim', fontSize: 'xs', py: '0', px: '1', flexShrink: 0,
  _hover: { color: 'fg.bright' },
});

const itemDeleteStyle = css({
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'red', fontSize: 'xs', py: '0', px: '1', flexShrink: 0,
  _hover: { opacity: 0.7 },
});

const emptyHintStyle = css({ py: '2.5', px: '3', color: 'fg.dim', fontSize: 'sm' });

const saveRowStyle = css({
  display: 'flex', gap: '2', py: '2', px: '3',
  borderTop: '1px solid token(colors.border.subtle)',
});

const saveInputStyle = css({
  flex: 1, minWidth: 0,
  background: 'surface.bg', color: 'fg',
  border: '1px solid token(colors.border.subtle)', borderRadius: 'sm',
  fontFamily: 'mono', fontSize: 'sm', py: '1', px: '2', outline: 'none',
  _focus: { borderColor: 'accent' },
});

const saveBtnStyle = css({
  flexShrink: 0, cursor: 'pointer',
  background: 'accent', color: 'white',
  border: 'none', borderRadius: 'sm',
  fontFamily: 'mono', fontSize: 'sm', fontWeight: 500, py: '1', px: '3',
  _disabled: { opacity: 0.4, cursor: 'not-allowed' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarize(value: SearchValue): string {
  const parts: string[] = [];
  if (value.query.trim()) parts.push(value.query.trim());
  if (value.services.length > 0) parts.push(`services:${value.services.join(',')}`);
  return parts.join('  ') || '(empty)';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SavedSearchesProps {
  /** Current filter-bar query. */
  query: string;
  /** Current active services selection. */
  services: string[];
  /** Apply a saved/recent entry: restores both query and services. */
  onApply: (query: string, services: string[]) => void;
}

export function SavedSearches({ query, services, onApply }: SavedSearchesProps) {
  const { saved, recent, save, rename, remove, clearRecent } = useSavedSearches();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const hasCurrent = query.trim() !== '' || services.length > 0;

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const close = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open, updatePos]);

  const apply = (value: SearchValue) => {
    onApply(value.query, value.services);
    setOpen(false);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !hasCurrent) return;
    save({ name: trimmed, query, services });
    setName('');
  };

  const handleRename = (entry: SavedSearch) => {
    const next = window.prompt('Rename saved search', entry.name);
    if (next && next.trim()) rename(entry.id, next.trim());
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`${triggerStyle} ${saved.length > 0 ? triggerActiveStyle : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Saved & recent searches"
        aria-label="Saved and recent searches"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={saved.length > 0 ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>

      {open && (
        <div ref={popRef} className={popoverStyle} style={{ top: `${pos.top}px`, right: `${pos.right}px` }}>
          <div className={sectionHeaderStyle}><span>Saved</span></div>
          {saved.length === 0 ? (
            <div className={emptyHintStyle}>No saved searches yet.</div>
          ) : (
            <div className={listStyle}>
              {saved.map((entry) => (
                <div key={entry.id} className={itemStyle} onClick={() => apply(entry)} title={summarize(entry)}>
                  <div className={itemMainStyle}>
                    <span className={itemNameStyle}>{entry.name}</span>
                    <span className={itemQueryStyle}>{summarize(entry)}</span>
                  </div>
                  <button className={itemActionStyle} onClick={(e) => { e.stopPropagation(); handleRename(entry); }}>rename</button>
                  <button className={itemDeleteStyle} onClick={(e) => { e.stopPropagation(); remove(entry.id); }}>delete</button>
                </div>
              ))}
            </div>
          )}

          <div className={saveRowStyle}>
            <input
              className={saveInputStyle}
              type="text"
              placeholder={hasCurrent ? 'Name this search…' : 'Type a filter to save it'}
              value={name}
              disabled={!hasCurrent}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
            />
            <button className={saveBtnStyle} onClick={handleSave} disabled={!name.trim() || !hasCurrent}>Save</button>
          </div>

          <div className={sectionHeaderStyle}>
            <span>Recent</span>
            {recent.length > 0 && (
              <button className={itemActionStyle} onClick={(e) => { e.stopPropagation(); clearRecent(); }}>clear</button>
            )}
          </div>
          {recent.length === 0 ? (
            <div className={emptyHintStyle}>No recent searches.</div>
          ) : (
            <div className={listStyle}>
              {recent.map((entry: RecentSearch, i) => (
                <div key={i} className={itemStyle} onClick={() => apply(entry)} title={summarize(entry)}>
                  <div className={itemMainStyle}>
                    <span className={itemQueryStyle}>{summarize(entry)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
