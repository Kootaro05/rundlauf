export type Tab = 'live' | 'dash' | 'hist' | 'players';

/** Welche Rubrik offen ist, und in der Rubrik Spieler ggf. welches Profil */
export interface Route {
  tab: Tab;
  player: string | null;
}

const SLUG: Record<Tab, string> = { live: 'live', dash: 'dashboard', hist: 'verlauf', players: 'spieler' };

/** "#/spieler/<id>" → { tab: 'players', player: id } */
export function parseHash(hash: string): Route | null {
  const [slug, id] = hash.replace(/^#\/?/, '').split('/');
  const tab = (Object.keys(SLUG) as Tab[]).find((t) => SLUG[t] === slug);
  if (!tab) return null;
  return { tab, player: tab === 'players' && id ? decodeURIComponent(id) : null };
}

export const toHash = (r: Route) => `#/${SLUG[r.tab]}${r.player ? `/${encodeURIComponent(r.player)}` : ''}`;
