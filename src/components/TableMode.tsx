import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { balances, crownCheck, currentRound, kingOf, nextSeq, openPause, roundInfo, serveRule } from '../domain/game';
import type { NewEvent, Pause, Round } from '../domain/types';
import { CrownIcon, WaveIcon, plural, useApp } from './ui';

/** So lange bleibt die Wahl "Krone oder raus" offen, wenn niemand tippt */
const CHOICE_TIMEOUT = 5000;
/** Nach einem Eintrag ist die Kachel kurz gesperrt, damit ein Doppeltipp nichts doppelt einträgt */
const TAP_LOCK = 800;

/**
 * Tisch-Modus (#/tisch): Vollbild für Laptop oder Tablet am Tischrand. Nur große Kacheln zum
 * Antippen; nach jedem Finale startet automatisch die nächste Runde mit denselben Spielern.
 * Pause starten/beenden und Spieler ändern bleiben in der normalen Ansicht.
 */
export function TableMode({ onExit }: { onExit: () => void }) {
  const { data, backend, run, canWrite } = useApp();
  const pa = openPause(data.pauses);
  const r = currentRound(pa);
  const [celebrate, setCelebrate] = useState<{ p: string; pot: number } | null>(null);
  const starting = useRef(false);

  useWakeLock();

  const startRound = useCallback(async (pause: Pause, participants: string[]) => {
    if (starting.current || participants.length < 2) return;
    starting.current = true;
    try {
      await run(() => backend.startRound(pause.id, participants));
    } finally {
      starting.current = false;
    }
  }, [run, backend]);

  const lastParticipants = (pause: Pause) => pause.rounds.at(-1)?.participants ?? pause.participants;

  // Beim Öffnen: läuft keine Runde, eine mit den Spielern der letzten Runde starten
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current || !pa || !canWrite) return;
    entered.current = true;
    if (!currentRound(pa)) void startRound(pa, lastParticipants(pa));
  }, [pa, canWrite, startRound]);

  // Schließen: eine noch leere Runde wird abgebrochen, sonst läuft sie in der normalen Ansicht weiter
  const exit = async () => {
    const cur = currentRound(pa);
    if (cur && cur.events.length === 0) await run(() => backend.deleteRound(cur.id), 'Leere Runde abgebrochen');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onExit();
  };

  const afterFinal = async (pause: Pause, round: Round, winner: string, pot: number) => {
    setCelebrate({ p: winner, pot });
    window.setTimeout(() => setCelebrate(null), 2600);
    await startRound(pause, round.participants);
  };

  let body: React.ReactNode;
  if (!canWrite) body = <Notice text="Zum Eintragen bitte in der normalen Ansicht anmelden." onExit={exit} />;
  else if (!pa) body = <Notice text="Gerade läuft keine Pause. Starte sie in der normalen Ansicht." onExit={exit} />;
  else if (!r)
    body = (
      <div className="tm-center">
        <button className="tm-big" onClick={() => void startRound(pa, lastParticipants(pa))}>Nächste Runde starten</button>
        <p className="tm-sub">{plural(lastParticipants(pa).length, 'Spieler', 'Spieler')} wie zuletzt. Spieler ändern geht in der normalen Ansicht.</p>
      </div>
    );
  else if (roundInfo(r).active.length <= 2) body = <FinalView key={r.id} pa={pa} r={r} onWon={(w, pot) => void afterFinal(pa, r, w, pot)} />;
  else body = <RoundView key={r.id} pa={pa} r={r} />;

  return (
    <div className="tm">
      <TopBar pa={pa} r={r} onExit={() => void exit()} />
      <div className="tm-body">{body}</div>
      {celebrate && <Celebration {...celebrate} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TopBar({ pa, r, onExit }: { pa: Pause | null; r: Round | null; onExit: () => void }) {
  const { undo, redo, redoNext, busy, run, backend, name } = useApp();
  const last = pa?.rounds.at(-1);
  const prev = pa?.rounds.at(-2);
  // Direkt nach einem Finale ist die neue Runde noch leer: "Rückgängig" meint dann das Finale
  const freshRound = !!last && last.events.length === 0 && !!prev;
  const lastEvent = freshRound ? prev!.events.at(-1) : last?.events.at(-1);

  const doUndo = () => {
    if (!pa) return;
    if (freshRound) {
      // Automatisch gestartete leere Runde verwerfen und das Finale davor zurücknehmen
      void run(async () => {
        await backend.deleteRound(last!.id);
        await backend.undo({ ...pa, rounds: pa.rounds.slice(0, -1) });
      }, 'Finale zurückgenommen');
    } else undo(pa);
  };

  return (
    <header className="tm-top">
      <div className="tm-round">
        {r ? <>Runde {r.number} <span className="tm-pot"><CrownIcon /> {roundInfo(r).pot}</span></> : 'Tisch-Modus'}
      </div>
      <div className="tm-actions">
        {lastEvent && (
          <button className="tm-undo" disabled={busy} onClick={doUndo}>
            ↶ Rückgängig <span>{describe(lastEvent, name)}</span>
          </button>
        )}
        {redoNext && !freshRound && (
          <button className="tm-undo" disabled={busy} onClick={redo}>↷ <span>{describe(redoNext, name)}</span></button>
        )}
      </div>
      <button className="tm-exit" aria-label="Tisch-Modus schließen" onClick={onExit}>✕</button>
    </header>
  );
}

function describe(e: Pick<NewEvent, 'type' | 'p'>, name: (id: string) => string) {
  switch (e.type) {
    case 'schwimmer': return `${name(e.p)}: Schwimmer`;
    case 'crown': return `${name(e.p)}: Krone`;
    case 'out': return `${name(e.p)}: raus`;
    case 'final': return `Finale ${name(e.p)}`;
  }
}

// ---------------------------------------------------------------------------

function RoundView({ pa, r }: { pa: Pause; r: Round }) {
  const { addEvent, name } = useApp();
  const i = roundInfo(r);
  const b = balances(pa);
  const king = kingOf(b);
  const [choice, setChoice] = useState<string | null>(null);
  const lockUntil = useRef(0);

  // Die Wahl "Krone oder raus" klappt nach ein paar Sekunden ohne Tipp wieder zu
  useEffect(() => {
    if (!choice) return;
    const t = window.setTimeout(() => setChoice(null), CHOICE_TIMEOUT);
    return () => window.clearTimeout(t);
  }, [choice]);

  const add = (ev: NewEvent, ok: string) => {
    lockUntil.current = Date.now() + TAP_LOCK;
    setChoice(null);
    void addEvent(r.id, nextSeq(r), ev, ok);
  };

  const tap = (p: string) => {
    if (Date.now() < lockUntil.current) return;
    if (!i.schwimmer) return add({ type: 'schwimmer', p }, `${name(p)} bekommt den Schwimmer`);
    if (!crownCheck(pa, r, p).ok) return add({ type: 'out', p }, `${name(p)} fliegt raus`);
    setChoice(choice === p ? null : p);
  };

  const n = i.active.length;
  const cols = n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;

  return (
    <div className="tm-round-view">
      <div className="tm-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {i.active.map((p) => {
          const c = choice === p ? crownCheck(pa, r, p) : null;
          return c && c.ok ? (
            <div key={p} className="tm-tile tm-choice">
              <button className="tm-crown" onClick={() => add({ type: 'crown', p }, `${name(p)} setzt eine Krone`)}>
                <span className="tm-crown-icon"><CrownIcon /></span>
                <span className="tm-choice-label">Krone setzen</span>
                <span className="tm-sub">{name(p)} · noch {c.left}{c.king ? ' · König' : ''}</span>
              </button>
              <button className="tm-out" onClick={() => add({ type: 'out', p }, `${name(p)} fliegt raus`)}>
                <span className="tm-choice-label">Raus</span>
                <span className="tm-sub">{name(p)}</span>
              </button>
            </div>
          ) : (
            <PlayerTile key={p} p={p} crowns={b[p] ?? 0} king={p === king} schwimmer={i.schwimmer === p}
              setThisRound={i.crowns[p] ?? 0} hint={!i.schwimmer ? 'Schwimmer' : crownCheck(pa, r, p).ok ? 'Krone oder raus' : 'raus'}
              onTap={() => tap(p)} />
          );
        })}
      </div>
      {i.out.length > 0 && (
        <div className="tm-out-strip">
          <span>Raus:</span>
          {i.out.map((p, k) => <span key={p} className="tm-out-chip">{k + 1}. {name(p)}</span>)}
        </div>
      )}
    </div>
  );
}

function PlayerTile({ p, crowns, king, schwimmer, setThisRound, hint, onTap, badge }: {
  p: string; crowns: number; king: boolean; schwimmer: boolean; setThisRound: number; hint?: string; onTap: () => void; badge?: string;
}) {
  const { name, avatar, color, busy } = useApp();
  const img = avatar(p);
  return (
    <button className="tm-tile tm-player" style={{ '--pc': color(p) } as CSSProperties} onClick={onTap} disabled={busy}>
      <span className="tm-art">{img ? <img src={img} alt="" /> : <span className="tm-ghost">{name(p).slice(0, 2)}</span>}</span>
      <span className="tm-info">
        <span className="tm-tags">
          {badge && <span className="tm-tag tm-tag-hot">{badge}</span>}
          {king && <span className="tm-tag tm-tag-gold"><CrownIcon /> König</span>}
          {schwimmer && <span className="tm-tag"><WaveIcon /> Schwimmer</span>}
          {setThisRound > 0 && <span className="tm-tag tm-tag-gold">×{setThisRound} gesetzt</span>}
        </span>
        <span className="tm-name">{name(p)}</span>
        <span className="tm-crowns"><CrownIcon /> {crowns}{hint && <span className="tm-hint"> · Tipp: {hint}</span>}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function FinalView({ pa, r, onWon }: { pa: Pause; r: Round; onWon: (winner: string, pot: number) => void }) {
  const { addEvent, name } = useApp();
  const rule = serveRule(pa, r);
  const i = roundInfo(r);
  const b = balances(pa);
  const king = kingOf(b);
  const [picked, setPicked] = useState<string | null>(null);
  const lockUntil = useRef(0);
  if (!rule) return null;
  const tie = rule.server === null;
  const server = rule.server ?? picked;
  const askServe = tie && !picked;

  const tap = async (p: string) => {
    if (Date.now() < lockUntil.current) return;
    lockUntil.current = Date.now() + TAP_LOCK;
    if (askServe) return setPicked(p);
    const loser = p === rule.a ? rule.b : rule.a;
    const ok = await addEvent(r.id, nextSeq(r), { type: 'final', p, loser, server, pot: i.pot }, `${name(p)} gewinnt ${plural(i.pot, 'Krone', 'Kronen')}`);
    if (ok) onWon(p, i.pot);
  };

  return (
    <div className="tm-final">
      <div className="tm-final-head">
        <span className="tm-final-title">Finale · {plural(i.pot, 'Krone', 'Kronen')} im Pot</span>
        <span className="tm-final-ask">
          {askServe ? 'Gleichstand: Angabe ausspielen. Wer hat sie gewonnen?' : 'Wer hat das Finale gewonnen?'}
        </span>
      </div>
      <div className="tm-final-grid">
        {[rule.a, rule.b].map((p) => (
          <PlayerTile key={p} p={p} crowns={b[p] ?? 0} king={p === king} schwimmer={false} setThisRound={0}
            badge={server === p ? 'schlägt auf' : undefined} onTap={() => void tap(p)} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Celebration({ p, pot }: { p: string; pot: number }) {
  const { name, avatar, color } = useApp();
  const img = avatar(p);
  return (
    <div className="tm-celebrate" style={{ '--pc': color(p) } as CSSProperties} role="status">
      <div className="tm-celebrate-card">
        <span className="tm-celebrate-crown"><CrownIcon /></span>
        {img && <img src={img} alt="" />}
        <span className="tm-name">{name(p)}</span>
        <span className="tm-celebrate-pot">+{pot} <CrownIcon /></span>
      </div>
    </div>
  );
}

function Notice({ text, onExit }: { text: string; onExit: () => void }) {
  return (
    <div className="tm-center">
      <p className="tm-sub">{text}</p>
      <button className="tm-big" onClick={onExit}>Zur normalen Ansicht</button>
    </div>
  );
}

/** Bildschirm bleibt an, solange der Tisch-Modus offen ist (wo der Browser es erlaubt) */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch { /* nicht erlaubt oder nicht unterstützt */ }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}
