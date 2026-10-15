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
  it('Schwimmer: "wieder", wenn er es schon in der Runde davor war', () => {
    const first = pause(P, round(P, ['schwimmer', 'a']));
    expect(lineForEvent(first, last(first))?.kind).toBe('schwimmer');
    const again = pause(P, round(P, ['schwimmer', 'a'], ['final', 'b', { loser: 'c', pot: 1 }]), round(P, ['schwimmer', 'a']));
    expect(lineForEvent(again, last(again))?.kind).toBe('schwimmerAgain');
  });

  it('raus ist still, außer es bleiben zwei fürs Finale', () => {
    const three = pause(P, round(P, ['schwimmer', 'a'], ['out', 'b']));
    expect(lineForEvent(three, last(three))).toBeNull();
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
});
