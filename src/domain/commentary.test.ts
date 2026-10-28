import { describe, expect, it } from 'vitest';
import { LINES, kronen, lineForEvent, lineForFinal, render } from './commentary';
import type { EventType, Pause, Round } from './types';

let n = 0;
function round(participants: string[], ...events: [EventType, string, Partial<{ loser: string; pot: number }>?][]): Round {
  return {
    id: `r${n++}`, number: 1, startedAt: 0, participants,
    events: events.map(([type, p, extra], i) => ({
      id: `e${n++}`, seq: i + 1, type, p, t: i, loser: extra?.loser ?? null, server: null, pot: extra?.pot ?? null,
    })),
  };
}
const pause = (participants: string[], ...rounds: Round[]): Pause => ({ id: 'p', startedAt: 0, endedAt: null, participants, rounds });
const last = (pa: Pause) => pa.rounds.at(-1)!.events.at(-1)!;
const P = ['a', 'b', 'c', 'd'];

describe('Kommentator', () => {
  it('Schwimmer: "wieder", wenn er es schon in der Runde davor war (und nicht Bademeister ist)', () => {
    const first = pause(P, round(P, ['schwimmer', 'a']));
    expect(lineForEvent(first, last(first))?.kind).toBe('schwimmer');
    const done = (p: string) => round(P, ['schwimmer', p], ['out', 'c'], ['out', 'd'], ['final', 'a', { loser: 'b', pot: 1 }]);
    // a ist mit 2 Schwimmern Bademeister; b zieht nur gleich und bleibt beim normalen "wieder"
    const again = pause(P, done('a'), done('a'), done('b'), round(P, ['schwimmer', 'b']));
    expect(lineForEvent(again, last(again))?.kind).toBe('schwimmerAgain');
  });

  it('raus: Slain-Sound, außer es bleiben zwei fürs Finale', () => {
    const three = pause(P, round(P, ['schwimmer', 'a'], ['out', 'b']));
    expect(lineForEvent(three, last(three))?.kind).toBe('slain');
    const two = pause(P, round(P, ['schwimmer', 'a'], ['out', 'b'], ['out', 'c']));
    expect(lineForEvent(two, last(two))).toEqual({ kind: 'finalTie', vars: { a: 'a', b: 'd', server: '', pot: 1 } });
  });

  it('Finale nennt den Aufschläger (wer weniger Kronen hat)', () => {
    const pa = pause(['a', 'b', 'c'], round(['a', 'b', 'c'], ['final', 'a', { loser: 'b', pot: 1 }]), round(['a', 'b', 'c'], ['schwimmer', 'c'], ['out', 'c']));
    const line = lineForFinal(pa, pa.rounds[1])!;
    expect(line.kind).toBe('final');
    expect(line.vars.server).toBe('b');
  });

  it('Krone: König mit zweiter Krone, großer Pot, sonst normal', () => {
    const k = ['a', 'b', 'c', 'd'];
    const won = round(k, ['final', 'a', { loser: 'b', pot: 3 }]);
    const pa = pause(k, won, round(k, ['schwimmer', 'b'], ['crown', 'a'], ['crown', 'a']));
    expect(lineForEvent(pa, last(pa))?.kind).toBe('crownKing');
    const big = pause(k, round(k, ['schwimmer', 'a'], ['crown', 'a'], ['crown', 'b'], ['crown', 'c'], ['crown', 'd']));
    expect(lineForEvent(big, last(big))?.kind).toBe('crownBigPot');
    const normal = pause(k, round(k, ['schwimmer', 'a'], ['crown', 'b']));
    expect(lineForEvent(normal, last(normal))).toEqual({ kind: 'crown', vars: { name: 'b', pot: 2 } });
  });

  it('Sieg und Text mit Namen und Kronen', () => {
    const pa = pause(['a', 'b'], round(['a', 'b'], ['final', 'a', { loser: 'b', pot: 1 }]));
    const line = lineForEvent(pa, last(pa))!;
    expect(line.kind).toBe('win');
    const text = render(line, (id) => id.toUpperCase(), () => 0);
    expect(text).toBe(LINES.win[0].replace('{name}', 'A').replace('{kronen}', 'eine Krone'));
    expect(kronen(3)).toBe('3 Kronen');
  });

  it('wiederholt den letzten Satz nicht direkt', () => {
    const line = { kind: 'win' as const, vars: { name: 'a', pot: 2 } };
    const first = render(line, (id) => id, () => 0);
    expect(render(line, (id) => id, () => 0, first)).not.toBe(first);
  });

  it('Bleiente: Schwimmer und trotzdem als Erster raus; das Finale hat Vorrang', () => {
    const pa = pause(P, round(P, ['schwimmer', 'a'], ['out', 'a']));
    expect(lineForEvent(pa, last(pa))).toEqual({ kind: 'bleiente', vars: { name: 'a' } });
    // nicht als Erster raus (hier bleiben danach zwei: Finale)
    const later = pause(P, round(P, ['schwimmer', 'a'], ['out', 'b'], ['out', 'a']));
    expect(lineForEvent(later, last(later))?.kind).toBe('finalTie');
    const five = ['a', 'b', 'c', 'd', 'e'];
    const notFirst = pause(five, round(five, ['schwimmer', 'a'], ['out', 'b'], ['out', 'a']));
    expect(lineForEvent(notFirst, last(notFirst))?.kind).toBe('slain');
    // bei drei Spielern führt das erste Raus ins Finale: nur der Finalspruch
    const three = ['a', 'b', 'c'];
    const fin = pause(three, round(three, ['schwimmer', 'a'], ['out', 'a']));
    expect(lineForEvent(fin, last(fin))?.kind).toMatch(/^final/);
  });

  it('Bademeister: neuer erst durch Überholen, danach eigene Sprüche; sonst normale Schwimmer-Sprüche', () => {
    const r1 = round(P, ['schwimmer', 'a'], ['out', 'b'], ['out', 'c'], ['final', 'a', { loser: 'd', pot: 1 }]);
    const r2 = round(P, ['schwimmer', 'b'], ['out', 'c'], ['out', 'd'], ['final', 'a', { loser: 'b', pot: 1 }]);
    const r3 = round(P, ['schwimmer', 'b']);
    // Erster Schwimmer im Semester: normaler Spruch (niemand überholt)
    expect(lineForEvent(pause(P, r1), r1.events[0])?.kind).toBe('schwimmer');
    // b gleichauf mit Bademeister a: normaler Spruch
    expect(lineForEvent(pause(P, r1, r2), r2.events[0])?.kind).toBe('schwimmer');
    // b überholt a
    const pa = pause(P, r1, r2, r3);
    expect(lineForEvent(pa, r3.events[0])).toEqual({ kind: 'bademeisterNew', vars: { name: 'b' } });
    // Bademeister a schwimmt erneut (in einer anderen Pause desselben Semesters)
    const r4 = round(P, ['schwimmer', 'a']);
    const pb = pause(P, r4);
    const p1 = { ...pause(P, r1), id: 'p1' };
    expect(lineForEvent(pb, r4.events[0], [p1, pb])?.kind).toBe('bademeisterAgain');
  });
});
