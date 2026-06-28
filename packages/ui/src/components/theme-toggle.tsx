import { css } from 'styled-system/css';

const styles = {
  button: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: '1px solid token(colors.border.subtle)',
    borderRadius: 'sm',
    background: 'transparent',
    cursor: 'pointer',
    transition: 'background 0.15s',
    _hover: {
      background: 'surface.hover',
    },
  }),
  icon: css({
    fontSize: 'md',
  }),
};

interface ThemeToggleProps {
  theme: 'dark' | 'light' | 'system';
  onCycle: () => void;
}

export function ThemeToggle({ theme, onCycle }: ThemeToggleProps) {
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥';
  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <button
      type="button"
      className={styles.button}
      onClick={onCycle}
      title={`Theme: ${label} (click to change)`}
    >
      <span className={styles.icon}>{icon}</span>
    </button>
  );
}
