import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { balances, crownCheck, currentRound, kingOf, nextSeq, openPause, roundInfo, serveRule } from '../domain/game';
import { SOUNDS, lineForEvent, lineForFinal, render, type Announcement, type SoundKey } from '../domain/commentary';
import { bademeister } from '../domain/stats';
import type { NewEvent, Pause, Round } from '../domain/types';
import { HORN_TIMES, hhmm, playHorn, unlockHorn } from '../lib/horn';
import { configureVoice, playClip, setSpeechEnabled, speak, speechEnabled, speechSupported, unlockAudio, warmVoice, type VoiceResult } from '../lib/speech';
import { CrownIcon, WaveIcon, plural, useApp } from './ui';

/** Sound abspielen (Dateien in public/sounds, selbst abzulegen); fehlt er, sagt die Stimme den englischen Text */
const sound = (key: SoundKey) => playClip(`${import.meta.env.BASE_URL}sounds/${SOUNDS[key].file}`, SOUNDS[key].text);

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
  useEffect(() => configureVoice(() => backend.auth.accessToken()), [backend]);
  const pa = openPause(data.pauses);
  const r = currentRound(pa);
  const [celebrate, setCelebrate] = useState<{ p: string; pot: number } | null>(null);
  const starting = useRef(false);
  const [voice, setVoice] = useState(speechEnabled);
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null);
  const say = useCommentary(pa, voice, setVoiceResult);

  // Beim Öffnen mit eingeschaltetem Kommentar: "Welcome to Summoner's Rift"
  useEffect(() => {
    if (speechEnabled()) void sound('welcome').then((res) => res && setVoiceResult(res));
  }, []);

  // Mit Kommentar die Server-Funktion wach halten, damit ElevenLabs schnell genug antwortet
  useEffect(() => {
    if (!voice) return;
    warmVoice();
    const t = window.setInterval(warmVoice, 4 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [voice]);

  useWakeLock();
  const now = useClock();
  useHorn(now, voice);

  const toggleVoice = () => {
    setSpeechEnabled(!voice);
    setVoice(!voice);
    // Der Tipp schaltet die Sprachausgabe frei (iPad/Safari reden erst nach einer Berührung)
    if (!voice) {
      unlockAudio();
      unlockHorn();
      void sound('welcome').then((res) => res && setVoiceResult(res));
    }
  };

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
  else if (roundInfo(r).active.length <= 2) body = <FinalView key={r.id} pa={pa} r={r} onServe={(p) => say({ kind: 'serve', vars: { server: p } })} onWon={(w, pot) => void afterFinal(pa, r, w, pot)} />;
  else body = <RoundView key={r.id} pa={pa} r={r} />;

  return (
    <div className="tm">
      <TopBar pa={pa} r={r} now={now} voice={voice} fallback={voice && voiceResult?.source === 'browser' ? voiceResult.reason ?? 'unbekannt' : null} onVoice={toggleVoice} onExit={() => void exit()} />
      <div className="tm-body">{body}</div>
      {celebrate && <Celebration {...celebrate} />}
    </div>
  );
}

/**
 * Kommentator: sagt neu eingetragene Ereignisse der laufenden Pause an. Was beim Öffnen schon
 * da war, bleibt still; Rückgängig sagt nichts. Gibt eine Funktion für zusätzliche Ansagen zurück.
 */
function useCommentary(pa: Pause | null, enabled: boolean, onSource: (s: VoiceResult) => void) {
  const { spokenName, data } = useApp();
  const pausesRef = useRef(data.pauses);
  pausesRef.current = data.pauses;
  const seen = useRef<Set<string> | null>(null);
  const lastText = useRef<string>();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const say = useCallback((a: Announcement | null) => {
    if (!a || !enabledRef.current) return;
    // Nur ein Sound (First Blood, Slain); fehlt die Datei, kommt der englische Text
    if ('sound' in a) {
      void sound(a.sound).then((res) => res && onSource(res));
      return;
    }
    lastText.current = render(a, spokenName, Math.random, lastText.current);
    void speak(lastText.current).then((res) => res && onSource(res));
    // Penta Kill oder Shut down direkt nach dem Siegspruch (die Warteschlange hält die Reihenfolge)
    if (a.then) void sound(a.then).then((res) => res && onSource(res));
  }, [spokenName, onSource]);

  useEffect(() => {
    if (!pa) return;
    const ids = [...pa.rounds.map((r) => r.id), ...pa.rounds.flatMap((r) => r.events.map((e) => e.id))];
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const newEvents = pa.rounds.flatMap((r) => r.events).filter((e) => !known.has(e.id));
    const newRounds = pa.rounds.filter((r) => !known.has(r.id));
    ids.forEach((id) => known.add(id));
    const e = newEvents.at(-1);
    if (e) return say(lineForEvent(pa, e, pausesRef.current));
    // Runde mit nur zwei Spielern ist sofort ein Finale
    const r = newRounds.at(-1);
    if (r && r.events.length === 0 && r.participants.length === 2) say(lineForFinal(pa, r));
  }, [pa, say]);

  return say;
}

/** Aktuelle Uhrzeit, jede Sekunde neu */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/**
 * Signalhorn zu festen Uhrzeiten als Zeichen "das ist die letzte Runde". Nur mit eingeschaltetem
 * Kommentator; es wird nichts beendet. Jede Uhrzeit spielt pro Tag höchstens einmal, auch nach Neuladen.
 */
function useHorn(now: Date, enabled: boolean) {
  const minute = hhmm(now);
  const key = `${now.toDateString()} ${minute}`;
  useEffect(() => {
    if (!enabled || !HORN_TIMES.includes(minute)) return;
    try {
      if (localStorage.getItem('rundlauf-horn') === key) return;
      localStorage.setItem('rundlauf-horn', key);
    } catch {
      /* ohne Speicher verhindert schon die Abhängigkeit von "key" ein zweites Abspielen */
    }
    playHorn();
  }, [key, minute, enabled]);
}

/** Trillerpfeife für den Bademeister */
function WhistleIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9 7h11a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3.2A6 6 0 1 1 9 7zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M4.5 6.5 3 5M7 5 6.5 3" />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? <><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></> : <path d="m17 9 5 6m0-6-5 6" />}
    </svg>
  );
}

// ---------------------------------------------------------------------------

function TopBar({ pa, r, now, voice, fallback, onVoice, onExit }: {
  pa: Pause | null; r: Round | null; now: Date; voice: boolean; fallback: string | null; onVoice: () => void; onExit: () => void;
}) {
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
      <time className="tm-clock" dateTime={now.toISOString()}>{hhmm(now)}</time>
      <div className="tm-top-right">
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
      {speechSupported() && (
        <button className={`tm-voice${voice ? ' on' : ''}`} aria-pressed={voice} onClick={onVoice}
          title={voice ? 'Kommentator ausschalten' : 'Kommentator einschalten'}>
          <SpeakerIcon on={voice} /> <span>Kommentar</span>
          {fallback && <small title={`Browser-Stimme, weil ElevenLabs gerade nicht genutzt wird: ${fallback}`}>Browser-Stimme · {fallback}</small>}
        </button>
      )}
        <button className="tm-exit" aria-label="Tisch-Modus schließen" onClick={onExit}>✕</button>
      </div>
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
  const { addEvent, name, data } = useApp();
  const i = roundInfo(r);
  const b = balances(pa);
  const king = kingOf(b);
  const bm = bademeister(data.pauses);
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
            <PlayerTile key={p} p={p} crowns={b[p] ?? 0} king={p === king} bademeister={p === bm} schwimmer={i.schwimmer === p}
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

function PlayerTile({ p, crowns, king, bademeister: isBademeister, schwimmer, setThisRound, hint, onTap }: {
  p: string; crowns: number; king: boolean; bademeister: boolean; schwimmer: boolean; setThisRound: number; hint?: string; onTap: () => void;
}) {
  const { name, avatar, color, busy } = useApp();
  const img = avatar(p);
  return (
    <button className={`tm-tile tm-player${king ? ' is-king' : ''}${schwimmer ? ' is-schwimmer' : ''}`}
      style={{ '--pc': color(p) } as CSSProperties} onClick={onTap} disabled={busy}>
      <span className="tm-art">
        {img ? <img src={img} alt="" /> : <span className="tm-ghost">{name(p).slice(0, 2)}</span>}
        {king && <span className="tm-king-crown" aria-hidden="true"><CrownIcon /></span>}
      </span>
      {schwimmer && (
        // Wasserlinie mit Wellen über dem schwimmenden Spieler, dazu das Wort als Wasserzeichen
        <span className="tm-water" aria-hidden="true">
          <span className="tm-water-mark">Schwimmer</span>
          <span className="tm-wave tm-wave-back" />
          <span className="tm-wave tm-wave-front" />
        </span>
      )}
      <span className="tm-info">
        <span className="tm-tags">
          {king && <span className="tm-tag tm-tag-gold"><CrownIcon /> König</span>}
          {isBademeister && <span className="tm-tag tm-tag-water" title="Meiste Schwimmer im Semester"><WhistleIcon /> Bademeister</span>}
          {schwimmer && <span className="tm-tag"><WaveIcon /> Schwimmer</span>}
          {setThisRound > 0 && <span className="tm-tag tm-tag-gold">×{setThisRound} gesetzt</span>}
        </span>
        <span className="tm-crowns"><CrownIcon /> {crowns}{hint && <span className="tm-hint"> · Tipp: {hint}</span>}</span>
        <span className="tm-name"><span>{name(p)}</span></span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function FinalView({ pa, r, onServe, onWon }: {
  pa: Pause; r: Round; onServe: (server: string) => void; onWon: (winner: string, pot: number) => void;
}) {
  const { addEvent, name, color } = useApp();
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
    if (askServe) {
      setPicked(p);
      onServe(p);
      return;
    }
    const loser = p === rule.a ? rule.b : rule.a;
    const ok = await addEvent(r.id, nextSeq(r), { type: 'final', p, loser, server, pot: i.pot }, `${name(p)} gewinnt ${plural(i.pot, 'Krone', 'Kronen')}`);
    if (ok) onWon(p, i.pot);
  };

  // Showdown: links und rechts die Finalisten frei stehend, dazwischen VS, oben mittig der Pot
  return (
    <div className="tm-showdown" style={{ '--ca': color(rule.a), '--cb': color(rule.b) } as CSSProperties}>
      <div className="tm-showdown-head">
        <span className="tm-showdown-label">Finale</span>
        <span className="tm-showdown-pot"><CrownIcon /> {i.pot}</span>
        <span className="tm-showdown-ask">
          {askServe ? 'Gleichstand: Angabe ausspielen. Wer hat sie gewonnen?' : 'Wer hat das Finale gewonnen?'}
        </span>
      </div>
      <div className="tm-showdown-stage">
        <Fighter p={rule.a} crowns={b[rule.a] ?? 0} king={rule.a === king} serves={server === rule.a} side="left" onTap={() => void tap(rule.a)} />
        <div className="tm-vs" aria-hidden="true">VS</div>
        <Fighter p={rule.b} crowns={b[rule.b] ?? 0} king={rule.b === king} serves={server === rule.b} side="right" onTap={() => void tap(rule.b)} />
      </div>
    </div>
  );
}

/** Tischtennis-Kelle: roter Belag, Holzgriff */
function PaddleIcon() {
  return (
    <svg viewBox="0 0 100 150" aria-hidden="true">
      <rect x="40" y="84" width="20" height="60" rx="7" fill="#b9793d" stroke="#6e4220" strokeWidth="3" />
      <rect x="44" y="96" width="12" height="40" rx="4" fill="#d79a5c" />
      <circle cx="50" cy="50" r="45" fill="#d93a32" stroke="#7d1712" strokeWidth="4" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="3" />
      <ellipse cx="34" cy="32" rx="14" ry="8" fill="rgba(255,255,255,.28)" transform="rotate(-35 34 32)" />
    </svg>
  );
}

/** Ein Finalist im Showdown: großes freigestelltes Bild ohne Kachel, darunter der Spitzname */
function Fighter({ p, crowns, king, serves, side, onTap }: {
  p: string; crowns: number; king: boolean; serves: boolean; side: 'left' | 'right'; onTap: () => void;
}) {
  const { name, avatar, busy } = useApp();
  const img = avatar(p);
  return (
    <button className="tm-fighter" onClick={onTap} disabled={busy}>
      <span className="tm-fighter-art">
        {img ? <img src={img} alt="" /> : <span className="tm-ghost">{name(p).slice(0, 2)}</span>}
        {serves && <span className={`tm-serve-paddle ${side}`}><PaddleIcon /></span>}
      </span>
      <span className="tm-fighter-name">{name(p)}</span>
      <span className="tm-fighter-meta">
        <span className="tm-crowns"><CrownIcon /> {crowns}</span>
        {king && <span className="tm-tag tm-tag-gold"><CrownIcon /> König</span>}
        {serves && <span className="tm-tag tm-tag-hot">schlägt auf</span>}
      </span>
    </button>
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
