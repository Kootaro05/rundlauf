/**
 * Sprachausgabe für den Kommentator. Zuerst ElevenLabs über /api/tts (bessere Stimme), sonst die im
 * Browser eingebaute Stimme (Web Speech API, kostenlos, offline). Fertige ElevenLabs-Audios werden auf
 * dem Gerät gespeichert, damit jeder genau gleiche Satz nur einmal Guthaben kostet.
 */

import { stripTags } from '../domain/commentary';

const KEY = 'rundlauf-kommentator';
/** Bis zu diesem Zeitpunkt wird ElevenLabs übersprungen (Guthaben leer, nicht eingerichtet, kein Zugriff) */
const PAUSE_KEY = 'rundlauf-stimme-pause';
/** Zuletzt von der Server-Funktion gemeldete Stimme; gehört zum Schlüssel im Zwischenspeicher */
const VOICE_KEY = 'rundlauf-stimme-id';
/** Verbrauchte Zeichen heute, als Schutz vor Endlosschleifen */
const DAY_KEY = 'rundlauf-stimme-tag';

const CACHE = 'rundlauf-stimme-v1';
const DAILY_LIMIT = 15000;
/** Länger wartet der Kommentar nicht, sonst hinkt er dem Spiel hinterher (die Anfrage läuft trotzdem weiter) */
const TIMEOUT = 2000;
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
  if (on) {
    write(PAUSE_KEY, null);
    unstickBrowserVoice();
  } else stop();
}

// --- Browser-Stimme ------------------------------------------------------------

/** Beste Stimme für die Sprache: natürliche Online-Stimmen (Edge) vor den Standardstimmen */
function bestVoice(lang: string, localOnly = false): SpeechSynthesisVoice | null {
  const de = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)) && (!localOnly || v.localService));
  const score = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return de.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Chrome lädt die Stimmen erst beim ersten Abfragen, deshalb schon beim Start einmal anstoßen
if (speechSupported()) speechSynthesis.getVoices();

/** Online-Stimmen, die sich aufgehängt haben: für den Rest der Sitzung nur noch Stimmen auf dem Gerät */
let localOnly = false;

/**
 * Chrome und Edge bleiben manchmal im Zustand "spricht" hängen (vor allem mit Online-Stimmen), dann kommt
 * nichts mehr heraus. Abbrechen und Fortsetzen löst das meist.
 */
function unstickBrowserVoice() {
  if (!speechSupported()) return;
  speechSynthesis.cancel();
  speechSynthesis.resume();
}

function browserSpeak(text: string, lang = 'de-DE', retry = true) {
  if (!speechSupported()) return;
  // Audio-Tags wie [excited] versteht nur ElevenLabs; die Browser-Stimme würde sie vorlesen
  const u = new SpeechSynthesisUtterance(stripTags(text));
  const v = bestVoice(lang, localOnly);
  if (v) u.voice = v;
  u.lang = v?.lang ?? lang;
  u.rate = 1.05;
  // Wächter: fängt die Stimme nicht innerhalb von 2,5 s an, hängt sie. Dann einmal mit einer Gerätestimme neu versuchen.
  let started = false;
  u.addEventListener('start', () => (started = true));
  const mine = turn;
  window.setTimeout(() => {
    if (started || mine !== turn || !retry) return;
    if (v && !v.localService) localOnly = true;
    unstickBrowserVoice();
    browserSpeak(text, lang, false);
  }, 2500);
  if (speechSynthesis.paused) speechSynthesis.resume();
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

/** Ergebnis einer Ansage: welche Stimme gesprochen hat und, bei der Browser-Stimme, warum */
export interface VoiceResult { source: VoiceSource; reason?: string }

const REASONS: Record<number, string> = {
  400: 'Text abgelehnt',
  401: 'nicht angemeldet',
  402: 'Guthaben leer',
  403: 'kein Mitglied',
  404: 'Funktion fehlt',
  503: 'nicht eingerichtet',
};

/** Pause bis zu einem Zeitpunkt, mit Grund: "1729000000000|Guthaben leer" */
function pausedReason(): string | null {
  const [until, reason] = (read(PAUSE_KEY) ?? '').split('|');
  return Number(until) > Date.now() ? reason || 'pausiert' : null;
}

type Fetched = { blob: Blob } | { reason: string };

/** Fragt die Server-Funktion. Das Ergebnis wird immer gespeichert, auch wenn die Ansage nicht darauf gewartet hat. */
async function request(text: string, token: string): Promise<Fetched> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      const reason = REASONS[res.status] ?? `ElevenLabs: ${body?.code ?? res.status}`;
      // Nicht eingerichtet, Guthaben leer, kein Zugriff: eine Stunde Ruhe, dann neuer Versuch
      if (res.status in REASONS && res.status !== 400) write(PAUSE_KEY, `${Date.now() + RETRY_AFTER}|${reason}`);
      return { reason };
    }
    const blob = await res.blob();
    write(DAY_KEY, `${today()}:${charsToday() + text.length}`);
    const voice = res.headers.get('X-Voice');
    if (voice) write(VOICE_KEY, voice);
    if ('caches' in window) {
      await caches.open(CACHE).then((c) => c.put(cacheKey(text), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } })));
    }
    return { blob };
  } catch {
    return { reason: 'kein Netz' };
  }
}

// Laufende Anfragen, damit derselbe Satz nicht doppelt bezahlt wird
const pending = new Map<string, Promise<Fetched>>();

/**
 * Holt das Audio von ElevenLabs. Dauert es zu lange, spricht diesmal die Browser-Stimme; die Anfrage
 * läuft aber weiter und landet im Speicher, sodass der Satz beim nächsten Mal sofort klappt.
 */
async function fromEleven(text: string): Promise<Fetched> {
  const paused = pausedReason();
  if (paused) return { reason: paused };
  if (!navigator.onLine) return { reason: 'kein Netz' };
  if (charsToday() + text.length > DAILY_LIMIT) return { reason: 'Tageslimit erreicht' };
  const token = await tokenGetter();
  if (!token) return { reason: 'nicht angemeldet' };

  let job = pending.get(text);
  if (!job) {
    job = request(text, token).finally(() => pending.delete(text));
    pending.set(text, job);
  }
  const slow = new Promise<Fetched>((ok) => window.setTimeout(() => ok({ reason: 'zu langsam' }), TIMEOUT));
  return Promise.race([job, slow]);
}

/** Weckt die Server-Funktion vorab auf, damit die erste Ansage nicht auf den Kaltstart wartet */
export function warmVoice() {
  if (pausedReason() || !navigator.onLine) return;
  void fetch('/api/tts', { method: 'GET' })
    .then((res) => {
      // Neue Stimme eingestellt: ab sofort nur noch deren Audios verwenden. Die der alten Stimme bleiben
      // gespeichert (der Schlüssel enthält die Stimme) und sind nach einem Zurückwechseln sofort wieder da.
      const voice = res.headers.get('X-Voice');
      if (voice) write(VOICE_KEY, voice);
    })
    .catch(() => {});
}

let turn = 0;

/**
 * Sagt den Satz an. Ein noch laufender Satz wird abgebrochen, damit der Kommentar nicht hinterherhinkt.
 * Gibt zurück, welche Stimme gesprochen hat.
 */
export async function speak(text: string, lang = 'de-DE'): Promise<VoiceResult> {
  const mine = ++turn;
  stop();
  let got: Fetched;
  try {
    const cached = await fromCache(text);
    got = cached ? { blob: cached } : await fromEleven(text);
  } catch {
    got = { reason: 'Fehler' };
  }
  if (mine !== turn) return 'blob' in got ? { source: 'eleven' } : { source: 'browser', reason: got.reason };
  if ('blob' in got) {
    const a = audio();
    if (playingUrl) URL.revokeObjectURL(playingUrl);
    playingUrl = URL.createObjectURL(got.blob);
    a.src = playingUrl;
    try {
      await a.play();
      return { source: 'eleven' };
    } catch {
      got = { reason: 'Abspielen blockiert' };
    }
  }
  browserSpeak(text, lang);
  return { source: 'browser', reason: got.reason };
}

/**
 * Spielt eine Tondatei (z. B. /sounds/enemy-slain.mp3) statt einer Ansage. Fehlt sie oder lässt sie sich nicht
 * abspielen, wird `fallbackText` gesprochen. Gibt nur bei diesem Ersatz ein Ergebnis zurück.
 */
export async function playClip(url: string, fallbackText: string, lang = 'en-US'): Promise<VoiceResult | null> {
  const mine = ++turn;
  stop();
  const a = audio();
  if (playingUrl) URL.revokeObjectURL(playingUrl);
  playingUrl = null;
  a.src = url;
  try {
    await a.play();
    return null;
  } catch {
    return mine === turn ? speak(fallbackText, lang) : null;
  }
}
