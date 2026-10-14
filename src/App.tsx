import { useCallback, useMemo, useRef, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { History } from './components/History';
import { Live } from './components/Live';
import { LoginForm } from './components/Login';
import { Players } from './components/Players';
import { CrownIcon, Ctx, type AppCtx } from './components/ui';
import { currentRound, openPause, roundInfo } from './domain/game';
import { fmtTime } from './domain/periods';
import { createBackend, useData, useSession } from './lib/hooks';

const TABS = [
  { id: 'live', label: 'Live' },
  { id: 'dash', label: 'Dashboard' },
  { id: 'hist', label: 'Verlauf' },
  { id: 'players', label: 'Spieler' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function initialTab(): Tab {
  try {
    const t = localStorage.getItem('rk.tab');
    if (TABS.some((x) => x.id === t)) return t as Tab;
  } catch { /* Speicher gesperrt */ }
  return 'live';
}

export default function App() {
  const backend = useMemo(createBackend, []);
  const { data, error, reload } = useData(backend);
  const { session, ready } = useSession(backend);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const toastTimer = useRef<number>();

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

  const ctx = useMemo<AppCtx | null>(() => {
    if (!data) return null;
    const byId = new Map(data.players.map((p) => [p.id, p]));
    const order = [...data.players].sort((a, b) => a.createdAt - b.createdAt).map((p) => p.id);
    return {
      data, backend, session, busy, run, toast,
      canWrite: !!session?.playerId,
      name: (id) => byId.get(id)?.name ?? 'Unbekannt',
      color: (id) => `var(--c${Math.max(0, order.indexOf(id)) % 8})`,
    };
  }, [data, backend, session, busy, run, toast]);

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
        {error && <div className="banner err"><span>Daten konnten nicht geladen werden: {error}</span><button className="btn small" onClick={() => void reload()}>Nochmal</button></div>}
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
