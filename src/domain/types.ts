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
  /** Hat sich schon einmal angemeldet. Dann darf nur der Spieler selbst sein Profil ändern. */
  linked: boolean;
}

export interface PrivateData {
  info: Record<string, PlayerPrivate>;
  accounts: Record<string, Account>;
}

export interface Data {
  players: Player[];
  pauses: Pause[];
}

export type NewEvent = Pick<GameEvent, 'type' | 'p'> & Partial<Pick<GameEvent, 'loser' | 'server' | 'pot'>>;
