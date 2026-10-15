/**
 * Sprachausgabe für den Kommentator. Zuerst ElevenLabs über /api/tts (bessere Stimme), sonst die im
 * Browser eingebaute Stimme (Web Speech API, kostenlos, offline). Fertige ElevenLabs-Audios werden auf
 * dem Gerät gespeichert, damit jeder genau gleiche Satz nur einmal Guthaben kostet.
 */

const KEY = 'rundlauf-kommentator';
/** Bis zu diesem Zeitpunkt wird ElevenLabs übersprungen (Guthaben leer, nicht eingerichtet, kein Zugriff) */
const PAUSE_KEY = 'rundlauf-stimme-pause';
/** Zuletzt von der Server-Funktion gemeldete Stimme; gehört zum Schlüssel im Zwischenspeicher */
const VOICE_KEY = 'rundlauf-stimme-id';
/** Verbrauchte Zeichen heute, als Schutz vor Endlosschleifen */
const DAY_KEY = 'rundlauf-stimme-tag';

const CACHE = 'rundlauf-stimme-v1';
const DAILY_LIMIT = 15000;
/** Länger wartet der Kommentar nicht, sonst hinkt er dem Spiel hinterher */
const TIMEOUT = 1500;
const RETRY_AFTER = 60 * 60 * 1000;

export type VoiceSource = 'eleven' | 'browser';

let tokenGetter: () => Promise<string | null> = async () => null;
/** Wird beim Start gesetzt; ohne Login (oder im Demo-Modus) spricht immer die Browser-Stimme */
export function configureVoice(getToken: () => Promise<string | null>) {
  tokenGetter = getToken;
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* privater Modus */
  }
};

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const speechEnabled = () => read(KEY) === '1';

export function setSpeechEnabled(on: boolean) {
  write(KEY, on ? '1' : '0');
  // Neu einschalten probiert ElevenLabs sofort wieder, z. B. nach dem Aufladen
  if (on) write(PAUSE_KEY, null);
  else stop();
}

// --- Browser-Stimme ------------------------------------------------------------

/** Beste deutsche Stimme: natürliche Online-Stimmen (Edge) vor den Standardstimmen */
function germanVoice(): SpeechSynthesisVoice | null {
  const de = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('de'));
  const score = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return de.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Chrome lädt die Stimmen erst beim ersten Abfragen, deshalb schon beim Start einmal anstoßen
if (speechSupported()) speechSynthesis.getVoices();

function browserSpeak(text: string) {
  if (!speechSupported()) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = germanVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'de-DE';
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// --- ElevenLabs ----------------------------------------------------------------

// Ein einziges Audio-Element: einmal per Tipp freigeschaltet, darf es auch später abspielen (iPad/Safari)
let player: HTMLAudioElement | null = null;
let playingUrl: string | null = null;
const audio = () => (player ??= new Audio());

/** Beim Einschalten (also während eines Tipps) aufrufen, damit spätere Ansagen abspielen dürfen */
export function unlockAudio() {
  const a = audio();
  a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  void a.play().catch(() => {});
}

function stop() {
  if (speechSupported()) speechSynthesis.cancel();
  player?.pause();
}

const today = () => new Date().toISOString().slice(0, 10);
function charsToday(): number {
  const [day, n] = (read(DAY_KEY) ?? '').split(':');
  return day === today() ? Number(n) || 0 : 0;
}

const cacheKey = (text: string) => `/__stimme/${encodeURIComponent(read(VOICE_KEY) ?? '-')}/${encodeURIComponent(text)}`;

async function fromCache(text: string): Promise<Blob | null> {
  if (!('caches' in window)) return null;
  const hit = await (await caches.open(CACHE)).match(cacheKey(text));
  return hit ? hit.blob() : null;
}

/** Holt das Audio von ElevenLabs; null heißt: diesmal die Browser-Stimme nehmen */
async function fromEleven(text: string): Promise<Blob | null> {
  if (Number(read(PAUSE_KEY) ?? 0) > Date.now() || !navigator.onLine) return null;
  if (charsToday() + text.length > DAILY_LIMIT) return null;
  const token = await tokenGetter();
  if (!token) return null;

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Nicht eingerichtet, Guthaben leer, kein Zugriff: eine Stunde Ruhe, dann neuer Versuch
      if ([401, 402, 403, 404, 503].includes(res.status)) write(PAUSE_KEY, String(Date.now() + RETRY_AFTER));
      return null;
    }
    const blob = await res.blob();
    write(DAY_KEY, `${today()}:${charsToday() + text.length}`);
    const voice = res.headers.get('X-Voice');
    if (voice) write(VOICE_KEY, voice);
    if ('caches' in window) {
      void caches.open(CACHE).then((c) => c.put(cacheKey(text), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } })));
    }
    return blob;
  } catch {
    return null; // Zeitüberschreitung oder Netzfehler
  } finally {
    window.clearTimeout(timer);
  }
}

let turn = 0;

/**
 * Sagt den Satz an. Ein noch laufender Satz wird abgebrochen, damit der Kommentar nicht hinterherhinkt.
 * Gibt zurück, welche Stimme gesprochen hat.
 */
export async function speak(text: string): Promise<VoiceSource> {
  const mine = ++turn;
  stop();
  let blob: Blob | null = null;
  try {
    blob = (await fromCache(text)) ?? (await fromEleven(text));
  } catch {
    blob = null;
  }
  if (mine !== turn) return blob ? 'eleven' : 'browser'; // inzwischen kam schon die nächste Ansage
  if (blob) {
    const a = audio();
    if (playingUrl) URL.revokeObjectURL(playingUrl);
    playingUrl = URL.createObjectURL(blob);
    a.src = playingUrl;
    try {
      await a.play();
      return 'eleven';
    } catch {
      /* Abspielen blockiert: dann eben die Browser-Stimme */
    }
  }
  browserSpeak(text);
  return 'browser';
}
