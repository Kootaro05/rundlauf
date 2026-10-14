import { balances, kingOf, roundInfo } from './game';
import { periodKey, type Granularity } from './periods';
import type { Pause } from './types';

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
  netto: 0, beste: 0, schwimmer: 0, ersterRaus: 0, maxPot: 0, koenig: 0, aufschlaege: 0, ass: 0,
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
