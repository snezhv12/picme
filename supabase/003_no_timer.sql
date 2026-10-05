-- PicMe: "No timer" rounds. Uploads stay open until everyone has uploaded or
-- the host closes them. A round without a timer has ends_at = null.
-- Run once in the Supabase SQL Editor after 002. Safe to re-run.

-- p_seconds = null starts a round with no timer
create or replace function start_round(p_prompt text, p_category text, p_seconds int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_prompt), '') = '' then
    raise exception 'prompt is empty';
  end if;
  if p_seconds is not null and p_seconds not between 5 and 300 then
    raise exception 'timer must be between 5 and 300 seconds';
  end if;
  perform 1 from game_state where id = 1 for update;
  update rounds set status = 'done' where status <> 'done';
  insert into rounds (prompt, category, status, ends_at)
  values (
    btrim(p_prompt), p_category, 'collecting',
    case when p_seconds is null then null else now() + make_interval(secs => p_seconds) end
  )
  returning id into v_id;
  update game_state
  set phase = 'uploading', current_round_id = v_id, current_photo_id = null, vote_count = 0
  where id = 1;
  return v_id;
end;
$$;

-- +N seconds only makes sense when there is a timer
create or replace function add_time(p_seconds int)
returns void language sql security definer set search_path = public as $$
  update rounds r
  set ends_at = greatest(r.ends_at, now()) + make_interval(secs => p_seconds)
  from game_state g
  where g.id = 1 and g.phase = 'uploading' and r.id = g.current_round_id
    and r.status = 'collecting' and r.ends_at is not null;
$$;

-- Uploads are accepted while the round is collecting and, if it has a timer,
-- until it runs out (plus 3 seconds for uploads already on their way)
create or replace function check_upload_window()
returns trigger language plpgsql set search_path = public as $$
declare
  v_round rounds%rowtype;
begin
  select * into v_round from rounds where id = new.round_id;
  if v_round.status is distinct from 'collecting'
     or (v_round.ends_at is not null and now() > v_round.ends_at + interval '3 seconds') then
    raise exception 'uploads are closed for this round';
  end if;
  return new;
end;
$$;
