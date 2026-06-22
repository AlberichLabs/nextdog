import { useEffect, useState } from 'preact/hooks';
import { css } from 'styled-system/css';

const shortcuts = [
  { key: 'j', desc: 'Next row' },
  { key: 'k', desc: 'Previous row' },
  { key: 'Enter', desc: 'Open trace / select' },
  { key: 'Esc', desc: 'Close / go back' },
  { key: '?', desc: 'Toggle this help' },
];

const overlayStyle = css({
  position: 'fixed',
  inset: '0',
  background: 'rgba(0,0,0,0.5)',
  zIndex: 1000,
});

const dialogStyle = css({
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  background: 'surface.panel',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'lg',
  py: '5',
  px: '6',
  zIndex: 1001,
  minWidth: '260px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
});

const titleStyle = css({
  fontSize: 'lg',
  fontWeight: '600',
  color: 'fg.bright',
  marginBottom: '3',
});

const rowStyle = css({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  py: '1',
  px: '0',
  fontSize: 'md',
});

const kbdStyle = css({
  background: 'surface.bg',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'sm',
  py: '0',
  px: '1',
  fontFamily: 'mono',
  fontSize: 'sm',
  color: 'fg.bright',
  minWidth: '20px',
  textAlign: 'center',
});

const footerStyle = css({
  marginTop: '3',
  fontSize: 'sm',
  color: 'fg.dim',
  textAlign: 'center',
});

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className={overlayStyle} onClick={() => setOpen(false)} />
      <div className={dialogStyle}>
        <div className={titleStyle}>Keyboard Shortcuts</div>
        {shortcuts.map(({ key, desc }) => (
          <div key={key} className={rowStyle}>
            <span className={css({ color: 'fg.dim' })}>{desc}</span>
            <kbd className={kbdStyle}>{key}</kbd>
          </div>
        ))}
        <div className={footerStyle}>
          Press <kbd className={kbdStyle}>?</kbd> to close
        </div>
      </div>
    </>
  );
}
