import { useCallback, useEffect, useState } from 'react';
import type { Data } from '../domain/types';
import type { Backend, Session } from './backend';
import { createDemoBackend } from './demoBackend';
import { loadCache, saveCache } from './outbox';
import { createSupabaseBackend } from './supabaseBackend';

export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? createSupabaseBackend(url, key) : createDemoBackend();
}

/**
 * Lädt alle Daten und lädt neu, sobald sich irgendwo etwas ändert.
 * Der letzte Stand wird auf dem Gerät gespeichert; ohne Netz startet die App damit.
 */
export function useData(backend: Backend) {
  const cached = backend.kind === 'supabase' ? loadCache() : null;
  const [data, setData] = useState<Data | null>(cached?.data ?? null);
  const [loadedAt, setLoadedAt] = useState<number | null>(cached?.at ?? null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await backend.load();
      setData(d);
      setLoadedAt(Date.now());
      setError(null);
      if (backend.kind === 'supabase') saveCache(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [backend]);

  useEffect(() => {
    void reload();
    let t: number | undefined;
    const unsub = backend.subscribe(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void reload(), 150);
    });
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, [backend, reload]);

  // Nach Funkloch sofort neu laden statt auf die nächste Änderung zu warten
  useEffect(() => {
    const onOnline = () => void reload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  return { data, error, reload, loadedAt };
}

export function useSession(backend: Backend) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      backend.auth.current().then((s) => {
        if (!alive) return;
        setSession(s);
        setReady(true);
      });
    void refresh();
    const unsub = backend.auth.onChange(() => void refresh());
    return () => {
      alive = false;
      unsub();
    };
  }, [backend]);
  return { session, ready };
}
