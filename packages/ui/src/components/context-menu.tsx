import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { css } from 'styled-system/css';

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
  icon?: string;
  danger?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

let globalShowMenu: ((state: ContextMenuState) => void) | null = null;

/** Show the global context menu at given position with given actions */
export function showContextMenu(x: number, y: number, actions: ContextMenuAction[]) {
  globalShowMenu?.({ x, y, actions });
}

/** Convenience: build standard actions for an attribute key:value pair */
export function attrContextActions(
  key: string,
  value: string,
  opts: {
    onFilter: (q: string) => void;
    onAddColumn?: (attrKey: string) => void;
    onRemoveColumn?: (attrKey: string) => void;
    isColumnActive?: boolean;
  },
): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [
    {
      label: `Filter ${key}:${value}`,
      icon: '⊕',
      onClick: () => opts.onFilter(`${key}:${value}`),
    },
    {
      label: `Exclude ${key}:${value}`,
      icon: '⊖',
      onClick: () => opts.onFilter(`!${key}:${value}`),
    },
  ];

  if (opts.isColumnActive && opts.onRemoveColumn) {
    actions.push({
      label: `Hide "${key}" column`,
      icon: '◻',
      onClick: () => opts.onRemoveColumn!(key),
    });
  } else if (!opts.isColumnActive && opts.onAddColumn) {
    actions.push({
      label: `Show "${key}" as column`,
      icon: '◼',
      onClick: () => opts.onAddColumn!(key),
    });
  }

  return actions;
}

const menuStyle = css({
  position: 'fixed',
  zIndex: 1000,
  background: 'surface.panel',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'md',
  py: '1',
  px: '0',
  minWidth: '200px',
  maxWidth: '320px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  fontSize: 'md',
  fontFamily: 'mono',
});

const itemStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  py: '1',
  px: '3',
  cursor: 'pointer',
  color: 'fg',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  _hover: { background: 'accent', color: 'white' },
});

const dangerItemStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  py: '1',
  px: '3',
  cursor: 'pointer',
  color: 'red',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  _hover: { background: 'red', color: 'white' },
});

const iconStyle = css({
  width: '16px',
  textAlign: 'center',
  flexShrink: 0,
});

/** Global context menu container — render once in App */
export function ContextMenuContainer() {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    globalShowMenu = setState;
    return () => {
      globalShowMenu = null;
    };
  }, []);

  useEffect(() => {
    if (!state) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setState(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState(null);
    };
    window.addEventListener('click', handleClick, true);
    window.addEventListener('contextmenu', handleClick, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('contextmenu', handleClick, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [state]);

  const adjustedPos = useCallback((x: number, y: number) => {
    const menuWidth = 260;
    const menuHeight = 120;
    return {
      x: Math.min(x, window.innerWidth - menuWidth - 8),
      y: Math.min(y, window.innerHeight - menuHeight - 8),
    };
  }, []);

  if (!state) return null;

  const pos = adjustedPos(state.x, state.y);

  return (
    <div ref={menuRef} className={menuStyle} style={`left:${pos.x}px;top:${pos.y}px`}>
      {state.actions.map((action, i) => (
        <div
          key={i}
          className={action.danger ? dangerItemStyle : itemStyle}
          onClick={() => {
            action.onClick();
            setState(null);
          }}
        >
          {action.icon && <span className={iconStyle}>{action.icon}</span>}
          <span>{action.label}</span>
        </div>
      ))}
    </div>
  );
}
