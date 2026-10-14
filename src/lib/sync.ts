import type { Data, Pause } from '../domain/types';
import type { Change } from './backend';

/** Was nachgeladen werden muss */
export interface Scope {
  /** Alles (unbekannte Änderung) */
  full?: boolean;
  players?: boolean;
  /** Bestimmte Pausen */
  pauses?: string[];
  /** Alle laufenden Pausen, auch eine gerade neu gestartete */
  open?: boolean;
}

export function mergeScopes(a: Scope, b: Scope): Scope {
  return {
    full: a.full || b.full,
    players: a.players || b.players,
    open: a.open || b.open,
    pauses: [...new Set([...(a.pauses ?? []), ...(b.pauses ?? [])])],
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

function pauseOfRound(data: Data, roundId: string | null) {
  if (!roundId) return null;
  return data.pauses.find((pa) => pa.rounds.some((r) => r.id === roundId))?.id ?? null;
}

function roundOfEvent(data: Data, eventId: string | null) {
  if (!eventId) return null;
  for (const pa of data.pauses) for (const r of pa.rounds) if (r.events.some((e) => e.id === eventId)) return r.id;
  return null;
}

/**
 * Welche Pause betrifft eine Änderung? Bei Löschungen schickt die Datenbank nur den Schlüssel der
 * gelöschten Zeile; die zugehörige Pause findet sich dann im bisherigen Stand.
 * Lässt sich nichts zuordnen, werden die laufenden Pausen nachgeladen.
 */
export function scopeForChange(c: Change, data: Data | null): Scope {
  if (c.table === '*' || !data) return { full: true };
  const r = c.row;
  const o = c.old;
  const pause = (id: string | null): Scope => (id ? { pauses: [id] } : { open: true });
  switch (c.table) {
    case 'players':
      return { players: true };
    case 'pauses':
      return pause(str(r.id) ?? str(o.id));
    case 'pause_players':
      return pause(str(r.pause_id) ?? str(o.pause_id));
    case 'rounds':
      return pause(str(r.pause_id) ?? pauseOfRound(data, str(o.id)));
    case 'round_players':
      return pause(pauseOfRound(data, str(r.round_id) ?? str(o.round_id)));
    case 'events':
      return pause(pauseOfRound(data, str(r.round_id) ?? roundOfEvent(data, str(o.id))));
    default:
      return { open: true };
  }
}

/** IDs der Pausen, die im bisherigen Stand noch laufen */
export const openPauseIds = (data: Data) => data.pauses.filter((p) => !p.endedAt).map((p) => p.id);

/**
 * Setzt frisch geladene Pausen in den Stand ein. Angefragte Pausen, die nicht zurückkamen,
 * wurden gelöscht und fliegen raus.
 */
export function mergePauses(data: Data, requested: string[], fresh: Pause[]): Data {
  const byId = new Map(data.pauses.map((p) => [p.id, p]));
  for (const id of requested) byId.delete(id);
  for (const p of fresh) byId.set(p.id, p);
  return { ...data, pauses: [...byId.values()].sort((a, b) => b.startedAt - a.startedAt) };
}
