import { useCallback, useEffect, useState } from 'react';
import type { Data } from '../domain/types';
import type { Backend, Session } from './backend';
import { createDemoBackend } from './demoBackend';
import { createSupabaseBackend } from './supabaseBackend';

export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? createSupabaseBackend(url, key) : createDemoBackend();
}

/** Lädt alle Daten und lädt neu, sobald sich irgendwo etwas ändert. */
export function useData(backend: Backend) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await backend.load());
      setError(null);
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

  return { data, error, reload };
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
