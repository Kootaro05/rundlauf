import type { EloResult } from '../domain/elo';
import { fmtDate } from '../domain/periods';
import { computeDuels, computeStats, longestFinalStreak, pct } from '../domain/stats';
import { LineChart } from './LineChart';
import { Dot, plural, useApp } from './ui';

/** Alles über einen Spieler, über alle Zeiten */
export function Profile({ p, elo, onClose }: { p: string; elo: EloResult; onClose: () => void }) {
  const { data, name } = useApp();
  const s = computeStats(data.pauses)[p];
  const duels = computeDuels(data.pauses);
  const ranking = Object.keys(elo.rating).sort((a, b) => elo.rating[b] - elo.rating[a]);
  const history = elo.history[p] ?? [];

  // Gegen wen im Finale am häufigsten gewonnen bzw. verloren
  const opponents = new Set([...Object.keys(duels[p] ?? {}), ...Object.keys(duels).filter((x) => duels[x][p])]);
  const bilanz = [...opponents].map((o) => ({ o, w: duels[p]?.[o] ?? 0, l: duels[o]?.[p] ?? 0 }));
  const liebling = [...bilanz].sort((a, b) => b.w - a.w || a.l - b.l)[0];
  const angst = [...bilanz].sort((a, b) => b.l - a.l || a.w - b.w)[0];

  return (
    <section className="card">
      <div className="row between">
        <h2 className="row"><Dot p={p} />{name(p)}</h2>
        <button className="btn small ghost" onClick={onClose}>Schließen</button>
      </div>
      {!s ? (
        <p className="sub">Noch keine Pause gespielt.</p>
      ) : (
        <>
          <div className="tiles">
            <Tile label="ELO" big={Math.round(elo.rating[p] ?? 1000)}
              sub={`Platz ${ranking.indexOf(p) + 1} von ${ranking.length} · Bestwert ${Math.round(elo.peak[p] ?? 1000)}`} />
            <Tile label="Kronen gesamt" big={s.netto} sub={`Ø ${(s.netto / s.pausen).toFixed(1).replace('.', ',')} pro Pause · beste Pause ${s.beste}`} />
            <Tile label="Siege" big={s.siege} sub={`${pct(s.siege, s.runden)} von ${plural(s.runden, 'Runde', 'Runden')} · ${s.siege} von ${s.finals} Finals`} />
            <Tile label="Längste Serie" big={longestFinalStreak(data.pauses, p)} sub="Finals am Stück gewonnen" />
          </div>
          <div className="stack">
            <p className="sub">
              {plural(s.pausen, 'Pause', 'Pausen')} · Schwimmer in {pct(s.schwimmer, s.runden)} der Runden ·
              als Erster raus in {pct(s.ersterRaus, s.runden)} · {plural(s.gesetzt, 'Krone', 'Kronen')} gesetzt ·
              {' '}{s.ass} {s.ass === 1 ? 'Ass' : 'Asse'} bei {plural(s.aufschlaege, 'Aufschlag', 'Aufschlägen')} · {plural(s.koenig, 'Pause', 'Pausen')} als König
            </p>
            {liebling?.w > 0 && <p className="sub">Lieblingsgegner: <b>{name(liebling.o)}</b>, im Finale {liebling.w}:{liebling.l}</p>}
            {angst?.l > 0 && <p className="sub">Angstgegner: <b>{name(angst.o)}</b>, im Finale {angst.w}:{angst.l}</p>}
          </div>
          {history.length > 1 && (
            <LineChart
              title="ELO-Verlauf"
              ariaLabel={`ELO-Verlauf von ${name(p)}`}
              baseline={1000}
              xLabels={history.map((h) => fmtDate(h.t).slice(0, 6))}
              series={[{ id: p, values: history.map((h) => h.r) }]}
            />
          )}
        </>
      )}
    </section>
  );
}

function Tile({ label, big, sub }: { label: string; big: number; sub: string }) {
  return (
    <div className="tile">
      <h3>{label}</h3>
      <div className="big num">{big}</div>
      <p className="sub">{sub}</p>
    </div>
  );
}
