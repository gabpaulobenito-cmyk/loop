import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/saira-condensed/500.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import './styles/app.css';
import { App } from './App';
import { applyTheme } from './hooks/useTheme';
import type { ThemePref } from '../shared/types';

// Apply the cached theme before first paint to avoid a flash.
try {
  const t = localStorage.getItem('loop.theme') as ThemePref | null;
  applyTheme(t === 'light' || t === 'system' ? t : 'dark');
} catch {
  applyTheme('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
