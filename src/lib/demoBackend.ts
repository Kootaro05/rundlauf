import { makeDemo } from '../domain/demo';
import { isFinished } from '../domain/game';
import type { Data } from '../domain/types';
import { AppError, type Backend } from './backend';

/** Speichert nur im Arbeitsspeicher. Für lokales Ausprobieren ohne Supabase-Projekt. */
export function createDemoBackend(): Backend {
  let data: Data = makeDemo();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  const id = () => Math.random().toString(36).slice(2, 10);
  const pause = (pid: string) => {
    const p = data.pauses.find((x) => x.id === pid);
    if (!p) throw new AppError('Pause nicht gefunden.');
    return p;
  };

  return {
    kind: 'demo',
    auth: {
      current: async () => ({ email: 'demo', playerId: 'demo' }),
      onChange: () => () => {},
      signIn: async () => {},
      verifyCode: async () => {},
      signOut: async () => {},
    },
    load: async () => structuredClone(data),
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async startPause(playerIds) {
      if (data.pauses.some((p) => !p.endedAt)) throw new AppError('Es läuft schon eine Pause.');
      data.pauses.push({ id: id(), startedAt: Date.now(), endedAt: null, participants: [...playerIds], rounds: [] });
      changed();
    },
    async startRound(pauseId, playerIds) {
      const pa = pause(pauseId);
      const last = pa.rounds.at(-1);
      if (last && !isFinished(last)) throw new AppError('Es läuft noch eine Runde.');
      pa.rounds.push({ id: id(), number: pa.rounds.length + 1, startedAt: Date.now(), participants: [...playerIds], events: [] });
      pa.participants = [...new Set([...pa.participants, ...playerIds])];
      changed();
    },
    async addEvent(roundId, seq, ev) {
      const r = data.pauses.flatMap((p) => p.rounds).find((x) => x.id === roundId);
      if (!r) throw new AppError('Runde nicht gefunden.');
      if (r.events.some((e) => e.seq === seq)) throw new AppError('Das wurde gerade schon eingetragen.');
      r.events.push({ id: id(), seq, t: Date.now(), loser: null, server: null, pot: null, ...ev });
      changed();
    },
    async undo(p) {
      const pa = pause(p.id);
      const r = pa.rounds.at(-1);
      if (!r) return;
      if (r.events.length) r.events.pop();
      else pa.rounds.pop();
      changed();
    },
    async endPause(pauseId) {
      const pa = pause(pauseId);
      pa.rounds = pa.rounds.filter(isFinished);
      pa.endedAt = Date.now();
      changed();
    },

    async deleteEvent(eventId) {
      for (const r of data.pauses.flatMap((p) => p.rounds)) r.events = r.events.filter((e) => e.id !== eventId);
      changed();
    },
    async updateFinal(eventId, patch) {
      const e = data.pauses.flatMap((p) => p.rounds).flatMap((r) => r.events).find((x) => x.id === eventId);
      if (e) Object.assign(e, patch);
      changed();
    },
    async deleteRound(roundId) {
      for (const p of data.pauses) p.rounds = p.rounds.filter((r) => r.id !== roundId);
      changed();
    },
    async deletePause(pauseId) {
      data.pauses = data.pauses.filter((p) => p.id !== pauseId);
      changed();
    },

    async addPlayer(name) {
      if (data.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new AppError('Diesen Namen gibt es schon.');
      data.players.push({ id: id(), name, hidden: false, createdAt: Date.now() });
      changed();
    },
    async updatePlayer(pid, patch) {
      const p = data.players.find((x) => x.id === pid);
      if (p) Object.assign(p, patch);
      changed();
    },
    async setEmail() {},
    playerEmails: async () => ({}),
  };
}
