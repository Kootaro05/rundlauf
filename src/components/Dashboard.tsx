import { useMemo, useState } from 'react';
import { computeElo, ELO_START, podium, ratingAt, semesterElo } from '../domain/elo';
import { balances } from '../domain/game';
import { PERIODS, fmtDate, type Granularity } from '../domain/periods';
import { computeComebacks, computeDuels, computeStats, pausesIn, pct, recordFor, type Comeback, type PlayerStats } from '../domain/stats';
import type { Pause } from '../domain/types';
import { LineChart } from './LineChart';
import { Dot, PodiumIcon, plural, useApp } from './ui';

type Col = { k: string; label: string; v: (x: PlayerStats) => number; fmt?: (x: PlayerStats) => React.ReactNode };

export function Dashboard() {
  const { data, name, isMember, openProfile } = useApp();
  const [period, setPeriod] = useState<Granularity>('all');
  const [sort, setSort] = useState('netto');
  // Semester-ELO = laufendes Semester (startet jedes Semester bei 1000), ELO = seit dem ersten Spiel
  const elo = useMemo(() => semesterElo(data.pauses), [data.pauses]);
  const eloAll = useMemo(() => computeElo(data.pauses), [data.pauses]);

  if (!data.pauses.length)
    return (
      <div className="card empty">
        <b>Noch keine Pausen gespielt.</b>
        <span>Sobald die erste Runde im Live-Tab beendet ist, füllt sich das Dashboard.</span>
      </div>
    );

  const list = pausesIn(data.pauses, period);
  const rows = Object.values(computeStats(list));
  const label = PERIODS.find((x) => x.g === period)!.label;
  const maxAbs = Math.max(1, ...rows.map((x) => Math.abs(x.netto)));
  const periodStart = Math.min(...list.map((pa) => pa.startedAt));
  // Die drei Besten: ELO (Krone, Medaillen vor dem Namen) und Semester-ELO (Sterne vor dem Wert)
  const topAll = podium(eloAll.rating);
  const topSem = podium(elo.rating);
  const eloNow = (p: string) => elo.rating[p] ?? ELO_START;
  const eloAllNow = (p: string) => eloAll.rating[p] ?? ELO_START;
  // Veränderung der Semester-ELO im gewählten Zeitraum (Tag, Woche, Semester)
  const eloDelta = (p: string) => eloNow(p) - ratingAt(elo.history[p], periodStart);

  const cols: Col[] = [
    {
      k: 'netto', label: 'Kronen', v: (x) => x.netto,
      fmt: (x) => (
        <span className="barcell">
          <span className={`bar ${x.netto < 0 ? 'neg' : ''}`} style={{ width: Math.round((56 * Math.abs(x.netto)) / maxAbs) }} />
          {x.netto}
        </span>
      ),
    },
    { k: 'elo', label: 'ELO', v: (x) => eloAllNow(x.p), fmt: (x) => Math.round(eloAllNow(x.p)) },
    {
      k: 'eloSem', label: 'Semester-ELO', v: (x) => eloNow(x.p),
      fmt: (x) => (
        <span className="row nowrap" style={{ justifyContent: 'flex-end', gap: 4 }}>
          <PodiumIcon place={topSem[x.p]} kind="semester" />
          {Math.round(eloNow(x.p))}
          {period !== 'all' && <span className={eloDelta(x.p) >= 0 ? 'win' : 'loss'}>{signed(eloDelta(x.p))}</span>}
        </span>
      ),
    },
    { k: 'avg', label: 'Ø / Pause', v: (x) => (x.pausen ? x.netto / x.pausen : 0), fmt: (x) => (x.pausen ? (x.netto / x.pausen).toFixed(1).replace('.', ',') : '–') },
    { k: 'pausen', label: 'Pausen', v: (x) => x.pausen },
    { k: 'runden', label: 'Runden', v: (x) => x.runden },
    { k: 'siege', label: 'Siege', v: (x) => x.siege },
    { k: 'quote', label: 'Siegquote', v: (x) => (x.runden ? x.siege / x.runden : 0), fmt: (x) => pct(x.siege, x.runden) },
    { k: 'finals', label: 'Finals', v: (x) => x.finals },
    { k: 'aufschlaege', label: 'Aufschläge', v: (x) => x.aufschlaege, fmt: (x) => <>{x.aufschlaege} <span className="dim">{pct(x.aufschlaege, x.finals)}</span></> },
    { k: 'ass', label: 'Ass', v: (x) => x.ass, fmt: (x) => <>{x.ass} <span className="dim">{pct(x.ass, x.aufschlaege)}</span></> },
    { k: 'gewonnen', label: 'Gewonnen', v: (x) => x.gewonnen },
    { k: 'gesetzt', label: 'Gesetzt', v: (x) => x.gesetzt },
    { k: 'schwimmer', label: 'Schwimmer', v: (x) => x.schwimmer, fmt: (x) => <>{x.schwimmer} <span className="dim">{pct(x.schwimmer, x.runden)}</span></> },
    { k: 'erster', label: 'Erster raus', v: (x) => (x.runden ? x.ersterRaus / x.runden : 0), fmt: (x) => <>{x.ersterRaus} <span className="dim">{pct(x.ersterRaus, x.runden)}</span></> },
    { k: 'maxPot', label: 'Max. Pot', v: (x) => x.maxPot },
    { k: 'beste', label: 'Beste Pause', v: (x) => x.beste },
    { k: 'koenig', label: 'König', v: (x) => x.koenig },
  ];
  const sc = cols.find((c) => c.k === sort) ?? cols[0];
  rows.sort((a, b) => sc.v(b) - sc.v(a) || b.netto - a.netto);

  const eloLeader = Object.keys(elo.rating).sort((a, b) => elo.rating[b] - elo.rating[a])[0];
  const allLeader = Object.keys(eloAll.rating).sort((a, b) => eloAll.rating[b] - eloAll.rating[a])[0];
  const peakHolder = Object.keys(eloAll.peak).sort((a, b) => eloAll.peak[b] - eloAll.peak[a])[0];

  return (
    <>
      <section className="stack">
        <h2>Rekorde</h2>
        <p className="sub">
          Kronen = Endstand der Pausen (gewonnene Pots minus gesetzte Kronen), über den Zeitraum summiert. Semester: SoSe April–September, WiSe Oktober–März.
        </p>
        <div className="tiles">
          {PERIODS.map(({ g, short }) => {
            const rec = recordFor(data.pauses, g);
            if (!rec) return null;
            const cur = Object.values(computeStats(pausesIn(data.pauses, g))).sort((a, b) => b.netto - a.netto)[0];
            return (
              <div className="tile" key={g}>
                <h3>Meiste Kronen · {short}</h3>
                <div className="big num">{rec.v}<small>{name(rec.p)}</small></div>
                <p className="sub">{g === 'all' ? 'Summe aller Pausen' : `Rekord: ${rec.key}`}</p>
                {g !== 'all' && <p className="sub">Aktuell vorne: {cur ? `${name(cur.p)} (${cur.netto})` : 'noch niemand'}</p>}
              </div>
            );
          })}
          {(eloLeader || allLeader) && (
            <div className="tile">
              <h3>ELO</h3>
              <div className="big num">{Math.round(eloAll.rating[allLeader])}<small>{name(allLeader)}</small></div>
              <p className="sub">Semester-ELO vorne: {eloLeader ? `${name(eloLeader)} (${Math.round(elo.rating[eloLeader])})` : `noch niemand (${ELO_START})`}</p>
              <p className="sub">Bestwert aller Zeiten: {Math.round(eloAll.peak[peakHolder])} ({name(peakHolder)})</p>
            </div>
          )}
        </div>
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Tabelle</h2>
          <div className="seg" role="group" aria-label="Zeitraum">
            {PERIODS.map(({ g, label }) => (
              <button key={g} aria-pressed={period === g} onClick={() => setPeriod(g)}>{label}</button>
            ))}
          </div>
        </div>
        <p className="sub">
          {plural(list.length, 'Pause', 'Pausen')} · Quoten zählen nur Runden, bei denen der Spieler dabei war. Spaltenkopf antippen zum Sortieren{isMember ? ', Namen antippen fürs Profil' : ''}.
          ELO bewertet jede Runde nach Platzierung und läuft seit dem ersten Spiel. Die Semester-ELO startet jedes Semester
          für alle bei 1000{period !== 'all' ? ', daneben ihre Veränderung im Zeitraum' : ''}.
        </p>
        {rows.length ? (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Spieler</th>
                  {cols.map((c) => (
                    <th key={c.k} aria-sort={c === sc ? 'descending' : undefined}>
                      <button onClick={() => setSort(c.k)}>{c.label}{c === sc ? ' ↓' : ''}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.p}>
                    <td>
                      {isMember ? (
                        <button className="linkbtn row nowrap" onClick={() => { openProfile(x.p); window.scrollTo({ top: 0 }); }}>
                          <Dot p={x.p} /><PodiumIcon place={topAll[x.p]} kind="elo" />{name(x.p)}
                        </button>
                      ) : (
                        <span className="row nowrap"><Dot p={x.p} /><PodiumIcon place={topAll[x.p]} kind="elo" />{name(x.p)}</span>
                      )}
                    </td>
                    {cols.map((c) => <td key={c.k}>{c.fmt ? c.fmt(x) : c.v(x)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card empty"><b>Keine Pausen im Zeitraum „{label}“.</b><span>Wähle einen anderen Zeitraum.</span></div>
        )}
      </section>

      {list.length > 0 && <CrownCurve list={list} players={rows.map((x) => x.p)} />}
      {list.length > 0 && <DuelMatrix list={list} />}
      <Awards rows={rows} label={label} comeback={computeComebacks(list)[0]} />
    </>
  );
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;

/** Kronen über den Zeitraum aufsummiert, Pause für Pause */
function CrownCurve({ list, players }: { list: Pause[]; players: string[] }) {
  const sorted = [...list].sort((a, b) => a.startedAt - b.startedAt);
  const totals: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const values: Record<string, number[]> = Object.fromEntries(players.map((p) => [p, [0]]));
  for (const pa of sorted) {
    const b = balances(pa);
    for (const p of players) {
      totals[p] += b[p] ?? 0;
      values[p].push(totals[p]);
    }
  }
  return (
    <section className="card">
      <LineChart
        title="Kronen-Kurve im Zeitraum"
        ariaLabel="Aufsummierte Kronen pro Spieler über die Pausen des Zeitraums"
        xLabels={['Start', ...sorted.map((pa) => fmtDate(pa.startedAt).slice(0, 6))]}
        series={players.map((p) => ({ id: p, values: values[p] }))}
      />
    </section>
  );
}

/** Wer gewinnt gegen wen im Finale */
function DuelMatrix({ list }: { list: Pause[] }) {
  const { name } = useApp();
  const d = computeDuels(list);
  const players = [...new Set(Object.entries(d).flatMap(([a, m]) => [a, ...Object.keys(m)]))].sort((a, b) => name(a).localeCompare(name(b), 'de'));
  if (players.length < 2) return null;
  const short = (p: string) => name(p).split(' ')[0];
  return (
    <section className="stack">
      <h2>Duelle</h2>
      <p className="sub">Finalbilanz der Zeile gegen die Spalte: Siege zu Niederlagen.</p>
      <div className="scroll">
        <table className="matrix">
          <thead>
            <tr><th>Finale</th>{players.map((p) => <th key={p}>{short(p)}</th>)}</tr>
          </thead>
          <tbody>
            {players.map((a) => (
              <tr key={a}>
                <td><span className="row nowrap"><Dot p={a} />{short(a)}</span></td>
                {players.map((b) => {
                  if (a === b) return <td key={b} className="dim">·</td>;
                  const w = d[a]?.[b] ?? 0;
                  const l = d[b]?.[a] ?? 0;
                  return <td key={b} className={w > l ? 'win' : w < l ? 'loss' : 'dim'}>{w || l ? `${w}:${l}` : '–'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Awards({ rows, label, comeback }: { rows: PlayerStats[]; label: string; comeback?: Comeback }) {
  const { name } = useApp();
  const pick = (f: (x: PlayerStats) => number, min: (x: PlayerStats) => boolean = () => true) =>
    [...rows].filter(min).sort((a, b) => f(b) - f(a))[0] as PlayerStats | undefined;
  const aw: [string, string, string][] = [];

  const sw = pick((x) => x.schwimmer + x.schwimmer / (x.runden || 1));
  if (sw?.schwimmer) aw.push(['Rettungsschwimmer', sw.p, `${sw.schwimmer}× Schwimmer · ${pct(sw.schwimmer, sw.runden)} der Runden`]);
  const gs = pick((x) => x.gesetzt);
  if (gs?.gesetzt) aw.push(['Kronen-Bonze', gs.p, `${plural(gs.gesetzt, 'Krone', 'Kronen')} gesetzt`]);
  const as = pick((x) => x.ass + x.ass / (x.aufschlaege || 1));
  if (as?.ass) aw.push(['Ass', as.p, `${as.ass} von ${plural(as.aufschlaege, 'Aufschlag', 'Aufschlägen')} im Finale selbst gewonnen`]);
  if (comeback) aw.push(['Comeback', comeback.p, `lag am ${fmtDate(comeback.pause.startedAt).slice(0, 6)} ${plural(comeback.deficit, 'Krone', 'Kronen')} hinten und ging als König mit ${comeback.end} raus`]);
  const pp = pick((x) => x.maxPot);
  if (pp?.maxPot) aw.push(['Pot-Pirat', pp.p, `größter gewonnener Pot: ${pp.maxPot}`]);
  const fr = pick((x) => x.ersterRaus / x.runden, (x) => x.runden >= 3);
  if (fr?.ersterRaus) aw.push(['Frühstarter', fr.p, `als Erster raus in ${pct(fr.ersterRaus, fr.runden)} der Runden`]);
  const fg = pick((x) => x.siege / x.finals, (x) => x.finals >= 3);
  if (fg?.siege) aw.push(['Finalgott', fg.p, `${fg.siege} von ${fg.finals} Finals gewonnen`]);
  const kg = pick((x) => x.koenig);
  if (kg?.koenig) aw.push(['Dauerkönig', kg.p, `${plural(kg.koenig, 'Pause', 'Pausen')} als König beendet`]);

  if (!aw.length) return null;
  return (
    <section className="stack">
      <h2>Auszeichnungen · {label}</h2>
      <div className="awards">
        {aw.map(([t, p, d]) => (
          <div className="award" key={t}>
            <span className="t">{t}</span>
            <span className="w row"><Dot p={p} />{name(p)}</span>
            <span className="sub">{d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
