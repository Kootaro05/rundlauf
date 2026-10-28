// Kommentator-Stimme über ElevenLabs. Der API-Schlüssel liegt nur hier auf dem Server (Vercel-Umgebungsvariablen).
// Fehlt er, antwortet die Funktion mit 503 und die App spricht mit der eingebauten Browser-Stimme.
//
// Variablen: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, optional ELEVENLABS_MODEL (Modell-ID aus der ElevenLabs-Doku)
// und zum Feinjustieren der Stimme ELEVENLABS_SPEED (0.7–1.2), ELEVENLABS_STABILITY, ELEVENLABS_SIMILARITY,
// ELEVENLABS_STYLE (je 0–1). Nicht gesetzte Werte nimmt ElevenLabs aus den Einstellungen der Stimme.

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/** Ansagen sind kurz; längere Texte werden abgelehnt, damit niemand Guthaben verheizt */
const MAX_LEN = 240;
const DEFAULT_MODEL = 'eleven_v4_turbo';

const fail = (status: number, error: string) => Response.json({ error }, { status });

const num = (v: string | undefined, min: number, max: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

/** Stimm-Einstellungen aus den Umgebungsvariablen; leer, wenn keine gesetzt ist */
function voiceSettings(): Record<string, number> | undefined {
  const s = {
    speed: num(env.ELEVENLABS_SPEED, 0.7, 1.2),
    stability: num(env.ELEVENLABS_STABILITY, 0, 1),
    similarity_boost: num(env.ELEVENLABS_SIMILARITY, 0, 1),
    style: num(env.ELEVENLABS_STYLE, 0, 1),
  };
  const set = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as Record<string, number>;
  return Object.keys(set).length ? set : undefined;
}

const model = () => env.ELEVENLABS_MODEL || DEFAULT_MODEL;

/**
 * Kennung der Stimme samt Modell und Einstellungen. Die App speichert Audios unter dieser Kennung;
 * ändert sich etwas davon, werden die Sätze neu erzeugt, alte bleiben für ein Zurückwechseln liegen.
 */
function voiceTag(voice: string) {
  const s = voiceSettings();
  const short: Record<string, string> = { speed: 'sp', stability: 'st', similarity_boost: 'si', style: 'sy' };
  return [voice, model(), ...(s ? Object.entries(s).map(([k, v]) => `${short[k]}${v}`) : [])].join('~');
}

/**
 * Zum Aufwärmen: die App ruft das vorab auf, damit die erste Ansage nicht auf den Kaltstart wartet.
 * Meldet dabei die eingestellte Stimme, damit die App nach einem Stimmwechsel keine alten Audios mehr abspielt.
 */
export async function GET() {
  const voice = env.ELEVENLABS_VOICE_ID;
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...(voice ? { 'X-Voice': voiceTag(voice) } : {}) } });
}

export async function POST(req: Request) {
  const key = env.ELEVENLABS_API_KEY;
  const voice = env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return fail(503, 'not-configured');

  // Nur angemeldete Mitglieder dürfen Guthaben verbrauchen
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const sbUrl = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_ANON_KEY;
  if (!token || !sbUrl || !anon) return fail(401, 'login');
  const member = await fetch(`${sbUrl}/rest/v1/rpc/is_member`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!member.ok || (await member.json()) !== true) return fail(403, 'member');

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_LEN) return fail(400, 'text');

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model(), ...(voiceSettings() ? { voice_settings: voiceSettings() } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('ElevenLabs', res.status, detail.slice(0, 300));
    // Fehlercode von ElevenLabs (z. B. voice_not_found) an die App weitergeben, damit er am Knopf steht
    let code = String(res.status);
    try {
      const d = (JSON.parse(detail) as { detail?: { status?: string; code?: string } | string }).detail;
      code = (typeof d === 'object' ? d?.status ?? d?.code : undefined) ?? code;
    } catch {
      /* keine JSON-Antwort */
    }
    // Nur echtes leeres Guthaben zählt als "quota"; die App macht dann eine Weile mit der Browser-Stimme weiter
    if (/quota|credit/i.test(code) || /quota_exceeded|insufficient.credit/i.test(detail)) return fail(402, 'quota');
    return Response.json({ error: 'upstream', code: code.slice(0, 60) }, { status: 502 });
  }
  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice': voiceTag(voice) },
  });
}
