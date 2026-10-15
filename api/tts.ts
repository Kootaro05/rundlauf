// Kommentator-Stimme über ElevenLabs. Der API-Schlüssel liegt nur hier auf dem Server (Vercel-Umgebungsvariablen).
// Fehlt er, antwortet die Funktion mit 503 und die App spricht mit der eingebauten Browser-Stimme.
//
// Variablen: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, optional ELEVENLABS_MODEL (Modell-ID aus der ElevenLabs-Doku).

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/** Ansagen sind kurz; längere Texte werden abgelehnt, damit niemand Guthaben verheizt */
const MAX_LEN = 240;
const DEFAULT_MODEL = 'eleven_turbo_v2_5';

const fail = (status: number, error: string) => Response.json({ error }, { status });

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
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || DEFAULT_MODEL }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Guthaben leer oder Limit erreicht: die App macht dann eine Weile mit der Browser-Stimme weiter
    if (/quota|credit|limit/i.test(detail) || res.status === 402 || res.status === 429) return fail(402, 'quota');
    console.error('ElevenLabs', res.status, detail.slice(0, 300));
    return fail(502, 'upstream');
  }
  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice': voice },
  });
}
