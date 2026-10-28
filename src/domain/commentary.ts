import { balances, kingOf, roundInfo, serveRule } from './game';
import { bademeister } from './stats';
import type { GameEvent, Pause, Round } from './types';

/**
 * Sprüche für den Kommentator im Tisch-Modus. Platzhalter: {name}, {a}, {b}, {server},
 * {pot} (Zahl) und {kronen} ("eine Krone" / "3 Kronen").
 *
 * Audio-Tags in eckigen Klammern wie [excited] steuern bei ElevenLabs (v3/v4) den Tonfall; sie werden
 * nicht vorgelesen. Die Browser-Stimme bekommt den Text ohne Tags. Pausen über "…", Betonung über "!".
 */
export const LINES = {
  schwimmer: [
    '{name} ist am Schwimmen.',
    '{name} hat den Schwimmer.',
    '[amused] {name} geht baden.',
    '[excited] Rettungsring für {name}!',
    '[amused] {name} paddelt noch.',
    '[sarcastic] Seepferdchen-Prüfung für {name}.',
  ],
  schwimmerAgain: [
    '[amused] {name} ist wieder am Schwimmen.',
    '[sarcastic] {name} fühlt sich im Wasser offenbar wohl.',
    '[sighs] Schon wieder {name}… Wird langsam eine Gewohnheit.',
  ],
  /** Überholt mit diesem Schwimmer den bisherigen Bademeister (meiste Schwimmer im Semester) */
  bademeisterNew: [
    '[excited] Neuer Bademeister: {name}!',
    '[dramatic] Pfeife und Badehose gehen an… {name}!',
    '[amused] {name} übernimmt die Aufsicht am Becken.',
  ],
  /** Der Bademeister nimmt selbst wieder einen Schwimmer */
  bademeisterAgain: [
    '[laughs] Der Bademeister geht selbst baden.',
    '[sarcastic] {name} prüft mal wieder die Wassertemperatur.',
    '[whispers] Der Bademeister ist im Wasser… Wer passt jetzt auf?',
  ],
  /** Schwimmer gehabt und trotzdem als Erster raus */
  bleiente: [
    '[laughs] {name} macht den Nichtschwimmer und hält den Rand.',
    '[amused] Glub, glub… {name} ist untergegangen.',
    '[sarcastic] {name} geht unter wie eine Bleiente.',
    '[sighs] Seepferdchen nicht bestanden, {name}.',
    '[dramatic] Der Rettungsring hat {name} nicht gereicht.',
  ],
  /** Normales "raus": spielt den Sound public/sounds/enemy-slain.mp3; der Text ist nur der Ersatz, falls er fehlt */
  slain: ['An enemy has been slain.'],
  crown: [
    '{name} setzt eine Krone. {pot} im Pot.',
    'Krone von {name}, der Pot steht bei {pot}.',
    '[amused] {name} kauft sich frei. {kronen} im Pot.',
    '[excited] Krone! {name} bleibt drin.',
    '[sarcastic] {name} zahlt lieber, als zu gehen.',
    '[excited] Der Pot wird fett: {kronen}.',
  ],
  /** Kommt ab 5 Kronen im Pot zusätzlich in die Auswahl */
  crownBigPot: ["[dramatic] {kronen} im Pot… jetzt wird's ernst."],
  /** Der König setzt in dieser Runde schon eine weitere Krone */
  crownKing: ['[amused] Der König greift in die Schatzkammer.', "[sarcastic] {name} kann's sich ja leisten."],
  final: [
    '[excited] Finale: {a} gegen {b}! {server} schlägt auf.',
    'Es kommt zum Finale zwischen {a} und {b}. Aufschlag {server}.',
    '[dramatic] Showdown! {a} gegen {b}… {kronen} stehen auf dem Spiel.',
    'Zwei bleiben übrig: {a} und {b}. {server} beginnt.',
    '[dramatic] Es geht um {kronen}. {server} hat die Angabe.',
  ],
  finalTie: [
    '[excited] Finale {a} gegen {b}! Gleichstand bei den Kronen. Die Angabe wird ausgespielt.',
    '[amused] Finale {a} gegen {b}. Keiner gönnt dem anderen was: Angabe ausspielen!',
  ],
  serve: ['{server} schlägt auf.'],
  win: [
    '[excited] {name} gewinnt {kronen}!',
    '[excited] Sieg für {name}, {kronen} aufs Konto!',
    '[laughs] {name} räumt den Pot ab.',
    "[excited] Und {name} macht's! {kronen}.",
    '[shouting] Kasse! {name} kassiert {kronen}!',
  ],
} satisfies Record<string, string[]>;

export type LineKind = keyof typeof LINES;
export interface Line { kind: LineKind; vars: Record<string, string | number> }

export const kronen = (n: number) => (n === 1 ? 'eine Krone' : `${n} Kronen`);

/**
 * Was zu einem frisch eingetragenen Ereignis gesagt wird; null heißt schweigen.
 * `pauses` sind alle Pausen (für den Bademeister im Semester), `pa` muss darin enthalten sein.
 */
export function lineForEvent(pa: Pause, e: GameEvent, pauses: Pause[] = [pa]): Line | null {
  const ri = pa.rounds.findIndex((r) => r.events.some((x) => x.id === e.id));
  if (ri < 0) return null;
  const r = pa.rounds[ri];
  const info = roundInfo(r);
  switch (e.type) {
    case 'schwimmer': {
      // Bademeister-Sprüche nur, wenn es ihn betrifft; sonst die normalen Schwimmer-Sprüche
      const before = bademeister(pauses, { before: e.id, now: pa.startedAt });
      const after = bademeister(pauses, { now: pa.startedAt });
      if (before === e.p) return { kind: 'bademeisterAgain', vars: { name: e.p } };
      if (after === e.p && before !== null) return { kind: 'bademeisterNew', vars: { name: e.p } };
      const prev = ri > 0 ? roundInfo(pa.rounds[ri - 1]).schwimmer : null;
      const times = pa.rounds.slice(0, ri + 1).filter((x) => roundInfo(x).schwimmer === e.p).length;
      return { kind: prev === e.p || times >= 2 ? 'schwimmerAgain' : 'schwimmer', vars: { name: e.p } };
    }
    case 'crown': {
      // Stand vor dieser Krone: war der Spieler König und hat in dieser Runde schon gesetzt?
      const before = balances(pa);
      before[e.p] = (before[e.p] ?? 0) + 1;
      const earlier = r.events.filter((x) => x.type === 'crown' && x.p === e.p && x.seq < e.seq).length;
      const kind: LineKind = kingOf(before) === e.p && earlier > 0 ? 'crownKing' : info.pot >= 5 ? 'crownBigPot' : 'crown';
      return { kind, vars: { name: e.p, pot: info.pot } };
    }
    case 'out':
      // Das Finale hat Vorrang, dann die Bleiente, sonst der Slain-Sound
      if (info.active.length === 2) return lineForFinal(pa, r);
      if (info.schwimmer === e.p && info.out[0] === e.p) return { kind: 'bleiente', vars: { name: e.p } };
      return { kind: 'slain', vars: {} };
    case 'final':
      return { kind: 'win', vars: { name: e.p, pot: e.pot ?? 0 } };
  }
}

/** Ansage, sobald nur noch zwei übrig sind */
export function lineForFinal(pa: Pause, r: Round): Line | null {
  const rule = serveRule(pa, r);
  if (!rule) return null;
  const vars = { a: rule.a, b: rule.b, server: rule.server ?? '', pot: roundInfo(r).pot };
  return { kind: rule.server ? 'final' : 'finalTie', vars };
}

/**
 * Macht aus einer Ansage einen Satz. Spieler-IDs in den Variablen werden über `name` aufgelöst.
 * `avoid` ist der zuletzt gesagte Satz, der möglichst nicht direkt wiederholt wird.
 */
export function render(line: Line, name: (id: string) => string, rnd = Math.random, avoid?: string): string {
  let pool: string[] = LINES[line.kind];
  // Bei großem Pot bleiben die normalen Kronen-Sprüche mit in der Auswahl
  if (line.kind === 'crownBigPot') pool = [...LINES.crown, ...LINES.crownBigPot, ...LINES.crownBigPot];
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(line.vars)) vars[k] = typeof v === 'number' ? String(v) : ['name', 'a', 'b', 'server'].includes(k) ? name(v) : v;
  if (typeof line.vars.pot === 'number') vars.kronen = kronen(line.vars.pot);
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  const options = pool.map(fill);
  const fresh = options.filter((o) => o !== avoid);
  const from = fresh.length ? fresh : options;
  return from[Math.floor(rnd() * from.length)];
}

/** Text ohne Audio-Tags, z. B. für die Browser-Stimme */
export const stripTags = (t: string) => t.replace(/\[[^\]]*\]\s*/g, '').trim();
