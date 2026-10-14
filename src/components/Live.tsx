import { Fragment, useCallback, useEffect, useState } from 'react';
import { balances, crownCheck, currentRound, kingOf, nextSeq, openPause, roundInfo, serveRule } from '../domain/game';
import { fmtTime } from '../domain/periods';
import type { Pause, Round } from '../domain/types';
import { CrownIcon, Dot, WaveIcon, plural, useApp } from './ui';

export function Live() {
  const { data } = useApp();
  const pa = openPause(data.pauses);
  if (!pa) return <StartPause key="pause" />;
  const r = currentRound(pa);
  return (
    <>
      <Standings pa={pa} />
      {r ? <RunningRound pa={pa} r={r} /> : <RoundSetup key={`${pa.id}-${pa.rounds.length}`} pa={pa} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function useSelection(initial: string[]) {
  const [sel, setSel] = useState(() => new Set(initial));
  const toggle = (p: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const add = useCallback((p: string) => setSel((s) => new Set(s).add(p)), []);
  return { sel, toggle, add };
}

function PlayerPicker({ sel, toggle, add }: ReturnType<typeof useSelection>) {
  const { data, canWrite, backend, run, busy } = useApp();
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const visible = data.players.filter((p) => !p.hidden).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Neu angelegte Spieler gleich mit auswählen
  useEffect(() => {
    if (!pending) return;
    const p = data.players.find((x) => x.name.toLowerCase() === pending.toLowerCase());
    if (p) {
      add(p.id);
      setPending(null);
    }
  }, [data.players, pending, add]);

  const submit = async () => {
    const n = newName.trim().slice(0, 24);
    if (!n) return;
    if (await run(() => backend.addPlayer(n, null), `${n} hinzugefügt`)) {
      setPending(n);
      setNewName('');
    }
  };

  return (
    <>
      <div className="row">
        {visible.map((p) => (
          <button key={p.id} className="chip" aria-pressed={sel.has(p.id)} onClick={() => toggle(p.id)} disabled={!canWrite}>
            <Dot p={p.id} />
            {p.name}
          </button>
        ))}
      </div>
      {canWrite && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input id="np-inline" type="text" maxLength={24} placeholder="Neuer Name" aria-label="Neuer Spielername" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn small" disabled={busy || !newName.trim()}>Hinzufügen</button>
        </form>
      )}
    </>
  );
}

function StartPause() {
  const { data, backend, run, busy, canWrite } = useApp();
  const last = [...data.pauses].sort((a, b) => b.startedAt - a.startedAt)[0];
  const visible = data.players.filter((p) => !p.hidden).map((p) => p.id);
  const selection = useSelection((last?.participants ?? visible).filter((p) => visible.includes(p)));
  const n = selection.sel.size;

  return (
    <section className="card">
      <div className="stack">
        <h2>Neue Pause</h2>
        <p className="sub">
          {canWrite ? 'Wer spielt mit? Alle starten mit 0 Kronen.' : 'Gerade läuft keine Pause. Zum Starten bitte anmelden.'}
        </p>
      </div>
      {data.players.length === 0 && canWrite && <p className="sub">Noch keine Spieler. Trag unten die Namen eurer Runde ein.</p>}
      <PlayerPicker {...selection} />
      {canWrite && (
        <div className="row">
          <button className="btn primary" disabled={busy || n < 2} onClick={() => void run(() => backend.startPause([...selection.sel]), 'Pause gestartet. Alle bei 0 Kronen.')}>
            Pause starten ({n})
          </button>
        </div>
      )}
    </section>
  );
}

function Standings({ pa }: { pa: Pause }) {
  const { name, canWrite, backend, run, busy } = useApp();
  const b = balances(pa);
  const king = kingOf(b);
  const order = Object.keys(b).sort((x, y) => b[y] - b[x] || name(x).localeCompare(name(y), 'de'));
  const last = pa.rounds.at(-1);
  const lastEv = last?.events.at(-1);
  const undoLabel = !last ? null : lastEv ? describeShort(lastEv, name) : `Runde ${last.number} verwerfen`;

  return (
    <section className="stack">
      <div className="row between">
        <h3>Kronenstand · Pause seit {fmtTime(pa.startedAt)}</h3>
        {canWrite && undoLabel && (
          <button className="btn small ghost" disabled={busy} title="Letzten Eintrag zurücknehmen" onClick={() => void run(() => backend.undo(pa), 'Zurückgenommen')}>
            ↶ {undoLabel}
          </button>
        )}
      </div>
      <div className="standings">
        {order.map((p) => (
          <div key={p} className={`stand ${p === king ? 'king' : ''}`}>
            <Dot p={p} />
            <span className="n">{name(p)}</span>
            <span className="c"><CrownIcon />{b[p]}</span>
            {p === king && <span className="tag gold">König</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function describeShort(e: Round['events'][number], name: (id: string) => string) {
  switch (e.type) {
    case 'schwimmer': return `${name(e.p)}: Schwimmer`;
    case 'crown': return `${name(e.p)}: Krone`;
    case 'out': return `${name(e.p)}: raus`;
    case 'final': return `Finale ${name(e.p)}`;
  }
}

function RoundSetup({ pa }: { pa: Pause }) {
  const { data, backend, run, busy, canWrite, name } = useApp();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const last = pa.rounds.at(-1);
  const visible = data.players.filter((p) => !p.hidden).map((p) => p.id);
  const selection = useSelection((last?.participants ?? pa.participants).filter((p) => visible.includes(p)));
  const lastFinal = last ? roundInfo(last).final : null;
  const n = selection.sel.size;

  return (
    <section className="card">
      <div className="stack">
        <h2>Runde {pa.rounds.length + 1}</h2>
        <p className="sub">
          {lastFinal && `Letzte Runde: ${name(lastFinal.p)} hat ${plural(lastFinal.pot ?? 0, 'Krone', 'Kronen')} gewonnen. `}
          {canWrite ? 'Wer ist diese Runde dabei? Neuer Pot: 1 Krone.' : 'Die nächste Runde startet gleich.'}
        </p>
      </div>
      <PlayerPicker {...selection} />
      {canWrite && (
        <div className="row between">
          <button className="btn primary" disabled={busy || n < 2} onClick={() => void run(() => backend.startRound(pa.id, [...selection.sel]))}>
            Runde starten ({n})
          </button>
          {confirmEnd ? (
            <span className="row">
              <span className="sub">Pause wirklich beenden?</span>
              <button className="btn danger small" disabled={busy} onClick={() => void run(() => backend.endPause(pa.id), 'Pause beendet. Bis zur nächsten!')}>Beenden</button>
              <button className="btn small" onClick={() => setConfirmEnd(false)}>Nein</button>
            </span>
          ) : (
            <button className="btn ghost" onClick={() => setConfirmEnd(true)}>Pause beenden</button>
          )}
        </div>
      )}
    </section>
  );
}

function RunningRound({ pa, r }: { pa: Pause; r: Round }) {
  const { backend, run, busy, canWrite, name } = useApp();
  const [sheet, setSheet] = useState<string | null>(null);
  const i = roundInfo(r);
  const b = balances(pa);
  const king = kingOf(b);
  const add = (ev: Parameters<typeof backend.addEvent>[2], ok?: string) =>
    run(() => backend.addEvent(r.id, nextSeq(r), ev), ok).then(() => setSheet(null));

  const head = (
    <div className="roundhead">
      <div className="stack">
        <h2>Runde {r.number}</h2>
        <p className="sub">
          {i.active.length} von {r.participants.length} noch drin · <WaveIcon />{' '}
          {i.schwimmer ? `Schwimmer: ${name(i.schwimmer)}` : 'Schwimmer noch frei'}
        </p>
      </div>
      <div className="pot"><CrownIcon /><b className="num">{i.pot}</b><span>Kronen<br />im Pot</span></div>
    </div>
  );
  const outs = i.out.length > 0 && (
    <div className="outlist">
      <span>Raus:</span>
      {i.out.map((p, k) => <s key={p}>{k + 1}. {name(p)}</s>)}
    </div>
  );

  if (i.active.length <= 2) return <section className="card">{head}<Final pa={pa} r={r} />{outs}</section>;

  return (
    <section className="card">
      {head}
      <p className="sub">{canWrite ? 'Tippe auf den Spieler, der den Fehler gemacht hat.' : 'Live-Stand der Runde.'}</p>
      <div className="grid">
        {i.active.map((p) => {
          const c = sheet === p ? crownCheck(pa, r, p) : null;
          return (
            // Zelle und Auswahl-Panel liegen als Geschwister im Grid, damit das Panel die volle Breite nimmt
            <Fragment key={p}>
              <button
                className="pl"
                aria-expanded={sheet === p}
                disabled={!canWrite || busy}
                onClick={() => {
                  if (!i.schwimmer) void add({ type: 'schwimmer', p }, `${name(p)} bekommt den Schwimmer`);
                  else setSheet(sheet === p ? null : p);
                }}
              >
                <span className="nm"><Dot p={p} />{name(p)}</span>
                <span className="meta">
                  <span className="tag"><CrownIcon /> {b[p] ?? 0}</span>
                  {i.schwimmer === p && <span className="tag"><WaveIcon /> Schwimmer</span>}
                  {i.crowns[p] && <span className="tag gold"><CrownIcon /> ×{i.crowns[p]} gesetzt</span>}
                  {p === king && <span className="tag gold">König</span>}
                </span>
                {canWrite && <span className="hint">{i.schwimmer ? 'Fehler eintragen' : 'Fehler → bekommt den Schwimmer'}</span>}
              </button>
              {c && (
                <div className="sheet">
                  <p>
                    <b>{name(p)}</b> hat einen Fehler gemacht.
                    {c.ok && ` Krone setzen und drin bleiben?${i.active.length === 3 ? ' Damit wird das Finale verhindert.' : ''}`}
                  </p>
                  <div className="row">
                    <button className="btn gold" disabled={!c.ok || busy} onClick={() => void add({ type: 'crown', p }, `${name(p)} setzt eine Krone`)}>
                      <CrownIcon /> Krone setzen{c.ok && ` (noch ${c.left})`}
                    </button>
                    <button className="btn danger" disabled={busy} onClick={() => void add({ type: 'out', p })}>Fliegt raus</button>
                    <button className="btn ghost" onClick={() => setSheet(null)}>Abbrechen</button>
                  </div>
                  {c.ok ? c.king && <p className="sub">Als König darf mehrfach gesetzt werden.</p> : <p className="sub">{c.why}</p>}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {outs}
    </section>
  );
}

function Final({ pa, r }: { pa: Pause; r: Round }) {
  const { backend, run, busy, canWrite, name } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const rule = serveRule(pa, r);
  const i = roundInfo(r);
  const king = kingOf(balances(pa));
  if (!rule) return null;
  const crownsOf = (p: string) => (p === rule.a ? rule.crownsA : rule.crownsB);
  // Weniger Kronen → schlägt automatisch auf. Bei Gleichstand wird die Angabe ausgespielt und hier eingetragen.
  const server = rule.server ?? picked;
  const tie = rule.server === null;

  const text = !tie
    ? `${name(rule.server!)} hat weniger Kronen (${Math.min(rule.crownsA, rule.crownsB)}:${Math.max(rule.crownsA, rule.crownsB)}) und schlägt auf.`
    : `Gleich viele Kronen (${rule.crownsA}:${rule.crownsB}). Erst die Angabe ausspielen (einwerfen), der Gewinner schlägt auf.`;

  const win = (p: string) =>
    run(
      () => backend.addEvent(r.id, nextSeq(r), { type: 'final', p, loser: p === rule.a ? rule.b : rule.a, server, pot: i.pot }),
      `${name(p)} gewinnt ${plural(i.pot, 'Krone', 'Kronen')}`,
    );

  const side = (p: string) => (
    <div className="fin">
      <div className="row"><Dot p={p} /><span className="sub"><CrownIcon /> {crownsOf(p)}{p === king ? ' · König' : ''}</span></div>
      <div className="nm">{name(p)}</div>
      {tie && canWrite ? (
        <button className="chip" aria-pressed={picked === p} onClick={() => setPicked(picked === p ? null : p)}>Angabe gewonnen · schlägt auf</button>
      ) : (
        server === p && <span className="tag gold" style={{ justifySelf: 'start' }}>Schlägt auf</span>
      )}
      {canWrite && (
        <button className="btn primary" disabled={busy || !server} onClick={() => void win(p)}>Gewinnt · +{i.pot} <CrownIcon /></button>
      )}
    </div>
  );

  return (
    <>
      <div className="note"><b>Finale um einen Punkt.</b> {text} Im Finale können keine Kronen gesetzt werden.</div>
      {tie && canWrite && !picked && <p className="sub">Erst eintragen, wer die Angabe gewonnen hat, dann den Sieger.</p>}
      <div className="final">{side(rule.a)}<div className="vs">VS</div>{side(rule.b)}</div>
    </>
  );
}
