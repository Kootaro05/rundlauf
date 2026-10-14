import type { Data, NewEvent, Pause } from '../domain/types';

export interface Session {
  email: string | null;
  /** Verknüpfter Spieler; null heißt: angemeldet, aber (noch) nicht eintragsberechtigt */
  playerId: string | null;
}

export interface AuthApi {
  current(): Promise<Session | null>;
  onChange(cb: () => void): () => void;
  /** Schickt eine Mail mit Login-Link und Code. */
  signIn(email: string): Promise<void>;
  /** Meldet mit dem Code aus der Mail an. Nötig in der installierten App auf dem iPhone, wo Links in Safari landen. */
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Alles, was die Oberfläche lesen und schreiben kann. Supabase und Demo implementieren dasselbe. */
export interface Backend {
  kind: 'supabase' | 'demo';
  auth: AuthApi;
  load(): Promise<Data>;
  /** Meldet jede Änderung, auch von anderen Geräten. Gibt eine Abmeldefunktion zurück. */
  subscribe(onChange: () => void): () => void;

  startPause(playerIds: string[]): Promise<void>;
  startRound(pauseId: string, playerIds: string[]): Promise<void>;
  addEvent(roundId: string, seq: number, ev: NewEvent): Promise<void>;
  /** Nimmt den letzten Eintrag der Pause zurück, bei einer leeren Runde die Runde selbst. */
  undo(pause: Pause): Promise<void>;
  endPause(pauseId: string): Promise<void>;

  // Korrekturen im Verlauf (vorher mit validatePause prüfen)
  deleteEvent(eventId: string): Promise<void>;
  updateFinal(eventId: string, patch: { p: string; loser: string; server: string | null }): Promise<void>;
  deleteRound(roundId: string): Promise<void>;
  deletePause(pauseId: string): Promise<void>;

  addPlayer(name: string, email: string | null): Promise<void>;
  updatePlayer(id: string, patch: { name?: string; hidden?: boolean }): Promise<void>;
  setEmail(id: string, email: string | null): Promise<void>;
  /** E-Mails der Spieler, nur für Mitglieder sichtbar */
  playerEmails(): Promise<Record<string, string>>;
}

export class AppError extends Error {
  /** true, wenn der Server nicht erreichbar war (kein Netz), statt dass er abgelehnt hat */
  constructor(message: string, readonly network = false) {
    super(message);
  }
}

export const isNetworkError = (e: unknown) =>
  (e instanceof AppError && e.network) || e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
