import { describe, expect, it } from 'vitest';
import { balances, crownCheck, currentRound, faultOutcome, kingOf, roundInfo, serveRule } from './game';
import { computeStats, recordFor } from './stats';
import { semester } from './periods';
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
const pause = (participants: string[], ...rounds: Round[]): Pause => ({ id: 'p', startedAt: 0, endedAt: 1, participants, rounds });
const won = (participants: string[], winner: string, loser: string, pot = 1) => round(participants, ['final', winner, { loser, pot }]);

describe('Runde', () => {
  it('Pot ist 1 plus gesetzte Kronen', () => {
    const r = round(['a', 'b', 'c', 'd'], ['schwimmer', 'a'], ['crown', 'b'], ['crown', 'c'], ['out', 'd']);
    const i = roundInfo(r);
    expect(i.pot).toBe(3);
    expect(i.active).toEqual(['a', 'b', 'c']);
    expect(i.schwimmer).toBe('a');
  });

  it('erster Fehler gibt den Schwimmer, danach Wahl', () => {
    const r = round(['a', 'b', 'c']);
    const pa = pause(['a', 'b', 'c'], r);
    expect(faultOutcome(pa, r, 'a')).toEqual({ kind: 'schwimmer' });
    r.events.push({ id: 'x', seq: 1, type: 'schwimmer', p: 'a', t: 0, loser: null, server: null, pot: null });
    expect(faultOutcome(pa, r, 'a').kind).toBe('choose');
  });
});

describe('Kronen', () => {
  it('Gewinner bekommt den ganzen Pot, Setzen kostet eine Krone', () => {
    const pa = pause(['a', 'b', 'c'], won(['a', 'b', 'c'], 'a', 'b', 1), round(['a', 'b', 'c'], ['schwimmer', 'c'], ['crown', 'a'], ['final', 'b', { loser: 'a', pot: 2 }]));
    expect(balances(pa)).toEqual({ a: 0, b: 2, c: 0 });
  });

  it('ohne Kronen kann man keine setzen', () => {
    const r = round(['a', 'b', 'c'], ['schwimmer', 'a']);
    const c = crownCheck(pause(['a', 'b', 'c'], r), r, 'b');
    expect(c.ok).toBe(false);
  });

  it('nur eine Krone pro Runde, außer für den König', () => {
    // a hat 2, b hat 1 → a ist König
    const pa = pause(['a', 'b', 'c', 'd'], won(['a', 'b', 'c', 'd'], 'a', 'b'), won(['a', 'b', 'c', 'd'], 'a', 'b'), won(['a', 'b', 'c', 'd'], 'b', 'a'));
    const r = round(['a', 'b', 'c', 'd'], ['schwimmer', 'c'], ['crown', 'b'], ['crown', 'a']);
    pa.rounds.push(r);
    // b hat schon gesetzt und ist nicht König
    expect(crownCheck(pa, r, 'b').ok).toBe(false);
    // a hat 1 übrig, b hat 0 → a ist weiterhin alleiniger König und darf nochmal
    expect(crownCheck(pa, r, 'a')).toEqual({ ok: true, king: true, left: 1 });
  });

  it('König verliert das Mehrfach-Setzen, sobald er nicht mehr allein vorne ist', () => {
    const pa = pause(['a', 'b', 'c', 'd'], won(['a', 'b', 'c', 'd'], 'a', 'b'), won(['a', 'b', 'c', 'd'], 'a', 'b'), won(['a', 'b', 'c', 'd'], 'b', 'a'));
    const r = round(['a', 'b', 'c', 'd'], ['schwimmer', 'c'], ['crown', 'a']);
    pa.rounds.push(r);
    // a: 1, b: 1 → Gleichstand, kein König
    expect(kingOf(balances(pa))).toBeNull();
    expect(crownCheck(pa, r, 'a').ok).toBe(false);
  });

  it('bei drei Spielern kann eine Krone das Finale verhindern, im Finale nicht', () => {
    const pa = pause(['a', 'b', 'c'], won(['a', 'b', 'c'], 'a', 'b'));
    const r = round(['a', 'b', 'c'], ['schwimmer', 'b']);
    pa.rounds.push(r);
    expect(crownCheck(pa, r, 'a').ok).toBe(true);
    r.events.push({ id: 'y', seq: 2, type: 'out', p: 'c', t: 0, loser: null, server: null, pot: null });
    expect(crownCheck(pa, r, 'a')).toMatchObject({ ok: false, why: expect.stringContaining('Finale') });
  });
});

describe('Finale', () => {
  it('wer weniger Kronen hat, schlägt auf; Gleichstand wird ausgespielt', () => {
    const pa = pause(['a', 'b'], won(['a', 'b'], 'a', 'b'));
    const r = round(['a', 'b']);
    pa.rounds.push(r);
    expect(serveRule(pa, r)?.server).toBe('b');
    const tie = pause(['a', 'b'], round(['a', 'b']));
    expect(serveRule(tie, tie.rounds[0])?.server).toBeNull();
  });

  it('eine Runde mit Finale ist abgeschlossen', () => {
    const pa = pause(['a', 'b'], won(['a', 'b'], 'a', 'b'));
    expect(currentRound(pa)).toBeNull();
  });
});

describe('Statistik', () => {
  it('Quoten zählen nur Runden mit Teilnahme', () => {
    const pa = pause(['a', 'b', 'c'],
      round(['a', 'b', 'c'], ['schwimmer', 'c'], ['out', 'c'], ['final', 'a', { loser: 'b', pot: 1 }]),
      won(['a', 'b'], 'b', 'a'));
    const s = computeStats([pa]);
    expect(s.c).toMatchObject({ runden: 1, schwimmer: 1, ersterRaus: 1, netto: 0 });
    expect(s.a).toMatchObject({ runden: 2, siege: 1, finals: 2, netto: 1 });
  });

  it('zählt Aufschläge im Finale und Asse (selbst aufgeschlagen und gewonnen)', () => {
    const fin = (winner: string, loser: string, server: string): Round => {
      const r = won(['a', 'b'], winner, loser);
      r.events[0].server = server;
      return r;
    };
    const s = computeStats([pause(['a', 'b'], fin('a', 'b', 'a'), fin('b', 'a', 'a'), fin('b', 'a', 'b'))]);
    expect(s.a).toMatchObject({ aufschlaege: 2, ass: 1 });
    expect(s.b).toMatchObject({ aufschlaege: 1, ass: 1 });
  });

  it('Tagesrekord nimmt den besten Tag', () => {
    const day = (d: number) => new Date(2026, 9, d, 10).getTime();
    const p1 = { ...pause(['a', 'b'], won(['a', 'b'], 'a', 'b', 3)), id: 'p1', startedAt: day(12) };
    const p2 = { ...pause(['a', 'b'], won(['a', 'b'], 'b', 'a', 5)), id: 'p2', startedAt: day(13) };
    expect(recordFor([p1, p2], 'day')).toMatchObject({ p: 'b', v: 5 });
    expect(recordFor([p1, p2], 'all')).toMatchObject({ p: 'b', v: 5 });
  });

  it('Semestergrenzen', () => {
    expect(semester(new Date(2026, 9, 14))).toBe('WiSe 26/27');
    expect(semester(new Date(2027, 2, 31))).toBe('WiSe 26/27');
    expect(semester(new Date(2027, 3, 1))).toBe('SoSe 2027');
  });
});
