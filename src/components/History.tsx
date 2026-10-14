import { Fragment, useState } from 'react';
import { balances, isFinished, kingOf, roundInfo } from '../domain/game';
import { fmtDate, fmtTime, fmtWeekday } from '../domain/periods';
import type { GameEvent, Pause } from '../domain/types';
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
              {isOpen && <PauseDetail pa={pa} />}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

function PauseDetail({ pa }: { pa: Pause }) {
  return (
    <div className="card">
      <Chart pa={pa} />
      <div className="timeline">
        {pa.rounds.length === 0 && <p className="sub">Noch keine Runde gespielt.</p>}
        {pa.rounds.map((r) => {
          const i = roundInfo(r);
          return (
            <div key={r.id} className={`tround ${i.final ? 'won' : ''}`}>
              <div className="row">
                <b>Runde {r.number}</b>
                <span className="sub">{r.participants.length} Spieler · Pot {i.pot}{i.final ? '' : ' · läuft'}</span>
              </div>
              {r.events.map((e) => (
                <div className="ev" key={e.id}><time>{fmtTime(e.t)}</time><span><EventText e={e} /></span></div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
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

function Chart({ pa }: { pa: Pause }) {
  const { name, color } = useApp();
  const n = pa.rounds.length;
  if (!n) return null;
  const ps = Object.keys(balances(pa));
  const snaps = Array.from({ length: n + 1 }, (_, k) => balances(pa, k));
  const series = ps.map((p) => ({ p, v: snaps.map((s) => s[p] ?? 0) }));
  const all = series.flatMap((s) => s.v);
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const W = 640, H = 220, L = 30, R = 96, T = 12, B = 26;
  const x = (k: number) => L + (k * (W - L - R)) / n;
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const step = Math.max(1, Math.ceil((hi - lo) / 5));
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const every = Math.ceil(n / 12);

  // Endbeschriftungen nicht überlappen lassen
  const ends = series.map((s) => ({ p: s.p, v: s.v[n], y: y(s.v[n]) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;

  return (
    <div className="chart">
      <h3>Kronenstand nach jeder Runde</h3>
      <svg viewBox={`0 0 ${W} ${H + Math.max(0, (ends.at(-1)?.y ?? 0) - (H - B))}`} role="img" aria-label="Kronenverlauf der Pause">
        <g className="grid">
          {ticks.map((v) => (
            <Fragment key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text>
            </Fragment>
          ))}
        </g>
        {lo < 0 && <line className="zero" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />}
        {Array.from({ length: n + 1 }, (_, k) => k).filter((k) => k % every === 0 || k === n).map((k) => (
          <text key={k} x={x(k)} y={H - 8} textAnchor="middle">{k === 0 ? 'Start' : `R${k}`}</text>
        ))}
        {series.map((s) => (
          <Fragment key={s.p}>
            <polyline fill="none" stroke={color(s.p)} strokeWidth={2.2} strokeLinejoin="round" points={s.v.map((v, k) => `${x(k)},${y(v)}`).join(' ')} />
            <circle cx={x(n)} cy={y(s.v[n])} r={3.5} fill={color(s.p)} />
          </Fragment>
        ))}
        {ends.map((e) => (
          <text key={e.p} className="lbl" x={W - R + 8} y={e.y + 4} style={{ fill: color(e.p) }}>
            {name(e.p).slice(0, 10)} {e.v}
          </text>
        ))}
      </svg>
    </div>
  );
}
