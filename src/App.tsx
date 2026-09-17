import { useEffect } from 'react';
import { useStore } from './hooks/useStore';
import { useTheme } from './hooks/useTheme';
import { store } from './lib/store';
import { Workspace } from './components/Workspace';

export function App() {
  const s = useStore();
  useTheme(s.settings.theme);
  useEffect(() => store.init(), []);
  return <Workspace />;
}
