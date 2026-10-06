-- PicMe stage 1: removing players cleanly, no duplicate players, who has voted.
-- Run once in the Supabase SQL Editor after 006. Safe to re-run.
-- Keeps 006's rules: browsers only get the new read/join functions below;
-- host-only functions are for the server (service_role).

-- ---------------------------------------------------------------------------
-- Names: compare ignoring case, accents, spaces, punctuation and emoji
-- ("Aless 🤗" -> "aless")
-- ---------------------------------------------------------------------------

create or replace function norm_name(p text)
returns text language sql immutable as $$
  select regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâäãåāăąéèêëēėęěíìîïīįóòôöõøōőúùûüūůűñńçćčśšžźżýÿłđ',
      'aaaaaaaaaeeeeeeeeiiiiiioooooooouuuuuuunncccsszzzyyld'),
    '[^a-z0-9]', '', 'g');
$$;

-- One player per name in this sense (declined players don't block a name).
-- Emoji-only names normalise to '' and are only unique as typed.
drop index if exists players_name_unique;
create unique index players_name_unique on players (
  (case when norm_name(name) = '' then lower(btrim(name)) else norm_name(name) end)
) where status <> 'declined';

-- The closest existing player for a name someone is about to join with:
-- the same name, or one name starting with the other (at least 3 letters,
-- "Aless" ~ "Alessandra"). Approved players first.
create or replace function find_similar_player(p_name text)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  with n as (select norm_name(p_name) as v)
  select p.id, p.name
  from players p, n
  where p.status <> 'declined'
    and length(n.v) >= 3
    and length(norm_name(p.name)) >= 3
    and (norm_name(p.name) = n.v
         or norm_name(p.name) like n.v || '%'
         or n.v like norm_name(p.name) || '%')
  order by (norm_name(p.name) = n.v) desc, (p.status = 'approved') desc, p.created_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- "Continue as Alessandra": a request the host has to approve. Approving
-- moves the player to the new device; the old device is signed out.
-- ---------------------------------------------------------------------------

create table if not exists player_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  device_id text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now()
);
create unique index if not exists player_claims_one_pending
  on player_claims (player_id, device_id) where status = 'pending';

-- Phones may read claims (to see when theirs is approved); nothing else
alter table player_claims enable row level security;
drop policy if exists "claims are readable" on player_claims;
create policy "claims are readable" on player_claims for select using (true);
revoke all on player_claims from anon, authenticated;
grant select on player_claims to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'player_claims'
  ) then
    alter publication supabase_realtime add table public.player_claims;
  end if;
end $$;

-- Phone: ask to continue as an existing player. Returns the claim id.
create or replace function request_claim(p_player uuid, p_device text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_device), '') = '' then
    raise exception 'missing device';
  end if;
  if not exists (select 1 from players where id = p_player and status <> 'declined') then
    raise exception 'unknown player';
  end if;
  if exists (select 1 from players where device_id = p_device and status = 'declined') then
    raise exception 'the host declined this device';
  end if;
  select id into v_id from player_claims
  where player_id = p_player and device_id = p_device and status = 'pending';
  if v_id is null then
    insert into player_claims (player_id, device_id) values (p_player, p_device)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Host: approve / decline a claim
create or replace function host_approve_claim(p_claim uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c player_claims%rowtype;
begin
  select * into c from player_claims where id = p_claim and status = 'pending' for update;
  if not found then
    return;
  end if;
  update player_claims set status = 'approved' where id = p_claim;
  -- Any other open claims for this player lose
  update player_claims set status = 'declined'
  where player_id = c.player_id and status = 'pending' and id <> p_claim;
  update players set device_id = c.device_id where id = c.player_id;
  -- Continuing as a player who was still waiting also lets them in
  if exists (select 1 from players where id = c.player_id and status = 'pending') then
    perform approve_player(c.player_id);
  end if;
end;
$$;

create or replace function host_decline_claim(p_claim uuid)
returns void language sql security definer set search_path = public as $$
  update player_claims set status = 'declined' where id = p_claim and status = 'pending';
$$;

-- ---------------------------------------------------------------------------
-- Who has voted on a photo (never what they voted)
--
-- The uploader blends in with a "decoy" vote: they tap a name like everyone
-- else, so the who-voted list can't give them away. Decoys never score.
-- Voting now waits for every approved player, uploader included.
-- ---------------------------------------------------------------------------

alter table votes add column if not exists decoy boolean not null default false;

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

  select count(*) into v_votes from votes where photo_id = p_photo;
  select count(*) into v_eligible from players where status = 'approved';

  update game_state
  set vote_count = v_votes,
      phase = case when v_votes >= v_eligible then 'reveal' else phase end
  where id = 1;
end;
$$;

-- Scores: decoys never count
create or replace function scoreboard()
returns table (player_id uuid, name text, points int)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         (count(v.id) filter (where v.guess_id = ph.player_id and not v.decoy))::int as points
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

create or replace function voters(p_photo uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select voter_id from votes where photo_id = p_photo;
$$;

-- ---------------------------------------------------------------------------
-- Removing a player, cleanly: their photos, votes and turn go with them, and
-- if their photo is on screen the game moves to the next photo
-- ---------------------------------------------------------------------------

create or replace function host_remove_player(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g game_state%rowtype;
  v_cur photos%rowtype;
  v_next uuid;
  v_votes int;
  v_eligible int;
begin
  select * into g from game_state where id = 1 for update;

  -- Their photo is on screen: move on first (next photo, or end of round)
  if g.current_photo_id is not null then
    select * into v_cur from photos where id = g.current_photo_id;
    if v_cur.player_id = p_id then
      select id into v_next from photos
      where round_id = v_cur.round_id and position > v_cur.position and player_id <> p_id
      order by position limit 1;
      if v_next is not null then
        update photos set revealed = true where id = v_next;
        update game_state
        set current_photo_id = v_next, phase = 'voting', vote_count = 0
        where id = 1;
      else
        perform back_to_lobby();
      end if;
    end if;
  end if;

  -- Turn passes on, photos/votes/claims go (triggers and cascades)
  delete from players where id = p_id;

  -- Close the gaps in the slideshow order ("Photo 2 of 5" stays right)
  select * into g from game_state where id = 1;
  if g.current_round_id is not null then
    update photos p set position = o.rn
    from (select id, row_number() over (order by position) as rn
          from photos where round_id = g.current_round_id and position is not null) o
    where p.id = o.id and p.position is distinct from o.rn;
  end if;

  -- Their vote no longer counts, and they're no longer waited for
  if g.phase = 'voting' and g.current_photo_id is not null then
    select count(*) into v_votes from votes where photo_id = g.current_photo_id;
    select count(*) into v_eligible from players where status = 'approved';
    update game_state
    set vote_count = v_votes,
        phase = case when v_votes >= v_eligible then 'reveal' else phase end
    where id = 1;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions (new functions get anon access by default in Supabase, so
-- every one is set explicitly)
-- ---------------------------------------------------------------------------

revoke execute on function norm_name(text) from public, anon, authenticated;
grant execute on function norm_name(text) to anon, authenticated, service_role;

revoke execute on function find_similar_player(text) from public;
grant execute on function find_similar_player(text) to anon, authenticated, service_role;

revoke execute on function request_claim(uuid, text) from public;
grant execute on function request_claim(uuid, text) to anon, authenticated, service_role;

revoke execute on function cast_vote(uuid, uuid, uuid) from public;
grant execute on function cast_vote(uuid, uuid, uuid) to anon, authenticated, service_role;
revoke execute on function scoreboard() from public;
grant execute on function scoreboard() to anon, authenticated, service_role;

revoke execute on function voters(uuid) from public;
grant execute on function voters(uuid) to anon, authenticated, service_role;

revoke execute on function host_approve_claim(uuid) from public, anon, authenticated;
revoke execute on function host_decline_claim(uuid) from public, anon, authenticated;
revoke execute on function host_remove_player(uuid) from public, anon, authenticated;
grant execute on function host_approve_claim(uuid) to service_role;
grant execute on function host_decline_claim(uuid) to service_role;
grant execute on function host_remove_player(uuid) to service_role;
