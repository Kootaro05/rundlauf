export type Tab = 'live' | 'dash' | 'hist' | 'players' | 'admin' | 'invite';

/** Welche Rubrik offen ist, in der Rubrik Spieler ggf. welches Profil, bei einer Einladung der Code */
export interface Route {
  tab: Tab;
  player: string | null;
  token?: string;
}

const SLUG: Record<Tab, string> = {
  live: 'live', dash: 'dashboard', hist: 'verlauf', players: 'spieler', admin: 'admin', invite: 'einladung',
};

/** "#/spieler/<id>" → { tab: 'players', player: id }, "#/einladung/<code>" → { tab: 'invite', token } */
export function parseHash(hash: string): Route | null {
  const [slug, param] = hash.replace(/^#\/?/, '').split('/');
  const tab = (Object.keys(SLUG) as Tab[]).find((t) => SLUG[t] === slug);
  if (!tab) return null;
  const value = param ? decodeURIComponent(param) : null;
  if (tab === 'invite') return value ? { tab, player: null, token: value } : null;
  return { tab, player: tab === 'players' ? value : null };
}

export const toHash = (r: Route) =>
  `#/${SLUG[r.tab]}${r.player ? `/${encodeURIComponent(r.player)}` : r.token ? `/${encodeURIComponent(r.token)}` : ''}`;

export const inviteUrl = (token: string) =>
  `${window.location.origin}${window.location.pathname}${toHash({ tab: 'invite', player: null, token })}`;
