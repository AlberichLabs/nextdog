import { useEffect, useState } from 'preact/hooks';

type Theme = 'dark' | 'light' | 'system';

/** Narrow an arbitrary localStorage string to a known Theme, defaulting to 'system'. */
function parseTheme(value: string | null): Theme {
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getEffective(theme: Theme): 'dark' | 'light' {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return parseTheme(localStorage.getItem('nextdog-theme'));
  });

  const effective = getEffective(theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effective);
  }, [effective]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => document.documentElement.setAttribute('data-theme', getSystemTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('nextdog-theme', t);
  };

  const cycle = () => {
    const next: Theme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  };

  return { theme, effective, setTheme, cycle };
}
