import { createContext, useContext } from 'react';
import type { Data } from '../domain/types';
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
  name: (id: string) => string;
  color: (id: string) => string;
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

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
