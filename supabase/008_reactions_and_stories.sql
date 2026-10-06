-- PicMe stage 2: reactions and written stories.
-- Run once in the Supabase SQL Editor after 007. Safe to re-run.
-- Keeps 006's rules: browsers write only through the functions below.

-- ---------------------------------------------------------------------------
-- Reactions: one per player per photo. Browsers can't read the table (so
-- nobody sees who reacted while a photo is being voted on); each photo keeps
-- live counts in photos.reactions instead, e.g. {"😂": 3, "🐐": 1}.
-- ---------------------------------------------------------------------------

create table if not exists reactions (
  photo_id uuid not null references photos(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, player_id)
);
alter table reactions enable row level security;
revoke all on reactions from anon, authenticated;

alter table photos add column if not exists reactions jsonb not null default '{}'::jsonb;

-- Written story by the uploader (optional; they can also tell it out loud)
alter table photos add column if not exists story text;

-- Recount a photo's reaction bubbles
create or replace function refresh_reaction_counts(p_photo uuid)
returns void language sql security definer set search_path = public as $$
  update photos
  set reactions = coalesce(
    (select jsonb_object_agg(emoji, n) from (
       select emoji, count(*)::int as n from reactions where photo_id = p_photo group by emoji
     ) c),
    '{}'::jsonb)
  where id = p_photo;
$$;

-- Keep counts right when reactions disappear with a removed player
create or replace function reactions_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_reaction_counts(old.photo_id);
  return old;
end;
$$;

drop trigger if exists reactions_after_delete on reactions;
create trigger reactions_after_delete
  after delete on reactions
  for each row execute function reactions_after_delete();

-- React to a photo. Tapping a different emoji replaces your reaction; the
-- same one again (or null) removes it. Anyone in the game can react,
-- the uploader too, any time the photo has been shown.
create or replace function set_reaction(p_photo uuid, p_player uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_emoji text := nullif(btrim(p_emoji), '');
begin
  if not exists (select 1 from players where id = p_player and status = 'approved') then
    raise exception 'unknown player';
  end if;
  if not exists (select 1 from photos where id = p_photo and revealed) then
    raise exception 'photo not shown yet';
  end if;
  if v_emoji is not null and (char_length(v_emoji) > 16 or v_emoji ~ '[[:alnum:][:space:]<>&"''`\\]') then
    raise exception 'not an emoji';
  end if;

  select emoji into v_old from reactions where photo_id = p_photo and player_id = p_player;
  if v_emoji is null or v_emoji = v_old then
    delete from reactions where photo_id = p_photo and player_id = p_player;
  else
    insert into reactions (photo_id, player_id, emoji) values (p_photo, p_player, v_emoji)
    on conflict (photo_id, player_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
  perform refresh_reaction_counts(p_photo);
end;
$$;

-- Who reacted with what: only once the photo's uploader has been revealed
-- (never while it's being voted on)
create or replace function reaction_people(p_photo uuid)
returns table (name text, emoji text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from photos where id = p_photo and revealed)
     or exists (select 1 from game_state where id = 1 and phase = 'voting' and current_photo_id = p_photo) then
    raise exception 'not revealed yet';
  end if;
  return query
    select p.name, r.emoji from reactions r join players p on p.id = r.player_id
    where r.photo_id = p_photo
    order by r.emoji, r.created_at;
end;
$$;

-- Your own reactions on some photos (to highlight what you picked)
create or replace function my_reactions(p_player uuid, p_photos uuid[])
returns table (photo_id uuid, emoji text)
language sql stable security definer set search_path = public as $$
  select photo_id, emoji from reactions where player_id = p_player and photo_id = any(p_photos);
$$;

-- ---------------------------------------------------------------------------
-- Stories: only the uploader, only once their photo has been revealed
-- (it can be added or edited any time after that)
-- ---------------------------------------------------------------------------

create or replace function set_story(p_photo uuid, p_player uuid, p_story text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from photos where id = p_photo and player_id = p_player and revealed) then
    raise exception 'not your photo';
  end if;
  if exists (select 1 from game_state where id = 1 and phase = 'voting' and current_photo_id = p_photo) then
    raise exception 'not revealed yet';
  end if;
  update photos set story = nullif(left(btrim(p_story), 4000), '') where id = p_photo;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function refresh_reaction_counts(uuid) from public, anon, authenticated;
revoke execute on function reactions_after_delete() from public, anon, authenticated;

revoke execute on function set_reaction(uuid, uuid, text) from public;
revoke execute on function reaction_people(uuid) from public;
revoke execute on function my_reactions(uuid, uuid[]) from public;
revoke execute on function set_story(uuid, uuid, text) from public;
grant execute on function set_reaction(uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function reaction_people(uuid) to anon, authenticated, service_role;
grant execute on function my_reactions(uuid, uuid[]) to anon, authenticated, service_role;
grant execute on function set_story(uuid, uuid, text) to anon, authenticated, service_role;
