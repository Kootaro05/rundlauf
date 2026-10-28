import { createClient, type PostgrestError } from '@supabase/supabase-js';
import type { Activity, Data, EventType, Pause, PrivateData } from '../domain/types';
import { AppError, EMPTY_PRIVATE, type Backend } from './backend';

interface EventRow {
  id: string;
  seq: number;
  type: EventType;
  player_id: string;
  loser_id: string | null;
  server_id: string | null;
  pot: number | null;
  created_at: string;
}
interface RoundRow {
  id: string;
  number: number;
  started_at: string;
  round_players: { player_id: string }[];
  events: EventRow[];
}
interface PauseRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  pause_players: { player_id: string }[];
  rounds: RoundRow[];
}
interface PlayerRow {
  id: string;
  name: string;
  hidden: boolean;
  created_at: string;
  spoken_name?: string | null;
}

const ms = (s: string) => new Date(s).getTime();

const PAUSE_SELECT =
  'id, started_at, ended_at, pause_players(player_id), rounds(id, number, started_at, round_players(player_id), events(id, seq, type, player_id, loser_id, server_id, pot, created_at))';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toPlayer = (r: PlayerRow) => ({ id: r.id, name: r.name, hidden: r.hidden, createdAt: ms(r.created_at), spoken: r.spoken_name ?? null });

const PLAYER_COLS = 'id, name, hidden, created_at';
/** Migration 0005 (Aussprache) fehlt noch: dann ohne die Spalte laden, statt dass die App nicht startet */
const missingSpoken = (e: { message?: string } | null) => !!e && /spoken_name/.test(e.message ?? '');

const toPause = (r: PauseRow): Pause => ({
  id: r.id,
  startedAt: ms(r.started_at),
  endedAt: r.ended_at ? ms(r.ended_at) : null,
  participants: r.pause_players.map((x) => x.player_id),
  rounds: r.rounds
    .sort((a, b) => a.number - b.number)
    .map((rr) => ({
      id: rr.id,
      number: rr.number,
      startedAt: ms(rr.started_at),
      participants: rr.round_players.map((x) => x.player_id),
      events: rr.events
        .sort((a, b) => a.seq - b.seq)
        .map((e) => ({
          id: e.id, seq: e.seq, type: e.type, p: e.player_id, loser: e.loser_id,
          server: e.server_id, pot: e.pot, t: ms(e.created_at),
        })),
    })),
});

function friendly(e: PostgrestError | { code?: string; message: string }): string {
  if (e.code === '23505') {
    if (e.message.includes('players_name_ci')) return 'Diesen Namen gibt es schon.';
    if (e.message.includes('email')) return 'Diese E-Mail gehört schon zu einem anderen Spieler.';
    if (e.message.includes('pauses_one_open')) return 'Es läuft schon eine Pause.';
    return 'Das hat gerade schon jemand anderes eingetragen. Der Stand ist aktualisiert.';
  }
  if (e.code === '42501') return 'Du darfst nicht eintragen. Melde dich mit einer E-Mail an, die einem Spieler zugeordnet ist.';
  if (e.code === 'P0001') return e.message;
  return `Speichern fehlgeschlagen: ${e.message}`;
}

// supabase-js meldet einen fehlgeschlagenen Request ohne Code und mit der Meldung des Browsers
const isFetchFailure = (e: { code?: string; message: string }) =>
  !e.code && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message);

function check<T extends { error: PostgrestError | null }>(res: T): T {
  if (res.error) {
    if (isFetchFailure(res.error)) throw new AppError('Keine Verbindung. Das geht erst wieder mit Netz.', true);
    throw new AppError(friendly(res.error));
  }
  return res;
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key);

  const loadPlayers = async () => {
    let res = await sb.from('players').select(`${PLAYER_COLS}, spoken_name`);
    if (missingSpoken(res.error)) res = await sb.from('players').select(PLAYER_COLS);
    return (check(res).data as PlayerRow[]).map(toPlayer);
  };

  return {
    kind: 'supabase',

    auth: {
      async current() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        // Die Zuordnung Login → Spieler wird gemerkt, damit man auch nach einem Neustart ohne Netz eintragen kann
        const memo = `rk.login.${data.session.user.id}`;
        const [link, admin] = await Promise.all([sb.rpc('link_me'), sb.rpc('is_admin')]);
        let known = { playerId: (link.data as string | null) ?? null, isAdmin: admin.data === true };
        try {
          if (link.error) known = { ...known, ...JSON.parse(localStorage.getItem(memo) ?? '{}') };
          else localStorage.setItem(memo, JSON.stringify(known));
        } catch { /* Speicher gesperrt */ }
        return { email: data.session.user.email ?? null, ...known };
      },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange(() => cb());
        return () => data.subscription.unsubscribe();
      },
      async signIn(email) {
        const redirect = window.location.origin + window.location.pathname;
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw new AppError(`Login-Mail konnte nicht gesendet werden: ${error.message}`);
      },
      async verifyCode(email, code) {
        const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw new AppError('Der Code stimmt nicht oder ist abgelaufen. Fordere einen neuen an.');
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async accessToken() {
        const { data } = await sb.auth.getSession();
        return data.session?.access_token ?? null;
      },
    },

    async load(): Promise<Data> {
      const [players, pa] = await Promise.all([
        loadPlayers(),
        sb.from('pauses').select(PAUSE_SELECT).order('started_at', { ascending: false }),
      ]);
      check(pa);
      return { players, pauses: (pa.data as unknown as PauseRow[]).map(toPause) };
    },

    loadPlayers,

    async loadPauses({ ids, open }) {
      const safe = ids.filter((id) => UUID.test(id));
      if (!safe.length && !open) return [];
      let q = sb.from('pauses').select(PAUSE_SELECT);
      if (safe.length && open) q = q.or(`ended_at.is.null,id.in.(${safe.join(',')})`);
      else if (safe.length) q = q.in('id', safe);
      else q = q.is('ended_at', null);
      return (check(await q).data as unknown as PauseRow[]).map(toPause);
    },

    subscribe(onChange) {
      const ch = sb
        .channel('alles')
        .on('postgres_changes', { event: '*', schema: 'public' }, (p) =>
          onChange({
            table: p.table,
            type: p.eventType,
            row: (p.new ?? {}) as Record<string, unknown>,
            old: (p.old ?? {}) as Record<string, unknown>,
          }))
        .subscribe();
      return () => void sb.removeChannel(ch);
    },

    async startPause(playerIds) {
      check(await sb.rpc('start_pause', { player_ids: playerIds }));
    },
    async startRound(pauseId, playerIds) {
      check(await sb.rpc('start_round', { p_pause_id: pauseId, player_ids: playerIds }));
    },
    async addEvent(roundId, seq, ev) {
      check(
        await sb.from('events').insert({
          round_id: roundId, seq, type: ev.type, player_id: ev.p,
          loser_id: ev.loser ?? null, server_id: ev.server ?? null, pot: ev.pot ?? null,
        }),
      );
    },
    async undo(pause) {
      const r = pause.rounds.at(-1);
      if (!r) return;
      const e = r.events.at(-1);
      if (e) check(await sb.from('events').delete().eq('id', e.id));
      else check(await sb.from('rounds').delete().eq('id', r.id));
    },
    async endPause(pauseId) {
      check(await sb.rpc('end_pause', { p_pause_id: pauseId }));
    },

    async deleteEvent(eventId) {
      check(await sb.from('events').delete().eq('id', eventId));
    },
    async updateFinal(eventId, patch) {
      check(await sb.from('events').update({ player_id: patch.p, loser_id: patch.loser, server_id: patch.server }).eq('id', eventId));
    },
    async deleteRound(roundId) {
      check(await sb.from('rounds').delete().eq('id', roundId));
    },
    async deletePause(pauseId) {
      check(await sb.from('pauses').delete().eq('id', pauseId));
    },
    async removeFromRound({ roundId, playerId, eventIds, leavePause }) {
      if (eventIds.length) check(await sb.from('events').delete().in('id', eventIds));
      check(await sb.from('round_players').delete().eq('round_id', roundId).eq('player_id', playerId));
      if (leavePause) check(await sb.from('pause_players').delete().eq('pause_id', leavePause).eq('player_id', playerId));
    },

    async addPlayer(name) {
      return check(await sb.rpc('add_player', { p_name: name, p_email: null })).data as string;
    },

    async loadPrivate(): Promise<PrivateData> {
      // Für alle außer eingetragenen Spielern liefern die Zugriffsregeln einfach nichts
      const [pr, acc] = await Promise.all([
        sb.from('player_private').select('player_id, first_name, last_name, avatar_path'),
        sb.from('player_accounts').select('player_id, email, user_id, is_admin'),
      ]);
      if (pr.error || acc.error) return EMPTY_PRIVATE;
      const rows = pr.data as { player_id: string; first_name: string | null; last_name: string | null; avatar_path: string | null }[];
      const paths = rows.map((r) => r.avatar_path).filter((p): p is string => !!p);
      const urls: Record<string, string> = {};
      if (paths.length) {
        const { data } = await sb.storage.from('avatars').createSignedUrls(paths, 3600);
        for (const s of data ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
      }
      return {
        info: Object.fromEntries(rows.map((r) => [r.player_id, {
          firstName: r.first_name, lastName: r.last_name, avatarPath: r.avatar_path,
          avatarUrl: r.avatar_path ? (urls[r.avatar_path] ?? null) : null,
        }])),
        accounts: Object.fromEntries((acc.data as { player_id: string; email: string; user_id: string | null; is_admin: boolean }[])
          .map((r) => [r.player_id, { email: r.email, linked: !!r.user_id, userId: r.user_id, isAdmin: r.is_admin }])),
      };
    },
    async saveProfile(id, p) {
      // Die Zugriffsregeln lassen fremde Änderungen ins Leere laufen, darum die geänderten Zeilen zählen
      const upd = await sb.from('players').update({ name: p.name, ...(p.spoken !== undefined ? { spoken_name: p.spoken } : {}) }).eq('id', id).select('id');
      if (missingSpoken(upd.error)) throw new AppError('Für die Aussprache muss zuerst die Migration 0005 in Supabase ausgeführt werden.');
      const res = check(upd);
      if (!res.data?.length) throw new AppError('Dieses Profil darf nur der Spieler selbst oder der Admin ändern.');
      check(await sb.from('player_private').upsert({
        player_id: id, first_name: p.firstName, last_name: p.lastName, updated_at: new Date().toISOString(),
      }));
    },
    async uploadAvatar(id, image, oldPath) {
      const path = `${id}/${Date.now()}.${image.type === 'image/webp' ? 'webp' : 'png'}`;
      const up = await sb.storage.from('avatars').upload(path, image, { contentType: image.type, upsert: false });
      if (up.error) throw new AppError(`Bild konnte nicht hochgeladen werden: ${up.error.message}`);
      check(await sb.from('player_private').upsert({ player_id: id, avatar_path: path, updated_at: new Date().toISOString() }));
      if (oldPath) await sb.storage.from('avatars').remove([oldPath]);
    },
    async removeAvatar(id, path) {
      check(await sb.from('player_private').update({ avatar_path: null, updated_at: new Date().toISOString() }).eq('player_id', id));
      await sb.storage.from('avatars').remove([path]);
    },

    async inviteInfo(token) {
      const res = check(await sb.rpc('invite_info', { p_token: token }));
      const row = (res.data as { player_name: string | null; valid: boolean; reason: string | null }[])[0];
      return { playerName: row?.player_name ?? null, valid: !!row?.valid, reason: row?.reason ?? 'Diesen Einladungslink gibt es nicht.' };
    },
    async redeemInvite(token, p) {
      check(await sb.rpc('redeem_invite', { p_token: token, p_name: p.name, p_first: p.firstName ?? '', p_last: p.lastName ?? '' }));
    },

    async setHidden(id, hidden) {
      check(await sb.rpc('set_player_hidden', { p_player_id: id, p_hidden: hidden }));
    },
    async createInvite(playerId) {
      return check(await sb.rpc('create_invite', { p_player_id: playerId })).data as string;
    },
    async listInvites() {
      const res = check(await sb.from('invites').select('id, player_id, created_at, expires_at, used_at, revoked_at').order('created_at', { ascending: false }));
      return (res.data as { id: string; player_id: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null }[])
        .map((r) => ({
          id: r.id, playerId: r.player_id, createdAt: ms(r.created_at), expiresAt: ms(r.expires_at),
          usedAt: r.used_at ? ms(r.used_at) : null, revokedAt: r.revoked_at ? ms(r.revoked_at) : null,
        }));
    },
    async revokeInvite(id) {
      check(await sb.from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', id));
    },
    async unlinkAccount(playerId) {
      check(await sb.rpc('unlink_account', { p_player_id: playerId }));
    },
    async mergePlayers(from, into) {
      check(await sb.rpc('merge_players', { p_from: from, p_into: into }));
    },
    async loadActivity(limit) {
      // Neu eingetragen: aus den Einträgen selbst (created_by); gelöscht/geändert: aus dem Protokoll
      const [ev, log] = await Promise.all([
        sb.from('events').select('id, round_id, type, player_id, loser_id, pot, created_at, created_by').order('created_at', { ascending: false }).limit(limit),
        sb.from('audit_log').select('id, at, user_id, action, table_name, old_row, new_row').order('at', { ascending: false }).limit(limit),
      ]);
      check(ev);
      check(log);
      const inserts: Activity[] = (ev.data as { id: string; created_at: string; created_by: string | null }[]).map((r) => ({
        id: `e-${r.id}`, at: ms(r.created_at), userId: r.created_by, action: 'insert', table: 'events', row: r as Record<string, unknown>, before: null,
      }));
      const changes: Activity[] = (log.data as { id: number; at: string; user_id: string | null; action: Activity['action']; table_name: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }[])
        .map((r) => ({ id: `a-${r.id}`, at: ms(r.at), userId: r.user_id, action: r.action, table: r.table_name, row: r.new_row, before: r.old_row }));
      return [...inserts, ...changes].sort((a, b) => b.at - a.at).slice(0, limit);
    },
  };
}
