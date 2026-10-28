export type EventType = 'schwimmer' | 'crown' | 'out' | 'final';

/** Ein Eintrag in einer Runde. Bei `final` ist `p` der Gewinner. */
export interface GameEvent {
  id: string;
  seq: number;
  type: EventType;
  p: string;
  loser: string | null;
  server: string | null;
  pot: number | null;
  t: number;
}

export interface Round {
  id: string;
  number: number;
  startedAt: number;
  participants: string[];
  events: GameEvent[];
}

export interface Pause {
  id: string;
  startedAt: number;
  endedAt: number | null;
  participants: string[];
  rounds: Round[];
}

export interface Player {
  id: string;
  name: string;
  hidden: boolean;
  createdAt: number;
  /** Wie der Kommentator den Spitznamen ausspricht; leer heißt: den Spitznamen vorlesen */
  spoken?: string | null;
}

/** Nur für eingetragene Spieler sichtbar */
export interface PlayerPrivate {
  firstName: string | null;
  lastName: string | null;
  avatarPath: string | null;
  /** Kurzlebige Adresse zum Anzeigen des Bildes */
  avatarUrl: string | null;
}

export interface Account {
  email: string;
  /** Hat sich schon einmal angemeldet */
  linked: boolean;
  /** Auth-ID des Logins, für das Protokoll */
  userId: string | null;
  isAdmin: boolean;
}

export interface PrivateData {
  info: Record<string, PlayerPrivate>;
  accounts: Record<string, Account>;
}

export interface Invite {
  id: string;
  playerId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}

/** Ein Eintrag im Admin-Protokoll: neu eingetragen, gelöscht oder geändert */
export interface Activity {
  id: string;
  at: number;
  /** Login, der es getan hat (Auth-ID); per Admin-Zuordnung auf einen Spieler abbildbar */
  userId: string | null;
  action: 'insert' | 'delete' | 'update';
  table: string;
  row: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
}

export interface Data {
  players: Player[];
  pauses: Pause[];
}

export type NewEvent = Pick<GameEvent, 'type' | 'p'> & Partial<Pick<GameEvent, 'loser' | 'server' | 'pot'>>;
