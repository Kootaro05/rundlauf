/**
 * Signalhorn für "letzte Runde": wird im Browser erzeugt (Web Audio), braucht also keine Datei und kein Netz.
 * Drei Stöße, kurz – kurz – lang, als Akkord aus Sägezahn-Tönen wie bei einer Drucklufthupe.
 */

/** Uhrzeiten, zu denen im Tisch-Modus mit Kommentator das Horn ertönt (Ortszeit) */
export const HORN_TIMES = ['09:58', '11:58', '13:58', '15:43'];

let ctx: AudioContext | null = null;

/** Während eines Tipps aufrufen, damit das Horn später ohne Berührung spielen darf */
export function unlockHorn() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    /* kein Web Audio */
  }
}

export function playHorn() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    return;
  }
  const t0 = ctx.currentTime + 0.05;
  for (const [at, len] of [[0, 0.35], [0.5, 0.35], [1, 1.4]]) blast(ctx, t0 + at, len);
}

function blast(c: AudioContext, t: number, len: number) {
  const out = c.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.32, t + 0.04);
  out.gain.setValueAtTime(0.32, t + len - 0.08);
  out.gain.linearRampToValueAtTime(0, t + len);
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  tone.connect(out);
  out.connect(c.destination);
  // Grundton, Quinte und Oktave; jeder Ton rutscht beim Ansetzen kurz von unten hoch
  for (const [f, g] of [[233, 1], [349, 0.6], [466, 0.5]]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.06);
    const og = c.createGain();
    og.gain.value = g * 0.3;
    o.connect(og);
    og.connect(tone);
    o.start(t);
    o.stop(t + len + 0.02);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
