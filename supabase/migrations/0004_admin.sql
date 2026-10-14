-- Rundlauf-Analytics: Admin, Einladungslinks, Korrekturrechte, Änderungsprotokoll
-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen (nach 0003_profile.sql).
-- Danach den Admin festlegen (siehe ganz unten).
--
-- Rollen:
--   Gast (ohne Login): liest Statistik und Spitznamen
--   Spieler (is_member): trägt ein, legt Spieler schnell an, korrigiert die laufende Pause
--                        (Rückgängig), pflegt das eigene Profil
--   Admin (genau einer):  alles, inkl. fremder Profile, vergangener Pausen, Einladungen, Logins

-- pgcrypto liegt bei Supabase im Schema "extensions"
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

alter table public.player_accounts add column if not exists is_admin boolean not null default false;
-- Es gibt höchstens einen Admin
create unique index if not exists player_accounts_one_admin on public.player_accounts ((true)) where is_admin;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.player_accounts where user_id = auth.uid() and is_admin);
$$;

-- Bearbeiten darf man das eigene Profil, der Admin alle
create or replace function public.can_edit_player(p_player_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    public.is_member()
    and exists (select 1 from public.player_accounts where player_id = p_player_id and user_id = auth.uid())
  );
$$;

-- Ausblenden nur noch durch den Admin
create or replace function public.set_player_hidden(p_player_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Das darf nur der Admin.' using errcode = '42501';
  end if;
  update public.players set hidden = p_hidden where id = p_player_id;
end $$;

-- Logins verwaltet nur noch der Admin (Spieler bekommen ihren Login über Einladungslinks)
drop policy if exists "anlegen: mitglieder" on public.player_accounts;
drop policy if exists "ändern: ohne login" on public.player_accounts;
drop policy if exists "löschen: ohne login" on public.player_accounts;
create policy "schreiben: admin" on public.player_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Login eines Spielers trennen (z. B. neue E-Mail). Danach braucht er eine neue Einladung.
create or replace function public.unlink_account(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Das darf nur der Admin.' using errcode = '42501';
  end if;
  if exists (select 1 from public.player_accounts where player_id = p_player_id and is_admin) then
    raise exception 'Den Login des Admins kann man nicht trennen.';
  end if;
  delete from public.player_accounts where player_id = p_player_id;
end $$;

-- ---------------------------------------------------------------------------
-- Korrekturrechte: Spieler dürfen nur in der laufenden Pause zurücknehmen,
-- vergangene Pausen ändert nur der Admin
-- ---------------------------------------------------------------------------

create or replace function public.round_in_open_pause(p_round_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rounds r join public.pauses p on p.id = r.pause_id
     where r.id = p_round_id and p.ended_at is null
  );
$$;

drop policy if exists "schreiben: mitglieder" on public.pauses;
create policy "anlegen: mitglieder" on public.pauses for insert to authenticated with check (public.is_member());
create policy "beenden: mitglieder" on public.pauses for update to authenticated
  using (public.is_admin() or (public.is_member() and ended_at is null)) with check (public.is_member());
create policy "löschen: admin" on public.pauses for delete to authenticated using (public.is_admin());

drop policy if exists "schreiben: mitglieder" on public.pause_players;
create policy "anlegen: mitglieder" on public.pause_players for insert to authenticated with check (public.is_member());
create policy "löschen: admin" on public.pause_players for delete to authenticated using (public.is_admin());

drop policy if exists "schreiben: mitglieder" on public.rounds;
create policy "anlegen: mitglieder" on public.rounds for insert to authenticated with check (public.is_member());
create policy "löschen: laufende pause oder admin" on public.rounds for delete to authenticated
  using (public.is_admin() or (public.is_member() and public.round_in_open_pause(id)));

drop policy if exists "schreiben: mitglieder" on public.round_players;
create policy "anlegen: mitglieder" on public.round_players for insert to authenticated with check (public.is_member());
create policy "löschen: admin" on public.round_players for delete to authenticated using (public.is_admin());

drop policy if exists "schreiben: mitglieder" on public.events;
create policy "anlegen: mitglieder" on public.events for insert to authenticated with check (public.is_member());
create policy "löschen: laufende pause oder admin" on public.events for delete to authenticated
  using (public.is_admin() or (public.is_member() and public.round_in_open_pause(round_id)));
create policy "ändern: admin" on public.events for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Finals ändern: beim Zusammenführen von Spielern (siehe unten) ist mehr erlaubt
create or replace function public.check_event_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_setting('rundlauf.merging', true) = 'on' then
    return new;
  end if;
  if old.type <> 'final' then
    raise exception 'Nur ein Finale lässt sich nachträglich ändern. Andere Einträge kann man löschen.';
  end if;
  if new.type <> old.type or new.round_id <> old.round_id or new.seq <> old.seq or new.pot is distinct from old.pot then
    raise exception 'Bei einem Finale lassen sich nur Sieger und Aufschläger ändern.';
  end if;
  if new.player_id = new.loser_id
     or new.player_id not in (old.player_id, old.loser_id)
     or new.loser_id not in (old.player_id, old.loser_id) then
    raise exception 'Sieger und Verlierer müssen die beiden Finalisten bleiben.';
  end if;
  if new.server_id is not null and new.server_id not in (old.player_id, old.loser_id) then
    raise exception 'Aufschlagen kann nur einer der beiden Finalisten.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Einladungslinks: einmalig, 7 Tage gültig. Gespeichert wird nur ein Hash des Links.
-- ---------------------------------------------------------------------------

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references auth.users on delete set null,
  revoked_at  timestamptz
);
alter table public.invites enable row level security;
create policy "lesen: admin" on public.invites for select to authenticated using (public.is_admin());
create policy "widerrufen: admin" on public.invites for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.invites to authenticated;

create or replace function public.invite_hash(p_token text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

-- Erzeugt einen neuen Link für einen Spieler ohne Login; ältere offene Links verfallen
create or replace function public.create_invite(p_player_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not public.is_admin() then
    raise exception 'Das darf nur der Admin.' using errcode = '42501';
  end if;
  if exists (select 1 from public.player_accounts where player_id = p_player_id and user_id is not null) then
    raise exception 'Dieser Spieler hat schon einen Login. Trenne ihn zuerst, wenn er sich neu verbinden soll.';
  end if;
  update public.invites set revoked_at = now()
   where player_id = p_player_id and used_at is null and revoked_at is null;
  v_token := translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  insert into public.invites (player_id, token_hash, expires_at)
  values (p_player_id, public.invite_hash(v_token), now() + interval '7 days');
  return v_token;
end $$;

-- Für die Einladungsseite: Spitzname und ob der Link noch gilt (auch ohne Login abrufbar)
create or replace function public.invite_info(p_token text)
returns table (player_name text, valid boolean, reason text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare i public.invites;
begin
  select * into i from public.invites where token_hash = public.invite_hash(p_token);
  if i.id is null then
    return query select null::text, false, 'Diesen Einladungslink gibt es nicht.';
  elsif i.used_at is not null then
    return query select null::text, false, 'Dieser Einladungslink wurde schon benutzt.';
  elsif i.revoked_at is not null then
    return query select null::text, false, 'Dieser Einladungslink wurde zurückgezogen.';
  elsif i.expires_at < now() then
    return query select null::text, false, 'Dieser Einladungslink ist abgelaufen.';
  else
    return query select p.name, true, null::text from public.players p where p.id = i.player_id;
  end if;
end $$;

-- Löst eine Einladung ein: verknüpft den angemeldeten Login mit dem Spieler und setzt die Namen
create or replace function public.redeem_invite(p_token text, p_name text, p_first text, p_last text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  i public.invites;
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst mit dem Code aus der Mail anmelden.';
  end if;
  select * into i from public.invites where token_hash = public.invite_hash(p_token) for update;
  if i.id is null or i.used_at is not null or i.revoked_at is not null or i.expires_at < now() then
    raise exception 'Dieser Einladungslink gilt nicht mehr. Frag den Admin nach einem neuen.';
  end if;
  if exists (select 1 from public.player_accounts where user_id = auth.uid()) then
    raise exception 'Dein Login ist schon mit einem Spieler verknüpft.';
  end if;
  if exists (select 1 from public.player_accounts where email = v_email and player_id <> i.player_id) then
    raise exception 'Diese E-Mail gehört schon zu einem anderen Spieler.';
  end if;
  if exists (select 1 from public.player_accounts where player_id = i.player_id and user_id is not null) then
    raise exception 'Dieser Spieler hat schon einen Login.';
  end if;

  insert into public.player_accounts (player_id, email, user_id) values (i.player_id, v_email, auth.uid())
  on conflict (player_id) do update set email = excluded.email, user_id = excluded.user_id;
  update public.players set name = btrim(p_name) where id = i.player_id;
  insert into public.player_private (player_id, first_name, last_name)
  values (i.player_id, nullif(btrim(p_first), ''), nullif(btrim(p_last), ''))
  on conflict (player_id) do update
    set first_name = excluded.first_name, last_name = excluded.last_name, updated_at = now();
  update public.invites set used_at = now(), used_by = auth.uid() where id = i.id;
  return i.player_id;
end $$;

-- ---------------------------------------------------------------------------
-- Doppelte Spieler zusammenführen: alle Runden von p_from gehen an p_into, p_from wird gelöscht
-- ---------------------------------------------------------------------------

create or replace function public.merge_players(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_round int;
begin
  if not public.is_admin() then
    raise exception 'Das darf nur der Admin.' using errcode = '42501';
  end if;
  if p_from = p_into then
    raise exception 'Bitte zwei verschiedene Spieler wählen.';
  end if;
  if exists (select 1 from public.player_accounts where player_id = p_from and user_id is not null) then
    raise exception 'Der Spieler, der verschwinden soll, hat einen Login. Trenne ihn zuerst.';
  end if;
  select r.number into v_round
    from public.round_players a
    join public.round_players b on b.round_id = a.round_id and b.player_id = p_into
    join public.rounds r on r.id = a.round_id
   where a.player_id = p_from limit 1;
  if v_round is not null then
    raise exception 'Beide waren in derselben Runde (z. B. Runde %). Das lässt sich nicht zusammenführen.', v_round;
  end if;

  perform set_config('rundlauf.merging', 'on', true);
  update public.round_players set player_id = p_into where player_id = p_from;
  insert into public.pause_players (pause_id, player_id)
    select pause_id, p_into from public.pause_players where player_id = p_from
    on conflict do nothing;
  delete from public.pause_players where player_id = p_from;
  update public.events set player_id = p_into where player_id = p_from;
  update public.events set loser_id  = p_into where loser_id  = p_from;
  update public.events set server_id = p_into where server_id = p_from;
  perform set_config('rundlauf.merging', 'off', true);

  delete from public.players where id = p_from;
end $$;

-- ---------------------------------------------------------------------------
-- Änderungsprotokoll: Löschungen und Änderungen (Rückgängig, Korrekturen)
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  action     text not null,
  table_name text not null,
  old_row    jsonb,
  new_row    jsonb
);
alter table public.audit_log enable row level security;
create policy "lesen: admin" on public.audit_log for select to authenticated using (public.is_admin());
grant select on public.audit_log to authenticated;

create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Folgelöschungen (z. B. Runden einer gelöschten Pause) nicht einzeln protokollieren
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  insert into public.audit_log (user_id, action, table_name, old_row, new_row)
  values (auth.uid(), lower(tg_op), tg_table_name,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

drop trigger if exists audit_events on public.events;
create trigger audit_events after update or delete on public.events for each row execute function public.audit();
drop trigger if exists audit_rounds on public.rounds;
create trigger audit_rounds after delete on public.rounds for each row execute function public.audit();
drop trigger if exists audit_pauses on public.pauses;
create trigger audit_pauses after delete on public.pauses for each row execute function public.audit();
drop trigger if exists audit_players on public.players;
create trigger audit_players after update or delete on public.players for each row execute function public.audit();

-- ---------------------------------------------------------------------------
-- Funktionsrechte
-- ---------------------------------------------------------------------------

revoke execute on function public.is_admin(), public.unlink_account(uuid), public.round_in_open_pause(uuid),
  public.create_invite(uuid), public.redeem_invite(text, text, text, text), public.merge_players(uuid, uuid),
  public.invite_hash(text), public.invite_info(text), public.audit() from public, anon;
grant execute on function public.is_admin(), public.unlink_account(uuid), public.round_in_open_pause(uuid),
  public.create_invite(uuid), public.redeem_invite(text, text, text, text), public.merge_players(uuid, uuid)
  to authenticated;
-- Die Einladungsseite muss auch ohne Login sagen können, ob der Link gilt
grant execute on function public.invite_info(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin festlegen: E-Mail anpassen und diese Zeile einmal ausführen
-- ---------------------------------------------------------------------------
-- update public.player_accounts set is_admin = true where email = 'deine.mail@example.com';
