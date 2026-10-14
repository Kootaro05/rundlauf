-- Rundlauf-Analytics: Profile mit Spitzname, echtem Namen und Profilbild
-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen (nach 0002_regeln.sql).
--
-- Sichtbarkeit: Spitznamen (players.name) und Statistik bleiben öffentlich.
-- Echte Namen, Profilseiten und Profilbilder sehen nur eingetragene Spieler (is_member).
-- Bearbeiten: Jeder nur sein eigenes Profil. Spieler, die sich noch nie angemeldet haben,
-- darf jedes Mitglied bearbeiten, sonst könnte niemand deren Profil pflegen.

-- ---------------------------------------------------------------------------
-- Wer darf ein Profil bearbeiten?
-- ---------------------------------------------------------------------------

create or replace function public.can_edit_player(p_player_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member() and (
    -- das eigene Profil
    exists (select 1 from public.player_accounts where player_id = p_player_id and user_id = auth.uid())
    -- oder ein Spieler, der sich noch nie angemeldet hat
    or not exists (select 1 from public.player_accounts where player_id = p_player_id and user_id is not null)
  );
$$;

-- ---------------------------------------------------------------------------
-- Private Profildaten
-- ---------------------------------------------------------------------------

create table if not exists public.player_private (
  player_id   uuid primary key references public.players on delete cascade,
  first_name  text check (first_name is null or char_length(btrim(first_name)) between 1 and 40),
  last_name   text check (last_name is null or char_length(btrim(last_name)) between 1 and 40),
  avatar_path text,
  updated_at  timestamptz not null default now()
);

alter table public.player_private enable row level security;

create policy "lesen: mitglieder" on public.player_private
  for select to authenticated using (public.is_member());
create policy "anlegen: eigenes" on public.player_private
  for insert to authenticated with check (public.can_edit_player(player_id));
create policy "ändern: eigenes" on public.player_private
  for update to authenticated using (public.can_edit_player(player_id)) with check (public.can_edit_player(player_id));

grant select, insert, update on public.player_private to authenticated;

-- ---------------------------------------------------------------------------
-- Spieler: anlegen dürfen alle Mitglieder, ändern nur das eigene Profil
-- ---------------------------------------------------------------------------

drop policy if exists "schreiben: mitglieder" on public.players;
create policy "anlegen: mitglieder" on public.players
  for insert to authenticated with check (public.is_member());
create policy "ändern: eigenes" on public.players
  for update to authenticated using (public.can_edit_player(id)) with check (public.can_edit_player(id));

-- Ausblenden (aus der Spielerauswahl) darf weiterhin jedes Mitglied bei jedem
create or replace function public.set_player_hidden(p_player_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then
    raise exception 'Nur eingetragene Spieler dürfen das.' using errcode = '42501';
  end if;
  update public.players set hidden = p_hidden where id = p_player_id;
end $$;

-- ---------------------------------------------------------------------------
-- Login-E-Mails: nur bei Spielern änderbar, die sich noch nie angemeldet haben
-- (sonst könnte man fremde Profile übernehmen)
-- ---------------------------------------------------------------------------

drop policy if exists "alles: mitglieder" on public.player_accounts;
create policy "lesen: mitglieder" on public.player_accounts
  for select to authenticated using (public.is_member());
create policy "anlegen: mitglieder" on public.player_accounts
  for insert to authenticated with check (public.is_member() and user_id is null);
create policy "ändern: ohne login" on public.player_accounts
  for update to authenticated using (public.is_member() and user_id is null) with check (public.is_member() and user_id is null);
create policy "löschen: ohne login" on public.player_accounts
  for delete to authenticated using (public.is_member() and user_id is null);

-- ---------------------------------------------------------------------------
-- Profilbilder: privater Speicher, Ordner pro Spieler (avatars/<player_id>/...)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp', 'image/png'])
on conflict (id) do nothing;

-- Prüft, ob der Ordner eines Bildes ein Spieler ist, den man bearbeiten darf
create or replace function public.can_edit_avatar(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_edit_player(((storage.foldername(p_name))[1])::uuid)
    else false
  end;
$$;

create policy "avatare lesen: mitglieder" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and public.is_member());
create policy "avatare hochladen: eigenes" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and public.can_edit_avatar(name));
create policy "avatare löschen: eigenes" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and public.can_edit_avatar(name));

-- ---------------------------------------------------------------------------
-- Funktionsrechte
-- ---------------------------------------------------------------------------

revoke execute on function public.can_edit_player(uuid), public.can_edit_avatar(text),
  public.set_player_hidden(uuid, boolean) from public, anon;
grant execute on function public.can_edit_player(uuid), public.can_edit_avatar(text),
  public.set_player_hidden(uuid, boolean) to authenticated;
