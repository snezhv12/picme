-- PicMe: voting ends the moment everyone needed has voted.
-- Needed: every approved player except the uploader, plus the uploader's
-- blend-in tap only when there are 3+ players (with 1-2 players there's
-- nobody to hide from, so they aren't waited for). With nobody left to vote
-- (1 player), voting closes straight away.
-- Run once in the Supabase SQL Editor after 010. Safe to re-run.

-- How many votes the photo on screen still needs, and how many it has
create or replace function voting_progress(p_photo uuid, out needed int, out cast_votes int)
language sql stable security definer set search_path = public as $$
  with o as (select player_id as owner from photos where id = p_photo),
       a as (select count(*)::int as n from players where status = 'approved')
  select
    (select count(*)::int from players, o where status = 'approved' and id <> o.owner)
      + (case when (select n from a) >= 3 then 1 else 0 end),
    (select count(*)::int from votes v join players p on p.id = v.voter_id, o
     where v.photo_id = p_photo and p.status = 'approved'
       and (v.voter_id <> o.owner or (select n from a) >= 3));
$$;

-- Every change to the game checks it, so voting closes the moment the last
-- needed vote is in, or as soon as a photo comes up that nobody can vote on.
-- (Runs before the deadline trigger, which then starts the reveal clock.)
create or replace function game_state_autoclose()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if new.phase = 'voting' and new.current_photo_id is not null then
    select * into v from voting_progress(new.current_photo_id);
    new.vote_count := v.cast_votes;
    if v.cast_votes >= v.needed then
      new.phase := 'reveal';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists game_state_autoclose on game_state;
create trigger game_state_autoclose
  before update on game_state
  for each row execute function game_state_autoclose();

-- Votes just record; the trigger above decides when voting is over
create or replace function cast_vote(p_photo uuid, p_voter uuid, p_guess uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  perform 1 from game_state
  where id = 1 and phase = 'voting' and current_photo_id = p_photo for update;
  if not found then
    raise exception 'voting is closed';
  end if;

  select player_id into v_owner from photos where id = p_photo;
  if p_guess = p_voter then
    raise exception 'you cannot guess yourself';
  end if;
  if not exists (select 1 from players where id = p_voter and status = 'approved')
     or not exists (select 1 from players where id = p_guess and status = 'approved') then
    raise exception 'unknown player';
  end if;

  insert into votes (photo_id, voter_id, guess_id, decoy)
  values (p_photo, p_voter, p_guess, p_voter = v_owner)
  on conflict (photo_id, voter_id)
  do update set guess_id = excluded.guess_id, decoy = excluded.decoy, created_at = now();

  -- Touch the game state: the trigger recounts and closes voting if done
  update game_state set vote_count = vote_count where id = 1;
end;
$$;

revoke execute on function game_state_autoclose() from public, anon, authenticated;
revoke execute on function voting_progress(uuid) from public, anon, authenticated;
grant execute on function voting_progress(uuid) to service_role;
revoke execute on function cast_vote(uuid, uuid, uuid) from public;
grant execute on function cast_vote(uuid, uuid, uuid) to anon, authenticated, service_role;

-- Apply to a vote that's open right now
update game_state set vote_count = vote_count where id = 1;
