-- =====================================================================
-- Thư Viện Phim · schema dùng ĐỊNH DANH (Tên + Mã định danh)
-- Cùng hệ đăng nhập với index.html / manage.html (bảng user_identities).
-- Chạy toàn bộ file này trong Supabase SQL Editor. Chạy lại nhiều lần vẫn an toàn.
--
-- Thiết kế bảo mật: các bảng movie_* KHÔNG cho anon ghi/đọc trực tiếp (trừ danh mục phim
-- đã công khai). Mọi thao tác của người dùng/admin đi qua hàm RPC (security definer);
-- mỗi hàm tự kiểm tra Tên + Mã định danh còn hiệu lực (và quyền admin phim nếu cần) ở phía server.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0) Điều kiện tiên quyết + cột quyền mới trên bảng mã định danh
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.user_identities') is null then
    raise exception 'Chưa có bảng public.user_identities. Hãy chạy setup-dinh-danh.sql của web bài soạn trước.';
  end if;
end $$;

-- Quyền truy cập adminmovie.html / analyticsmovie.html + mục Quản trị của trang phim.
-- Bật/tắt trong manage.html → Mã định danh.
alter table public.user_identities
  add column if not exists can_access_movie_admin boolean not null default false;

-- ---------------------------------------------------------------------
-- 1) Bảng
-- ---------------------------------------------------------------------
create table if not exists public.movie_films (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 300),
  slug text not null unique check (slug ~ '^[A-Za-z0-9._-]{1,200}$'),
  original_name text,
  poster_url text check (poster_url is null or poster_url ~* '^https?://'),
  thumb_url text check (thumb_url is null or thumb_url ~* '^https?://'),
  description text,
  current_episode text,
  total_episodes integer check (total_episodes is null or total_episodes >= 0),
  year integer check (year is null or year between 1900 and 2100),
  quality text,
  language text,
  director text,
  casts text,
  format text,
  genres text[] not null default '{}',
  countries text[] not null default '{}',
  is_published boolean not null default true,
  is_featured boolean not null default false,
  created_by text,               -- id dòng user_identities của người tạo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movie_episodes (
  id uuid primary key default gen_random_uuid(),
  film_slug text not null,
  server_name text not null,
  episode_name text not null,
  embed_url text check (embed_url is null or embed_url ~* '^https?://'),
  m3u8_url text check (m3u8_url is null or m3u8_url ~* '^https?://'),
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (film_slug, server_name, episode_name)
);

create table if not exists public.movie_favorites (
  id bigint generated always as identity primary key,
  identity_id text not null,     -- user_identities.id
  film_slug text not null,
  film_name text,
  created_at timestamptz not null default now(),
  unique (identity_id, film_slug)
);

create table if not exists public.movie_watch_history (
  id bigint generated always as identity primary key,
  identity_id text not null,
  film_slug text not null,
  film_name text,
  episode text,
  progress_seconds integer not null default 0 check (progress_seconds >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  updated_at timestamptz not null default now(),
  unique (identity_id, film_slug)
);

create table if not exists public.movie_view_events (
  id bigint generated always as identity primary key,
  identity_id text,
  session_id text,
  film_slug text not null,
  film_name text,
  episode text,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.movie_broken_links (
  id bigint generated always as identity primary key,
  film_slug text not null,
  film_name text,
  episode text,
  kind text not null default 'embed' check (kind in ('embed','m3u8','poster','thumb','other')),
  url text not null check (char_length(url) <= 2000),
  status text not null default 'unknown' check (status in ('unknown','ok','broken')),
  http_status integer,
  error text,
  reported_by text,
  last_checked_at timestamptz,
  checked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (film_slug, episode, kind, url)
);

-- Sao chép dữ liệu từ bản cũ (nếu trước đây đã chạy bản schema dùng Supabase Auth). Không xoá bảng cũ.
do $$
begin
  if to_regclass('public.films') is not null and exists (select 1 from information_schema.columns where table_schema='public' and table_name='films' and column_name='is_featured') then
    insert into public.movie_films (name, slug, original_name, poster_url, thumb_url, description, current_episode, total_episodes, year, quality, language, director, casts, format, genres, countries, is_published, is_featured)
    select name, slug, original_name, poster_url, thumb_url, description, current_episode, total_episodes, year, quality, language, director, casts, format, genres, countries, is_published, is_featured
    from public.films on conflict (slug) do nothing;
  end if;
  if to_regclass('public.episodes') is not null and exists (select 1 from information_schema.columns where table_schema='public' and table_name='episodes' and column_name='server_name') then
    insert into public.movie_episodes (film_slug, server_name, episode_name, embed_url, m3u8_url, is_active)
    select film_slug, server_name, episode_name, embed_url, m3u8_url, is_active
    from public.episodes on conflict (film_slug, server_name, episode_name) do nothing;
  end if;
exception when others then
  raise notice 'Bỏ qua bước sao chép dữ liệu cũ: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 2) Trigger cập nhật updated_at
-- ---------------------------------------------------------------------
create or replace function public.movie_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists movie_films_touch on public.movie_films;
create trigger movie_films_touch before update on public.movie_films for each row execute function public.movie_touch_updated_at();
drop trigger if exists movie_episodes_touch on public.movie_episodes;
create trigger movie_episodes_touch before update on public.movie_episodes for each row execute function public.movie_touch_updated_at();
drop trigger if exists movie_history_touch on public.movie_watch_history;
create trigger movie_history_touch before update on public.movie_watch_history for each row execute function public.movie_touch_updated_at();
drop trigger if exists movie_links_touch on public.movie_broken_links;
create trigger movie_links_touch before update on public.movie_broken_links for each row execute function public.movie_touch_updated_at();

-- ---------------------------------------------------------------------
-- 3) Chỉ mục
-- ---------------------------------------------------------------------
create index if not exists movie_films_pub_idx on public.movie_films (is_published, updated_at desc);
create index if not exists movie_films_feat_idx on public.movie_films (is_featured, updated_at desc) where is_published = true;
create index if not exists movie_episodes_film_idx on public.movie_episodes (film_slug, server_name, episode_name);
create index if not exists movie_fav_user_idx on public.movie_favorites (identity_id, created_at desc);
create index if not exists movie_hist_user_idx on public.movie_watch_history (identity_id, updated_at desc);
create index if not exists movie_views_created_idx on public.movie_view_events (created_at desc);
create index if not exists movie_links_status_idx on public.movie_broken_links (status, last_checked_at);

-- ---------------------------------------------------------------------
-- 4) RLS: khoá toàn bộ, chỉ mở đọc danh mục công khai
-- ---------------------------------------------------------------------
alter table public.movie_films enable row level security;
alter table public.movie_episodes enable row level security;
alter table public.movie_favorites enable row level security;
alter table public.movie_watch_history enable row level security;
alter table public.movie_view_events enable row level security;
alter table public.movie_broken_links enable row level security;

revoke all on table public.movie_films, public.movie_episodes, public.movie_favorites,
  public.movie_watch_history, public.movie_view_events, public.movie_broken_links
  from anon, authenticated;
grant select on public.movie_films, public.movie_episodes to anon, authenticated;

drop policy if exists movie_films_public_read on public.movie_films;
create policy movie_films_public_read on public.movie_films
  for select to anon, authenticated using (is_published = true);

drop policy if exists movie_episodes_public_read on public.movie_episodes;
create policy movie_episodes_public_read on public.movie_episodes
  for select to anon, authenticated using (is_active = true);

-- ---------------------------------------------------------------------
-- 5) Hàm nội bộ (KHÔNG gọi được từ trình duyệt)
-- ---------------------------------------------------------------------
create or replace function public.movie_uid(p_name text, p_code text)
returns text language sql stable security definer set search_path = public as $$
  select i.id::text from public.user_identities i
  where i.display_name = p_name and i.identity_code = p_code and coalesce(i.revoked, false) = false
  limit 1;
$$;

create or replace function public.movie_is_admin(p_name text, p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select i.can_access_movie_admin from public.user_identities i
    where i.display_name = p_name and i.identity_code = p_code and coalesce(i.revoked, false) = false
    limit 1), false);
$$;

create or replace function public.movie_require_user(p_name text, p_code text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  v := public.movie_uid(p_name, p_code);
  if v is null then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  return v;
end;
$$;

create or replace function public.movie_require_admin(p_name text, p_code text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  v := public.movie_uid(p_name, p_code);
  if v is null or not public.movie_is_admin(p_name, p_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public.movie_url_or_null(u text)
returns text language plpgsql immutable as $$
begin
  u := nullif(btrim(coalesce(u, '')), '');
  if u is null then return null; end if;
  if u !~* '^https?://[^[:space:]]+$' or char_length(u) > 2000 then
    raise exception 'Link không hợp lệ (chỉ nhận http/https): %', left(u, 80);
  end if;
  return u;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) RPC cho NGƯỜI DÙNG (đã đăng nhập bằng Tên + Mã định danh)
-- ---------------------------------------------------------------------
create or replace function public.movie_admin_check(p_name text, p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.movie_is_admin(p_name, p_code);
$$;

create or replace function public.movie_fav_list(p_name text, p_code text)
returns setof public.movie_favorites language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  return query select * from public.movie_favorites where identity_id = v order by created_at desc;
end;
$$;

create or replace function public.movie_fav_set(p_name text, p_code text, p_slug text, p_film_name text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  if p_on then
    insert into public.movie_favorites (identity_id, film_slug, film_name)
    values (v, left(p_slug, 200), left(p_film_name, 300))
    on conflict (identity_id, film_slug) do nothing;
  else
    delete from public.movie_favorites where identity_id = v and film_slug = p_slug;
  end if;
end;
$$;

create or replace function public.movie_hist_list(p_name text, p_code text, p_limit integer default 60)
returns setof public.movie_watch_history language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  return query select * from public.movie_watch_history where identity_id = v
    order by updated_at desc limit greatest(1, least(coalesce(p_limit, 60), 200));
end;
$$;

create or replace function public.movie_hist_get(p_name text, p_code text, p_slug text)
returns setof public.movie_watch_history language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  return query select * from public.movie_watch_history where identity_id = v and film_slug = p_slug limit 1;
end;
$$;

create or replace function public.movie_hist_save(p_name text, p_code text, p_slug text, p_film_name text,
  p_episode text, p_progress integer, p_duration integer)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  insert into public.movie_watch_history (identity_id, film_slug, film_name, episode, progress_seconds, duration_seconds)
  values (v, left(p_slug, 200), left(p_film_name, 300), left(p_episode, 100), greatest(coalesce(p_progress, 0), 0), nullif(greatest(coalesce(p_duration, 0), 0), 0))
  on conflict (identity_id, film_slug) do update set
    film_name = excluded.film_name, episode = excluded.episode,
    progress_seconds = excluded.progress_seconds, duration_seconds = excluded.duration_seconds;
end;
$$;

create or replace function public.movie_hist_delete(p_name text, p_code text, p_slug text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  if p_slug is null then
    delete from public.movie_watch_history where identity_id = v;
  else
    delete from public.movie_watch_history where identity_id = v and film_slug = p_slug;
  end if;
end;
$$;

create or replace function public.movie_report_link(p_name text, p_code text, p_slug text, p_film_name text,
  p_episode text, p_kind text, p_url text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  if p_kind not in ('embed','m3u8','poster','thumb','other') then p_kind := 'other'; end if;
  begin
    insert into public.movie_broken_links (film_slug, film_name, episode, kind, url, status, reported_by)
    values (left(p_slug, 200), left(p_film_name, 300), left(coalesce(p_episode, ''), 100), p_kind, public.movie_url_or_null(p_url), 'broken', v);
  exception when unique_violation then
    update public.movie_broken_links set status = 'broken', reported_by = v
      where film_slug = p_slug and episode = coalesce(p_episode, '') and kind = p_kind and url = p_url and status <> 'broken';
    return 'dup';
  end;
  return 'ok';
end;
$$;

create or replace function public.movie_track_view(p_name text, p_code text, p_slug text, p_film_name text,
  p_episode text, p_session text, p_referrer text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_user(p_name, p_code);
begin
  insert into public.movie_view_events (identity_id, session_id, film_slug, film_name, episode, referrer, user_agent)
  values (v, left(p_session, 100), left(p_slug, 200), left(p_film_name, 300), left(p_episode, 100), left(p_referrer, 300), left(p_ua, 300));
end;
$$;

-- ---------------------------------------------------------------------
-- 7) RPC cho ADMIN PHIM (identity có can_access_movie_admin = true)
-- ---------------------------------------------------------------------
create or replace function public.movie_admin_films_list(p_name text, p_code text, p_q text default null,
  p_offset integer default 0, p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); q text := lower(coalesce(p_q, '')); res jsonb;
begin
  select jsonb_build_object(
    'total', (select count(*) from public.movie_films f where q = '' or position(q in lower(f.name)) > 0 or position(q in lower(f.slug)) > 0),
    'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from public.movie_films f
        where q = '' or position(q in lower(f.name)) > 0 or position(q in lower(f.slug)) > 0
        order by f.updated_at desc offset greatest(coalesce(p_offset, 0), 0) limit greatest(1, least(coalesce(p_limit, 10), 100))
      ) x), '[]'::jsonb))
  into res;
  return res;
end;
$$;

create or replace function public.movie_admin_film_save(p_name text, p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); vid uuid := nullif(p->>'id', '')::uuid; r public.movie_films;
begin
  if nullif(btrim(p->>'name'), '') is null or nullif(btrim(p->>'slug'), '') is null then
    raise exception 'Thiếu tên hoặc slug';
  end if;
  if vid is null then
    insert into public.movie_films (name, slug, original_name, poster_url, thumb_url, description, current_episode, total_episodes, year,
      quality, language, director, casts, format, genres, countries, is_published, is_featured, created_by)
    values (btrim(p->>'name'), btrim(p->>'slug'), nullif(p->>'original_name', ''), public.movie_url_or_null(p->>'poster_url'), public.movie_url_or_null(p->>'thumb_url'),
      nullif(p->>'description', ''), nullif(p->>'current_episode', ''), nullif(p->>'total_episodes', '')::int, nullif(p->>'year', '')::int,
      nullif(p->>'quality', ''), nullif(p->>'language', ''), nullif(p->>'director', ''), nullif(p->>'casts', ''), nullif(p->>'format', ''),
      array(select jsonb_array_elements_text(coalesce(p->'genres', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(p->'countries', '[]'::jsonb))),
      coalesce((p->>'is_published')::boolean, true), coalesce((p->>'is_featured')::boolean, false), v)
    returning * into r;
  else
    update public.movie_films set
      name = btrim(p->>'name'), slug = btrim(p->>'slug'), original_name = nullif(p->>'original_name', ''),
      poster_url = public.movie_url_or_null(p->>'poster_url'), thumb_url = public.movie_url_or_null(p->>'thumb_url'),
      description = nullif(p->>'description', ''), current_episode = nullif(p->>'current_episode', ''),
      total_episodes = nullif(p->>'total_episodes', '')::int, year = nullif(p->>'year', '')::int,
      quality = nullif(p->>'quality', ''), language = nullif(p->>'language', ''), director = nullif(p->>'director', ''),
      casts = nullif(p->>'casts', ''), format = nullif(p->>'format', ''),
      genres = array(select jsonb_array_elements_text(coalesce(p->'genres', '[]'::jsonb))),
      countries = array(select jsonb_array_elements_text(coalesce(p->'countries', '[]'::jsonb))),
      is_published = coalesce((p->>'is_published')::boolean, true), is_featured = coalesce((p->>'is_featured')::boolean, false)
    where id = vid returning * into r;
    if not found then raise exception 'Không tìm thấy phim để sửa'; end if;
  end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.movie_admin_film_toggle(p_name text, p_code text, p_id uuid, p_col text, p_val boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  if p_col = 'is_published' then update public.movie_films set is_published = p_val where id = p_id;
  elsif p_col = 'is_featured' then update public.movie_films set is_featured = p_val where id = p_id;
  else raise exception 'Cột không hợp lệ'; end if;
end;
$$;

create or replace function public.movie_admin_film_delete(p_name text, p_code text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  delete from public.movie_films where id = p_id;
end;
$$;

create or replace function public.movie_admin_eps_list(p_name text, p_code text, p_slug text)
returns setof public.movie_episodes language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  return query select * from public.movie_episodes where film_slug = p_slug order by server_name, episode_name;
end;
$$;

create or replace function public.movie_admin_ep_save(p_name text, p_code text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); vid uuid := nullif(p->>'id', '')::uuid;
begin
  if nullif(btrim(p->>'film_slug'), '') is null or nullif(btrim(p->>'server_name'), '') is null or nullif(btrim(p->>'episode_name'), '') is null then
    raise exception 'Thiếu slug phim, server hoặc tên tập';
  end if;
  if public.movie_url_or_null(p->>'embed_url') is null and public.movie_url_or_null(p->>'m3u8_url') is null then
    raise exception 'Cần ít nhất một link (embed hoặc m3u8)';
  end if;
  if vid is null then
    insert into public.movie_episodes (film_slug, server_name, episode_name, embed_url, m3u8_url, is_active, created_by)
    values (btrim(p->>'film_slug'), btrim(p->>'server_name'), btrim(p->>'episode_name'), public.movie_url_or_null(p->>'embed_url'),
      public.movie_url_or_null(p->>'m3u8_url'), coalesce((p->>'is_active')::boolean, true), v)
    on conflict (film_slug, server_name, episode_name) do update set
      embed_url = excluded.embed_url, m3u8_url = excluded.m3u8_url, is_active = excluded.is_active;
  else
    update public.movie_episodes set film_slug = btrim(p->>'film_slug'), server_name = btrim(p->>'server_name'),
      episode_name = btrim(p->>'episode_name'), embed_url = public.movie_url_or_null(p->>'embed_url'),
      m3u8_url = public.movie_url_or_null(p->>'m3u8_url'), is_active = coalesce((p->>'is_active')::boolean, true)
    where id = vid;
  end if;
end;
$$;

create or replace function public.movie_admin_eps_import(p_name text, p_code text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); r jsonb; n integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Dữ liệu tập không hợp lệ (tối đa 2000 dòng)'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if nullif(btrim(r->>'film_slug'), '') is null or nullif(btrim(r->>'server_name'), '') is null or nullif(btrim(r->>'episode_name'), '') is null then continue; end if;
    if public.movie_url_or_null(r->>'embed_url') is null and public.movie_url_or_null(r->>'m3u8_url') is null then continue; end if;
    insert into public.movie_episodes (film_slug, server_name, episode_name, embed_url, m3u8_url, is_active, created_by)
    values (btrim(r->>'film_slug'), btrim(r->>'server_name'), btrim(r->>'episode_name'), public.movie_url_or_null(r->>'embed_url'),
      public.movie_url_or_null(r->>'m3u8_url'), true, v)
    on conflict (film_slug, server_name, episode_name) do update set embed_url = excluded.embed_url, m3u8_url = excluded.m3u8_url;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.movie_admin_ep_toggle(p_name text, p_code text, p_id uuid, p_val boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  update public.movie_episodes set is_active = p_val where id = p_id;
end;
$$;

create or replace function public.movie_admin_ep_delete(p_name text, p_code text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  delete from public.movie_episodes where id = p_id;
end;
$$;

create or replace function public.movie_admin_links_list(p_name text, p_code text)
returns setof public.movie_broken_links language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  return query select * from public.movie_broken_links order by last_checked_at desc nulls first, created_at desc limit 300;
end;
$$;

create or replace function public.movie_admin_link_add(p_name text, p_code text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); k text := coalesce(nullif(p->>'kind', ''), 'embed');
begin
  if k not in ('embed','m3u8','poster','thumb','other') then k := 'other'; end if;
  insert into public.movie_broken_links (film_slug, film_name, episode, kind, url, status, reported_by)
  values (btrim(p->>'film_slug'), nullif(p->>'film_name', ''), coalesce(p->>'episode', ''), k, public.movie_url_or_null(p->>'url'), 'unknown', v);
end;
$$;

create or replace function public.movie_admin_link_mark(p_name text, p_code text, p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  if p_status not in ('unknown','ok','broken') then raise exception 'Trạng thái không hợp lệ'; end if;
  update public.movie_broken_links set status = p_status, last_checked_at = now(), checked_by = v, error = null where id = p_id;
end;
$$;

create or replace function public.movie_admin_link_delete(p_name text, p_code text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  delete from public.movie_broken_links where id = p_id;
end;
$$;

create or replace function public.movie_admin_views(p_name text, p_code text, p_since timestamptz,
  p_offset integer default 0, p_limit integer default 1000)
returns table (film_slug text, film_name text, episode text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  return query select e.film_slug, e.film_name, e.episode, e.created_at from public.movie_view_events e
    where e.created_at >= p_since order by e.created_at desc
    offset greatest(coalesce(p_offset, 0), 0) limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end;
$$;

-- ---------------------------------------------------------------------
-- 9) Poster đầu trang (hero slides) — chọn phim có sẵn để làm banner
-- ---------------------------------------------------------------------
create table if not exists public.movie_hero_slides (
  id uuid primary key default gen_random_uuid(),
  film_slug text not null,
  film_name text not null,
  original_name text,
  poster_url text check (poster_url is null or poster_url ~* '^https?://'),
  backdrop_url text check (backdrop_url is null or backdrop_url ~* '^https?://'),
  current_episode text,
  language text,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists movie_hero_touch on public.movie_hero_slides;
create trigger movie_hero_touch before update on public.movie_hero_slides for each row execute function public.movie_touch_updated_at();

create index if not exists movie_hero_active_idx on public.movie_hero_slides (is_active, sort_order);

alter table public.movie_hero_slides enable row level security;
revoke all on table public.movie_hero_slides from anon, authenticated;
grant select on public.movie_hero_slides to anon, authenticated;

drop policy if exists movie_hero_public_read on public.movie_hero_slides;
create policy movie_hero_public_read on public.movie_hero_slides
  for select to anon, authenticated using (is_active = true);

create or replace function public.movie_admin_hero_list(p_name text, p_code text)
returns setof public.movie_hero_slides language plpgsql stable security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  return query select * from public.movie_hero_slides order by sort_order, created_at;
end;
$$;

create or replace function public.movie_admin_hero_save(p_name text, p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); vid uuid := nullif(p->>'id', '')::uuid; r public.movie_hero_slides; nextord integer;
begin
  if nullif(btrim(p->>'film_slug'), '') is null or nullif(btrim(p->>'film_name'), '') is null then
    raise exception 'Thiếu phim';
  end if;
  if vid is null then
    select coalesce(max(sort_order), 0) + 1 into nextord from public.movie_hero_slides;
    insert into public.movie_hero_slides (film_slug, film_name, original_name, poster_url, backdrop_url, current_episode, language, description, sort_order, is_active, created_by)
    values (btrim(p->>'film_slug'), btrim(p->>'film_name'), nullif(p->>'original_name', ''), public.movie_url_or_null(p->>'poster_url'), public.movie_url_or_null(p->>'backdrop_url'),
      nullif(p->>'current_episode', ''), nullif(p->>'language', ''), nullif(p->>'description', ''), nextord, coalesce((p->>'is_active')::boolean, true), v)
    returning * into r;
  else
    update public.movie_hero_slides set
      film_slug = btrim(p->>'film_slug'), film_name = btrim(p->>'film_name'), original_name = nullif(p->>'original_name', ''),
      poster_url = public.movie_url_or_null(p->>'poster_url'), backdrop_url = public.movie_url_or_null(p->>'backdrop_url'),
      current_episode = nullif(p->>'current_episode', ''), language = nullif(p->>'language', ''), description = nullif(p->>'description', ''),
      is_active = coalesce((p->>'is_active')::boolean, true)
    where id = vid returning * into r;
    if not found then raise exception 'Không tìm thấy poster để sửa'; end if;
  end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.movie_admin_hero_delete(p_name text, p_code text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  delete from public.movie_hero_slides where id = p_id;
end;
$$;

create or replace function public.movie_admin_hero_toggle(p_name text, p_code text, p_id uuid, p_val boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code);
begin
  update public.movie_hero_slides set is_active = p_val where id = p_id;
end;
$$;

-- Đổi chỗ 1 poster lên/xuống trong thứ tự hiển thị (hoán đổi sort_order với láng giềng)
create or replace function public.movie_admin_hero_move(p_name text, p_code text, p_id uuid, p_dir text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public.movie_require_admin(p_name, p_code); cur_ord integer; nb_id uuid; nb_ord integer;
begin
  select sort_order into cur_ord from public.movie_hero_slides where id = p_id;
  if cur_ord is null then raise exception 'Không tìm thấy poster'; end if;
  if p_dir = 'up' then
    select id, sort_order into nb_id, nb_ord from public.movie_hero_slides where sort_order < cur_ord order by sort_order desc limit 1;
  else
    select id, sort_order into nb_id, nb_ord from public.movie_hero_slides where sort_order > cur_ord order by sort_order asc limit 1;
  end if;
  if nb_id is null then return; end if;
  update public.movie_hero_slides set sort_order = nb_ord where id = p_id;
  update public.movie_hero_slides set sort_order = cur_ord where id = nb_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Phân quyền EXECUTE: hàm nội bộ khoá lại, RPC mở cho trình duyệt
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'movie\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not in ('movie_uid', 'movie_is_admin', 'movie_require_user', 'movie_require_admin', 'movie_url_or_null', 'movie_touch_updated_at') then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    end if;
  end loop;
end $$;
