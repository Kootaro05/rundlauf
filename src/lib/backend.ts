import type { Activity, Data, Invite, NewEvent, Pause, PrivateData } from '../domain/types';

export interface Session {
  email: string | null;
  /** Verknüpfter Spieler; null heißt: angemeldet, aber (noch) nicht eintragsberechtigt */
  playerId: string | null;
  isAdmin: boolean;
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

export interface InviteInfo {
  playerName: string | null;
  valid: boolean;
  reason: string | null;
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

  // Korrekturen vergangener Pausen, nur Admin (vorher mit validatePause prüfen)
  deleteEvent(eventId: string): Promise<void>;
  updateFinal(eventId: string, patch: { p: string; loser: string; server: string | null }): Promise<void>;
  deleteRound(roundId: string): Promise<void>;
  deletePause(pauseId: string): Promise<void>;

  /** Schnelles Anlegen am Tisch: nur ein Spitzname. Gibt die ID des neuen Spielers zurück. */
  addPlayer(name: string): Promise<string>;

  /** Echte Namen, Profilbilder und Logins, nur für eingetragene Spieler. Für alle anderen leer. */
  loadPrivate(): Promise<PrivateData>;
  saveProfile(id: string, p: { name: string; firstName: string | null; lastName: string | null }): Promise<void>;
  /** Lädt ein vorbereitetes Bild hoch (siehe lib/image.ts) und löscht das alte */
  uploadAvatar(id: string, image: Blob, oldPath: string | null): Promise<void>;
  removeAvatar(id: string, path: string): Promise<void>;

  // Einladungen: Infos und Einlösen gehen ohne Admin-Rechte
  inviteInfo(token: string): Promise<InviteInfo>;
  redeemInvite(token: string, p: { name: string; firstName: string | null; lastName: string | null }): Promise<void>;

  // Admin
  setHidden(id: string, hidden: boolean): Promise<void>;
  /** Erzeugt einen neuen Einladungslink (Token) für einen Spieler ohne Login */
  createInvite(playerId: string): Promise<string>;
  listInvites(): Promise<Invite[]>;
  revokeInvite(id: string): Promise<void>;
  unlinkAccount(playerId: string): Promise<void>;
  /** Alle Runden von `from` gehen an `into`, `from` wird gelöscht */
  mergePlayers(from: string, into: string): Promise<void>;
  /** Neueste Einträge, Löschungen und Änderungen */
  loadActivity(limit: number): Promise<Activity[]>;
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
