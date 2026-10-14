import { useState } from 'react';
import { PERIODS, type Granularity } from '../domain/periods';
import { computeStats, pausesIn, pct, recordFor, type PlayerStats } from '../domain/stats';
import { Dot, plural, useApp } from './ui';

type Col = { k: string; label: string; v: (x: PlayerStats) => number; fmt?: (x: PlayerStats) => React.ReactNode };

export function Dashboard() {
  const { data, name } = useApp();
  const [period, setPeriod] = useState<Granularity>('all');
  const [sort, setSort] = useState('netto');

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
          {plural(list.length, 'Pause', 'Pausen')} · Quoten zählen nur Runden, bei denen der Spieler dabei war. Spaltenkopf antippen zum Sortieren.
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
                    <td><span className="row nowrap"><Dot p={x.p} />{name(x.p)}</span></td>
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

      <Awards rows={rows} label={label} />
    </>
  );
}

function Awards({ rows, label }: { rows: PlayerStats[]; label: string }) {
  const { name } = useApp();
  const pick = (f: (x: PlayerStats) => number, min: (x: PlayerStats) => boolean = () => true) =>
    [...rows].filter(min).sort((a, b) => f(b) - f(a))[0] as PlayerStats | undefined;
  const aw: [string, PlayerStats, string][] = [];

  const sw = pick((x) => x.schwimmer + x.schwimmer / (x.runden || 1));
  if (sw?.schwimmer) aw.push(['Rettungsschwimmer', sw, `${sw.schwimmer}× Schwimmer · ${pct(sw.schwimmer, sw.runden)} der Runden`]);
  const gs = pick((x) => x.gesetzt);
  if (gs?.gesetzt) aw.push(['Kronen-Bonze', gs, `${plural(gs.gesetzt, 'Krone', 'Kronen')} gesetzt`]);
  const as = pick((x) => x.ass + x.ass / (x.aufschlaege || 1));
  if (as?.ass) aw.push(['Ass', as, `${as.ass} von ${plural(as.aufschlaege, 'Aufschlag', 'Aufschlägen')} im Finale selbst gewonnen`]);
  const pp = pick((x) => x.maxPot);
  if (pp?.maxPot) aw.push(['Pot-Pirat', pp, `größter gewonnener Pot: ${pp.maxPot}`]);
  const fr = pick((x) => x.ersterRaus / x.runden, (x) => x.runden >= 3);
  if (fr?.ersterRaus) aw.push(['Frühstarter', fr, `als Erster raus in ${pct(fr.ersterRaus, fr.runden)} der Runden`]);
  const fg = pick((x) => x.siege / x.finals, (x) => x.finals >= 3);
  if (fg?.siege) aw.push(['Finalgott', fg, `${fg.siege} von ${fg.finals} Finals gewonnen`]);
  const kg = pick((x) => x.koenig);
  if (kg?.koenig) aw.push(['Dauerkönig', kg, `${plural(kg.koenig, 'Pause', 'Pausen')} als König beendet`]);
  const sg = pick((x) => x.pausen);
  if (sg?.pausen) aw.push(['Stammgast', sg, `${plural(sg.pausen, 'Pause', 'Pausen')} dabei`]);

  if (!aw.length) return null;
  return (
    <section className="stack">
      <h2>Auszeichnungen · {label}</h2>
      <div className="awards">
        {aw.map(([t, x, d]) => (
          <div className="award" key={t}>
            <span className="t">{t}</span>
            <span className="w row"><Dot p={x.p} />{name(x.p)}</span>
            <span className="sub">{d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
