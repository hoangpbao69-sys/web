-- =============================================================================
-- setup-homework.sql — tạo bảng cho web "Bài tập về nhà" (homework.html)
-- Chạy 1 lần trong Supabase: SQL Editor -> New query -> dán toàn bộ -> Run.
-- An toàn khi chạy lại nhiều lần.
-- =============================================================================

create table if not exists public.homework_posts (
  id            uuid primary key default gen_random_uuid(),
  title         text        not null,
  title_color   text        not null default '#8B7CF6',
  homework_date date        not null default current_date,
  is_pinned     boolean     not null default false,
  is_published  boolean     not null default true,
  kind          text        not null default 'text' check (kind in ('text', 'table')),
  content_html  text,                 -- dùng khi kind = 'text'
  content_table jsonb,                -- dùng khi kind = 'table': {"cells": [["Toán Học","Bài 1"],["Ngữ Văn","Soạn bài"]]}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists homework_posts_order_idx
  on public.homework_posts (is_pinned desc, homework_date desc, created_at desc);

-- Tự cập nhật updated_at mỗi lần sửa
create or replace function public.homework_posts_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists homework_posts_touch_trg on public.homework_posts;
create trigger homework_posts_touch_trg
  before update on public.homework_posts
  for each row execute function public.homework_posts_touch();

-- Row Level Security — cùng kiểu với các bảng khác của web (dùng anon key):
-- trang quản lý và trang homework đều truy cập bằng anon key, việc giới hạn
-- "ai được xem / được đăng" do lớp đăng nhập của từng trang đảm nhiệm.
alter table public.homework_posts enable row level security;

drop policy if exists "homework_posts_all" on public.homework_posts;
create policy "homework_posts_all" on public.homework_posts
  for all to anon, authenticated
  using (true) with check (true);

-- Bật realtime để bài mới hiện ngay trên homework.html (không bắt buộc;
-- nếu báo lỗi "already member of publication" thì bỏ qua).
do $$
begin
  alter publication supabase_realtime add table public.homework_posts;
exception when others then
  null;
end $$;
