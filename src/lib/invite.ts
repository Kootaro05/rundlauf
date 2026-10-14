import { isNetworkError, type Backend } from './backend';

/**
 * Eine angefangene Einladung wird auf dem Gerät gemerkt, bis sie eingelöst ist.
 * Öffnet der Eingeladene statt den Code einzugeben den Link aus der Mail, landet er ohne
 * Einladungsseite in der App; die App löst die Einladung dann nach dem Login automatisch ein.
 */
export interface PendingInvite {
  token: string;
  profile: { name: string; firstName: string | null; lastName: string | null };
}

const KEY = 'rk.invite';

export function savePendingInvite(p: PendingInvite) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* Speicher gesperrt */ }
}

export function loadPendingInvite(): PendingInvite | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingInvite) : null;
  } catch {
    return null;
  }
}

function clearPendingInvite() {
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
}

let running: Promise<boolean> | null = null;

/**
 * Löst die gemerkte Einladung ein (höchstens einmal gleichzeitig, auch wenn Einladungsseite und App
 * es beide versuchen). true, wenn eingelöst; false, wenn keine da war. Wirft bei Ablehnung.
 */
export function redeemPendingInvite(backend: Backend): Promise<boolean> {
  if (running) return running;
  const p = loadPendingInvite();
  if (!p) return Promise.resolve(false);
  running = backend
    .redeemInvite(p.token, p.profile)
    .then(() => {
      clearPendingInvite();
      return true;
    })
    .catch((e: unknown) => {
      // Ohne Netz später nochmal versuchen, sonst ist die Einladung nicht mehr einlösbar
      if (!isNetworkError(e)) clearPendingInvite();
      throw e;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
