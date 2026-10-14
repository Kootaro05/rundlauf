import type { Data, GameEvent, NewEvent } from '../domain/types';

/** Ein Spielereignis, das ohne Netz eingetragen wurde und noch zum Server muss. */
export interface PendingEvent {
  key: string;
  roundId: string;
  seq: number;
  ev: NewEvent;
  t: number;
}

const OUTBOX = 'rk.outbox';
const CACHE = 'rk.cache';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher voll oder gesperrt: dann eben ohne */
  }
}

export const loadOutbox = () => read<PendingEvent[]>(OUTBOX, []);
export const saveOutbox = (o: PendingEvent[]) => write(OUTBOX, o);

/** Letzter vom Server geladener Stand, damit die App auch ohne Netz mit Daten startet. */
export const loadCache = () => read<{ data: Data; at: number } | null>(CACHE, null);
export const saveCache = (data: Data) => write(CACHE, { data, at: Date.now() });

/**
 * Blendet wartende Einträge in die Serverdaten ein, so als wären sie schon gespeichert.
 * Hat der Server zu einer seq schon einen Eintrag, gilt der des Servers.
 */
export function applyOutbox(data: Data, outbox: PendingEvent[]): Data {
  if (!outbox.length) return data;
  const byRound = new Map<string, PendingEvent[]>();
  for (const p of outbox) byRound.set(p.roundId, [...(byRound.get(p.roundId) ?? []), p]);
  return {
    ...data,
    pauses: data.pauses.map((pa) =>
      !pa.rounds.some((r) => byRound.has(r.id))
        ? pa
        : {
            ...pa,
            rounds: pa.rounds.map((r) => {
              const pending = byRound.get(r.id);
              if (!pending) return r;
              const taken = new Set(r.events.map((e) => e.seq));
              const extra: GameEvent[] = pending
                .filter((p) => !taken.has(p.seq))
                .map((p) => ({ id: `offline-${p.key}`, seq: p.seq, t: p.t, loser: null, server: null, pot: null, ...p.ev }));
              return { ...r, events: [...r.events, ...extra].sort((a, b) => a.seq - b.seq) };
            }),
          },
    ),
  };
}
