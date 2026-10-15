import { DEMO_PEOPLE, makeDemo } from '../domain/demo';
import { isFinished } from '../domain/game';
import type { Activity, Data, Invite, PlayerPrivate, PrivateData } from '../domain/types';
import { AppError, type Backend } from './backend';

/** Speichert nur im Arbeitsspeicher. Für lokales Ausprobieren ohne Supabase-Projekt. */
export function createDemoBackend(): Backend {
  let data: Data = makeDemo();
  // Echte Namen der Beispiel-Spieler. Im Demo-Modus bist du Admin und Spieler "Countess" (demo-0).
  const emptyInfo = (): PlayerPrivate => ({ firstName: null, lastName: null, avatarPath: null, avatarUrl: null });
  const priv: PrivateData = {
    // Profilbilder: eigene Fantasiefiguren in public/demo-avatars (nur im Demo-Modus geladen)
    info: Object.fromEntries(DEMO_PEOPLE.map((p, i) => {
      const url = `${import.meta.env.BASE_URL}demo-avatars/${p.avatar}.svg`;
      return [`demo-${i}`, { ...emptyInfo(), firstName: p.first, lastName: p.last, avatarPath: url, avatarUrl: url }];
    })),
    accounts: { 'demo-0': { email: 'demo@example.com', linked: true, userId: 'demo-user', isAdmin: true } },
  };
  const invites: (Invite & { token: string })[] = [];
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  const id = () => Math.random().toString(36).slice(2, 10);
  const pause = (pid: string) => {
    const p = data.pauses.find((x) => x.id === pid);
    if (!p) throw new AppError('Pause nicht gefunden.');
    return p;
  };

  return {
    kind: 'demo',
    auth: {
      current: async () => ({ email: 'demo@example.com', playerId: 'demo-0', isAdmin: true }),
      onChange: () => () => {},
      signIn: async () => {},
      verifyCode: async () => {},
      signOut: async () => {},
      accessToken: async () => null,
    },
    load: async () => structuredClone(data),
    loadPlayers: async () => structuredClone(data.players),
    loadPauses: async ({ ids, open }) => structuredClone(data.pauses.filter((p) => ids.includes(p.id) || (open && !p.endedAt))),
    subscribe(cb) {
      // Im Demo-Modus ist alles im Speicher, da lohnt kein gezieltes Nachladen
      const l = () => cb({ table: '*', type: '*', row: {}, old: {} });
      listeners.add(l);
      return () => listeners.delete(l);
    },

    async startPause(playerIds) {
      if (data.pauses.some((p) => !p.endedAt)) throw new AppError('Es läuft schon eine Pause.');
      data.pauses.push({ id: id(), startedAt: Date.now(), endedAt: null, participants: [...playerIds], rounds: [] });
      changed();
    },
    async startRound(pauseId, playerIds) {
      const pa = pause(pauseId);
      const last = pa.rounds.at(-1);
      if (last && !isFinished(last)) throw new AppError('Es läuft noch eine Runde.');
      pa.rounds.push({ id: id(), number: pa.rounds.length + 1, startedAt: Date.now(), participants: [...playerIds], events: [] });
      pa.participants = [...new Set([...pa.participants, ...playerIds])];
      changed();
    },
    async addEvent(roundId, seq, ev) {
      const r = data.pauses.flatMap((p) => p.rounds).find((x) => x.id === roundId);
      if (!r) throw new AppError('Runde nicht gefunden.');
      if (r.events.some((e) => e.seq === seq)) throw new AppError('Das wurde gerade schon eingetragen.');
      r.events.push({ id: id(), seq, t: Date.now(), loser: null, server: null, pot: null, ...ev });
      changed();
    },
    async undo(p) {
      const pa = pause(p.id);
      const r = pa.rounds.at(-1);
      if (!r) return;
      if (r.events.length) r.events.pop();
      else pa.rounds.pop();
      changed();
    },
    async endPause(pauseId) {
      const pa = pause(pauseId);
      pa.rounds = pa.rounds.filter(isFinished);
      pa.endedAt = Date.now();
      changed();
    },

    async deleteEvent(eventId) {
      for (const r of data.pauses.flatMap((p) => p.rounds)) r.events = r.events.filter((e) => e.id !== eventId);
      changed();
    },
    async updateFinal(eventId, patch) {
      const e = data.pauses.flatMap((p) => p.rounds).flatMap((r) => r.events).find((x) => x.id === eventId);
      if (e) Object.assign(e, patch);
      changed();
    },
    async deleteRound(roundId) {
      for (const p of data.pauses) p.rounds = p.rounds.filter((r) => r.id !== roundId);
      changed();
    },
    async deletePause(pauseId) {
      data.pauses = data.pauses.filter((p) => p.id !== pauseId);
      changed();
    },

    async addPlayer(name) {
      if (data.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new AppError('Diesen Namen gibt es schon.');
      const pid = id();
      data.players.push({ id: pid, name, hidden: false, createdAt: Date.now() });
      changed();
      return pid;
    },

    loadPrivate: async () => structuredClone(priv),
    async saveProfile(pid, p) {
      const pl = data.players.find((x) => x.id === pid);
      if (pl) pl.name = p.name;
      priv.info[pid] = { ...(priv.info[pid] ?? emptyInfo()), firstName: p.firstName, lastName: p.lastName };
      changed();
    },
    async uploadAvatar(pid, image) {
      const url = URL.createObjectURL(image);
      priv.info[pid] = { ...(priv.info[pid] ?? emptyInfo()), avatarPath: url, avatarUrl: url };
      changed();
    },
    async removeAvatar(pid) {
      priv.info[pid] = { ...(priv.info[pid] ?? emptyInfo()), avatarPath: null, avatarUrl: null };
      changed();
    },

    async inviteInfo(token) {
      const i = invites.find((x) => x.token === token);
      if (!i) return { playerName: null, valid: false, reason: 'Diesen Einladungslink gibt es nicht.' };
      if (i.usedAt || i.revokedAt || i.expiresAt < Date.now()) return { playerName: null, valid: false, reason: 'Dieser Einladungslink gilt nicht mehr.' };
      return { playerName: data.players.find((p) => p.id === i.playerId)?.name ?? null, valid: true, reason: null };
    },
    async redeemInvite(token, p) {
      const i = invites.find((x) => x.token === token && !x.usedAt && !x.revokedAt);
      if (!i) throw new AppError('Dieser Einladungslink gilt nicht mehr.');
      const pl = data.players.find((x) => x.id === i.playerId);
      if (pl) pl.name = p.name;
      priv.info[i.playerId] = { ...(priv.info[i.playerId] ?? emptyInfo()), firstName: p.firstName, lastName: p.lastName };
      i.usedAt = Date.now();
      changed();
    },

    async setHidden(pid, hidden) {
      const p = data.players.find((x) => x.id === pid);
      if (p) p.hidden = hidden;
      changed();
    },
    async createInvite(playerId) {
      if (priv.accounts[playerId]?.linked) throw new AppError('Dieser Spieler hat schon einen Login.');
      for (const i of invites) if (i.playerId === playerId && !i.usedAt && !i.revokedAt) i.revokedAt = Date.now();
      const token = crypto.randomUUID().replace(/-/g, '');
      invites.unshift({ id: id(), token, playerId, createdAt: Date.now(), expiresAt: Date.now() + 7 * 864e5, usedAt: null, revokedAt: null });
      changed();
      return token;
    },
    listInvites: async () => invites.map(({ token: _token, ...i }) => ({ ...i })),
    async revokeInvite(inviteId) {
      const i = invites.find((x) => x.id === inviteId);
      if (i) i.revokedAt = Date.now();
      changed();
    },
    async unlinkAccount(playerId) {
      if (priv.accounts[playerId]?.isAdmin) throw new AppError('Den Login des Admins kann man nicht trennen.');
      delete priv.accounts[playerId];
      changed();
    },
    async mergePlayers(from, into) {
      if (from === into) throw new AppError('Bitte zwei verschiedene Spieler wählen.');
      for (const pa of data.pauses)
        for (const r of pa.rounds) {
          if (r.participants.includes(from) && r.participants.includes(into))
            throw new AppError(`Beide waren in derselben Runde (z. B. Runde ${r.number}). Das lässt sich nicht zusammenführen.`);
        }
      const swap = (x: string | null) => (x === from ? into : x);
      for (const pa of data.pauses) {
        pa.participants = [...new Set(pa.participants.map((x) => swap(x)!))];
        for (const r of pa.rounds) {
          r.participants = r.participants.map((x) => swap(x)!);
          for (const e of r.events) Object.assign(e, { p: swap(e.p), loser: swap(e.loser), server: swap(e.server) });
        }
      }
      data.players = data.players.filter((p) => p.id !== from);
      delete priv.info[from];
      changed();
    },
    loadActivity: async (limit) =>
      data.pauses.flatMap((pa) => pa.rounds.flatMap((r) => r.events.map((e): Activity => ({
        id: e.id, at: e.t, userId: 'demo-user', action: 'insert', table: 'events',
        row: { type: e.type, player_id: e.p, loser_id: e.loser, pot: e.pot, round_id: r.id }, before: null,
      })))).sort((a, b) => b.at - a.at).slice(0, limit),
  };
}
