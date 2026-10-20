import type { GameEvent, Pause, Round } from './types';

export interface RoundInfo {
  /** Ausgeschiedene Spieler in Reihenfolge */
  out: string[];
  /** Gesetzte Kronen pro Spieler in dieser Runde */
  crowns: Record<string, number>;
  schwimmer: string | null;
  final: GameEvent | null;
  /** Noch im Spiel */
  active: string[];
  /** 1 Startkrone + alle gesetzten Kronen */
  pot: number;
}

export function roundInfo(r: Round): RoundInfo {
  const out: string[] = [];
  const crowns: Record<string, number> = {};
  let schwimmer: string | null = null;
  let final: GameEvent | null = null;
  for (const e of r.events) {
    if (e.type === 'schwimmer') schwimmer = e.p;
    else if (e.type === 'crown') crowns[e.p] = (crowns[e.p] ?? 0) + 1;
    else if (e.type === 'out') out.push(e.p);
    else if (e.type === 'final') final = e;
  }
  const set = Object.values(crowns).reduce((a, b) => a + b, 0);
  return { out, crowns, schwimmer, final, active: r.participants.filter((p) => !out.includes(p)), pot: 1 + set };
}

export type Balances = Record<string, number>;

/** Kronenstand pro Spieler in einer Pause, optional nur nach den ersten `upto` Runden. */
export function balances(pa: Pause, upto = Infinity): Balances {
  const b: Balances = {};
  for (const p of pa.participants) b[p] = 0;
  pa.rounds.forEach((r, i) => {
    if (i >= upto) return;
    for (const p of r.participants) b[p] ??= 0;
    for (const e of r.events) if (e.type === 'crown') b[e.p] -= 1;
    const f = roundInfo(r).final;
    if (f) b[f.p] += f.pot ?? 0;
  });
  return b;
}

/** König ist, wer allein die meisten Kronen hat (mindestens eine). Bei Gleichstand gibt es keinen. */
export function kingOf(b: Balances): string | null {
  let best: string | null = null;
  let max = 0;
  let tie = false;
  for (const [p, v] of Object.entries(b)) {
    if (v > max) {
      max = v;
      best = p;
      tie = false;
    } else if (v === max && v > 0) tie = true;
  }
  return tie ? null : best;
}

export type CrownCheck = { ok: true; king: boolean; left: number } | { ok: false; why: string };

export function crownCheck(pa: Pause, r: Round, p: string): CrownCheck {
  const i = roundInfo(r);
  const b = balances(pa);
  if (i.active.length <= 2) return { ok: false, why: 'Im Finale werden keine Kronen gesetzt.' };
  if ((b[p] ?? 0) <= 0) return { ok: false, why: 'Keine Kronen übrig.' };
  const king = kingOf(b) === p;
  if ((i.crowns[p] ?? 0) >= 1 && !king)
    return { ok: false, why: 'Diese Runde schon eine Krone gesetzt. Nur der König darf mehrere setzen.' };
  return { ok: true, king, left: b[p] };
}

/** Was ein Fehler von `p` auslöst: erster Fehler der Runde → Schwimmer, sonst Wahl zwischen Krone und Raus. */
export function faultOutcome(pa: Pause, r: Round, p: string): { kind: 'schwimmer' } | { kind: 'choose'; crown: CrownCheck } {
  return roundInfo(r).schwimmer ? { kind: 'choose', crown: crownCheck(pa, r, p) } : { kind: 'schwimmer' };
}

export interface ServeRule {
  a: string;
  b: string;
  crownsA: number;
  crownsB: number;
  /** Wer weniger Kronen hat, schlägt auf; null bei Gleichstand (dann wird die Angabe ausgespielt). */
  server: string | null;
}

export function serveRule(pa: Pause, r: Round): ServeRule | null {
  const i = roundInfo(r);
  if (i.active.length !== 2) return null;
  const [a, b] = i.active;
  const bal = balances(pa);
  const crownsA = bal[a] ?? 0;
  const crownsB = bal[b] ?? 0;
  return { a, b, crownsA, crownsB, server: crownsA === crownsB ? null : crownsA < crownsB ? a : b };
}

export const isFinished = (r: Round) => roundInfo(r).final !== null;

export function openPause(pauses: Pause[]): Pause | null {
  return pauses.filter((p) => !p.endedAt).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

export function currentRound(pa: Pause | null): Round | null {
  const r = pa?.rounds.at(-1);
  return r && !isFinished(r) ? r : null;
}

export const nextSeq = (r: Round) => (r.events.at(-1)?.seq ?? 0) + 1;

type EventInput = Pick<GameEvent, 'type' | 'p'> & Partial<Pick<GameEvent, 'loser' | 'server' | 'pot'>>;

/**
 * Prüft, ob ein Eintrag in der aktuellen Lage der Runde erlaubt ist.
 * Dieselben Regeln prüft die Datenbank beim Speichern (supabase/migrations/0002_regeln.sql).
 */
export function checkEvent(pa: Pause, r: Round, e: EventInput): string | null {
  const i = roundInfo(r);
  if (i.final) return 'Diese Runde ist schon entschieden.';
  if (!i.active.includes(e.p)) return 'Dieser Spieler ist nicht mehr in der Runde.';
  if (e.type !== 'final' && i.active.length <= 2) return 'Im Finale wird nur noch der Sieger eingetragen.';
  if (e.type === 'schwimmer' && i.schwimmer) return 'Der Schwimmer ist in dieser Runde schon vergeben.';
  if ((e.type === 'crown' || e.type === 'out') && !i.schwimmer) return 'Der erste Fehler einer Runde gibt den Schwimmer.';
  if (e.type === 'crown') {
    const c = crownCheck(pa, r, e.p);
    if (!c.ok) return c.why;
  }
  if (e.type === 'final') {
    if (i.active.length !== 2) return 'Das Finale gibt es erst, wenn nur noch zwei drin sind.';
    if (!e.loser || e.loser === e.p || !i.active.includes(e.loser)) return 'Im Finale spielen die beiden Letzten gegeneinander.';
    if (e.server && !i.active.includes(e.server)) return 'Aufschlagen kann nur einer der beiden Finalisten.';
    if (e.pot !== i.pot) return `Der Pot stimmt nicht, erwartet sind ${i.pot} Kronen.`;
  }
  return null;
}

/**
 * Spielt eine Pause Eintrag für Eintrag nach und prüft jeden gegen die Regeln.
 * Gibt den ersten Regelverstoß zurück oder null. Für Korrekturen im Verlauf:
 * Ein gelöschter Sieg kann z. B. eine später gesetzte Krone ungültig machen.
 */
export function validatePause(pa: Pause): string | null {
  const replay: Pause = { ...pa, rounds: [] };
  for (const [idx, r] of pa.rounds.entries()) {
    const cur: Round = { ...r, events: [] };
    replay.rounds.push(cur);
    for (const e of r.events) {
      const err = checkEvent(replay, cur, e);
      if (err) return `Runde ${r.number}: ${err}`;
      cur.events.push(e);
    }
    if (!isFinished(cur) && (pa.endedAt || idx < pa.rounds.length - 1)) return `Runde ${r.number} hätte kein Finale mehr.`;
  }
  return null;
}

/**
 * Pause ohne einen versehentlich mitgezählten Spieler in Runde `r`. Geht nur, wenn er dort höchstens
 * ein "raus" hat (kein Schwimmer, keine Krone, nicht im Finale). Mit `leavePause`: Er hat in keiner anderen
 * Runde dieser Pause mitgespielt und fällt auch aus der Pause. Ob die Pause danach gültig ist, prüft validatePause.
 */
export function withoutPlayer(pa: Pause, r: Round, p: string): { pause: Pause; eventIds: string[]; leavePause: boolean } | null {
  const mine = r.events.filter((e) => e.p === p || e.loser === p || e.server === p);
  if (!r.participants.includes(p) || mine.some((e) => e.type !== 'out')) return null;
  const leavePause = !pa.rounds.some((x) => x.id !== r.id && x.participants.includes(p));
  const rounds = pa.rounds.map((x) => (x.id === r.id ? { ...x, participants: x.participants.filter((q) => q !== p), events: x.events.filter((e) => !mine.includes(e)) } : x));
  const participants = leavePause ? pa.participants.filter((q) => q !== p) : pa.participants;
  return { pause: { ...pa, rounds, participants }, eventIds: mine.map((e) => e.id), leavePause };
}
