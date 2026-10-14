import { Fragment, useState } from 'react';
import { balances, isFinished, kingOf, roundInfo, validatePause } from '../domain/game';
import { fmtDate, fmtTime, fmtWeekday } from '../domain/periods';
import type { GameEvent, Pause, Round } from '../domain/types';
import { LineChart } from './LineChart';
import { CrownIcon, WaveIcon, plural, useApp } from './ui';

export function History() {
  const { data, name } = useApp();
  const list = [...data.pauses].sort((a, b) => b.startedAt - a.startedAt);
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null);

  if (!list.length)
    return (
      <div className="card empty">
        <b>Noch kein Verlauf.</b>
        <span>Jede gespielte Pause erscheint hier mit allen Runden, Kronen und Schwimmern.</span>
      </div>
    );

  return (
    <section className="stack">
      <h2>Verlauf</h2>
      <div className="plist">
        {list.map((pa) => {
          const b = balances(pa);
          const k = kingOf(b);
          const done = pa.rounds.filter(isFinished).length;
          const isOpen = open === pa.id;
          return (
            <Fragment key={pa.id}>
              <button className="pitem" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : pa.id)}>
                <span className="d">{fmtWeekday(pa.startedAt)}<br /><span className="sub num">{fmtDate(pa.startedAt).slice(0, 6)}</span></span>
                <span>
                  <b>{fmtTime(pa.startedAt)}{pa.endedAt ? `–${fmtTime(pa.endedAt)}` : ' · läuft'}</b><br />
                  <span className="sub">{Object.keys(b).length} Spieler · {plural(done, 'Runde', 'Runden')}</span>
                </span>
                <span>{k ? <span className="tag gold"><CrownIcon /> {name(k)} {b[k]}</span> : <span className="tag">kein König</span>}</span>
              </button>
              {isOpen && <PauseDetail key={pa.id} pa={pa} />}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

function PauseDetail({ pa }: { pa: Pause }) {
  const { canWrite, backend, run, toast, busy } = useApp();
  const [edit, setEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const n = pa.rounds.length;

  /** Prüft die Pause so, wie sie nach der Änderung aussähe, und speichert nur, wenn alle Regeln noch aufgehen. */
  const change = (after: Pause, action: () => Promise<void>, ok: string) => {
    const err = validatePause(after);
    if (err) toast(`Geht nicht, danach wäre die Pause ungültig. ${err}`);
    else void run(action, ok);
  };
  const withRounds = (rounds: Round[]): Pause => ({ ...pa, rounds });
  const mapEvents = (r: Round, f: (e: GameEvent[]) => GameEvent[]) => withRounds(pa.rounds.map((x) => (x === r ? { ...x, events: f(x.events) } : x)));

  const ops = {
    deleteEvent: (r: Round, e: GameEvent) =>
      change(mapEvents(r, (es) => es.filter((x) => x !== e)), () => backend.deleteEvent(e.id), 'Eintrag gelöscht'),
    swapWinner: (r: Round, e: GameEvent) =>
      change(
        mapEvents(r, (es) => es.map((x) => (x === e ? { ...x, p: x.loser!, loser: x.p } : x))),
        () => backend.updateFinal(e.id, { p: e.loser!, loser: e.p, server: e.server }),
        'Sieger getauscht',
      ),
    setServer: (e: GameEvent, server: string) =>
      void run(() => backend.updateFinal(e.id, { p: e.p, loser: e.loser!, server }), 'Aufschläger geändert'),
    deleteRound: (r: Round) =>
      change(withRounds(pa.rounds.filter((x) => x !== r)), () => backend.deleteRound(r.id), 'Runde gelöscht'),
  };

  return (
    <div className="card">
      <LineChart
        title="Kronenstand nach jeder Runde"
        ariaLabel="Kronenverlauf der Pause"
        xLabels={['Start', ...pa.rounds.map((r) => `R${r.number}`)]}
        series={Object.keys(balances(pa)).map((p) => ({ id: p, values: Array.from({ length: n + 1 }, (_, k) => balances(pa, k)[p] ?? 0) }))}
      />
      {canWrite && (
        <div className="row between">
          <button className="btn small" aria-pressed={edit} onClick={() => { setEdit(!edit); setConfirmDelete(false); }}>
            {edit ? 'Fertig' : 'Korrigieren'}
          </button>
          {edit && (confirmDelete ? (
            <span className="row">
              <span className="sub">Ganze Pause mit allen Runden löschen?</span>
              <button className="btn danger small" disabled={busy} onClick={() => void run(() => backend.deletePause(pa.id), 'Pause gelöscht')}>Löschen</button>
              <button className="btn small" onClick={() => setConfirmDelete(false)}>Nein</button>
            </span>
          ) : (
            <button className="btn ghost small" onClick={() => setConfirmDelete(true)}>Pause löschen</button>
          ))}
        </div>
      )}
      {edit && <p className="sub">Jede Änderung wird gegen die Regeln geprüft. Ein gelöschter Sieg kann zum Beispiel eine später gesetzte Krone ungültig machen, dann geht die Änderung nicht.</p>}
      <div className="timeline">
        {n === 0 && <p className="sub">Noch keine Runde gespielt.</p>}
        {pa.rounds.map((r) => {
          const i = roundInfo(r);
          return (
            <div key={r.id} className={`tround ${i.final ? 'won' : ''}`}>
              <div className="row between">
                <span className="row">
                  <b>Runde {r.number}</b>
                  <span className="sub">{r.participants.length} Spieler · Pot {i.pot}{i.final ? '' : ' · läuft'}</span>
                </span>
                {edit && <button className="btn ghost small" disabled={busy} onClick={() => ops.deleteRound(r)}>Runde löschen</button>}
              </div>
              {r.events.map((e) => (
                <div className="ev" key={e.id}>
                  <time>{fmtTime(e.t)}</time>
                  <span className="row between">
                    <span><EventText e={e} /></span>
                    {edit && (e.type === 'final'
                      ? <FinalEdit e={e} busy={busy} onSwap={() => ops.swapWinner(r, e)} onServer={(s) => ops.setServer(e, s)} />
                      : <button className="btn ghost small" disabled={busy} aria-label="Eintrag löschen" onClick={() => ops.deleteEvent(r, e)}>✕</button>)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinalEdit({ e, busy, onSwap, onServer }: { e: GameEvent; busy: boolean; onSwap: () => void; onServer: (p: string) => void }) {
  const { name } = useApp();
  const other = e.server === e.p ? e.loser! : e.p;
  return (
    <span className="row">
      <button className="btn ghost small" disabled={busy} onClick={onSwap}>Sieger tauschen</button>
      <button className="btn ghost small" disabled={busy} onClick={() => onServer(other)}>Aufschlag an {name(other)}</button>
    </span>
  );
}

function EventText({ e }: { e: GameEvent }) {
  const { name } = useApp();
  switch (e.type) {
    case 'schwimmer': return <><WaveIcon /> {name(e.p)} bekommt den Schwimmer</>;
    case 'crown': return <><CrownIcon /> {name(e.p)} setzt eine Krone</>;
    case 'out': return <>{name(e.p)} fliegt raus</>;
    case 'final':
      return (
        <>
          <b>{name(e.p)}</b> gewinnt das Finale gegen {e.loser ? name(e.loser) : '?'} und holt <b>{plural(e.pot ?? 0, 'Krone', 'Kronen')}</b>
          {e.server && ` · Angabe: ${name(e.server)}`}
        </>
      );
  }
}
