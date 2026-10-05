-- PicMe: players take turns picking the category.
-- The lobby's prompt preview, timer and turn now live in game_state so the
-- picking player's phone and the projector stay in sync.
-- Run once in the Supabase SQL Editor after 003. Safe to re-run.

alter table game_state add column if not exists pick_mode text not null default 'players';
alter table game_state drop constraint if exists game_state_pick_mode_check;
alter table game_state add constraint game_state_pick_mode_check
  check (pick_mode in ('host', 'players'));

-- Whose turn it is to pick (in join order)
alter table game_state add column if not exists picker_id uuid;
alter table game_state drop constraint if exists game_state_picker_id_fkey;
alter table game_state add constraint game_state_picker_id_fkey
  foreign key (picker_id) references players(id) on delete set null;

-- The prompt shown in the lobby before the round starts. preview_from is
-- what it was drawn from (a category id or 'shuffle'); null for the host's own.
alter table game_state add column if not exists preview_prompt text;
alter table game_state add column if not exists preview_category text;
alter table game_state add column if not exists preview_from text;

-- Upload time for the next round; null = no timer
alter table game_state add column if not exists timer_seconds int default 20;

-- ---------------------------------------------------------------------------
-- Turn order
-- ---------------------------------------------------------------------------

-- The player after p_after in join order, wrapping around. With nobody else
-- left it returns p_after itself (if still there); with p_after null, the first.
create or replace function next_picker(p_after uuid)
returns uuid language plpgsql stable set search_path = public as $$
declare
  v_at timestamptz;
  v_next uuid;
begin
  select created_at into v_at from players where id = p_after;
  if v_at is not null then
    select id into v_next from players
    where id <> p_after and (created_at, id) > (v_at, p_after)
    order by created_at, id limit 1;
  end if;
  if v_next is null then
    select id into v_next from players
    where id is distinct from p_after
    order by created_at, id limit 1;
  end if;
  if v_next is null and v_at is not null then
    v_next := p_after;
  end if;
  return v_next;
end;
$$;

-- The first player to join gets the first turn
create or replace function players_first_picker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update game_state set picker_id = new.id where id = 1 and picker_id is null;
  return new;
end;
$$;

drop trigger if exists players_first_picker on players;
create trigger players_first_picker
  after insert on players
  for each row execute function players_first_picker();

-- If the picking player is removed, the turn moves on to the next player
create or replace function players_pass_turn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update game_state
  set picker_id = next_picker(old.id),
      preview_prompt = null, preview_category = null, preview_from = null
  where id = 1 and picker_id = old.id;
  return old;
end;
$$;

drop trigger if exists players_pass_turn on players;
create trigger players_pass_turn
  before delete on players
  for each row execute function players_pass_turn();

-- Fill in a turn for games that already have players
update game_state set picker_id = next_picker(null) where id = 1 and picker_id is null;

-- ---------------------------------------------------------------------------
-- Lobby actions
-- ---------------------------------------------------------------------------

create or replace function set_pick_mode(p_mode text)
returns void language sql security definer set search_path = public as $$
  update game_state
  set pick_mode = p_mode, picker_id = coalesce(picker_id, next_picker(null))
  where id = 1;
$$;

-- p_seconds = null means no timer
create or replace function set_timer(p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_seconds is not null and p_seconds not between 5 and 300 then
    raise exception 'timer must be between 5 and 300 seconds';
  end if;
  update game_state set timer_seconds = p_seconds where id = 1;
end;
$$;

-- Show a prompt in the lobby. p_player = null is the host (always allowed);
-- a player may only do this on their turn.
create or replace function set_preview(p_player uuid, p_prompt text, p_category text, p_from text)
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

-- Start the round with the previewed prompt (host, or the picking player).
-- In turn mode, the turn then passes to the next player.
create or replace function start_previewed_round(p_player uuid)
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

create or replace function skip_picker()
returns void language sql security definer set search_path = public as $$
  update game_state
  set picker_id = next_picker(picker_id),
      preview_prompt = null, preview_category = null, preview_from = null
  where id = 1 and phase = 'lobby';
$$;

-- Same players, fresh scores (now also clears the lobby preview)
create or replace function play_again()
returns void language plpgsql security definer set search_path = public as $$
begin
  update game_state
  set phase = 'lobby', current_round_id = null, current_photo_id = null, vote_count = 0,
      preview_prompt = null, preview_category = null, preview_from = null
  where id = 1;
  delete from rounds where true;
end;
$$;

grant execute on function next_picker(uuid) to anon, authenticated;
grant execute on function set_pick_mode(text) to anon, authenticated;
grant execute on function set_timer(int) to anon, authenticated;
grant execute on function set_preview(uuid, text, text, text) to anon, authenticated;
grant execute on function start_previewed_round(uuid) to anon, authenticated;
grant execute on function skip_picker() to anon, authenticated;
