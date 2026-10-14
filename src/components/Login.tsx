import { useState } from 'react';
import type { Backend } from '../lib/backend';

/** Formular für den Magic Link. */
export function LoginForm({ backend, onClose }: { backend: Backend; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState('sending');
    setError(null);
    try {
      await backend.auth.signIn(email.trim());
      setState('sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  };

  if (state === 'sent')
    return (
      <div className="banner">
        <span>Login-Link an <b>{email}</b> geschickt. Öffne ihn auf diesem Gerät, dann bist du angemeldet.</span>
        <button className="btn small" onClick={onClose}>OK</button>
      </div>
    );

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <div className="stack">
        <h2>Anmelden</h2>
        <p className="sub">Du bekommst einen Login-Link per E-Mail. Eintragen kann, wessen E-Mail bei einem Spieler hinterlegt ist.</p>
      </div>
      <div className="row">
        <input id="login-mail" type="email" required placeholder="name@uni.de" aria-label="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn primary" disabled={state === 'sending' || !email.includes('@')}>
          {state === 'sending' ? 'Sende …' : 'Link schicken'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>Abbrechen</button>
      </div>
      {error && <p className="sub" style={{ color: 'var(--danger)' }}>{error}</p>}
    </form>
  );
}
