import { createClient, type PostgrestError } from '@supabase/supabase-js';
import type { Data, EventType, Pause } from '../domain/types';
import { AppError, type Backend } from './backend';

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
}

const ms = (s: string) => new Date(s).getTime();

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

function check<T extends { error: PostgrestError | null }>(res: T): T {
  if (res.error) throw new AppError(friendly(res.error));
  return res;
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key);

  return {
    kind: 'supabase',

    auth: {
      async current() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        const { data: pid } = await sb.rpc('link_me');
        return { email: data.session.user.email ?? null, playerId: (pid as string | null) ?? null };
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
    },

    async load(): Promise<Data> {
      const [pl, pa] = await Promise.all([
        sb.from('players').select('id, name, hidden, created_at'),
        sb
          .from('pauses')
          .select(
            'id, started_at, ended_at, pause_players(player_id), rounds(id, number, started_at, round_players(player_id), events(id, seq, type, player_id, loser_id, server_id, pot, created_at))',
          )
          .order('started_at', { ascending: false }),
      ]);
      check(pl);
      check(pa);
      const players = (pl.data as PlayerRow[]).map((r) => ({ id: r.id, name: r.name, hidden: r.hidden, createdAt: ms(r.created_at) }));
      const pauses: Pause[] = (pa.data as unknown as PauseRow[]).map((r) => ({
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
      }));
      return { players, pauses };
    },

    subscribe(onChange) {
      const ch = sb
        .channel('alles')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => onChange())
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

    async addPlayer(name, email) {
      check(await sb.rpc('add_player', { p_name: name, p_email: email }));
    },
    async updatePlayer(id, patch) {
      check(await sb.from('players').update(patch).eq('id', id));
    },
    async setEmail(id, email) {
      if (email) check(await sb.from('player_accounts').upsert({ player_id: id, email: email.toLowerCase(), user_id: null }));
      else check(await sb.from('player_accounts').delete().eq('player_id', id));
    },
    async playerEmails() {
      const { data, error } = await sb.from('player_accounts').select('player_id, email');
      if (error) return {};
      return Object.fromEntries((data ?? []).map((r) => [r.player_id as string, r.email as string]));
    },
  };
}
