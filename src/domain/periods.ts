export type Granularity = 'day' | 'week' | 'semester' | 'all';

export const PERIODS: { g: Granularity; label: string; short: string }[] = [
  { g: 'day', label: 'Heute', short: 'Tag' },
  { g: 'week', label: 'Diese Woche', short: 'Woche' },
  { g: 'semester', label: 'Dieses Semester', short: 'Semester' },
  { g: 'all', label: 'All-Time', short: 'All-Time' },
];

export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
export const fmtWeekday = (t: number) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short' });

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `KW ${w} · ${y}`;
}

/** Sommersemester April–September, Wintersemester Oktober–März. */
export function semester(d: Date): string {
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m >= 3 && m <= 8) return `SoSe ${y}`;
  const s = m >= 9 ? y : y - 1;
  return `WiSe ${String(s).slice(2)}/${String(s + 1).slice(2)}`;
}

export function periodKey(ts: number, g: Granularity): string {
  const d = new Date(ts);
  if (g === 'day') return fmtDate(ts);
  if (g === 'week') return isoWeek(d);
  if (g === 'semester') return semester(d);
  return 'All-Time';
}
