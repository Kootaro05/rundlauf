import { balances, kingOf, roundInfo } from './game';
import { periodKey, type Granularity } from './periods';
import type { GameEvent, Pause } from './types';

export interface PlayerStats {
  p: string;
  pausen: number;
  /** Nur abgeschlossene Runden, an denen der Spieler teilgenommen hat */
  runden: number;
  finals: number;
  siege: number;
  gewonnen: number;
  gesetzt: number;
  /** Summe der Endstände aller Pausen (gewonnen − gesetzt) */
  netto: number;
  beste: number;
  schwimmer: number;
  ersterRaus: number;
  /** Runden mit Schwimmer und trotzdem als Erster raus */
  bleiente: number;
  maxPot: number;
  /** Pausen, die als König beendet wurden */
  koenig: number;
  /** Finals mit eigenem Aufschlag */
  aufschlaege: number;
  /** Finals mit eigenem Aufschlag, die man auch gewonnen hat */
  ass: number;
}

const empty = (p: string): PlayerStats => ({
  p, pausen: 0, runden: 0, finals: 0, siege: 0, gewonnen: 0, gesetzt: 0,
  netto: 0, beste: 0, schwimmer: 0, ersterRaus: 0, bleiente: 0, maxPot: 0, koenig: 0, aufschlaege: 0, ass: 0,
});

export function computeStats(list: Pause[]): Record<string, PlayerStats> {
  const s: Record<string, PlayerStats> = {};
  const S = (p: string) => (s[p] ??= empty(p));
  for (const pa of list) {
    const b = balances(pa);
    for (const [p, v] of Object.entries(b)) {
      const x = S(p);
      x.pausen++;
      x.netto += v;
      x.beste = Math.max(x.beste, v);
    }
    const k = kingOf(b);
    if (k && pa.endedAt) S(k).koenig++;
    for (const r of pa.rounds) {
      for (const e of r.events) if (e.type === 'crown') S(e.p).gesetzt++;
      const i = roundInfo(r);
      if (!i.final) continue;
      for (const p of r.participants) S(p).runden++;
      if (i.schwimmer) S(i.schwimmer).schwimmer++;
      if (i.out[0]) S(i.out[0]).ersterRaus++;
      if (i.schwimmer && i.out[0] === i.schwimmer) S(i.schwimmer).bleiente++;
      const pot = i.final.pot ?? 0;
      const w = S(i.final.p);
      w.finals++;
      w.siege++;
      w.gewonnen += pot;
      w.maxPot = Math.max(w.maxPot, pot);
      if (i.final.loser) S(i.final.loser).finals++;
      if (i.final.server) {
        S(i.final.server).aufschlaege++;
        if (i.final.server === i.final.p) w.ass++;
      }
    }
  }
  return s;
}

export const pausesIn = (pauses: Pause[], g: Granularity, now = Date.now()) => {
  const key = periodKey(now, g);
  return pauses.filter((pa) => periodKey(pa.startedAt, g) === key);
};

export interface PeriodRecord {
  p: string;
  v: number;
  key: string;
}

/** Bestwert an Netto-Kronen eines Spielers innerhalb eines einzelnen Tages/einer Woche/eines Semesters. */
export function recordFor(pauses: Pause[], g: Granularity): PeriodRecord | null {
  const groups: Record<string, Pause[]> = {};
  for (const pa of pauses) (groups[periodKey(pa.startedAt, g)] ??= []).push(pa);
  let best: PeriodRecord | null = null;
  for (const [key, list] of Object.entries(groups))
    for (const x of Object.values(computeStats(list)))
      if (!best || x.netto > best.v) best = { p: x.p, v: x.netto, key };
  return best;
}

export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '–');

/** Finalbilanz zwischen zwei Spielern: duels[a][b] = Siege von a gegen b */
export type Duels = Record<string, Record<string, number>>;

export function computeDuels(pauses: Pause[]): Duels {
  const d: Duels = {};
  for (const pa of pauses)
    for (const r of pa.rounds) {
      const f = roundInfo(r).final;
      if (!f?.loser) continue;
      (d[f.p] ??= {})[f.loser] = (d[f.p]?.[f.loser] ?? 0) + 1;
    }
  return d;
}

export interface Comeback {
  p: string;
  pause: Pause;
  /** Größter Rückstand auf den Führenden während der Pause */
  deficit: number;
  end: number;
}

/** Wer als König aus einer Pause gegangen ist, nachdem er zwischendurch deutlich hinten lag. */
export function computeComebacks(pauses: Pause[]): Comeback[] {
  const out: Comeback[] = [];
  for (const pa of pauses) {
    if (!pa.endedAt) continue;
    const end = balances(pa);
    const king = kingOf(end);
    if (!king) continue;
    let deficit = 0;
    for (let k = 1; k < pa.rounds.length; k++) {
      const b = balances(pa, k);
      deficit = Math.max(deficit, Math.max(...Object.values(b)) - (b[king] ?? 0));
    }
    if (deficit > 0) out.push({ p: king, pause: pa, deficit, end: end[king] });
  }
  return out.sort((a, b) => b.deficit - a.deficit || b.end - a.end);
}

/** Längste Serie gewonnener Finals am Stück */
export function longestFinalStreak(pauses: Pause[], p: string): number {
  let best = 0;
  let cur = 0;
  for (const pa of [...pauses].sort((a, b) => a.startedAt - b.startedAt))
    for (const r of pa.rounds) {
      const f = roundInfo(r).final;
      if (!f || (f.p !== p && f.loser !== p)) continue;
      cur = f.p === p ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
  return best;
}

/** Alle Schwimmer des laufenden Semesters in Spielreihenfolge, auch aus der gerade laufenden Runde */
function semesterSchwimmer(pauses: Pause[], now: number): GameEvent[] {
  return pausesIn(pauses, 'semester', now)
    .sort((a, b) => a.startedAt - b.startedAt)
    .flatMap((pa) => pa.rounds.flatMap((r) => r.events.filter((e) => e.type === 'schwimmer')));
}

/**
 * Bademeister: wer im laufenden Semester die meisten Schwimmer hat. Bei Gleichstand bleibt der bisherige,
 * neuer Bademeister wird man erst durch Überholen. Mit `before` der Stand direkt vor diesem Schwimmer-Eintrag.
 */
export function bademeister(pauses: Pause[], opts: { now?: number; before?: string } = {}): string | null {
  const count: Record<string, number> = {};
  let holder: string | null = null;
  for (const e of semesterSchwimmer(pauses, opts.now ?? Date.now())) {
    if (e.id === opts.before) break;
    count[e.p] = (count[e.p] ?? 0) + 1;
    if (!holder || count[e.p] > count[holder]) holder = e.p;
  }
  return holder;
}
