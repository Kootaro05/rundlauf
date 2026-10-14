import { useEffect, useState } from 'react';
import type { Backend, InviteInfo, Session } from '../lib/backend';
import { redeemPendingInvite, savePendingInvite } from '../lib/invite';

/**
 * Einladungsseite (#/einladung/<code>): Der Eingeladene gibt E-Mail, Spitzname und Namen ein,
 * bestätigt mit dem Code aus der Mail und ist danach mit seinem Spieler verknüpft.
 */
export function InvitePage({ token, backend, session, onDone, onLeave }: {
  token: string;
  backend: Backend;
  session: Session | null;
  onDone: (playerId: string) => void | Promise<void>;
  onLeave: () => void;
}) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [email, setEmail] = useState('');
  const [nick, setNick] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.inviteInfo(token).then((i) => {
      setInfo(i);
      if (i.playerName) setNick(i.playerName);
    }, (e: unknown) => setInfo({ playerName: null, valid: false, reason: e instanceof Error ? e.message : String(e) }));
  }, [backend, token]);

  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remember = () =>
    savePendingInvite({ token, profile: { name: nick.trim().slice(0, 24), firstName: first.trim() || null, lastName: last.trim() || null } });

  const finish = async () => {
    await redeemPendingInvite(backend);
    const s = await backend.auth.current();
    await onDone(s?.playerId ?? '');
  };

  const card = (body: React.ReactNode) => (
    <section className="card invite">
      <h2>Einladung</h2>
      {body}
    </section>
  );

  if (!info) return card(<p className="sub">Prüfe den Einladungslink …</p>);
  if (!info.valid)
    return card(
      <>
        <p>{info.reason}</p>
        <p className="sub">Frag den Admin nach einem neuen Link.</p>
        <div className="row"><button className="btn" onClick={onLeave}>Zur App</button></div>
      </>,
    );
  if (session?.playerId)
    return card(
      <>
        <p>Du bist schon mit einem Spieler angemeldet. Diese Einladung ist für jemand anderen.</p>
        <p className="sub">Wenn das ein Versehen ist: oben rechts abmelden und den Link nochmal öffnen.</p>
        <div className="row"><button className="btn" onClick={onLeave}>Zur App</button></div>
      </>,
    );

  const nameFields = (
    <div className="formgrid">
      <label>Spitzname<input id="inv-nick" type="text" maxLength={24} required value={nick} onChange={(e) => setNick(e.target.value)} /></label>
      <label>Vorname<input id="inv-first" type="text" maxLength={40} value={first} onChange={(e) => setFirst(e.target.value)} /></label>
      <label>Nachname<input id="inv-last" type="text" maxLength={40} value={last} onChange={(e) => setLast(e.target.value)} /></label>
    </div>
  );

  return card(
    <>
      <p>Du wirst als <b>{info.playerName}</b> zu Rundlauf-Analytics eingeladen. Bisherige Runden unter diesem Namen gehören dann dir.</p>
      {session ? (
        // Schon angemeldet, aber noch ohne Spieler: direkt annehmen
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { remember(); await finish(); }); }}>
          {nameFields}
          <div className="row"><button className="btn primary" disabled={busy || !nick.trim()}>Einladung annehmen</button></div>
        </form>
      ) : step === 'form' ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            remember();
            await backend.auth.signIn(email.trim());
            setStep('code');
          });
        }}>
          {nameFields}
          <label className="formgrid-full">E-Mail für den Login
            <input id="inv-mail" type="email" required autoComplete="email" placeholder="name@uni.de" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <p className="sub">Den Spitznamen sieht jeder, Vor- und Nachname nur angemeldete Spieler. Du bekommst gleich eine Mail mit einem Code.</p>
          <div className="row"><button className="btn primary" disabled={busy || !nick.trim() || !email.includes('@')}>{busy ? 'Sende …' : 'Code schicken'}</button></div>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            await backend.auth.verifyCode(email.trim(), code.trim());
            await finish();
          });
        }}>
          <p className="sub">Mail an <b>{email}</b> ist unterwegs. Gib den Code ein (oder öffne den Link aus der Mail in diesem Browser).</p>
          <div className="row">
            <input id="inv-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="123456"
              aria-label="Code aus der Mail" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ fontFamily: 'var(--f-mono)', letterSpacing: '.2em', width: '10ch' }} />
            <button className="btn primary" disabled={busy || !/^\d{6,10}$/.test(code)}>{busy ? 'Prüfe …' : 'Einrichten'}</button>
            <button type="button" className="btn ghost" onClick={() => { setStep('form'); setCode(''); }}>Zurück</button>
          </div>
        </form>
      )}
      {error && <p className="sub" style={{ color: 'var(--danger)' }}>{error}</p>}
    </>,
  );
}
