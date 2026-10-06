-- PicMe: write the story while uploading, keep it secret until the reveal.
-- Drafts live in photo_stories, which browsers can't read at all. When a
-- photo's uploader is revealed, its story is copied to photos.story (which
-- everyone can read) and shows up on every screen.
-- Run once in the Supabase SQL Editor after 009. Safe to re-run.

create table if not exists photo_stories (
  photo_id uuid primary key references photos(id) on delete cascade,
  story text,
  -- md5 of the writing phone's secret + photo id: only that phone can change it
  secret_hash text not null,
  updated_at timestamptz not null default now()
);
alter table photo_stories enable row level security;
revoke all on photo_stories from anon, authenticated;

-- Has this photo's uploader been revealed yet?
alter table photos add column if not exists answer_revealed boolean not null default false;

-- Photos revealed before this change (finished rounds, earlier photos of the
-- current round, the one on reveal now, or any with a story already)
update photos p set answer_revealed = true
where not p.answer_revealed and (
  p.story is not null
  or exists (select 1 from rounds r where r.id = p.round_id and r.status = 'done')
  or exists (
    select 1 from game_state g join photos c on c.id = g.current_photo_id
    where g.id = 1 and c.round_id = p.round_id
      and (p.position < c.position or (p.id = c.id and g.phase = 'reveal'))
  )
);

-- On the reveal: publish the story with the photo
create or replace function publish_story_on_reveal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phase = 'reveal' and new.current_photo_id is not null
     and (old.phase is distinct from 'reveal' or old.current_photo_id is distinct from new.current_photo_id) then
    update photos
    set answer_revealed = true,
        story = coalesce((select s.story from photo_stories s where s.photo_id = new.current_photo_id), story)
    where id = new.current_photo_id;
  end if;
  return new;
end;
$$;

drop trigger if exists publish_story_on_reveal on game_state;
create trigger publish_story_on_reveal
  after update on game_state
  for each row execute function publish_story_on_reveal();

-- The stage-2 version (story only after the reveal) is replaced
drop function if exists set_story(uuid, uuid, text);

-- Save the uploader's story: any time once the photo is in (the upload
-- timer only applies to the photo). Before the reveal it stays secret;
-- after it, edits show up straight away.
create or replace function set_story(p_photo uuid, p_player uuid, p_secret text, p_story text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hash text := md5(coalesce(p_secret, '') || ':' || p_photo::text);
  v_old text;
  v_story text := nullif(left(btrim(coalesce(p_story, '')), 4000), '');
begin
  if not exists (select 1 from photos where id = p_photo and player_id = p_player) then
    raise exception 'not your photo';
  end if;
  if char_length(coalesce(p_secret, '')) < 16 then
    raise exception 'missing secret';
  end if;
  select secret_hash into v_old from photo_stories where photo_id = p_photo;
  if v_old is not null and v_old <> v_hash then
    raise exception 'story was started on another device';
  end if;

  insert into photo_stories (photo_id, story, secret_hash) values (p_photo, v_story, v_hash)
  on conflict (photo_id) do update set story = excluded.story, updated_at = now();

  update photos set story = v_story where id = p_photo and answer_revealed;
end;
$$;

revoke execute on function publish_story_on_reveal() from public, anon, authenticated;
revoke execute on function set_story(uuid, uuid, text, text) from public;
grant execute on function set_story(uuid, uuid, text, text) to anon, authenticated, service_role;
