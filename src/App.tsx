import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { History } from './components/History';
import { Live } from './components/Live';
import { LoginForm } from './components/Login';
import { Players } from './components/Players';
import { CrownIcon, Ctx, type AppCtx } from './components/ui';
import { Admin } from './components/Admin';
import { InvitePage } from './components/InvitePage';
import { TableMode } from './components/TableMode';
import { checkEvent, currentRound, nextSeq, openPause, roundInfo } from './domain/game';
import { loadPendingInvite, redeemPendingInvite } from './lib/invite';
import { fmtTime } from './domain/periods';
import type { NewEvent, Pause, PrivateData } from './domain/types';
import { EMPTY_PRIVATE, isNetworkError } from './lib/backend';
import { parseHash, toHash, type Route, type Tab } from './lib/route';
import { createBackend, useData, useSession } from './lib/hooks';
import { applyOutbox, loadOutbox, saveOutbox, type PendingEvent } from './lib/outbox';
import type { Scope } from './lib/sync';

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'dash', label: 'Dashboard' },
  { id: 'hist', label: 'Verlauf' },
  { id: 'players', label: 'Spieler' },
];

/** Ein zurückgenommener Eintrag, den "Wiederholen" wieder eintragen kann */
interface RedoItem {
  roundId: string;
  ev: NewEvent;
}

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

function initialRoute(): Route {
  const fromHash = parseHash(window.location.hash);
  if (fromHash) return fromHash;
  try {
    const t = localStorage.getItem('rk.tab');
    if (TABS.some((x) => x.id === t)) return { tab: t as Tab, player: null };
  } catch { /* Speicher gesperrt */ }
  return { tab: 'live', player: null };
}

/** Rubrik und Profil stehen in der Adresse (#/spieler/<id>), damit Zurück am Handy funktioniert. */
function useRoute() {
  const [route, setRoute] = useState<Route>(initialRoute);
  // Ob das Profil per Klick in der App geöffnet wurde; dann führt "Zurück" einen Schritt im Verlauf zurück
  const pushedProfile = useRef(false);

  useEffect(() => {
    const onHash = () => {
      const r = parseHash(window.location.hash) ?? { tab: 'live', player: null };
      if (!r.player) pushedProfile.current = false;
      setRoute(r);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((r: Route, replace = false) => {
    if (replace) window.history.replaceState(null, '', toHash(r));
    else window.history.pushState(null, '', toHash(r));
    setRoute(r);
    try { localStorage.setItem('rk.tab', r.tab); } catch { /* egal */ }
  }, []);

  const openProfile = useCallback((id: string) => {
    pushedProfile.current = true;
    go({ tab: 'players', player: id });
  }, [go]);

  const closeProfile = useCallback(() => {
    if (pushedProfile.current) {
      pushedProfile.current = false;
      window.history.back();
    } else go({ tab: 'players', player: null }, true);
  }, [go]);

  return { route, go, openProfile, closeProfile };
}

export default function App() {
  const backend = useMemo(createBackend, []);
  const { data: serverData, error, reload, refresh, loadedAt } = useData(backend);
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
  const { session, ready, refresh: refreshSession } = useSession(backend);
  const { route, go, openProfile, closeProfile } = useRoute();
  const tab = route.tab;
  const isAdmin = !!session?.isAdmin;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const toastTimer = useRef<number>();
  const install = useInstallPrompt();
  const isMember = !!session?.playerId;

  // Echte Namen, Bilder und Logins: nur für eingetragene Spieler. Bild-Links laufen nach einer Stunde ab.
  const [priv, setPriv] = useState<PrivateData>(EMPTY_PRIVATE);
  const playerCount = serverData?.players.length ?? 0;
  const refreshPrivate = useCallback(async () => {
    setPriv(isMember ? await backend.loadPrivate() : EMPTY_PRIVATE);
  }, [backend, isMember]);
  useEffect(() => {
    void refreshPrivate();
    const timer = window.setInterval(() => void refreshPrivate(), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshPrivate, playerCount]);

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setMsg(null), 2800);
  }, []);

  // Angemeldet, aber noch keinem Spieler zugeordnet, und eine Einladung wartet: einlösen
  // (z. B. wenn der Eingeladene den Link aus der Mail statt den Code benutzt hat)
  useEffect(() => {
    if (!session || session.playerId || !loadPendingInvite()) return;
    redeemPendingInvite(backend)
      .then(async (done) => {
        if (!done) return;
        await refreshSession();
        toast('Willkommen! Dein Login ist eingerichtet.');
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
  }, [session, backend, refreshSession, toast]);

  // Nach eigenen Aktionen nur nachladen, was sich geändert haben kann (Standard: laufende Pause und Spieler)
  const run = useCallback(
    async (fn: () => Promise<void>, ok?: string, scope?: Scope) => {
      setBusy(true);
      try {
        await fn();
        await refresh(scope);
        if (ok) toast(ok);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
        await refresh(scope);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
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
      await refresh({ open: true });
    } finally {
      flushing.current = false;
    }
  }, [backend, refresh, setOutbox, toast]);

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

  const submitEvent = useCallback(
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
        // Spielereignisse gibt es nur in der laufenden Pause
        await refresh({ open: true });
        if (ok) toast(ok);
        return true;
      } catch (e) {
        if (isNetworkError(e)) return queue();
        toast(e instanceof Error ? e.message : String(e));
        await refresh({ open: true });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [backend, refresh, setOutbox, toast],
  );

  // Wiederholen: was auf diesem Gerät zurückgenommen wurde, bis jemand etwas Neues einträgt
  const [redoStack, setRedoStack] = useState<RedoItem[]>([]);

  const addEvent = useCallback(
    (roundId: string, seq: number, ev: NewEvent, ok?: string) => {
      setRedoStack([]);
      return submitEvent(roundId, seq, ev, ok);
    },
    [submitEvent],
  );

  const undo = useCallback(
    (pa: Pause) => {
      const lastRound = pa.rounds.at(-1);
      const lastEvent = lastRound?.events.at(-1);
      // Den Eintrag merken, damit "Wiederholen" ihn wieder eintragen kann. Eine leere Runde lässt sich nicht wiederholen.
      if (lastRound && lastEvent) {
        const { type, p, loser, server, pot } = lastEvent;
        setRedoStack((s) => [...s, { roundId: lastRound.id, ev: { type, p, loser, server, pot } }]);
      } else setRedoStack([]);

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

  const redo = useCallback(() => {
    const item = redoStack.at(-1);
    if (!item || !data) return;
    setRedoStack((s) => s.slice(0, -1));
    const pa = data.pauses.find((x) => x.rounds.some((r) => r.id === item.roundId));
    const r = pa?.rounds.find((x) => x.id === item.roundId);
    const err = !pa || !r ? 'Die Runde gibt es nicht mehr.' : checkEvent(pa, r, item.ev);
    if (err || !r) {
      setRedoStack([]);
      toast(`Wiederholen geht nicht mehr: ${err}`);
      return;
    }
    void submitEvent(r.id, nextSeq(r), item.ev, 'Wiederhergestellt');
  }, [redoStack, data, submitEvent, toast]);

  const ctx = useMemo<AppCtx | null>(() => {
    if (!data) return null;
    const byId = new Map(data.players.map((p) => [p.id, p]));
    const order = [...data.players].sort((a, b) => a.createdAt - b.createdAt).map((p) => p.id);
    return {
      data, backend, session, busy, run, toast, addEvent, undo, redo,
      redoNext: redoStack.at(-1)?.ev ?? null,
      canWrite: isMember,
      isMember,
      isAdmin,
      priv,
      refreshPrivate,
      openProfile,
      closeProfile,
      openTableMode: () => {
        go({ tab: 'table', player: null });
        // Vollbild geht nur direkt aus einem Klick heraus; wo es nicht erlaubt ist, bleibt es beim Fenster
        void document.documentElement.requestFullscreen?.().catch(() => {});
      },
      // Das eigene Profil, der Admin alle
      canEditPlayer: (id) => isAdmin || (isMember && id === session?.playerId),
      name: (id) => byId.get(id)?.name ?? 'Unbekannt',
      spokenName: (id) => byId.get(id)?.spoken?.trim() || byId.get(id)?.name || 'Unbekannt',
      realName: (id) => [priv.info[id]?.firstName, priv.info[id]?.lastName].filter(Boolean).join(' ') || null,
      avatar: (id) => priv.info[id]?.avatarUrl ?? null,
      color: (id) => `var(--c${Math.max(0, order.indexOf(id)) % 8})`,
    };
  }, [data, backend, session, busy, run, toast, addEvent, undo, redo, redoStack, isMember, isAdmin, priv, refreshPrivate, openProfile, closeProfile, go]);

  const pa = data ? openPause(data.pauses) : null;
  const r = currentRound(pa);

  // Tisch-Modus: Vollbild ohne Kopfzeile und Reiter
  if (tab === 'table')
    return (
      <>
        {ctx ? (
          <Ctx.Provider value={ctx}>
            <TableMode onExit={() => go({ tab: 'live', player: null }, true)} />
          </Ctx.Provider>
        ) : (
          <div className="tm"><div className="tm-center"><p className="tm-sub">Lade Daten …</p></div></div>
        )}
        {msg && <div className="toast" role="status">{msg}</div>}
      </>
    );

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
          {[...TABS, ...(isAdmin ? [{ id: 'admin' as Tab, label: 'Admin' }] : [])].map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go({ tab: t.id, player: null })}>{t.label}</button>
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
        {session && !session.playerId && tab !== 'invite' && (
          <div className="banner">
            <span>Angemeldet als <b>{session.email}</b>, aber diese E-Mail ist keinem Spieler zugeordnet. Für einen eigenen Login brauchst du einen Einladungslink vom Admin.</span>
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
        {tab === 'invite' && route.token ? (
          <InvitePage
            token={route.token}
            backend={backend}
            session={session}
            onDone={async (playerId) => {
              await refreshSession();
              toast('Willkommen! Dein Login ist eingerichtet.');
              go({ tab: 'players', player: playerId }, true);
            }}
            onLeave={() => go({ tab: 'live', player: null }, true)}
          />
        ) : !ctx ? (
          !error && <div className="card empty"><b>Lade Daten …</b></div>
        ) : (
          <Ctx.Provider value={ctx}>
            {tab === 'live' && <Live />}
            {tab === 'dash' && <Dashboard />}
            {tab === 'hist' && <History />}
            {tab === 'players' && <Players profile={route.player} />}
            {tab === 'admin' && (isAdmin ? <Admin /> : <div className="card empty"><b>Nur für den Admin.</b></div>)}
          </Ctx.Provider>
        )}
      </main>
      {msg && <div className="toast" role="status">{msg}</div>}
    </>
  );
}
