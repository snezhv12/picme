-- PicMe: host actions need the host PIN.
-- The public (anon) key used by browsers can no longer run host actions or
-- write to the game tables directly. Host actions go through the Next.js
-- server, which checks the PIN cookie and calls Supabase with the
-- service_role key (kept on the server only).
-- Run once in the Supabase SQL Editor after 005. Safe to re-run.
-- Don't re-run 002-005 after this: they grant some of these back to anon.

-- ---------------------------------------------------------------------------
-- Tables: browsers may read, join, and upload; nothing else
-- ---------------------------------------------------------------------------

revoke insert, update, delete on game_state from anon, authenticated;
revoke insert, update, delete on rounds from anon, authenticated;
revoke all on votes from anon, authenticated;

-- Players: join only (status is set by the database, never by the phone)
revoke update, delete on players from anon, authenticated;

-- Photos: upload and "Change photo" (an upsert) only
revoke update, delete on photos from anon, authenticated;
grant update (round_id, player_id, path, revealed) on photos to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Host-only functions: service_role (the server) only
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'start_round(text, text, int)',
    'add_time(int)',
    'end_uploads()',
    'close_voting(uuid)',
    'next_photo(uuid)',
    'back_to_lobby()',
    'end_game()',
    'play_again()',
    'new_game()',
    'approve_player(uuid)',
    'decline_player(uuid)',
    'set_auto_approve(boolean)',
    'set_pick_mode(text)',
    'set_timer(int)',
    'skip_picker()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Lobby prompt and starting a round: players on their turn (public), the
-- host via host_* (server only). The shared logic lives in lobby_*.
-- ---------------------------------------------------------------------------

-- Moves the existing logic to lobby_* names (callers: the wrappers below)
create or replace function lobby_set_preview(p_player uuid, p_prompt text, p_category text, p_from text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g game_state%rowtype;
begin
  select * into g from game_state where id = 1 for update;
  if g.phase <> 'lobby' then
    raise exception 'not in the lobby';
  end if;
  if p_player is not null and (g.pick_mode <> 'players' or g.picker_id is distinct from p_player) then
    raise exception 'not your turn';
  end if;
  update game_state
  set preview_prompt = nullif(btrim(p_prompt), ''), preview_category = p_category, preview_from = p_from
  where id = 1;
end;
$$;

create or replace function lobby_start_round(p_player uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g game_state%rowtype;
  v_id uuid;
begin
  select * into g from game_state where id = 1 for update;
  if g.phase <> 'lobby' or g.preview_prompt is null then
    raise exception 'nothing to start';
  end if;
  if p_player is not null and (g.pick_mode <> 'players' or g.picker_id is distinct from p_player) then
    raise exception 'not your turn';
  end if;

  v_id := start_round(g.preview_prompt, g.preview_category, g.timer_seconds);

  update game_state
  set preview_prompt = null, preview_category = null, preview_from = null,
      picker_id = case when g.pick_mode = 'players' then next_picker(g.picker_id) else picker_id end
  where id = 1;
  return v_id;
end;
$$;

-- Public: only for a real player (on their turn)
create or replace function set_preview(p_player uuid, p_prompt text, p_category text, p_from text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_player is null then
    raise exception 'host only';
  end if;
  perform lobby_set_preview(p_player, p_prompt, p_category, p_from);
end;
$$;

create or replace function start_previewed_round(p_player uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if p_player is null then
    raise exception 'host only';
  end if;
  return lobby_start_round(p_player);
end;
$$;

-- Server only: the host, any time in the lobby
create or replace function host_set_preview(p_prompt text, p_category text, p_from text)
returns void language sql security definer set search_path = public as $$
  select lobby_set_preview(null, p_prompt, p_category, p_from);
$$;

create or replace function host_start_round()
returns uuid language sql security definer set search_path = public as $$
  select lobby_start_round(null);
$$;

create or replace function host_remove_player(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from players where id = p_id;
$$;

revoke execute on function lobby_set_preview(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function lobby_start_round(uuid) from public, anon, authenticated;
revoke execute on function host_set_preview(text, text, text) from public, anon, authenticated;
revoke execute on function host_start_round() from public, anon, authenticated;
revoke execute on function host_remove_player(uuid) from public, anon, authenticated;
grant execute on function host_set_preview(text, text, text) to service_role;
grant execute on function host_start_round() to service_role;
grant execute on function host_remove_player(uuid) to service_role;
grant execute on function set_preview(uuid, text, text, text) to anon, authenticated;
grant execute on function start_previewed_round(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scores stay hidden until the final scoreboard (the server can always see)
-- ---------------------------------------------------------------------------

create or replace function scoreboard()
returns table (player_id uuid, name text, points int)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         (count(v.id) filter (where v.guess_id = ph.player_id))::int as points
  from players p
  left join votes v on v.voter_id = p.id
  left join photos ph on ph.id = v.photo_id
  where p.status = 'approved'
    and (
      (select phase from game_state where id = 1) = 'scoreboard'
      or coalesce(current_setting('request.jwt.claims', true), '') like '%"service_role"%'
    )
  group by p.id, p.name, p.created_at
  order by 3 desc, p.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Wrong PIN attempts (per device/IP), so guessing gets slow
-- ---------------------------------------------------------------------------

create table if not exists host_login_attempts (
  key text primary key,
  failures int not null default 0,
  locked_until timestamptz
);
alter table host_login_attempts enable row level security;
revoke all on host_login_attempts from anon, authenticated;

-- Seconds left before this key may try again (0 = may try now)
create or replace function host_lock_seconds(p_key text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((
    select greatest(0, ceil(extract(epoch from locked_until - now())))::int
    from host_login_attempts where key = p_key and locked_until is not null
  ), 0);
$$;

-- Record a PIN attempt. After 5 wrong ones in a row: wait 30 s, then twice
-- as long for each further miss (up to 10 minutes). A right PIN resets it.
create or replace function host_record_attempt(p_key text, p_ok boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_fail int;
begin
  if p_ok then
    delete from host_login_attempts where key = p_key;
    return 0;
  end if;
  insert into host_login_attempts (key, failures) values (p_key, 1)
  on conflict (key) do update set failures = host_login_attempts.failures + 1
  returning failures into v_fail;
  if v_fail >= 5 then
    update host_login_attempts
    set locked_until = now() + make_interval(secs => least(600, 30 * power(2, v_fail - 5)))
    where key = p_key;
  end if;
  return host_lock_seconds(p_key);
end;
$$;

revoke execute on function host_lock_seconds(text) from public, anon, authenticated;
revoke execute on function host_record_attempt(text, boolean) from public, anon, authenticated;
grant execute on function host_lock_seconds(text) to service_role;
grant execute on function host_record_attempt(text, boolean) to service_role;
