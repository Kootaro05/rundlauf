import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { computeElo, ELO_START, podium, semesterElo, type Podium } from '../domain/elo';
import { fmtDate } from '../domain/periods';
import { computeDuels, computeStats, longestFinalStreak, pct } from '../domain/stats';
import { loadForCrop } from '../lib/image';
import { AvatarCropper } from './AvatarCropper';
import { LineChart } from './LineChart';
import { plural, useApp } from './ui';

/** Profilseite im E-Sport-Look. Nur für eingetragene Spieler. */
export function PlayerProfile({ p }: { p: string }) {
  const { data, isMember, closeProfile, name, realName, avatar, color, canEditPlayer } = useApp();
  // Semester-ELO = laufendes Semester (bestimmt die Platzierung), ELO = seit dem ersten Spiel
  const elo = useMemo(() => semesterElo(data.pauses), [data.pauses]);
  const eloAll = useMemo(() => computeElo(data.pauses), [data.pauses]);
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
  // Die drei Besten jeder Wertung: Rahmen in Gold, Silber, Bronze um das jeweilige Tag
  const topAll = podium(eloAll.rating);
  const topSem = podium(elo.rating);
  const rating = Math.round(elo.rating[p] ?? ELO_START);
  const ratingAll = Math.round(eloAll.rating[p] ?? ELO_START);
  const img = avatar(p);
  const real = realName(p);
  const history = eloAll.history[p] ?? [];

  const duels = computeDuels(data.pauses);
  const opponents = new Set([...Object.keys(duels[p] ?? {}), ...Object.keys(duels).filter((x) => duels[x][p])]);
  const bilanz = [...opponents].map((o) => ({ o, w: duels[p]?.[o] ?? 0, l: duels[o]?.[p] ?? 0 }));
  const liebling = [...bilanz].sort((a, b) => b.w - a.w || a.l - b.l)[0];
  const angst = [...bilanz].sort((a, b) => b.l - a.l || a.w - b.w)[0];

  return (
    <div className="stack">
      <div className="row between">
        {back}
        {canEditPlayer(p) && !editing && <button className="btn small" onClick={() => setEditing(true)}>Profil bearbeiten</button>}
      </div>

      <section className="hero" style={{ '--pc': color(p) } as CSSProperties}>
        {rank > 0 && <span className="hero-rank" aria-hidden="true">#{rank}</span>}
        <div className="hero-info">
          <div className="hero-top">
            <div className="hero-badges">
              {rank > 0 && <span className="hero-badge">Platz {rank} von {ranking.length}</span>}
              <span className={`hero-badge${ringClass(topSem[p])}`}>Semester-ELO {rating}</span>
              <span className={`hero-badge${ringClass(topAll[p])}`}>ELO {ratingAll}</span>
              {player.hidden && <span className="hero-badge">ausgeblendet</span>}
            </div>
            {/* ELO zusätzlich groß als Wasserzeichen, im selben Stil wie die Platzzahl rechts */}
            <div className="hero-elo" aria-hidden="true">
              <span className="v num">{ratingAll}</span>
              <span className="l">ELO</span>
            </div>
          </div>
          <div>
            <h2 className={`hero-nick ${name(p).length > 8 ? 'long' : ''}`}>{name(p)}</h2>
            {real && <p className="hero-real">{real}</p>}
          </div>
        </div>
        <div className="hero-art">
          {img ? <img src={img} alt={`Profilbild von ${name(p)}`} /> : <span className="hero-ghost" aria-hidden="true">{name(p).slice(0, 2)}</span>}
        </div>
      </section>

      {editing && <ProfileEditor p={p} hidden={player.hidden} onDone={() => setEditing(false)} />}

      {!s ? (
        <p className="sub">Noch keine Pause gespielt.</p>
      ) : (
        <>
          <div className="tiles">
            <Tile label="ELO" big={ratingAll} sub={`Bestwert aller Zeiten ${Math.round(eloAll.peak[p] ?? ELO_START)}`} />
            <Tile label="Semester-ELO" big={rating} sub={rank > 0 ? `Platz ${rank} von ${ranking.length} · Bestwert ${Math.round(elo.peak[p] ?? ELO_START)}` : 'In diesem Semester noch nicht gespielt'} />
            <Tile label="Kronen gesamt" big={s.netto} sub={`Ø ${(s.netto / s.pausen).toFixed(1).replace('.', ',')} pro Pause · beste Pause ${s.beste}`} />
            <Tile label="Siege" big={s.siege} sub={`${pct(s.siege, s.runden)} von ${plural(s.runden, 'Runde', 'Runden')} · ${s.siege} von ${s.finals} Finals`} />
            <Tile label="Längste Serie" big={longestFinalStreak(data.pauses, p)} sub="Finals am Stück gewonnen" />
          </div>
          <div className="card stack">
            <p className="sub">
              {plural(s.pausen, 'Pause', 'Pausen')} · Schwimmer in {pct(s.schwimmer, s.runden)} der Runden{s.bleiente > 0 && `, davon ${s.bleiente}× als Bleiente`} ·
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

const ringClass = (place?: Podium) => (place ? ` ring ${({ 1: 'gold', 2: 'silver', 3: 'bronze' } as const)[place]}` : '');

function Tile({ label, big, sub }: { label: string; big: number; sub: string }) {
  return (
    <div className="tile">
      <h3>{label}</h3>
      <div className="big num">{big}</div>
      <p className="sub">{sub}</p>
    </div>
  );
}

function ProfileEditor({ p, hidden, onDone }: { p: string; hidden: boolean; onDone: () => void }) {
  const { backend, run, busy, priv, refreshPrivate, name, session, toast, color, isAdmin, data } = useApp();
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const info = priv.info[p];
  const account = priv.accounts[p];
  const own = p === session?.playerId;
  const [nick, setNick] = useState(name(p));
  const [first, setFirst] = useState(info?.firstName ?? '');
  const [last, setLast] = useState(info?.lastName ?? '');
  const spokenBefore = data.players.find((x) => x.id === p)?.spoken ?? '';
  const [spoken, setSpoken] = useState(spokenBefore);
  // Liefert den gewählten Bildausschnitt, solange ein neues Bild im Zuschnitt-Rahmen liegt
  const cropRef = useRef<(() => Promise<Blob>) | null>(null);

  // Speichern übernimmt Namen und den gewählten Bildausschnitt in einem Schritt
  const save = async () => {
    const n = nick.trim().slice(0, 24);
    if (!n) return toast('Der Spitzname darf nicht leer sein.');
    const ok = await run(async () => {
      const sp = spoken.trim().slice(0, 60);
      await backend.saveProfile(p, {
        name: n, firstName: first.trim() || null, lastName: last.trim() || null,
        ...(sp !== spokenBefore.trim() ? { spoken: sp || null } : {}),
      });
      if (source && cropRef.current) await backend.uploadAvatar(p, await cropRef.current(), info?.avatarPath ?? null);
    }, 'Profil gespeichert');
    await refreshPrivate();
    if (ok) onDone();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setSource(await loadForCrop(file));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3>Profil bearbeiten</h3>
      <div className="formgrid">
        <label>Spitzname<input id="pf-nick" type="text" maxLength={24} value={nick} onChange={(e) => setNick(e.target.value)} /></label>
        <label>Vorname<input id="pf-first" type="text" maxLength={40} value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label>Nachname<input id="pf-last" type="text" maxLength={40} value={last} onChange={(e) => setLast(e.target.value)} /></label>
        <label>Aussprache<input id="pf-spoken" type="text" maxLength={60} value={spoken} placeholder={name(p)} onChange={(e) => setSpoken(e.target.value)} /></label>
      </div>
      <p className="sub">Aussprache: So liest der Kommentator im Tisch-Modus deinen Spitznamen vor, geschrieben wie gesprochen (z. B. „Flobbob null neun“). Leer lassen, wenn der Spitzname schon richtig klingt.</p>
      {own && account?.email && <p className="sub">Angemeldet mit {account.email}</p>}
      <p className="sub">Den Spitznamen sieht jeder. Vor- und Nachname und das Bild sehen nur angemeldete Spieler.</p>

      <div className="stack">
        <h3>Profilbild</h3>
        <p className="sub">Am besten ein Bild mit durchsichtigem Hintergrund (PNG oder WebP), dann steht die Figur frei im Profil. Danach wählst du den Ausschnitt; alle Bilder haben dasselbe Hochformat.</p>
        {source && <AvatarCropper source={source} color={color(p)} cropRef={cropRef} />}
        <div className="row">
          <label className="btn">
            {source || info?.avatarPath ? 'Anderes Bild wählen' : 'Bild wählen'}
            <input id="pf-img" type="file" accept="image/png,image/webp,image/jpeg" hidden disabled={busy}
              onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {info?.avatarPath && !source && (
            <button type="button" className="btn ghost" disabled={busy}
              onClick={() => void run(() => backend.removeAvatar(p, info.avatarPath!), 'Bild entfernt').then(refreshPrivate)}>
              Bild entfernen
            </button>
          )}
        </div>
      </div>

      {isAdmin && <div className="stack">
        <h3>Spielerauswahl (Admin)</h3>
        <div className="row">
          <button type="button" className="btn ghost" disabled={busy}
            onClick={() => void run(() => backend.setHidden(p, !hidden), hidden ? 'Wieder in der Spielerauswahl' : 'Aus der Spielerauswahl ausgeblendet')}>
            {hidden ? 'Wieder einblenden' : 'Ausblenden'}
          </button>
          <span className="sub">Ausgeblendete Spieler stehen nicht mehr in der Auswahl für neue Runden. Ihre Statistik bleibt.</span>
        </div>
      </div>}

      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Zurück</button>
      </div>
    </form>
  );
}
