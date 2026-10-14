import type { Data, NewEvent, Pause, PrivateData } from '../domain/types';

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
  setHidden(id: string, hidden: boolean): Promise<void>;
  /** Nur bei Spielern, die sich noch nie angemeldet haben */
  setEmail(id: string, email: string | null): Promise<void>;

  /** Echte Namen, Profilbilder und Logins, nur für eingetragene Spieler. Für alle anderen leer. */
  loadPrivate(): Promise<PrivateData>;
  saveProfile(id: string, p: { name: string; firstName: string | null; lastName: string | null }): Promise<void>;
  /** Lädt ein vorbereitetes Bild hoch (siehe lib/image.ts) und löscht das alte */
  uploadAvatar(id: string, image: Blob, oldPath: string | null): Promise<void>;
  removeAvatar(id: string, path: string): Promise<void>;
}

export const EMPTY_PRIVATE: PrivateData = { info: {}, accounts: {} };

export class AppError extends Error {
  /** true, wenn der Server nicht erreichbar war (kein Netz), statt dass er abgelehnt hat */
  constructor(message: string, readonly network = false) {
    super(message);
  }
}

export const isNetworkError = (e: unknown) =>
  (e instanceof AppError && e.network) || e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
