import { useEffect } from 'react';
import { useStore } from './hooks/useStore';
import { useTheme } from './hooks/useTheme';
import { store } from './lib/store';
import { Login } from './components/Login';
import { Workspace } from './components/Workspace';

export function App() {
  const s = useStore();
  useTheme(s.settings.theme);
  useEffect(() => store.init(), []);

  if (s.auth === 'checking') {
    return (
      <div className="boot" role="status">
        LOOP…
      </div>
    );
  }
  if (s.auth === 'signed-out') return <Login />;
  return <Workspace />;
}
