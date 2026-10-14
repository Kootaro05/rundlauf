import { describe, expect, it } from 'vitest';
import type { Data, Pause } from '../domain/types';
import { mergePauses, scopeForChange } from './sync';

const pause = (id: string, startedAt: number, endedAt: number | null, roundIds: string[] = [], eventIds: string[] = []): Pause => ({
  id, startedAt, endedAt, participants: [],
  rounds: roundIds.map((rid, i) => ({
    id: rid, number: i + 1, startedAt, participants: [],
    events: eventIds.map((eid, k) => ({ id: eid, seq: k + 1, type: 'out', p: 'a', t: 0, loser: null, server: null, pot: null })),
  })),
});

const data: Data = {
  players: [],
  pauses: [pause('alt', 1, 2, ['r-alt']), pause('laufend', 10, null, ['r1'], ['e1', 'e2'])],
};

describe('Gezieltes Nachladen', () => {
  it('ein neuer Eintrag betrifft nur seine Pause', () => {
    expect(scopeForChange({ table: 'events', type: 'INSERT', row: { round_id: 'r1' }, old: {} }, data)).toEqual({ pauses: ['laufend'] });
  });

  it('bei einer Löschung wird die Pause über den bisherigen Stand gefunden', () => {
    expect(scopeForChange({ table: 'events', type: 'DELETE', row: {}, old: { id: 'e2' } }, data)).toEqual({ pauses: ['laufend'] });
    expect(scopeForChange({ table: 'rounds', type: 'DELETE', row: {}, old: { id: 'r-alt' } }, data)).toEqual({ pauses: ['alt'] });
  });

  it('eine neue Runde nennt ihre Pause selbst, eine neue Pause sich selbst', () => {
    expect(scopeForChange({ table: 'rounds', type: 'INSERT', row: { pause_id: 'laufend' }, old: {} }, data)).toEqual({ pauses: ['laufend'] });
    expect(scopeForChange({ table: 'pauses', type: 'INSERT', row: { id: 'neu' }, old: {} }, data)).toEqual({ pauses: ['neu'] });
  });

  it('nicht zuordenbar: laufende Pausen; unbekannt: alles; Spieler: nur Spieler', () => {
    expect(scopeForChange({ table: 'events', type: 'INSERT', row: { round_id: 'unbekannt' }, old: {} }, data)).toEqual({ open: true });
    expect(scopeForChange({ table: '*', type: '*', row: {}, old: {} }, data)).toEqual({ full: true });
    expect(scopeForChange({ table: 'players', type: 'UPDATE', row: { id: 'x' }, old: {} }, data)).toEqual({ players: true });
  });

  it('einsortieren: ersetzt Geladenes, entfernt Gelöschtes, behält den Rest', () => {
    const neu = pause('laufend', 10, 20, ['r1']);
    const merged = mergePauses(data, ['laufend', 'alt'], [neu]);
    expect(merged.pauses.map((p) => p.id)).toEqual(['laufend']);
    expect(merged.pauses[0].endedAt).toBe(20);
    const ohneAnfrage = mergePauses(data, [], [pause('frisch', 30, null)]);
    expect(ohneAnfrage.pauses.map((p) => p.id)).toEqual(['frisch', 'laufend', 'alt']);
  });
});
