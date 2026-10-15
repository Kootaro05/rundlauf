import { createContext, useContext, type CSSProperties } from 'react';
import type { Podium } from '../domain/elo';
import type { Data, NewEvent, Pause, PrivateData } from '../domain/types';
import type { Backend, Session } from '../lib/backend';
import type { Scope } from '../lib/sync';

export interface AppCtx {
  data: Data;
  backend: Backend;
  session: Session | null;
  canWrite: boolean;
  busy: boolean;
  /** Führt eine Schreibaktion aus, sperrt solange die Buttons und zeigt Fehler als Hinweis. */
  /** `scope`: was danach nachgeladen wird; ohne Angabe die laufende Pause und die Spieler */
  run: (fn: () => Promise<void>, ok?: string, scope?: Scope) => Promise<boolean>;
  toast: (msg: string) => void;
  /** Trägt ein Spielereignis ein. Ohne Netz landet es in der Warteschlange und wird nachgereicht. */
  addEvent: (roundId: string, seq: number, ev: NewEvent, ok?: string) => Promise<boolean>;
  /** Nimmt den letzten Eintrag der Pause zurück, zuerst wartende Offline-Einträge. */
  undo: (pa: Pause) => void;
  /** Trägt den zuletzt zurückgenommenen Eintrag wieder ein (nur auf diesem Gerät) */
  redo: () => void;
  /** Was "Wiederholen" eintragen würde, sonst null */
  redoNext: NewEvent | null;
  isAdmin: boolean;
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

const MedalIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" opacity=".55" d="M7 2h4l2 6H9zM13 2h4l-2 6h-4z" />
    <circle cx="12" cy="15" r="7" fill="currentColor" />
  </svg>
);

const StarIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z" />
  </svg>
);

const PODIUM_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' } as const;

/**
 * Auszeichnung der drei Besten: in der ELO Krone (1.) und Medaillen (2., 3.),
 * in der Semester-ELO Sterne; jeweils in Gold, Silber, Bronze.
 */
export function PodiumIcon({ place, kind }: { place?: Podium; kind: 'elo' | 'semester' }) {
  if (!place) return null;
  const label = `${place}. Platz ${kind === 'elo' ? 'ELO' : 'Semester-ELO'}`;
  return (
    <span className={`podium ${PODIUM_CLASS[place]}`} title={label} aria-label={label}>
      {kind === 'semester' ? <StarIcon /> : place === 1 ? <CrownIcon /> : <MedalIcon />}
    </span>
  );
}

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
export function Avatar({ p, size, place }: { p: string; size: number; place?: Podium }) {
  const { avatar, name, color } = useApp();
  const url = avatar(p);
  // Die drei Besten (ELO) bekommen einen Rahmen in Gold, Silber oder Bronze
  const ring = place ? ` ring ${PODIUM_CLASS[place]}` : '';
  return (
    <span className={`avatar-tile${ring}`} aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4, '--pc': color(p) } as CSSProperties}>
      {url ? <img src={url} alt="" /> : initials(name(p))}
    </span>
  );
}

export const plural =(n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
