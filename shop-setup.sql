-- =====================================================================
-- shop-setup.sql — Supabase cho trang shop.html (Quản lý đơn hàng)
-- Cách dùng: Supabase → SQL Editor → dán toàn bộ file → Run.
-- Chạy lại nhiều lần vẫn an toàn (idempotent).
-- Giả định: các bảng manager_codes, admin_qr_identities đã có từ manage.html.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Hàm dùng chung
-- ---------------------------------------------------------------------
create or replace function public.shop_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Phiên đăng nhập (chặn đăng nhập 2 nơi) + ghi nhớ đăng nhập
-- ---------------------------------------------------------------------
create table if not exists public.shop_sessions (
  code          text primary key,
  device_name   text,
  session_token text not null,
  last_seen     timestamptz not null default now()
);

-- Thường đã có từ manage.html; chỉ tạo nếu chưa có.
-- Nếu bảng cũ có CHECK constraint trên cột "kind", hãy cho phép thêm giá trị 'shop'.
create table if not exists public.remembered_logins (
  id            text primary key,
  kind          text,
  ip            text,
  fingerprint   text,
  identity_code text,
  display_name  text,
  last_seen     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Loại đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.shop_order_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  calc_mode     text not null default 'manual' check (calc_mode in ('manual','rounds')),
  unit_rounds   integer not null default 10 check (unit_rounds >= 1),
  unit_price    bigint  not null default 0  check (unit_price >= 0),
  round_options integer[] not null default '{10,20}',
  is_account    boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists shop_order_types_name_uq
  on public.shop_order_types (lower(name));

-- ---------------------------------------------------------------------
-- 4. Khách hàng
-- ---------------------------------------------------------------------
create table if not exists public.shop_customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  note       text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists shop_customers_name_uq
  on public.shop_customers (lower(name));

-- ---------------------------------------------------------------------
-- 5. Sản phẩm (kho tài khoản, v.v.)
-- ---------------------------------------------------------------------
create table if not exists public.shop_products (
  id         uuid primary key default gen_random_uuid(),
  type_id    uuid not null references public.shop_order_types(id) on delete restrict,
  title      text not null default '',   -- tiêu đề (tách biệt với tên tài khoản)
  name       text not null check (length(btrim(name)) > 0),
  password   text not null default '',
  price      bigint not null default 0 check (price >= 0),
  note       text not null default '',
  status     text not null default 'available' check (status in ('available','sold')),
  created_at timestamptz not null default now()
);
-- Nâng cấp cho bảng đã tạo từ bản cũ: thêm cột tiêu đề
alter table public.shop_products add column if not exists title text not null default '';
create index if not exists shop_products_type_idx on public.shop_products (type_id);

-- ---------------------------------------------------------------------
-- 6. Đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.shop_orders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  customer_id uuid not null references public.shop_customers(id)   on delete restrict,
  type_id     uuid not null references public.shop_order_types(id) on delete restrict,
  product_id  uuid references public.shop_products(id) on delete set null,
  detail      text not null default '',
  amount      bigint not null default 0 check (amount >= 0),
  rounds      integer,
  paid        boolean not null default false,
  paid_at     timestamptz,
  done        boolean not null default false,
  done_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists shop_orders_created_idx  on public.shop_orders (created_at desc);
create index if not exists shop_orders_updated_idx  on public.shop_orders (updated_at desc);
create index if not exists shop_orders_customer_idx on public.shop_orders (customer_id);
create index if not exists shop_orders_type_idx     on public.shop_orders (type_id);
create index if not exists shop_orders_product_idx  on public.shop_orders (product_id);

-- Tự cập nhật updated_at, paid_at, done_at
create or replace function public.shop_orders_before()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.paid and new.paid_at is null then new.paid_at := now(); end if;
    if new.done and new.done_at is null then new.done_at := now(); end if;
  else
    if new.paid is distinct from old.paid then
      new.paid_at := case when new.paid then now() else null end;
    end if;
    if new.done is distinct from old.done then
      new.done_at := case when new.done then now() else null end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_shop_orders_before on public.shop_orders;
create trigger trg_shop_orders_before
  before insert or update on public.shop_orders
  for each row execute function public.shop_orders_before();

-- Đồng bộ trạng thái sản phẩm: gắn vào đơn => 'sold', gỡ/xoá đơn => 'available'
create or replace function public.shop_orders_sync_product()
returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.product_id is not null
     and (tg_op = 'DELETE' or new.product_id is distinct from old.product_id) then
    update public.shop_products set status = 'available' where id = old.product_id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.product_id is not null then
    update public.shop_products set status = 'sold' where id = new.product_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_shop_orders_sync on public.shop_orders;
create trigger trg_shop_orders_sync
  after insert or update or delete on public.shop_orders
  for each row execute function public.shop_orders_sync_product();

-- ---------------------------------------------------------------------
-- 7. Quyền truy cập (RLS)
-- Trang dùng khoá anon + đăng nhập tự quản (mật khẩu chung + mã quản lý),
-- nên policy phải cho phép role anon — giống các bảng của manage.html.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'shop_sessions','remembered_logins','shop_order_types',
    'shop_customers','shop_products','shop_orders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "shop_all" on public.%I', t);
    execute format(
      'create policy "shop_all" on public.%I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Dữ liệu mẫu (tuỳ chọn): loại "IOE" tính theo vòng thi, 15k / 10 vòng
-- ---------------------------------------------------------------------
insert into public.shop_order_types (name, calc_mode, unit_rounds, unit_price, round_options, is_account)
select 'IOE', 'rounds', 10, 15000, '{10,20}', false
where not exists (select 1 from public.shop_order_types where lower(name) = 'ioe');
