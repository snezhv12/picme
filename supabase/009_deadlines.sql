-- PicMe: automatic deadlines (no pg_cron).
--   Picking (players take turns): 5 minutes, then a Shuffle prompt starts the round
--   Voting: closes after 3 minutes
--   Reveal: the uploader taps "Done, next photo", or it moves on after 2 minutes
-- Deadlines are stored in game_state.deadline (set by a trigger whenever the
-- phase changes). When one passes, any open phone or the host asks the
-- server to move the game on (game_tick, server only).
-- Run once in the Supabase SQL Editor after 008. Safe to re-run.

alter table game_state add column if not exists deadline timestamptz;

-- ---------------------------------------------------------------------------
-- Set the deadline whenever the game moves to a new step
-- ---------------------------------------------------------------------------

create or replace function game_state_deadline()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.phase = 'voting' then
    if old.phase is distinct from 'voting' or old.current_photo_id is distinct from new.current_photo_id
       or old.deadline is null then
      new.deadline := now() + interval '3 minutes';
    end if;
  elsif new.phase = 'reveal' then
    if old.phase is distinct from 'reveal' or old.current_photo_id is distinct from new.current_photo_id
       or old.deadline is null then
      new.deadline := now() + interval '2 minutes';
    end if;
  elsif new.phase = 'lobby' and new.pick_mode = 'players' and new.picker_id is not null then
    -- A new turn (or turns just switched on): the picker gets 5 minutes
    if old.phase is distinct from 'lobby' or old.picker_id is distinct from new.picker_id
       or old.pick_mode is distinct from new.pick_mode or old.deadline is null then
      new.deadline := now() + interval '5 minutes';
    end if;
  else
    -- Host picks, nobody to pick, uploading (its own timer) or scoreboard
    new.deadline := null;
  end if;
  return new;
end;
$$;

drop trigger if exists game_state_deadline on game_state;
create trigger game_state_deadline
  before update on game_state
  for each row execute function game_state_deadline();

-- ---------------------------------------------------------------------------
-- After a reveal: next photo, or back to picking after the last one
-- ---------------------------------------------------------------------------

create or replace function advance_after_reveal()
returns void language plpgsql security definer set search_path = public as $$
declare
  g game_state%rowtype;
  v_next uuid;
begin
  select * into g from game_state where id = 1 for update;
  if g.phase <> 'reveal' then
    return;
  end if;
  select n.id into v_next
  from photos c
  join photos n on n.round_id = c.round_id and n.position > c.position
  where c.id = g.current_photo_id
  order by n.position
  limit 1;
  if v_next is not null then
    perform next_photo(g.current_photo_id);
  else
    perform back_to_lobby();
  end if;
end;
$$;

-- The uploader is done telling the story: "Done, next photo"
create or replace function uploader_done(p_photo uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from game_state g join photos p on p.id = g.current_photo_id
    where g.id = 1 and g.phase = 'reveal' and p.id = p_photo and p.player_id = p_player
  ) then
    raise exception 'not your photo on screen';
  end if;
  perform advance_after_reveal();
end;
$$;

-- ---------------------------------------------------------------------------
-- Move on when a deadline has passed (called by the server; does nothing if
-- nothing is due, so many phones calling at once is fine).
-- p_prompt / p_category: a Shuffle prompt drawn by the server, used when the
-- picker ran out of time without choosing one.
-- ---------------------------------------------------------------------------

create or replace function game_tick(p_prompt text, p_category text)
returns text language plpgsql security definer set search_path = public as $$
declare
  g game_state%rowtype;
  r rounds%rowtype;
begin
  select * into g from game_state where id = 1 for update;

  -- Uploads: the timer ran out (3 s grace for photos on their way)
  if g.phase = 'uploading' then
    select * into r from rounds where id = g.current_round_id;
    if r.ends_at is not null and now() > r.ends_at + interval '3 seconds'
       and exists (select 1 from photos where round_id = r.id) then
      perform end_uploads();
      return 'uploads closed';
    end if;
    return 'nothing due';
  end if;

  if g.deadline is null or now() < g.deadline then
    return 'nothing due';
  end if;

  if g.phase = 'lobby' then
    if g.pick_mode <> 'players' or g.picker_id is null then
      return 'nothing due';
    end if;
    -- Use what the picker chose, or else the server's Shuffle prompt
    if g.preview_prompt is null then
      if coalesce(btrim(p_prompt), '') = '' then
        return 'need a prompt';
      end if;
      perform lobby_set_preview(null, p_prompt, p_category, 'shuffle');
    end if;
    perform lobby_start_round(null);
    return 'round started';
  elsif g.phase = 'voting' then
    perform close_voting(g.current_photo_id);
    return 'voting closed';
  elsif g.phase = 'reveal' then
    perform advance_after_reveal();
    return 'moved on';
  end if;
  return 'nothing due';
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: the tick and the helpers are server only; "Done" is for the
-- uploader's phone
-- ---------------------------------------------------------------------------

revoke execute on function game_state_deadline() from public, anon, authenticated;
revoke execute on function advance_after_reveal() from public, anon, authenticated;
revoke execute on function game_tick(text, text) from public, anon, authenticated;
grant execute on function advance_after_reveal() to service_role;
grant execute on function game_tick(text, text) to service_role;

revoke execute on function uploader_done(uuid, uuid) from public;
grant execute on function uploader_done(uuid, uuid) to anon, authenticated, service_role;

-- Start the clock for whatever step the game is in right now (keeps a
-- clock that's already running when re-run)
update game_state set phase = phase where id = 1;
