import { crownCheck, roundInfo } from './game';
import type { Data, GameEvent, Pause, Player, Round } from './types';

/** Erfundene Beispieldaten (Informatik-Pioniere), deterministisch erzeugt. */
export function makeDemo(now = Date.now()): Data {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const names = ['Ada', 'Linus', 'Grace', 'Alan', 'Barbara', 'Edsger'];
  const skill = [0.62, 0.5, 0.57, 0.45, 0.4, 0.52];
  const players: Player[] = names.map((name, i) => ({ id: `demo-${i}`, name, hidden: false, createdAt: i }));
  const ids = players.map((p) => p.id);
  const sk = (p: string) => skill[ids.indexOf(p)];
  const pauses: Pause[] = [];
  let n = 0;
  const ev = (r: Round, e: Omit<GameEvent, 'id' | 'seq' | 'loser' | 'server' | 'pot'> & Partial<GameEvent>) =>
    r.events.push({ loser: null, server: null, pot: null, ...e, id: `e${n++}`, seq: r.events.length + 1 });

  for (let d = 24; d >= 0; d--) {
    const day = new Date(now - d * 864e5);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const [h, m] of [[9, 30], [11, 15], [13, 0]]) {
      if (rnd() < 0.35) continue;
      const start = new Date(day);
      start.setHours(h, m, 0, 0);
      if (+start > now - 20 * 6e4) continue;
      const parts = ids.filter(() => rnd() < 0.78);
      if (parts.length < 3) continue;
      const pa: Pause = { id: `demo-p${d}-${h}`, startedAt: +start, endedAt: null, participants: parts, rounds: [] };
      let t = +start;
      const nR = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < nR; k++) {
        let sub = parts.filter(() => rnd() < 0.93);
        if (sub.length < 2) sub = parts;
        const r: Round = { id: `r${n++}`, number: k + 1, startedAt: t, participants: sub, events: [] };
        pa.rounds.push(r);
        for (let guard = 0; guard < 40; guard++) {
          const i = roundInfo(r);
          if (i.active.length <= 2) break;
          const w = i.active.map((p) => 1.1 - sk(p));
          let x = rnd() * w.reduce((a, b) => a + b, 0);
          let p = i.active[0];
          for (let j = 0; j < w.length; j++) {
            x -= w[j];
            if (x <= 0) { p = i.active[j]; break; }
          }
          t += 15000 + rnd() * 25000;
          if (!i.schwimmer) ev(r, { type: 'schwimmer', p, t });
          else if (crownCheck(pa, r, p).ok && rnd() < 0.5) ev(r, { type: 'crown', p, t });
          else ev(r, { type: 'out', p, t });
        }
        const i = roundInfo(r);
        const [a, b] = i.active;
        const win = rnd() < sk(a) / (sk(a) + sk(b)) ? a : b;
        t += 20000;
        ev(r, { type: 'final', p: win, loser: win === a ? b : a, server: rnd() < 0.5 ? a : b, pot: i.pot, t });
        t += 10000;
      }
      pa.endedAt = t + 30000;
      pauses.push(pa);
    }
  }
  return { players, pauses };
}
