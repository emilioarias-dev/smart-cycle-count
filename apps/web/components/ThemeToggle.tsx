'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

// Light / dark theme toggle (presentation only). Without a choice the page
// follows the system preference; a choice is stored in this browser and
// applied before the first paint by THEME_SCRIPT.

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'scc-theme';

export const THEME_SCRIPT = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') {
    return chosen;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  // Unknown on the server; read from the document once mounted.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
    // Follow system changes while the user has not chosen a theme.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(currentTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the theme still applies to this page.
    }
    setTheme(next);
  }

  // The icon shows the theme the button switches to; the accessible name says it.
  const target = theme === 'dark' ? 'light' : 'dark';
  const label = theme === null ? 'Theme' : `Switch to ${target} theme`;
  return (
    <button type="button" className="theme-toggle" onClick={toggle} disabled={theme === null} aria-label={label} title={label}>
      <Icon name={target === 'light' ? 'sun' : 'moon'} />
    </button>
  );
}
