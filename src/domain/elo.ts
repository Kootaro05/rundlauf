import { roundInfo } from './game';
import { periodKey } from './periods';
import type { Pause, Round } from './types';

export const ELO_START = 1000;
/** Maximaler Gewinn pro Runde (gegen alle Gegner zusammen) */
const K = 32;

/**
 * Platzierung einer abgeschlossenen Runde, beste zuerst:
 * Finalsieger, Finalverlierer, dann rückwärts in der Raus-Reihenfolge (wer zuerst rausfliegt, ist Letzter).
 */
export function placement(r: Round): string[] | null {
  const i = roundInfo(r);
  if (!i.final || !i.final.loser) return null;
  return [i.final.p, i.final.loser, ...[...i.out].reverse()];
}

export interface EloPoint {
  t: number;
  r: number;
}

export interface EloResult {
  rating: Record<string, number>;
  peak: Record<string, number>;
  /** Wertung nach jeder gespielten Runde, beginnend mit dem Startwert */
  history: Record<string, EloPoint[]>;
}

/**
 * Mehrspieler-ELO: Jede Runde wird in paarweise Duelle zerlegt. Wer vor einem anderen landet,
 * hat gegen ihn gewonnen. Der Gewinn wird durch die Zahl der Gegner geteilt, damit eine Runde
 * mit vielen Spielern nicht mehr zählt als ein Duell.
 */
export function computeElo(pauses: Pause[]): EloResult {
  const rating: Record<string, number> = {};
  const peak: Record<string, number> = {};
  const history: Record<string, EloPoint[]> = {};
  const get = (p: string, t: number) => {
    if (rating[p] === undefined) {
      rating[p] = ELO_START;
      peak[p] = ELO_START;
      history[p] = [{ t, r: ELO_START }];
    }
    return rating[p];
  };

  const rounds = [...pauses]
    .sort((a, b) => a.startedAt - b.startedAt)
    .flatMap((pa) => pa.rounds);

  for (const r of rounds) {
    const order = placement(r);
    if (!order || order.length < 2) continue;
    const t = roundInfo(r).final!.t;
    const before = order.map((p) => get(p, r.startedAt));
    const delta = order.map(() => 0);
    const k = K / (order.length - 1);
    for (let a = 0; a < order.length; a++)
      for (let b = a + 1; b < order.length; b++) {
        // a ist vor b gelandet
        const expectedA = 1 / (1 + 10 ** ((before[b] - before[a]) / 400));
        delta[a] += k * (1 - expectedA);
        delta[b] -= k * (1 - expectedA);
      }
    order.forEach((p, idx) => {
      rating[p] = before[idx] + delta[idx];
      peak[p] = Math.max(peak[p], rating[p]);
      history[p].push({ t, r: rating[p] });
    });
  }
  return { rating, peak, history };
}

/**
 * ELO des laufenden Semesters: Zu Semesterbeginn starten alle wieder bei 1000,
 * es zählen nur Pausen aus diesem Semester. Die Gesamt-ELO (computeElo über alle Pausen) läuft weiter.
 */
export function semesterElo(pauses: Pause[], now = Date.now()): EloResult {
  const key = periodKey(now, 'semester');
  return computeElo(pauses.filter((pa) => periodKey(pa.startedAt, 'semester') === key));
}

/** Wertung zu einem Zeitpunkt (letzter Stand davor). Wer bis dahin nicht gespielt hat, steht auf dem Startwert. */
export function ratingAt(history: EloPoint[] | undefined, t: number): number {
  if (!history) return ELO_START;
  let r = ELO_START;
  for (const h of history) {
    if (h.t >= t) break;
    r = h.r;
  }
  return r;
}
