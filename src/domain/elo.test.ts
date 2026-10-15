import { describe, expect, it } from 'vitest';
import { ELO_START, computeElo, placement, podium, ratingAt, semesterElo } from './elo';
import { computeComebacks, computeDuels, longestFinalStreak } from './stats';
import type { EventType, Pause, Round } from './types';

let n = 0;
function round(participants: string[], ...events: [EventType, string, { loser?: string; pot?: number }?][]): Round {
  return {
    id: `r${n++}`, number: 1, startedAt: n, participants,
    events: events.map(([type, p, x], i) => ({ id: `e${n++}`, seq: i + 1, type, p, t: n + i, loser: x?.loser ?? null, server: null, pot: x?.pot ?? null })),
  };
}
const pause = (startedAt: number, ...rounds: Round[]): Pause => ({
  id: `p${startedAt}`, startedAt, endedAt: startedAt + 1, participants: [...new Set(rounds.flatMap((r) => r.participants))], rounds,
});
// a gewinnt das Finale gegen b, c fliegt als Erster raus
const abc = () => round(['a', 'b', 'c'], ['schwimmer', 'c'], ['out', 'c'], ['final', 'a', { loser: 'b', pot: 1 }]);

describe('ELO', () => {
  it('Platzierung: Sieger, Finalverlierer, dann rückwärts nach Ausscheiden', () => {
    const r = round(['a', 'b', 'c', 'd'], ['schwimmer', 'd'], ['out', 'c'], ['out', 'd'], ['final', 'a', { loser: 'b', pot: 1 }]);
    expect(placement(r)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('Sieger gewinnt, Letzter verliert, die Summe bleibt gleich', () => {
    const { rating } = computeElo([pause(0, abc())]);
    expect(rating.a).toBeGreaterThan(ELO_START);
    expect(rating.c).toBeLessThan(ELO_START);
    expect(rating.b).toBeCloseTo(ELO_START, 5);
    expect(rating.a + rating.b + rating.c).toBeCloseTo(3 * ELO_START, 5);
  });

  it('ein Sieg gegen einen Stärkeren bringt mehr als gegen einen Schwächeren', () => {
    const strongB = computeElo([pause(0, round(['b', 'c'], ['final', 'b', { loser: 'c', pot: 1 }])), pause(1, round(['a', 'b'], ['final', 'a', { loser: 'b', pot: 1 }]))]);
    const weakB = computeElo([pause(0, round(['b', 'c'], ['final', 'c', { loser: 'b', pot: 1 }])), pause(1, round(['a', 'b'], ['final', 'a', { loser: 'b', pot: 1 }]))]);
    expect(strongB.rating.a).toBeGreaterThan(weakB.rating.a);
  });

  it('Semester-ELO zählt nur das laufende Semester, die ELO alles', () => {
    const sommer = new Date(2026, 5, 1).getTime();
    const winter = new Date(2026, 9, 14).getTime();
    const pausen = [pause(sommer, abc()), pause(winter, abc())];
    const gesamt = computeElo(pausen);
    const semester = semesterElo(pausen, winter);
    expect(semester.history.a).toHaveLength(2);
    expect(gesamt.history.a).toHaveLength(3);
    expect(semester.rating.a).toBeLessThan(gesamt.rating.a);
    expect(semesterElo(pausen, new Date(2027, 3, 1).getTime()).rating).toEqual({});
  });

  it('Podium: die drei Besten in Reihenfolge', () => {
    expect(podium({ a: 990, b: 1040, c: 1010, d: 1001 })).toEqual({ b: 1, c: 2, d: 3 });
    expect(podium({ a: 1000 })).toEqual({ a: 1 });
  });

  it('Verlauf und Wert zu einem Zeitpunkt', () => {
    const { history } = computeElo([pause(0, abc()), pause(10, abc())]);
    expect(history.a).toHaveLength(3);
    expect(ratingAt(history.a, -1)).toBe(ELO_START);
    expect(ratingAt(history.a, Infinity)).toBe(history.a[2].r);
  });
});

describe('Duelle, Comeback, Serien', () => {
  it('zählt Finalsiege gegeneinander', () => {
    const d = computeDuels([pause(0, abc(), abc(), round(['a', 'b'], ['final', 'b', { loser: 'a', pot: 1 }]))]);
    expect(d.a.b).toBe(2);
    expect(d.b.a).toBe(1);
  });

  it('erkennt den König, der zwischendurch hinten lag', () => {
    const pa = pause(0,
      round(['a', 'b'], ['final', 'b', { loser: 'a', pot: 1 }]),
      round(['a', 'b'], ['final', 'b', { loser: 'a', pot: 1 }]),
      round(['a', 'b'], ['final', 'a', { loser: 'b', pot: 1 }]),
      round(['a', 'b'], ['final', 'a', { loser: 'b', pot: 1 }]),
      round(['a', 'b'], ['final', 'a', { loser: 'b', pot: 1 }]));
    expect(computeComebacks([pa])[0]).toMatchObject({ p: 'a', deficit: 2, end: 3 });
  });

  it('längste Final-Siegesserie', () => {
    const win = (w: string, l: string) => round([w, l], ['final', w, { loser: l, pot: 1 }]);
    expect(longestFinalStreak([pause(0, win('a', 'b'), win('a', 'b'), win('b', 'a'), win('a', 'b'))], 'a')).toBe(2);
  });
});
