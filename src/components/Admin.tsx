import { useCallback, useEffect, useState } from 'react';
import { fmtDate, fmtTime } from '../domain/periods';
import type { Activity, Invite } from '../domain/types';
import { inviteUrl } from '../lib/route';
import { History } from './History';
import { Avatar, useApp } from './ui';

type Section = 'spieler' | 'pausen' | 'einladungen' | 'protokoll' | 'daten';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'spieler', label: 'Spieler' },
  { id: 'pausen', label: 'Pausen' },
  { id: 'einladungen', label: 'Einladungen' },
  { id: 'protokoll', label: 'Protokoll' },
  { id: 'daten', label: 'Daten' },
];

const isOpenInvite = (i: Invite) => !i.usedAt && !i.revokedAt && i.expiresAt > Date.now();

/** Nur für den Admin: Spieler und Logins verwalten, vergangene Pausen korrigieren, Protokoll, Export */
export function Admin() {
  const [section, setSection] = useState<Section>('spieler');
  const { backend, toast } = useApp();
  const [invites, setInvites] = useState<Invite[]>([]);
  const loadInvites = useCallback(async () => {
    try {
      setInvites(await backend.listInvites());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  }, [backend, toast]);
  useEffect(() => void loadInvites(), [loadInvites]);

  return (
    <section className="stack">
      <div className="row between">
        <h2>Admin</h2>
        <div className="seg" role="group" aria-label="Bereich">
          {SECTIONS.map((s) => (
            <button key={s.id} aria-pressed={section === s.id} onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>
      {section === 'spieler' && <PlayersAdmin invites={invites} reloadInvites={loadInvites} />}
      {section === 'pausen' && (
        <>
          <p className="sub">Pause aufklappen, dann „Korrigieren“. Jede Änderung wird gegen die Regeln geprüft.</p>
          <History admin />
        </>
      )}
      {section === 'einladungen' && <InvitesAdmin invites={invites} reloadInvites={loadInvites} />}
      {section === 'protokoll' && <ActivityAdmin />}
      {section === 'daten' && <DataAdmin />}
    </section>
  );
}

// ---------------------------------------------------------------------------

function PlayersAdmin({ invites, reloadInvites }: { invites: Invite[]; reloadInvites: () => Promise<void> }) {
  const { data, priv, backend, run, busy, toast, name, realName, openProfile } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [link, setLink] = useState<{ player: string; url: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState('');
  const players = [...data.players].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const invite = async (pid: string) => {
    try {
      const token = await backend.createInvite(pid);
      setLink({ player: pid, url: inviteUrl(token) });
      await reloadInvites();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async () => {
    const n = newName.trim().slice(0, 24);
    if (!n) return;
    let pid = '';
    if (await run(async () => { pid = await backend.addPlayer(n); }, `${n} angelegt`)) {
      setNewName('');
      setOpen(pid);
      await invite(pid);
    }
  };

  return (
    <div className="stack">
      <form className="card" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <h3>Neuer Spieler mit Einladung</h3>
        <div className="row">
          <input id="adm-new" type="text" maxLength={24} placeholder="Spitzname" aria-label="Spitzname" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn primary" disabled={busy || !newName.trim()}>Anlegen und Link erzeugen</button>
        </div>
        <p className="sub">Am Tisch angelegte Spieler lädst du unten in der Liste ein.</p>
      </form>

      <div className="card">
        <div className="plist-players">
          {players.map((p) => {
            const acc = priv.accounts[p.id];
            const inv = invites.find((i) => i.playerId === p.id && isOpenInvite(i));
            const status = acc?.isAdmin ? 'Admin' : acc?.linked ? 'Login' : inv ? `Einladung bis ${fmtDate(inv.expiresAt).slice(0, 6)}` : 'ohne Login';
            const isOpen = open === p.id;
            return (
              <div key={p.id} className="stack admin-row">
                <button className="prow" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : p.id); setConfirm(null); }}>
                  <Avatar p={p.id} size={40} />
                  <span className="pinfo">
                    <span className="row">
                      <b>{name(p.id)}</b>
                      <span className={`tag ${acc?.linked ? 'gold' : ''}`}>{status}</span>
                      {p.hidden && <span className="tag">ausgeblendet</span>}
                    </span>
                    <span className="sub">{[realName(p.id), acc?.email].filter(Boolean).join(' · ') || 'keine weiteren Angaben'}</span>
                  </span>
                  <span className="chev" aria-hidden="true">{isOpen ? '⌄' : '›'}</span>
                </button>

                {isOpen && (
                  <div className="admin-actions">
                    {link?.player === p.id && <InviteLinkBox url={link.url} who={name(p.id)} />}
                    <div className="row">
                      <button className="btn small" onClick={() => openProfile(p.id)}>Profil bearbeiten</button>
                      {!acc?.linked && (
                        <button className="btn small primary" disabled={busy} onClick={() => void invite(p.id)}>
                          {inv ? 'Neuen Einladungslink erzeugen' : 'Einladungslink erzeugen'}
                        </button>
                      )}
                      <button className="btn small ghost" disabled={busy}
                        onClick={() => void run(() => backend.setHidden(p.id, !p.hidden), p.hidden ? 'Wieder in der Spielerauswahl' : 'Ausgeblendet')}>
                        {p.hidden ? 'Einblenden' : 'Ausblenden'}
                      </button>
                      {acc?.linked && !acc.isAdmin && (
                        <button className="btn small ghost" onClick={() => setConfirm(`unlink:${p.id}`)}>Login trennen</button>
                      )}
                      <button className="btn small ghost" onClick={() => { setConfirm(`merge:${p.id}`); setMergeInto(''); }}>Zusammenführen …</button>
                    </div>

                    {confirm === `unlink:${p.id}` && (
                      <div className="note row between">
                        <span>Login von {name(p.id)} trennen? Danach kann er nicht mehr eintragen, bis er eine neue Einladung einlöst.</span>
                        <span className="row">
                          <button className="btn small danger" disabled={busy}
                            onClick={() => void run(() => backend.unlinkAccount(p.id), 'Login getrennt').then(() => setConfirm(null))}>Trennen</button>
                          <button className="btn small" onClick={() => setConfirm(null)}>Nein</button>
                        </span>
                      </div>
                    )}

                    {confirm === `merge:${p.id}` && (
                      <div className="note stack">
                        <span>
                          Alle Runden von <b>{name(p.id)}</b> gehen an den gewählten Spieler, <b>{name(p.id)}</b> wird danach gelöscht.
                          Für doppelt angelegte Spieler.
                        </span>
                        <div className="row">
                          <select id={`merge-${p.id}`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} aria-label="Zusammenführen mit">
                            <option value="">Übernehmen durch …</option>
                            {players.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <button className="btn small danger" disabled={busy || !mergeInto}
                            onClick={() => void run(() => backend.mergePlayers(p.id, mergeInto), 'Zusammengeführt').then((ok) => { if (ok) { setConfirm(null); setOpen(null); } })}>
                            Zusammenführen
                          </button>
                          <button className="btn small" onClick={() => setConfirm(null)}>Abbrechen</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Der Link wird nur einmal angezeigt (gespeichert ist nur ein Hash), darum gleich kopieren oder teilen */
function InviteLinkBox({ url, who }: { url: string; who: string }) {
  const { toast } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link kopiert');
    } catch {
      (document.getElementById('invite-url') as HTMLInputElement | null)?.select();
    }
  };
  const share = () =>
    navigator.share?.({ title: 'Einladung zu Rundlauf-Analytics', text: `Hier ist deine Einladung als ${who}:`, url }).catch(() => {});
  return (
    <div className="note stack">
      <span><b>Einladungslink für {who}</b>, gültig 7 Tage, einmal benutzbar. Er wird nur jetzt angezeigt.</span>
      <input id="invite-url" type="text" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Einladungslink" />
      <div className="row">
        <button className="btn small primary" onClick={() => void copy()}>Kopieren</button>
        {'share' in navigator && <button className="btn small" onClick={() => void share()}>Teilen</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function InvitesAdmin({ invites, reloadInvites }: { invites: Invite[]; reloadInvites: () => Promise<void> }) {
  const { backend, run, busy, name } = useApp();
  if (!invites.length) return <div className="card empty"><b>Noch keine Einladungen.</b><span>Einladungslinks erzeugst du unter „Spieler“.</span></div>;
  const status = (i: Invite) =>
    i.usedAt ? `benutzt am ${fmtDate(i.usedAt).slice(0, 6)}`
      : i.revokedAt ? 'zurückgezogen'
        : i.expiresAt < Date.now() ? 'abgelaufen'
          : `offen bis ${fmtDate(i.expiresAt).slice(0, 6)}`;
  return (
    <div className="card">
      <div className="plist-players">
        {invites.map((i) => (
          <div key={i.id} className="prow">
            <span className="pinfo">
              <span className="row"><b>{name(i.playerId)}</b><span className={`tag ${isOpenInvite(i) ? 'gold' : ''}`}>{status(i)}</span></span>
              <span className="sub">erzeugt am {fmtDate(i.createdAt)} um {fmtTime(i.createdAt)}</span>
            </span>
            {isOpenInvite(i) && (
              <button className="btn small ghost" disabled={busy}
                onClick={() => void run(() => backend.revokeInvite(i.id), 'Einladung zurückgezogen').then(reloadInvites)}>Zurückziehen</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ActivityAdmin() {
  const { backend, priv, name, toast } = useApp();
  const [items, setItems] = useState<Activity[] | null>(null);
  useEffect(() => {
    backend.loadActivity(150).then(setItems, (e: unknown) => toast(e instanceof Error ? e.message : String(e)));
  }, [backend, toast]);

  // Login → Spieler, damit das Protokoll Spitznamen statt Login-IDs zeigt
  const byUser = Object.fromEntries(Object.entries(priv.accounts).filter(([, a]) => a.userId).map(([pid, a]) => [a.userId!, pid]));
  const who = (userId: string | null) => (userId && byUser[userId] ? name(byUser[userId]) : userId ? 'unbekannter Login' : 'System');
  const n = (v: unknown) => (typeof v === 'string' ? name(v) : '?');

  const describe = (a: Activity): string => {
    const r = a.row ?? {};
    const b = a.before ?? {};
    if (a.table === 'events') {
      const ev = a.action === 'delete' ? b : r;
      const what = ev.type === 'schwimmer' ? `Schwimmer für ${n(ev.player_id)}`
        : ev.type === 'crown' ? `Krone von ${n(ev.player_id)}`
          : ev.type === 'out' ? `${n(ev.player_id)} raus`
            : `Finale: ${n(ev.player_id)} schlägt ${n(ev.loser_id)} (+${String(ev.pot)})`;
      if (a.action === 'insert') return what;
      if (a.action === 'delete') return `gelöscht: ${what}`;
      return `geändert: Finale jetzt ${n(r.player_id)} schlägt ${n(r.loser_id)}`;
    }
    if (a.table === 'rounds') return `Runde ${String(b.number)} gelöscht`;
    if (a.table === 'pauses') return `Pause vom ${typeof b.started_at === 'string' ? fmtDate(Date.parse(b.started_at)) : '?'} gelöscht`;
    if (a.table === 'players') {
      if (a.action === 'delete') return `Spieler ${String(b.name)} gelöscht (zusammengeführt)`;
      if (b.name !== r.name) return `Spitzname ${String(b.name)} → ${String(r.name)}`;
      if (b.hidden !== r.hidden) return `${String(r.name)} ${r.hidden ? 'ausgeblendet' : 'eingeblendet'}`;
      return `${String(r.name)} geändert`;
    }
    return `${a.action} in ${a.table}`;
  };

  if (!items) return <p className="sub">Lade Protokoll …</p>;
  return (
    <div className="card">
      <p className="sub">Die letzten {items.length} Aktionen. Löschungen stammen aus „Rückgängig“ in der laufenden Pause oder aus Korrekturen.</p>
      <div className="timeline">
        {items.map((a) => (
          <div key={a.id} className={`ev ${a.action === 'insert' ? '' : 'ev-change'}`}>
            <time>{fmtDate(a.at).slice(0, 6)}<br />{fmtTime(a.at)}</time>
            <span><b>{who(a.userId)}</b> · {describe(a)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DataAdmin() {
  const { data, priv, toast } = useApp();
  const exportAll = async () => {
    const file = new File(
      [JSON.stringify({ exportedAt: new Date().toISOString(), players: data.players, private: priv, pauses: data.pauses }, null, 2)],
      `rundlauf-export-${new Date().toISOString().slice(0, 10)}.json`,
      { type: 'application/json' },
    );
    // Am Handy übers Teilen-Menü (in Dateien sichern, AirDrop …), sonst als Download
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Rundlauf-Export' }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Export gespeichert');
  };
  const rounds = data.pauses.reduce((s, p) => s + p.rounds.length, 0);
  return (
    <div className="card">
      <h3>Datensicherung</h3>
      <p className="sub">
        Der Gratis-Tarif von Supabase macht keine abrufbaren Backups. Der Export enthält alle Spieler (mit echten Namen und E-Mails),
        {` ${data.pauses.length} Pausen und ${rounds} Runden`} als JSON-Datei. Ab und zu sichern, z. B. am Semesterende.
      </p>
      <div className="row"><button className="btn primary" onClick={() => void exportAll()}>Exportieren</button></div>
      <p className="sub">Profilbilder sind nicht enthalten; die liegen im Supabase-Speicher.</p>
    </div>
  );
}
