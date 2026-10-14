import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { History } from './components/History';
import { Live } from './components/Live';
import { LoginForm } from './components/Login';
import { Players } from './components/Players';
import { CrownIcon, Ctx, type AppCtx } from './components/ui';
import { currentRound, openPause, roundInfo } from './domain/game';
import { fmtTime } from './domain/periods';
import type { NewEvent, Pause } from './domain/types';
import { isNetworkError } from './lib/backend';
import { createBackend, useData, useSession } from './lib/hooks';
import { applyOutbox, loadOutbox, saveOutbox, type PendingEvent } from './lib/outbox';

const TABS = [
  { id: 'live', label: 'Live' },
  { id: 'dash', label: 'Dashboard' },
  { id: 'hist', label: 'Verlauf' },
  { id: 'players', label: 'Spieler' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Chrome/Edge/Android bieten die Installation über dieses Ereignis an (Safari kennt es nicht). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function useInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return evt && (() => void evt.prompt().finally(() => setEvt(null)));
}

function initialTab(): Tab {
  try {
    const t = localStorage.getItem('rk.tab');
    if (TABS.some((x) => x.id === t)) return t as Tab;
  } catch { /* Speicher gesperrt */ }
  return 'live';
}

export default function App() {
  const backend = useMemo(createBackend, []);
  const { data: serverData, error, reload, loadedAt } = useData(backend);
  const [outbox, setOutboxState] = useState<PendingEvent[]>(loadOutbox);
  const setOutbox = useCallback((f: (o: PendingEvent[]) => PendingEvent[]) => {
    setOutboxState((prev) => {
      const next = f(prev);
      saveOutbox(next);
      return next;
    });
  }, []);
  // Was die App zeigt: Serverstand plus Einträge, die noch auf Netz warten
  const data = useMemo(() => serverData && applyOutbox(serverData, outbox), [serverData, outbox]);
  const { session, ready } = useSession(backend);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const toastTimer = useRef<number>();
  const install = useInstallPrompt();

  const setTab = (t: Tab) => {
    setTabState(t);
    try { localStorage.setItem('rk.tab', t); } catch { /* egal */ }
  };

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setMsg(null), 2800);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<void>, ok?: string) => {
      setBusy(true);
      try {
        await fn();
        await reload();
        if (ok) toast(ok);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
        await reload();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload, toast],
  );

  // Wartende Offline-Einträge der Reihe nach senden. Lehnt der Server einen ab (Regeln), wird er verworfen.
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      for (const p of loadOutbox()) {
        try {
          await backend.addEvent(p.roundId, p.seq, p.ev);
        } catch (e) {
          if (isNetworkError(e)) break;
          toast(`Offline-Eintrag verworfen: ${e instanceof Error ? e.message : String(e)}`);
        }
        setOutbox((o) => o.filter((x) => x.key !== p.key));
      }
      await reload();
    } finally {
      flushing.current = false;
    }
  }, [backend, reload, setOutbox, toast]);

  useEffect(() => {
    if (!outbox.length) return;
    void flush();
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void flush(), 15000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [outbox.length, flush]);

  const addEvent = useCallback(
    async (roundId: string, seq: number, ev: NewEvent, ok?: string) => {
      const queue = () => {
        setOutbox((o) => [...o, { key: crypto.randomUUID(), roundId, seq, ev, t: Date.now() }]);
        toast(`${ok ?? 'Eingetragen'}. Kein Netz, wird nachgereicht.`);
        return true;
      };
      // Warten schon Einträge, muss der neue hinten anstehen, damit die Reihenfolge stimmt
      if (!navigator.onLine || loadOutbox().length) return queue();
      setBusy(true);
      try {
        await backend.addEvent(roundId, seq, ev);
        await reload();
        if (ok) toast(ok);
        return true;
      } catch (e) {
        if (isNetworkError(e)) return queue();
        toast(e instanceof Error ? e.message : String(e));
        await reload();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [backend, reload, setOutbox, toast],
  );

  const undo = useCallback(
    (pa: Pause) => {
      const roundIds = new Set(pa.rounds.map((r) => r.id));
      const pending = outbox.filter((p) => roundIds.has(p.roundId));
      if (pending.length) {
        const last = pending.at(-1)!;
        setOutbox((o) => o.filter((x) => x.key !== last.key));
        toast('Zurückgenommen');
        return;
      }
      void run(() => backend.undo(pa), 'Zurückgenommen');
    },
    [outbox, setOutbox, toast, run, backend],
  );

  const ctx = useMemo<AppCtx | null>(() => {
    if (!data) return null;
    const byId = new Map(data.players.map((p) => [p.id, p]));
    const order = [...data.players].sort((a, b) => a.createdAt - b.createdAt).map((p) => p.id);
    return {
      data, backend, session, busy, run, toast, addEvent, undo,
      canWrite: !!session?.playerId,
      name: (id) => byId.get(id)?.name ?? 'Unbekannt',
      color: (id) => `var(--c${Math.max(0, order.indexOf(id)) % 8})`,
    };
  }, [data, backend, session, busy, run, toast, addEvent, undo]);

  const pa = data ? openPause(data.pauses) : null;
  const r = currentRound(pa);

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand">
            <h1>
              <span className="t1">
                Rundlauf
                <svg className="arc" viewBox="0 0 56 64" aria-hidden="true">
                  <path d="M4 60 Q 12 2 46 14" />
                  <circle cx="46" cy="14" r="5.5" />
                </svg>
              </span>
              <span className="t2">Analytics</span>
            </h1>
          </div>
          <div className="topright">
            {pa && (
              <div className="potbadge">
                {r ? <><span>Runde {r.number}</span><CrownIcon /><b className="num">{roundInfo(r).pot}</b><span>im Pot</span></> : <span>Pause läuft seit {fmtTime(pa.startedAt)}</span>}
              </div>
            )}
            {install && <button className="authbtn" onClick={install}>Installieren</button>}
            {backend.kind === 'supabase' && ready && (
              session
                ? <button className="authbtn" onClick={() => void backend.auth.signOut()} title={session.email ?? ''}>Abmelden</button>
                : <button className="authbtn" onClick={() => setLogin(true)}>Anmelden</button>
            )}
          </div>
        </div>
      </header>
      <nav className="tabs" aria-label="Bereiche">
        <div className="wrap" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </nav>
      <main className="wrap">
        {backend.kind === 'demo' && (
          <div className="banner">
            <span><b>Demo-Modus.</b> Kein Supabase-Projekt verbunden. Erfundene Beispieldaten, Änderungen gehen beim Neuladen verloren.</span>
          </div>
        )}
        {login && !session && <LoginForm backend={backend} onClose={() => setLogin(false)} />}
        {session && !session.playerId && (
          <div className="banner">
            <span>Angemeldet als <b>{session.email}</b>, aber diese E-Mail ist keinem Spieler zugeordnet. Bitte jemanden aus der Runde, sie im Tab „Spieler“ einzutragen.</span>
          </div>
        )}
        {outbox.length > 0 && (
          <div className="banner">
            <span><b>{outbox.length === 1 ? '1 Eintrag wartet' : `${outbox.length} Einträge warten`} auf Netz.</b> Wird automatisch nachgereicht. Runden und Pausen starten geht erst wieder online.</span>
          </div>
        )}
        {error && (data ? (
          <div className="banner">
            <span>Keine Verbindung. Du siehst den Stand von {loadedAt ? fmtTime(loadedAt) : 'vorhin'} Uhr.</span>
            <button className="btn small" onClick={() => void reload()}>Neu laden</button>
          </div>
        ) : (
          <div className="banner err"><span>Daten konnten nicht geladen werden: {error}</span><button className="btn small" onClick={() => void reload()}>Nochmal</button></div>
        ))}
        {!ctx ? (
          !error && <div className="card empty"><b>Lade Daten …</b></div>
        ) : (
          <Ctx.Provider value={ctx}>
            {tab === 'live' && <Live />}
            {tab === 'dash' && <Dashboard />}
            {tab === 'hist' && <History />}
            {tab === 'players' && <Players />}
          </Ctx.Provider>
        )}
      </main>
      {msg && <div className="toast" role="status">{msg}</div>}
    </>
  );
}
