-- Rundlauf-Analytics: Spielregeln in der Datenbank prüfen
-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen (nach 0001_init.sql).
-- Die App prüft die Regeln auch selbst; hier werden sie zusätzlich durchgesetzt, z. B. wenn
-- Offline-Einträge verspätet ankommen oder zwei Leute gleichzeitig eintragen.

-- Kronenstand aller Spieler einer Pause: gewonnene Pots minus gesetzte Kronen
create or replace function public.pause_balances(p_pause_id uuid)
returns table (player_id uuid, balance int)
language sql stable security invoker set search_path = public as $$
  with won as (
    select e.player_id, sum(e.pot)::int as v
      from public.events e join public.rounds r on r.id = e.round_id
     where r.pause_id = p_pause_id and e.type = 'final'
     group by e.player_id
  ), spent as (
    select e.player_id, count(*)::int as v
      from public.events e join public.rounds r on r.id = e.round_id
     where r.pause_id = p_pause_id and e.type = 'crown'
     group by e.player_id
  )
  select pp.player_id, coalesce(w.v, 0) - coalesce(s.v, 0)
    from public.pause_players pp
    left join won w on w.player_id = pp.player_id
    left join spent s on s.player_id = pp.player_id
   where pp.pause_id = p_pause_id;
$$;

-- Prüft jeden neuen Eintrag gegen die Regeln
create or replace function public.check_event() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_pause uuid;
  v_ended timestamptz;
  v_active uuid[];
  v_has_schwimmer boolean;
  v_has_final boolean;
  v_bal int;
  v_max int;
  v_max_count int;
  v_set_this_round int;
  v_pot int;
begin
  select r.pause_id, p.ended_at into v_pause, v_ended
    from public.rounds r join public.pauses p on p.id = r.pause_id
   where r.id = new.round_id;
  if v_ended is not null then
    raise exception 'Diese Pause ist schon beendet.';
  end if;

  select coalesce(array_agg(rp.player_id), '{}') into v_active
    from public.round_players rp
   where rp.round_id = new.round_id
     and not exists (select 1 from public.events e
                      where e.round_id = new.round_id and e.type = 'out' and e.player_id = rp.player_id);

  select exists (select 1 from public.events where round_id = new.round_id and type = 'schwimmer'),
         exists (select 1 from public.events where round_id = new.round_id and type = 'final')
    into v_has_schwimmer, v_has_final;

  if v_has_final then
    raise exception 'Diese Runde ist schon entschieden.';
  end if;
  if not (new.player_id = any (v_active)) then
    raise exception 'Dieser Spieler ist nicht mehr in der Runde.';
  end if;

  if new.type <> 'final' and cardinality(v_active) <= 2 then
    raise exception 'Im Finale wird nur noch der Sieger eingetragen.';
  end if;
  if new.type = 'schwimmer' and v_has_schwimmer then
    raise exception 'Der Schwimmer ist in dieser Runde schon vergeben.';
  end if;
  if new.type in ('crown', 'out') and not v_has_schwimmer then
    raise exception 'Der erste Fehler einer Runde gibt den Schwimmer.';
  end if;

  if new.type = 'crown' then
    select b.balance into v_bal from public.pause_balances(v_pause) b where b.player_id = new.player_id;
    if coalesce(v_bal, 0) <= 0 then
      raise exception 'Keine Kronen übrig.';
    end if;
    select count(*) into v_set_this_round
      from public.events where round_id = new.round_id and type = 'crown' and player_id = new.player_id;
    if v_set_this_round >= 1 then
      -- König = allein die meisten Kronen
      select max(b.balance) into v_max from public.pause_balances(v_pause) b;
      select count(*) into v_max_count from public.pause_balances(v_pause) b where b.balance = v_max;
      if not (v_bal = v_max and v_max_count = 1) then
        raise exception 'Diese Runde schon eine Krone gesetzt. Nur der König darf mehrere setzen.';
      end if;
    end if;
  end if;

  if new.type = 'final' then
    if cardinality(v_active) <> 2 then
      raise exception 'Das Finale gibt es erst, wenn nur noch zwei drin sind.';
    end if;
    if new.loser_id is null or new.loser_id = new.player_id or not (new.loser_id = any (v_active)) then
      raise exception 'Im Finale spielen die beiden Letzten gegeneinander.';
    end if;
    if new.server_id is not null and not (new.server_id = any (v_active)) then
      raise exception 'Aufschlagen kann nur einer der beiden Finalisten.';
    end if;
    select 1 + count(*) into v_pot from public.events where round_id = new.round_id and type = 'crown';
    if new.pot <> v_pot then
      raise exception 'Der Pot stimmt nicht, erwartet sind % Kronen.', v_pot;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists events_check on public.events;
create trigger events_check before insert on public.events
  for each row execute function public.check_event();

-- Korrekturen: Bei einem Finale lassen sich nur Sieger und Aufschläger ändern
create or replace function public.check_event_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
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

drop trigger if exists events_check_update on public.events;
create trigger events_check_update before update on public.events
  for each row execute function public.check_event_update();

revoke execute on function public.pause_balances(uuid) from public, anon;
grant execute on function public.pause_balances(uuid) to authenticated;
