import { useEffect, useRef, useState } from 'react';
import { computeStats } from '../domain/stats';
import { PlayerProfile } from './PlayerProfile';
import { Avatar, useApp } from './ui';

/** Rubrik Spieler: Liste, oder mit `profile` die Profilseite des Spielers. Beim Wechsel gleitet die Seite herein. */
export function Players({ profile }: { profile: string | null }) {
  // Richtung merken: ins Profil von rechts, zurück zur Liste von links
  const last = useRef(profile);
  const dir = profile ? 'from-right' : last.current ? 'from-left' : '';
  useEffect(() => {
    last.current = profile;
  }, [profile]);

  return (
    <div key={profile ?? 'liste'} className={`slide ${dir}`}>
      {profile ? <PlayerProfile p={profile} /> : <PlayerList />}
    </div>
  );
}

function PlayerList() {
  const { data, backend, run, busy, canWrite, isMember, priv, openProfile, realName, name } = useApp();
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const stats = computeStats(data.pauses);
  const players = [...data.players].sort((a, b) => a.hidden === b.hidden ? a.name.localeCompare(b.name, 'de') : a.hidden ? 1 : -1);

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
          <input id="np-main" type="text" maxLength={24} placeholder="Spitzname" aria-label="Spitzname" value={newName} onChange={(e) => setNewName(e.target.value)} />
          {backend.kind === 'supabase' && (
            <input id="np-mail" type="email" placeholder="E-Mail (optional)" aria-label="E-Mail für den Login" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          )}
          <button className="btn primary" disabled={busy || !newName.trim()}>Spieler hinzufügen</button>
        </form>
      )}
      {canWrite && backend.kind === 'supabase' && (
        <p className="sub">Mit E-Mail kann sich der Spieler anmelden, selbst eintragen und sein Profil pflegen. Echten Namen und Bild ergänzt man im Profil.</p>
      )}
      {!isMember && <p className="sub">Profile mit echten Namen und Bildern sehen nur angemeldete Spieler.</p>}

      <div className="plist-players">
        {players.length === 0 && <p className="sub">Noch niemand eingetragen.</p>}
        {players.map((p) => {
          const s = stats[p.id];
          const info = s ? `${s.pausen} Pausen · ${s.runden} Runden` : 'noch nicht gespielt';
          const content = (
            <>
              <Avatar p={p.id} size={44} />
              <span className="pinfo">
                <span className="row">
                  <b>{name(p.id)}</b>
                  {p.hidden && <span className="tag">ausgeblendet</span>}
                  {isMember && priv.accounts[p.id]?.linked && <span className="tag">Login</span>}
                </span>
                <span className="sub">{[realName(p.id), info].filter(Boolean).join(' · ')}</span>
              </span>
              {isMember && <span className="chev" aria-hidden="true">›</span>}
            </>
          );
          return isMember ? (
            <button key={p.id} className="prow" onClick={() => openProfile(p.id)}>{content}</button>
          ) : (
            <div key={p.id} className="prow">{content}</div>
          );
        })}
      </div>
    </section>
  );
}
