import { useMemo, useState, type CSSProperties } from 'react';
import { computeElo, ELO_START } from '../domain/elo';
import { fmtDate } from '../domain/periods';
import { computeDuels, computeStats, longestFinalStreak, pct } from '../domain/stats';
import { prepareAvatar } from '../lib/image';
import { LineChart } from './LineChart';
import { plural, useApp } from './ui';

/** Profilseite im E-Sport-Look. Nur für eingetragene Spieler. */
export function PlayerProfile({ p }: { p: string }) {
  const { data, isMember, closeProfile, name, realName, avatar, color, canEditPlayer, backend, run, busy } = useApp();
  const elo = useMemo(() => computeElo(data.pauses), [data.pauses]);
  const player = data.players.find((x) => x.id === p);
  const [editing, setEditing] = useState(false);

  const back = <button className="btn small ghost backbtn" onClick={closeProfile}>‹ Alle Spieler</button>;
  if (!isMember)
    return <section className="card">{back}<div className="empty"><b>Profile sehen nur angemeldete Spieler.</b><span>Melde dich oben rechts an.</span></div></section>;
  if (!player)
    return <section className="card">{back}<div className="empty"><b>Diesen Spieler gibt es nicht (mehr).</b></div></section>;

  const s = computeStats(data.pauses)[p];
  const ranking = Object.keys(elo.rating).sort((a, b) => elo.rating[b] - elo.rating[a]);
  const rank = ranking.indexOf(p) + 1;
  const rating = Math.round(elo.rating[p] ?? ELO_START);
  const img = avatar(p);
  const real = realName(p);
  const history = elo.history[p] ?? [];

  const duels = computeDuels(data.pauses);
  const opponents = new Set([...Object.keys(duels[p] ?? {}), ...Object.keys(duels).filter((x) => duels[x][p])]);
  const bilanz = [...opponents].map((o) => ({ o, w: duels[p]?.[o] ?? 0, l: duels[o]?.[p] ?? 0 }));
  const liebling = [...bilanz].sort((a, b) => b.w - a.w || a.l - b.l)[0];
  const angst = [...bilanz].sort((a, b) => b.l - a.l || a.w - b.w)[0];

  return (
    <div className="stack">
      <div className="row between">
        {back}
        <span className="row">
          <button className="btn small ghost" disabled={busy}
            onClick={() => void run(() => backend.setHidden(p, !player.hidden), player.hidden ? 'Wieder in der Spielerauswahl' : 'Aus der Spielerauswahl ausgeblendet')}>
            {player.hidden ? 'Einblenden' : 'Ausblenden'}
          </button>
          {canEditPlayer(p) && !editing && <button className="btn small" onClick={() => setEditing(true)}>Profil bearbeiten</button>}
        </span>
      </div>

      <section className="hero" style={{ '--pc': color(p) } as CSSProperties}>
        {rank > 0 && <span className="hero-rank" aria-hidden="true">#{rank}</span>}
        <div className="hero-info">
          <div className="hero-badges">
            {rank > 0 && <span className="hero-badge">Platz {rank} von {ranking.length}</span>}
            <span className="hero-badge">ELO {rating}</span>
            {player.hidden && <span className="hero-badge">ausgeblendet</span>}
          </div>
          <div>
            <h2 className="hero-nick">{name(p)}</h2>
            {real && <p className="hero-real">{real}</p>}
          </div>
        </div>
        <div className="hero-art">
          {img ? <img src={img} alt={`Profilbild von ${name(p)}`} /> : <span className="hero-ghost" aria-hidden="true">{name(p).slice(0, 2)}</span>}
        </div>
      </section>

      {editing && <ProfileEditor p={p} onDone={() => setEditing(false)} />}

      {!s ? (
        <p className="sub">Noch keine Pause gespielt.</p>
      ) : (
        <>
          <div className="tiles">
            <Tile label="ELO" big={rating} sub={`Bestwert ${Math.round(elo.peak[p] ?? ELO_START)}`} />
            <Tile label="Kronen gesamt" big={s.netto} sub={`Ø ${(s.netto / s.pausen).toFixed(1).replace('.', ',')} pro Pause · beste Pause ${s.beste}`} />
            <Tile label="Siege" big={s.siege} sub={`${pct(s.siege, s.runden)} von ${plural(s.runden, 'Runde', 'Runden')} · ${s.siege} von ${s.finals} Finals`} />
            <Tile label="Längste Serie" big={longestFinalStreak(data.pauses, p)} sub="Finals am Stück gewonnen" />
          </div>
          <div className="card stack">
            <p className="sub">
              {plural(s.pausen, 'Pause', 'Pausen')} · Schwimmer in {pct(s.schwimmer, s.runden)} der Runden ·
              als Erster raus in {pct(s.ersterRaus, s.runden)} · {plural(s.gesetzt, 'Krone', 'Kronen')} gesetzt ·
              {' '}{s.ass} {s.ass === 1 ? 'Ass' : 'Asse'} bei {plural(s.aufschlaege, 'Aufschlag', 'Aufschlägen')} · {plural(s.koenig, 'Pause', 'Pausen')} als König
            </p>
            {liebling?.w > 0 && <p className="sub">Lieblingsgegner: <b>{name(liebling.o)}</b>, im Finale {liebling.w}:{liebling.l}</p>}
            {angst?.l > 0 && <p className="sub">Angstgegner: <b>{name(angst.o)}</b>, im Finale {angst.w}:{angst.l}</p>}
            {history.length > 1 && (
              <LineChart
                title="ELO-Verlauf"
                ariaLabel={`ELO-Verlauf von ${name(p)}`}
                baseline={ELO_START}
                xLabels={history.map((h) => fmtDate(h.t).slice(0, 6))}
                series={[{ id: p, values: history.map((h) => h.r) }]}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, big, sub }: { label: string; big: number; sub: string }) {
  return (
    <div className="tile">
      <h3>{label}</h3>
      <div className="big num">{big}</div>
      <p className="sub">{sub}</p>
    </div>
  );
}

function ProfileEditor({ p, onDone }: { p: string; onDone: () => void }) {
  const { backend, run, busy, priv, refreshPrivate, name, session, toast } = useApp();
  const info = priv.info[p];
  const account = priv.accounts[p];
  const own = p === session?.playerId;
  const [nick, setNick] = useState(name(p));
  const [first, setFirst] = useState(info?.firstName ?? '');
  const [last, setLast] = useState(info?.lastName ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [uploading, setUploading] = useState(false);

  const save = async () => {
    const n = nick.trim().slice(0, 24);
    if (!n) return toast('Der Spitzname darf nicht leer sein.');
    const ok = await run(async () => {
      await backend.saveProfile(p, { name: n, firstName: first.trim() || null, lastName: last.trim() || null });
      // Die Login-E-Mail lässt sich nur ändern, solange sich der Spieler noch nie angemeldet hat
      if (!account?.linked && email.trim() !== (account?.email ?? '')) await backend.setEmail(p, email.trim() || null);
    }, 'Profil gespeichert');
    await refreshPrivate();
    if (ok) onDone();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const image = await prepareAvatar(file);
      await run(() => backend.uploadAvatar(p, image, info?.avatarPath ?? null), 'Bild gespeichert');
      await refreshPrivate();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3>Profil bearbeiten</h3>
      <div className="formgrid">
        <label>Spitzname<input id="pf-nick" type="text" maxLength={24} value={nick} onChange={(e) => setNick(e.target.value)} /></label>
        <label>Vorname<input id="pf-first" type="text" maxLength={40} value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label>Nachname<input id="pf-last" type="text" maxLength={40} value={last} onChange={(e) => setLast(e.target.value)} /></label>
        {backend.kind === 'supabase' && (account?.linked ? (
          own && <p className="sub">Angemeldet mit {account.email}</p>
        ) : (
          <label>Login-E-Mail<input id="pf-mail" type="email" placeholder="optional" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        ))}
      </div>
      <p className="sub">Den Spitznamen sieht jeder. Vor- und Nachname und das Bild sehen nur angemeldete Spieler.</p>

      <div className="stack">
        <h3>Profilbild</h3>
        <p className="sub">Am besten ein Bild mit durchsichtigem Hintergrund (PNG oder WebP), dann steht die Figur frei im Profil. Ein durchsichtiger Rand wird automatisch abgeschnitten.</p>
        <div className="row">
          <label className="btn">
            {uploading ? 'Lade hoch …' : info?.avatarPath ? 'Anderes Bild wählen' : 'Bild wählen'}
            <input id="pf-img" type="file" accept="image/png,image/webp,image/jpeg" hidden disabled={uploading || busy}
              onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {info?.avatarPath && (
            <button type="button" className="btn ghost" disabled={busy || uploading}
              onClick={() => void run(() => backend.removeAvatar(p, info.avatarPath!), 'Bild entfernt').then(refreshPrivate)}>
              Bild entfernen
            </button>
          )}
        </div>
      </div>

      <div className="row">
        <button className="btn primary" disabled={busy}>Speichern</button>
        <button type="button" className="btn ghost" onClick={onDone}>Abbrechen</button>
      </div>
    </form>
  );
}
