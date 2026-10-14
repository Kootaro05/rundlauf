import { describe, expect, it } from 'vitest';
import { roundInfo } from '../domain/game';
import type { Data } from '../domain/types';
import { applyOutbox, type PendingEvent } from './outbox';

const data: Data = {
  players: [],
  pauses: [{
    id: 'p', startedAt: 0, endedAt: null, participants: ['a', 'b', 'c'],
    rounds: [{
      id: 'r1', number: 1, startedAt: 0, participants: ['a', 'b', 'c'],
      events: [{ id: 'e1', seq: 1, type: 'schwimmer', p: 'a', t: 0, loser: null, server: null, pot: null }],
    }],
  }],
};
const pending = (seq: number, type: PendingEvent['ev']['type'], p: string): PendingEvent => ({ key: `k${seq}`, roundId: 'r1', seq, t: seq, ev: { type, p } });

describe('Offline-Warteschlange', () => {
  it('blendet wartende Einträge in die Runde ein', () => {
    const r = applyOutbox(data, [pending(2, 'out', 'c')]).pauses[0].rounds[0];
    expect(r.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(roundInfo(r).active).toEqual(['a', 'b']);
  });

  it('ist ein Eintrag schon auf dem Server, gilt der vom Server', () => {
    const r = applyOutbox(data, [pending(1, 'schwimmer', 'b')]).pauses[0].rounds[0];
    expect(r.events).toHaveLength(1);
    expect(r.events[0].p).toBe('a');
  });

  it('ohne wartende Einträge bleiben die Daten unverändert', () => {
    expect(applyOutbox(data, [])).toBe(data);
  });
});
