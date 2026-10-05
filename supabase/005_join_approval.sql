-- PicMe: the host lets players in.
-- New players start as 'pending'; only 'approved' players take part in
-- anything (turns, uploads, voting, scores). 'declined' players stay listed
-- so the same device can't just ask again, until the host lets them in.
-- Run once in the Supabase SQL Editor after 004. Safe to re-run.

-- Everyone already in the game counts as approved; new players start pending
alter table players add column if not exists status text not null default 'approved';
alter table players alter column status set default 'pending';
alter table players drop constraint if exists players_status_check;
alter table players add constraint players_status_check
  check (status in ('pending', 'approved', 'declined'));

-- Random id kept on the phone, to recognise a declined device
alter table players add column if not exists device_id text;

-- Host setting: let everyone in without asking
alter table game_state add column if not exists auto_approve boolean not null default false;

-- A declined player's name is free again for someone else
drop index if exists players_name_unique;
create unique index players_name_unique on players (lower(btrim(name))) where status <> 'declined';

-- Players can't change their own status: only the functions below do that
revoke update on players from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

-- New players are pending (or approved straight away when the host lets
-- everyone in), and a declined device can't ask again
create or replace function players_on_join()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.device_id is not null and exists (
    select 1 from players where device_id = new.device_id and status = 'declined'
  ) then
    raise exception 'the host declined this device';
  end if;
  new.status := case
    when (select auto_approve from game_state where id = 1) then 'approved'
    else 'pending'
  end;
  return new;
end;
$$;

drop trigger if exists players_on_join on players;
create trigger players_on_join
  before insert on players
  for each row execute function players_on_join();

-- The first approved player gets the first turn
create or replace function players_first_picker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' then
    update game_state set picker_id = new.id where id = 1 and picker_id is null;
  end if;
  return new;
end;
$$;

create or replace function approve_player(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update players set status = 'approved' where id = p_id and status <> 'approved';
  if found then
    update game_state set picker_id = p_id where id = 1 and picker_id is null;
  end if;
end;
$$;

create or replace function decline_player(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update players set status = 'declined' where id = p_id and status = 'pending';
$$;

-- Turning it on also lets in everyone who's waiting
create or replace function set_auto_approve(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  update game_state set auto_approve = p_on where id = 1;
  if p_on then
    for r in select id from players where status = 'pending' order by created_at loop
      perform approve_player(r.id);
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Only approved players count
-- ---------------------------------------------------------------------------

-- Turns: next approved player in join order
create or replace function next_picker(p_after uuid)
returns uuid language plpgsql stable set search_path = public as $$
declare
  v_at timestamptz;
  v_next uuid;
begin
  select created_at into v_at from players where id = p_after and status = 'approved';
  if v_at is not null then
    select id into v_next from players
    where status = 'approved' and id <> p_after and (created_at, id) > (v_at, p_after)
    order by created_at, id limit 1;
  end if;
  if v_next is null then
    select id into v_next from players
    where status = 'approved' and id is distinct from p_after
    order by created_at, id limit 1;
  end if;
  if v_next is null and v_at is not null then
    v_next := p_after;
  end if;
  return v_next;
end;
$$;

-- Uploads: approved players only, while the round is open
create or replace function check_upload_window()
returns trigger language plpgsql set search_path = public as $$
declare
  v_round rounds%rowtype;
begin
  if not exists (select 1 from players where id = new.player_id and status = 'approved') then
    raise exception 'the host has not let this player in';
  end if;
  select * into v_round from rounds where id = new.round_id;
  if v_round.status is distinct from 'collecting'
     or (v_round.ends_at is not null and now() > v_round.ends_at + interval '3 seconds') then
    raise exception 'uploads are closed for this round';
  end if;
  return new;
end;
$$;

-- Voting: approved voters, approved guesses, and only approved players
-- count towards "everyone has voted"
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
  if not exists (select 1 from players where id = p_voter and status = 'approved')
     or not exists (select 1 from players where id = p_guess and status = 'approved') then
    raise exception 'unknown player';
  end if;

  insert into votes (photo_id, voter_id, guess_id)
  values (p_photo, p_voter, p_guess)
  on conflict (photo_id, voter_id)
  do update set guess_id = excluded.guess_id, created_at = now();

  select count(*) into v_votes from votes where photo_id = p_photo;
  select count(*) into v_eligible from players where id <> v_owner and status = 'approved';

  update game_state
  set vote_count = v_votes,
      phase = case when v_votes >= v_eligible then 'reveal' else phase end
  where id = 1;
end;
$$;

-- Scores: approved players only
create or replace function scoreboard()
returns table (player_id uuid, name text, points int)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         (count(v.id) filter (where v.guess_id = ph.player_id))::int as points
  from players p
  left join votes v on v.voter_id = p.id
  left join photos ph on ph.id = v.photo_id
  where p.status = 'approved'
  group by p.id, p.name, p.created_at
  order by 3 desc, p.created_at;
$$;

grant execute on function approve_player(uuid) to anon, authenticated;
grant execute on function decline_player(uuid) to anon, authenticated;
grant execute on function set_auto_approve(boolean) to anon, authenticated;
