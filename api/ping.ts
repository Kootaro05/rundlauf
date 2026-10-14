// Vercel-Cron (siehe vercel.json): liest einmal täglich eine Zeile aus Supabase.
// Gratis-Projekte pausieren sonst nach etwa 7 Tagen ohne Zugriff, z. B. in den Semesterferien.

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

export async function GET() {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ ok: false, error: 'Supabase-Variablen fehlen' }, { status: 500 });

  const res = await fetch(`${url}/rest/v1/players?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return Response.json({ ok: res.ok, status: res.status, at: new Date().toISOString() }, { status: res.ok ? 200 : 502 });
}
