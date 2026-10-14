import { useEffect, useState } from 'react';
import { computeStats } from '../domain/stats';
import type { Player } from '../domain/types';
import { Dot, useApp } from './ui';

export function Players() {
  const { data, backend, run, busy, canWrite } = useApp();
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const showEmails = canWrite && backend.kind === 'supabase';

  useEffect(() => {
    if (showEmails) void backend.playerEmails().then(setEmails);
  }, [backend, showEmails, data]);

  const stats = computeStats(data.pauses);
  const players = [...data.players].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const add = async () => {
    const n = newName.trim().slice(0, 24);
    if (!n) return;
    if (await run(() => backend.addPlayer(n, newEmail.trim() || null), `${n} hinzugefügt`)) {
      setNewName('');
      setNewEmail('');
    }
  };

  return (
    <section className="card">
      <h2>Spieler</h2>
      {canWrite && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input id="np-main" type="text" maxLength={24} placeholder="Name" aria-label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          {showEmails && (
            <input id="np-mail" type="email" placeholder="E-Mail (optional)" aria-label="E-Mail für den Login" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          )}
          <button className="btn primary" disabled={busy || !newName.trim()}>Spieler hinzufügen</button>
        </form>
      )}
      {showEmails && (
        <p className="sub">
          Mit E-Mail kann sich der Spieler per Login-Link anmelden und selbst eintragen. Ohne E-Mail taucht er nur in der Statistik auf.
        </p>
      )}
      <div className="stack">
        {players.length === 0 && <p className="sub">Noch niemand eingetragen.</p>}
        {players.map((p) => (
          <PlayerRow key={p.id} p={p} email={emails[p.id]} showEmail={showEmails}
            info={stats[p.id] ? `${stats[p.id].pausen} Pausen · ${stats[p.id].runden} Runden` : 'noch nicht gespielt'} />
        ))}
      </div>
      <p className="sub">Ausgeblendete Spieler tauchen nicht mehr in der Auswahl auf, ihre Statistik bleibt erhalten.</p>
    </section>
  );
}

function PlayerRow({ p, email, showEmail, info }: { p: Player; email?: string; showEmail: boolean; info: string }) {
  const { backend, run, busy, canWrite } = useApp();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(p.name);
  const [mail, setMail] = useState(email ?? '');

  const save = async () => {
    const n = name.trim().slice(0, 24);
    if (!n) return;
    const ok = await run(async () => {
      if (n !== p.name) await backend.updatePlayer(p.id, { name: n });
      if (showEmail && mail.trim() !== (email ?? '')) await backend.setEmail(p.id, mail.trim() || null);
    }, 'Gespeichert');
    if (ok) setEdit(false);
  };

  if (edit)
    return (
      <form className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input id={`rn-${p.id}`} type="text" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
        {showEmail && <input id={`rm-${p.id}`} type="email" value={mail} placeholder="E-Mail (optional)" onChange={(e) => setMail(e.target.value)} aria-label="E-Mail" />}
        <button className="btn small primary" disabled={busy}>Speichern</button>
        <button type="button" className="btn small ghost" onClick={() => { setEdit(false); setName(p.name); setMail(email ?? ''); }}>Abbrechen</button>
      </form>
    );

  return (
    <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <span className="row">
        <Dot p={p.id} />
        <b>{p.name}</b>
        {p.hidden && <span className="tag">ausgeblendet</span>}
        {showEmail && (email ? <span className="tag">Login</span> : null)}
        <span className="sub">{info}</span>
      </span>
      {canWrite && (
        <span className="row">
          <button className="btn small ghost" onClick={() => { setMail(email ?? ''); setEdit(true); }}>Bearbeiten</button>
          <button className="btn small ghost" disabled={busy} onClick={() => void run(() => backend.updatePlayer(p.id, { hidden: !p.hidden }))}>
            {p.hidden ? 'Einblenden' : 'Ausblenden'}
          </button>
        </span>
      )}
    </div>
  );
}
