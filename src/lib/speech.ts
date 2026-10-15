/** Sprachausgabe über die im Browser eingebaute Stimme (Web Speech API). Kostet nichts, geht offline. */

const KEY = 'rundlauf-kommentator';

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speechEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setSpeechEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* privater Modus: dann gilt es nur bis zum Neuladen */
  }
  if (!on && speechSupported()) speechSynthesis.cancel();
}

/** Beste deutsche Stimme: natürliche Online-Stimmen (Edge) vor den Standardstimmen */
function germanVoice(): SpeechSynthesisVoice | null {
  const de = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('de'));
  const score = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return de.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Chrome lädt die Stimmen erst beim ersten Abfragen, deshalb schon beim Start einmal anstoßen
if (speechSupported()) speechSynthesis.getVoices();

/** Sagt den Satz an. Ein noch laufender Satz wird abgebrochen, damit der Kommentar nicht hinterherhinkt. */
export function speak(text: string) {
  if (!speechSupported()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = germanVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'de-DE';
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
