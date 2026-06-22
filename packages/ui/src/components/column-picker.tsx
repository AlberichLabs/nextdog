import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';

interface ColumnDef {
  id: string;
  label: string;
  attrKey: string;
}

interface ColumnPickerProps {
  customColumns: ColumnDef[];
  availableAttrs: string[];
  onAdd: (attrKey: string) => void;
  onRemove: (id: string) => void;
}

const popoverStyle = css({
  position: 'fixed',
  zIndex: 200,
  width: '280px',
  background: 'surface.panel',
  border: '1px solid token(colors.border.strong)',
  borderRadius: 'lg',
  boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
  fontSize: 'md',
  fontFamily: 'mono',
  overflow: 'hidden',
  animation: 'fade-in 0.1s ease-out',
});

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  py: '2',
  px: '3',
  borderBottom: '1px solid token(colors.border.subtle)',
  fontSize: 'sm',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'fg.dim',
});

const activeItemStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  py: '1',
  px: '3',
});

const listItemStyle = css({
  py: '1.5',
  px: '3',
  cursor: 'pointer',
  transition: 'background 0.1s ease',
  _hover: { background: 'surface.hover' },
});

export function ColumnPicker({
  customColumns,
  availableAttrs,
  onAdd,
  onRemove,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, []);

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
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open, updatePos]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className={css({
          fontSize: 'sm',
          fontFamily: 'mono',
          py: '1',
          px: '2',
          borderRadius: 'md',
          border: '1px solid token(colors.border.subtle)',
          background: 'transparent',
          color: 'fg',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          _hover: { background: 'surface.hover' },
        })}
      >
        + Column
      </button>

      {open && (
        <div
          ref={popRef}
          className={popoverStyle}
          style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
        >
          <div className={headerStyle}>
            <span>Add column</span>
            <button
              onClick={() => setOpen(false)}
              className={css({
                background: 'none',
                border: 'none',
                color: 'fg.dim',
                cursor: 'pointer',
                fontSize: 'lg',
                lineHeight: '1',
                _hover: { color: 'fg.bright' },
              })}
            >
              ×
            </button>
          </div>

          {customColumns.length > 0 && (
            <div
              className={css({
                py: '1',
                px: '0',
                borderBottom: '1px solid token(colors.border.subtle)',
              })}
            >
              <div
                className={css({
                  fontSize: 'xs',
                  color: 'fg.dim',
                  py: '0',
                  px: '3',
                  marginBottom: '0.5',
                })}
              >
                Active:
              </div>
              {customColumns.map((col) => (
                <div key={col.id} className={activeItemStyle}>
                  <span className={css({ fontSize: 'sm' })}>{col.attrKey}</span>
                  <button
                    onClick={() => onRemove(col.id)}
                    className={css({
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'red',
                      fontSize: 'sm',
                      py: '0',
                      px: '1',
                      _hover: { opacity: 0.7 },
                    })}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={css({ maxHeight: '240px', overflowY: 'auto' })}>
            {availableAttrs.length === 0 ? (
              <div className={css({ py: '3', px: '3', color: 'fg.dim', textAlign: 'center' })}>
                No more attributes available
              </div>
            ) : (
              availableAttrs.map((attr) => (
                <div
                  key={attr}
                  onClick={() => {
                    onAdd(attr);
                    setOpen(false);
                  }}
                  className={listItemStyle}
                >
                  {attr}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
