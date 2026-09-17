import { useState, type FormEvent } from 'react';
import { useStore } from '../hooks/useStore';
import { store } from '../lib/store';

export function Login() {
  const { loadError } = useStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    const err = await store.login(key);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <main className="gate">
      <form className="gate__panel" onSubmit={submit} aria-labelledby="gate-title">
        <div className="gate__head">
          <span className="marker marker--running" aria-hidden="true" />
          <h1 id="gate-title" className="hdr__word" style={{ margin: 0, fontSize: 15 }}>LOOP</h1>
        </div>
        <div className="gate__body">
          <label className="gate__label" htmlFor="access-key">ACCESS KEY</label>
          <div className="gate__field">
            <input
              id="access-key"
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              required
              maxLength={512}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="gate__error" role="alert" aria-live="assertive">
            {error ?? (loadError && !error ? loadError : '')}
          </div>
          <button type="submit" className="gate__submit" disabled={busy || !key}>
            {busy ? 'UNLOCKING…' : 'UNLOCK'}
            <kbd>⏎</kbd>
          </button>
          <div className="gate__foot">PRIVATE WORKSPACE · WHAT HAVE YOU STARTED BUT NOT CLOSED?</div>
        </div>
      </form>
    </main>
  );
}
