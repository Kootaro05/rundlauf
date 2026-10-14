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
