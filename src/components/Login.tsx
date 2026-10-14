import { useState } from 'react';
import type { Backend } from '../lib/backend';

/** Login per Mail: Code eingeben (funktioniert überall) oder Link öffnen (nur im selben Browser). */
export function LoginForm({ backend, onClose }: { backend: Backend; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attempt = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = () => attempt(() => backend.auth.signIn(email.trim()), () => setStep('code'));
  const verify = () => attempt(() => backend.auth.verifyCode(email.trim(), code.trim()), onClose);
  const codeOk = /^\d{6,10}$/.test(code.trim());

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void (step === 'email' ? send() : verify());
      }}
    >
      <div className="stack">
        <h2>Anmelden</h2>
        <p className="sub">
          {step === 'email'
            ? 'Du bekommst eine Mail mit einem Code. Eintragen kann, wessen E-Mail bei einem Spieler hinterlegt ist.'
            : <>Mail an <b>{email}</b> ist unterwegs. Gib den Code aus der Mail ein. Den Link kannst du auch öffnen, aber nur im selben Browser, nicht in der installierten App.</>}
        </p>
      </div>
      {step === 'email' ? (
        <div className="row">
          <input id="login-mail" type="email" required autoComplete="email" placeholder="name@uni.de" aria-label="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" disabled={busy || !email.includes('@')}>{busy ? 'Sende …' : 'Code schicken'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Abbrechen</button>
        </div>
      ) : (
        <div className="row">
          <input
            id="login-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
            placeholder="123456" aria-label="Code aus der Mail" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ fontFamily: 'var(--f-mono)', letterSpacing: '.2em', width: '10ch' }}
          />
          <button className="btn primary" disabled={busy || !codeOk}>{busy ? 'Prüfe …' : 'Anmelden'}</button>
          <button type="button" className="btn ghost" onClick={() => { setStep('email'); setCode(''); setError(null); }}>Andere E-Mail</button>
        </div>
      )}
      {error && <p className="sub" style={{ color: 'var(--danger)' }}>{error}</p>}
    </form>
  );
}
