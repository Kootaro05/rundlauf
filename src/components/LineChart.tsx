import { Fragment } from 'react';
import { useApp } from './ui';

export interface Series {
  /** Spieler-ID, bestimmt Farbe und Beschriftung */
  id: string;
  values: number[];
}

/** Liniendiagramm mit einer Linie pro Spieler und Beschriftung am Ende. Alle Reihen haben dieselbe Länge wie xLabels. */
export function LineChart({ title, series, xLabels, ariaLabel, baseline = 0 }: {
  title: string;
  series: Series[];
  xLabels: string[];
  ariaLabel: string;
  /** Wird immer mit abgebildet und gestrichelt markiert, falls die Werte darunter fallen */
  baseline?: number;
}) {
  const { name, color } = useApp();
  const n = xLabels.length - 1;
  if (n < 1 || !series.length) return null;
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(baseline, ...all);
  const hi = Math.max(baseline + 1, ...all);
  const W = 640, H = 220, L = 40, R = 104, T = 12, B = 26;
  const x = (k: number) => L + (k * (W - L - R)) / n;
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const step = niceStep((hi - lo) / 5);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Math.round(v));
  const every = Math.ceil(n / 10);

  // Endbeschriftungen nicht überlappen lassen
  const ends = series.map((s) => ({ id: s.id, v: s.values[n], y: y(s.values[n]) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  const height = Math.max(H, (ends.at(-1)?.y ?? 0) + 8);

  return (
    <div className="chart">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
        <g className="grid">
          {ticks.map((v) => (
            <Fragment key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text>
            </Fragment>
          ))}
        </g>
        {lo < baseline && <line className="zero" x1={L} x2={W - R} y1={y(baseline)} y2={y(baseline)} />}
        {xLabels.map((label, k) => (k % every === 0 || k === n) && (
          <text key={k} x={x(k)} y={H - 8} textAnchor="middle">{label}</text>
        ))}
        {series.map((s) => (
          <Fragment key={s.id}>
            <polyline fill="none" stroke={color(s.id)} strokeWidth={2.2} strokeLinejoin="round" points={s.values.map((v, k) => `${x(k)},${y(v)}`).join(' ')} />
            <circle cx={x(n)} cy={y(s.values[n])} r={3.5} fill={color(s.id)} />
          </Fragment>
        ))}
        {ends.map((e) => (
          <text key={e.id} className="lbl" x={W - R + 8} y={e.y + 4} style={{ fill: color(e.id) }}>
            {name(e.id).split(' ')[0].slice(0, 10)} {Math.round(e.v)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function niceStep(raw: number) {
  if (raw <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
