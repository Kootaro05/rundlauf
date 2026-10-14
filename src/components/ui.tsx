import { createContext, useContext, type CSSProperties } from 'react';
import type { Data, NewEvent, Pause, PrivateData } from '../domain/types';
import type { Backend, Session } from '../lib/backend';

export interface AppCtx {
  data: Data;
  backend: Backend;
  session: Session | null;
  canWrite: boolean;
  busy: boolean;
  /** Führt eine Schreibaktion aus, sperrt solange die Buttons und zeigt Fehler als Hinweis. */
  run: (fn: () => Promise<void>, ok?: string) => Promise<boolean>;
  toast: (msg: string) => void;
  /** Trägt ein Spielereignis ein. Ohne Netz landet es in der Warteschlange und wird nachgereicht. */
  addEvent: (roundId: string, seq: number, ev: NewEvent, ok?: string) => Promise<boolean>;
  /** Nimmt den letzten Eintrag der Pause zurück, zuerst wartende Offline-Einträge. */
  undo: (pa: Pause) => void;
  /** Spitzname, für alle sichtbar */
  name: (id: string) => string;
  color: (id: string) => string;

  /** Eingetragener Spieler: sieht echte Namen, Profile und Bilder */
  isMember: boolean;
  priv: PrivateData;
  refreshPrivate: () => Promise<void>;
  canEditPlayer: (id: string) => boolean;
  /** Vor- und Nachname, nur für Mitglieder, sonst null */
  realName: (id: string) => string | null;
  avatar: (id: string) => string | null;
  openProfile: (id: string) => void;
  closeProfile: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp außerhalb von <Ctx.Provider>');
  return c;
}

export const CrownIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M3 7.5l4.6 4 4.4-7 4.4 7 4.6-4-1.7 11H4.7z" />
  </svg>
);

export const WaveIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M2 10c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" />
  </svg>
);

export function Dot({ p }: { p: string }) {
  const { color } = useApp();
  return <span className="dot" style={{ background: color(p) }} />;
}

const initials = (s: string) =>
  s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/**
 * Profilbild als Kachel in der Spielerfarbe. Freigestellte Bilder stehen ohne Rahmen unten bündig darin.
 * Ohne Bild: Initialen.
 */
export function Avatar({ p, size }: { p: string; size: number }) {
  const { avatar, name, color } = useApp();
  const url = avatar(p);
  return (
    <span className="avatar-tile" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4, '--pc': color(p) } as CSSProperties}>
      {url ? <img src={url} alt="" /> : <span className="ini">{initials(name(p))}</span>}
    </span>
  );
}

export const plural =(n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
