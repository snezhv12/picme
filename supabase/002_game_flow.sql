-- PicMe: shared game phases, synced upload timer, hidden voting, scoreboard.
-- Run once in the Supabase SQL Editor (paste the whole file). Safe to re-run.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- One shared phase drives the projector and every phone:
-- lobby -> uploading -> voting -> reveal -> (voting ...) -> lobby | scoreboard
alter table game_state add column if not exists phase text not null default 'lobby';
alter table game_state drop constraint if exists game_state_phase_check;
alter table game_state add constraint game_state_phase_check
  check (phase in ('lobby', 'uploading', 'voting', 'reveal', 'scoreboard'));

-- How many votes the photo on screen has (never who voted for what)
alter table game_state add column if not exists vote_count int not null default 0;

-- Category of the prompt, and when uploads close (server time)
alter table rounds add column if not exists category text;
alter table rounds add column if not exists ends_at timestamptz;

-- Random slideshow order, fixed when uploads close (1, 2, 3, ...)
alter table photos add column if not exists position int;

-- No two players with the same name (ignoring case and spaces)
create unique index if not exists players_name_unique on players (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Deleting players / rounds cleans up after itself
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  -- photos -> players / rounds: delete the photo with its player or round
  for r in
    select conname from pg_constraint
    where conrelid = 'public.photos'::regclass and contype = 'f'
      and confrelid in ('public.players'::regclass, 'public.rounds'::regclass)
  loop
    execute format('alter table public.photos drop constraint %I', r.conname);
  end loop;
  -- game_state -> rounds / photos: just forget the pointer
  for r in
    select conname from pg_constraint
    where conrelid = 'public.game_state'::regclass and contype = 'f'
  loop
    execute format('alter table public.game_state drop constraint %I', r.conname);
  end loop;
end $$;

alter table photos add constraint photos_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;
alter table photos add constraint photos_round_id_fkey
  foreign key (round_id) references rounds(id) on delete cascade;
alter table game_state add constraint game_state_current_round_id_fkey
  foreign key (current_round_id) references rounds(id) on delete set null;
alter table game_state add constraint game_state_current_photo_id_fkey
  foreign key (current_photo_id) references photos(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Votes: one per player per photo. RLS on with no policies, so nobody can
-- read or write votes directly; only the functions below touch them.
-- ---------------------------------------------------------------------------

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  voter_id uuid not null references players(id) on delete cascade,
  guess_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (photo_id, voter_id)
);
alter table votes enable row level security;

-- ---------------------------------------------------------------------------
-- Realtime: make sure every game table sends live updates.
-- (votes is included as asked, but RLS means no client ever receives its rows;
-- the live vote counter comes from game_state.vote_count.)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['players', 'rounds', 'photos', 'game_state', 'votes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Uploads are only accepted while the round's timer runs (plus 3 seconds for
-- uploads that started just before zero)
-- ---------------------------------------------------------------------------

create or replace function check_upload_window()
returns trigger language plpgsql set search_path = public as $$
declare
  v_round rounds%rowtype;
begin
  select * into v_round from rounds where id = new.round_id;
  if v_round.status <> 'collecting' or v_round.ends_at is null
     or now() > v_round.ends_at + interval '3 seconds' then
    raise exception 'uploads are closed for this round';
  end if;
  return new;
end;
$$;

drop trigger if exists photos_upload_window on photos;
create trigger photos_upload_window
  before insert or update of path on photos
  for each row execute function check_upload_window();

-- ---------------------------------------------------------------------------
-- Game actions. All game moves go through these so the projector and phones
-- always agree, and double clicks / two host tabs can't skip a step.
-- ---------------------------------------------------------------------------

-- Server clock, so every device counts down to the same moment
create or replace function server_time()
returns timestamptz language sql stable as $$ select now(); $$;

-- Lobby -> uploading
create or replace function start_round(p_prompt text, p_category text, p_seconds int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_prompt), '') = '' then
    raise exception 'prompt is empty';
  end if;
  if p_seconds not between 5 and 300 then
    raise exception 'timer must be between 5 and 300 seconds';
  end if;
  perform 1 from game_state where id = 1 for update;
  update rounds set status = 'done' where status <> 'done';
  insert into rounds (prompt, category, status, ends_at)
  values (btrim(p_prompt), p_category, 'collecting', now() + make_interval(secs => p_seconds))
  returning id into v_id;
  update game_state
  set phase = 'uploading', current_round_id = v_id, current_photo_id = null, vote_count = 0
  where id = 1;
  return v_id;
end;
$$;

-- +N seconds while uploading
create or replace function add_time(p_seconds int)
returns void language sql security definer set search_path = public as $$
  update rounds r
  set ends_at = greatest(r.ends_at, now()) + make_interval(secs => p_seconds)
  from game_state g
  where g.id = 1 and g.phase = 'uploading' and r.id = g.current_round_id
    and r.status = 'collecting';
$$;

-- Uploading -> voting on the first photo (random order).
-- With no photos, just stops the clock and stays put so the host can go back.
create or replace function end_uploads()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_round uuid;
  v_first uuid;
begin
  select current_round_id into v_round from game_state
  where id = 1 and phase = 'uploading' for update;
  if v_round is null then
    return;
  end if;

  update rounds set ends_at = least(coalesce(ends_at, now()), now()) where id = v_round;

  if not exists (select 1 from photos where round_id = v_round) then
    return;
  end if;

  update rounds set status = 'revealing' where id = v_round;
  update photos p set position = o.rn
  from (select id, row_number() over (order by random()) as rn
        from photos where round_id = v_round) o
  where p.id = o.id;

  select id into v_first from photos where round_id = v_round and position = 1;
  update photos set revealed = true where id = v_first;
  update game_state
  set phase = 'voting', current_photo_id = v_first, vote_count = 0
  where id = 1;
end;
$$;

-- Voting -> reveal (also happens automatically once everyone has voted)
create or replace function close_voting(p_photo uuid)
returns void language sql security definer set search_path = public as $$
  update game_state set phase = 'reveal'
  where id = 1 and phase = 'voting' and current_photo_id = p_photo;
$$;

-- Reveal -> voting on the next photo
create or replace function next_photo(p_current uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_next uuid;
begin
  perform 1 from game_state
  where id = 1 and phase = 'reveal' and current_photo_id = p_current for update;
  if not found then
    return;
  end if;

  select n.id into v_next
  from photos c
  join photos n on n.round_id = c.round_id and n.position > c.position
  where c.id = p_current
  order by n.position
  limit 1;
  if v_next is null then
    return;
  end if;

  update photos set revealed = true where id = v_next;
  update game_state
  set phase = 'voting', current_photo_id = v_next, vote_count = 0
  where id = 1;
end;
$$;

-- Any phase -> lobby (closes the current round)
create or replace function back_to_lobby()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from game_state where id = 1 for update;
  update rounds set status = 'done' where status <> 'done';
  update game_state
  set phase = 'lobby', current_round_id = null, current_photo_id = null, vote_count = 0
  where id = 1;
end;
$$;

-- Any phase -> final scoreboard
create or replace function end_game()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from game_state where id = 1 for update;
  update rounds set status = 'done' where status <> 'done';
  update game_state
  set phase = 'scoreboard', current_round_id = null, current_photo_id = null, vote_count = 0
  where id = 1;
end;
$$;

-- Same players, fresh scores: drops all rounds, photos and votes
create or replace function play_again()
returns void language plpgsql security definer set search_path = public as $$
begin
  update game_state
  set phase = 'lobby', current_round_id = null, current_photo_id = null, vote_count = 0
  where id = 1;
  delete from rounds where true;
end;
$$;

-- Everything gone: players too
create or replace function new_game()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform play_again();
  delete from players where true;
end;
$$;

-- Cast or change a vote: only on the photo on screen, while voting is open,
-- never on your own photo. Closes voting once everyone eligible has voted.
create or replace function cast_vote(p_photo uuid, p_voter uuid, p_guess uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_votes int;
  v_eligible int;
begin
  perform 1 from game_state
  where id = 1 and phase = 'voting' and current_photo_id = p_photo for update;
  if not found then
    raise exception 'voting is closed';
  end if;

  select player_id into v_owner from photos where id = p_photo;
  if p_voter = v_owner then
    raise exception 'you cannot vote on your own photo';
  end if;
  if p_guess = p_voter then
    raise exception 'you cannot guess yourself';
  end if;
  if not exists (select 1 from players where id = p_voter)
     or not exists (select 1 from players where id = p_guess) then
    raise exception 'unknown player';
  end if;

  insert into votes (photo_id, voter_id, guess_id)
  values (p_photo, p_voter, p_guess)
  on conflict (photo_id, voter_id)
  do update set guess_id = excluded.guess_id, created_at = now();

  select count(*) into v_votes from votes where photo_id = p_photo;
  select count(*) into v_eligible from players where id <> v_owner;

  update game_state
  set vote_count = v_votes,
      phase = case when v_votes >= v_eligible then 'reveal' else phase end
  where id = 1;
end;
$$;

-- Final scoreboard: one point per correct guess
create or replace function scoreboard()
returns table (player_id uuid, name text, points int)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         (count(v.id) filter (where v.guess_id = ph.player_id))::int as points
  from players p
  left join votes v on v.voter_id = p.id
  left join photos ph on ph.id = v.photo_id
  group by p.id, p.name, p.created_at
  order by 3 desc, p.created_at;
$$;

grant execute on function server_time() to anon, authenticated;
grant execute on function start_round(text, text, int) to anon, authenticated;
grant execute on function add_time(int) to anon, authenticated;
grant execute on function end_uploads() to anon, authenticated;
grant execute on function close_voting(uuid) to anon, authenticated;
grant execute on function next_photo(uuid) to anon, authenticated;
grant execute on function back_to_lobby() to anon, authenticated;
grant execute on function end_game() to anon, authenticated;
grant execute on function play_again() to anon, authenticated;
grant execute on function new_game() to anon, authenticated;
grant execute on function cast_vote(uuid, uuid, uuid) to anon, authenticated;
grant execute on function scoreboard() to anon, authenticated;

-- Start from a clean lobby
update game_state
set phase = 'lobby', current_round_id = null, current_photo_id = null, vote_count = 0
where id = 1;
