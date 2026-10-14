-- Rundlauf-Analytics: Grundschema
-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

-- Spieler sind öffentlich sichtbar (nur Name), damit das Dashboard ohne Login funktioniert.
create table public.players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 24),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index players_name_ci on public.players (lower(name));

-- Verknüpfung Spieler <-> Login. E-Mails sind nur für Mitglieder lesbar.
-- Wer hier mit seiner E-Mail steht, wird beim ersten Magic-Link-Login automatisch verknüpft
-- und darf ab dann eintragen.
create table public.player_accounts (
  player_id  uuid primary key references public.players on delete cascade,
  email      text not null unique check (email = lower(btrim(email)) and email like '%@%'),
  user_id    uuid unique references auth.users on delete set null
);

create table public.pauses (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_by  uuid default auth.uid() references auth.users on delete set null
);
-- Es kann immer nur eine Pause gleichzeitig laufen.
create unique index pauses_one_open on public.pauses ((true)) where ended_at is null;

create table public.pause_players (
  pause_id   uuid not null references public.pauses on delete cascade,
  player_id  uuid not null references public.players on delete restrict,
  primary key (pause_id, player_id)
);

create table public.rounds (
  id          uuid primary key default gen_random_uuid(),
  pause_id    uuid not null references public.pauses on delete cascade,
  number      int  not null check (number > 0),
  started_at  timestamptz not null default now(),
  unique (pause_id, number)
);

create table public.round_players (
  round_id   uuid not null references public.rounds on delete cascade,
  player_id  uuid not null references public.players on delete restrict,
  primary key (round_id, player_id)
);

create type public.event_type as enum ('schwimmer', 'crown', 'out', 'final');

-- Alles, was in einer Runde passiert. Bei 'final' ist player_id der Gewinner.
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.rounds on delete cascade,
  seq         int  not null check (seq > 0),
  type        public.event_type not null,
  player_id   uuid not null references public.players,
  loser_id    uuid references public.players,
  server_id   uuid references public.players,
  pot         int check (pot > 0),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users on delete set null,
  -- seq ist pro Runde eindeutig: tragen zwei Leute gleichzeitig ein, gewinnt der erste
  unique (round_id, seq),
  check ((type = 'final') = (loser_id is not null and pot is not null))
);
create unique index events_one_schwimmer on public.events (round_id) where type = 'schwimmer';
create unique index events_one_final     on public.events (round_id) where type = 'final';
create unique index events_out_once      on public.events (round_id, player_id) where type = 'out';
create index events_round on public.events (round_id);
create index rounds_pause on public.rounds (pause_id);

-- ---------------------------------------------------------------------------
-- Mitgliedschaft
-- ---------------------------------------------------------------------------

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.player_accounts where user_id = auth.uid());
$$;

-- Nach dem Login aufrufen: verknüpft den Login mit dem Spieler, der diese E-Mail hat.
-- Gibt die Spieler-ID zurück oder null, wenn die E-Mail keinem Spieler zugeordnet ist.
create or replace function public.link_me() returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then return null; end if;
  update public.player_accounts
     set user_id = auth.uid()
   where email = lower(auth.jwt() ->> 'email') and user_id is null;
  select player_id into pid from public.player_accounts where user_id = auth.uid();
  return pid;
end $$;

-- ---------------------------------------------------------------------------
-- Aktionen, die mehrere Zeilen auf einmal schreiben (laufen mit den Rechten des Aufrufers)
-- ---------------------------------------------------------------------------

create or replace function public.start_pause(player_ids uuid[]) returns uuid
language plpgsql security invoker set search_path = public as $$
declare pid uuid;
begin
  if coalesce(array_length(player_ids, 1), 0) < 2 then
    raise exception 'Eine Pause braucht mindestens zwei Spieler.';
  end if;
  insert into public.pauses default values returning id into pid;
  insert into public.pause_players (pause_id, player_id) select pid, unnest(player_ids);
  return pid;
end $$;

create or replace function public.start_round(p_pause_id uuid, player_ids uuid[]) returns uuid
language plpgsql security invoker set search_path = public as $$
declare rid uuid; n int;
begin
  if coalesce(array_length(player_ids, 1), 0) < 2 then
    raise exception 'Eine Runde braucht mindestens zwei Spieler.';
  end if;
  if not exists (select 1 from public.pauses where id = p_pause_id and ended_at is null) then
    raise exception 'Diese Pause ist schon beendet.';
  end if;
  if exists (
    select 1 from public.rounds r
     where r.pause_id = p_pause_id
       and not exists (select 1 from public.events e where e.round_id = r.id and e.type = 'final')
  ) then
    raise exception 'Es läuft noch eine Runde.';
  end if;
  select coalesce(max(number), 0) + 1 into n from public.rounds where pause_id = p_pause_id;
  insert into public.rounds (pause_id, number) values (p_pause_id, n) returning id into rid;
  insert into public.round_players (round_id, player_id) select rid, unnest(player_ids);
  insert into public.pause_players (pause_id, player_id)
    select p_pause_id, unnest(player_ids) on conflict do nothing;
  return rid;
end $$;

-- Beendet die Pause. Eine nicht zu Ende gespielte Runde wird verworfen (gesetzte Kronen zählen dann nicht).
create or replace function public.end_pause(p_pause_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.rounds r
   where r.pause_id = p_pause_id
     and not exists (select 1 from public.events e where e.round_id = r.id and e.type = 'final');
  update public.pauses set ended_at = now() where id = p_pause_id and ended_at is null;
end $$;

create or replace function public.add_player(p_name text, p_email text default null) returns uuid
language plpgsql security invoker set search_path = public as $$
declare pid uuid;
begin
  insert into public.players (name) values (btrim(p_name)) returning id into pid;
  if nullif(btrim(p_email), '') is not null then
    insert into public.player_accounts (player_id, email) values (pid, lower(btrim(p_email)));
  end if;
  return pid;
end $$;

-- ---------------------------------------------------------------------------
-- Zugriffsregeln: Lesen darf jeder, Schreiben nur Mitglieder
-- ---------------------------------------------------------------------------

alter table public.players         enable row level security;
alter table public.player_accounts enable row level security;
alter table public.pauses          enable row level security;
alter table public.pause_players   enable row level security;
alter table public.rounds          enable row level security;
alter table public.round_players   enable row level security;
alter table public.events          enable row level security;

create policy "lesen: alle" on public.players       for select using (true);
create policy "lesen: alle" on public.pauses        for select using (true);
create policy "lesen: alle" on public.pause_players for select using (true);
create policy "lesen: alle" on public.rounds        for select using (true);
create policy "lesen: alle" on public.round_players for select using (true);
create policy "lesen: alle" on public.events        for select using (true);

create policy "schreiben: mitglieder" on public.players         for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "alles: mitglieder"     on public.player_accounts for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "schreiben: mitglieder" on public.pauses          for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "schreiben: mitglieder" on public.pause_players   for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "schreiben: mitglieder" on public.rounds          for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "schreiben: mitglieder" on public.round_players   for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "schreiben: mitglieder" on public.events          for all to authenticated using (public.is_member()) with check (public.is_member());

-- ---------------------------------------------------------------------------
-- Rechte für die Data API
-- Ausdrücklich vergeben, damit das Schema auch mit abgeschaltetem
-- "Automatically expose new tables" funktioniert. Wer wirklich lesen und
-- schreiben darf, entscheiden die Zugriffsregeln (RLS) oben.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.players, public.pauses, public.pause_players,
                public.rounds, public.round_players, public.events
  to anon, authenticated;
grant insert, update, delete on public.players, public.pauses, public.pause_players,
                                public.rounds, public.round_players, public.events
  to authenticated;
grant select, insert, update, delete on public.player_accounts to authenticated;

-- Funktionen nur für die Rollen, die sie brauchen
revoke execute on function public.is_member(), public.link_me(), public.start_pause(uuid[]),
  public.start_round(uuid, uuid[]), public.end_pause(uuid), public.add_player(text, text) from public;
grant execute on function public.is_member() to anon, authenticated;
grant execute on function public.link_me(), public.start_pause(uuid[]), public.start_round(uuid, uuid[]),
  public.end_pause(uuid), public.add_player(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Live-Updates für alle offenen Geräte
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.players, public.pauses, public.pause_players, public.rounds, public.round_players, public.events;
