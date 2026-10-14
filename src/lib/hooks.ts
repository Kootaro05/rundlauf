import { useCallback, useEffect, useRef, useState } from 'react';
import type { Data } from '../domain/types';
import type { Backend, Session } from './backend';
import { createDemoBackend } from './demoBackend';
import { loadCache, saveCache } from './outbox';
import { mergePauses, mergeScopes, openPauseIds, scopeForChange, type Scope } from './sync';
import { createSupabaseBackend } from './supabaseBackend';

export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? createSupabaseBackend(url, key) : createDemoBackend();
}

/** Nach so langer Zeit im Hintergrund wird beim Zurückkommen alles neu geladen */
const STALE_AFTER = 10 * 60 * 1000;

/**
 * Hält die Daten aktuell und lädt dabei so wenig wie möglich:
 * - alles nur beim Start, nach einem Funkloch und nach längerer Zeit im Hintergrund
 * - bei Änderungen (auch von anderen Geräten) nur die betroffene Pause bzw. die Spieler
 * Der letzte Stand wird auf dem Gerät gespeichert; ohne Netz startet die App damit.
 */
export function useData(backend: Backend) {
  const cached = backend.kind === 'supabase' ? loadCache() : null;
  const [data, setDataState] = useState<Data | null>(cached?.data ?? null);
  const [loadedAt, setLoadedAt] = useState<number | null>(cached?.at ?? null);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<Data | null>(cached?.data ?? null);
  const fullAt = useRef(0);

  const setData = useCallback((d: Data) => {
    dataRef.current = d;
    setDataState(d);
    setLoadedAt(Date.now());
    setError(null);
    if (backend.kind === 'supabase') saveCache(d);
  }, [backend]);

  /** Alles neu laden */
  const reload = useCallback(async () => {
    try {
      setData(await backend.load());
      fullAt.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [backend, setData]);

  /** Nur nachladen, was der Bereich nennt; ohne Angabe die laufenden Pausen und die Spieler */
  const refresh = useCallback(async (scope: Scope = { open: true, players: true }) => {
    const current = dataRef.current;
    if (scope.full || !current) return reload();
    try {
      const ids = [...new Set([...(scope.pauses ?? []), ...(scope.open ? openPauseIds(current) : [])])];
      const [players, pauses] = await Promise.all([
        scope.players ? backend.loadPlayers() : null,
        ids.length || scope.open ? backend.loadPauses({ ids, open: !!scope.open }) : null,
      ]);
      // Zwischenzeitliche Änderungen am Stand nicht überschreiben: auf den aktuellen Stand anwenden
      let next = dataRef.current ?? current;
      if (players) next = { ...next, players };
      if (pauses) next = mergePauses(next, ids, pauses);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [backend, reload, setData]);

  useEffect(() => {
    void reload();
    // Änderungen kurz sammeln (eine neue Runde meldet sich z. B. mehrfach) und dann gemeinsam nachladen
    let t: number | undefined;
    let pending: Scope = {};
    const unsub = backend.subscribe((c) => {
      pending = mergeScopes(pending, scopeForChange(c, dataRef.current));
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const scope = pending;
        pending = {};
        void refresh(scope);
      }, 150);
    });
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, [backend, reload, refresh]);

  // Nach Funkloch oder längerer Zeit im Hintergrund alles neu laden: verpasste Änderungen nachholen
  useEffect(() => {
    const onOnline = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - fullAt.current > STALE_AFTER) void reload();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  return { data, error, reload, refresh, loadedAt };
}

export function useSession(backend: Backend) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const s = await backend.auth.current();
    setSession(s);
    setReady(true);
  }, [backend]);
  useEffect(() => {
    void refresh();
    return backend.auth.onChange(() => void refresh());
  }, [backend, refresh]);
  return { session, ready, refresh };
}
