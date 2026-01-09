-- ONE NET ERP - Supabase Schema (Postgres)
-- ملاحظة: شغّل هذا في Supabase SQL Editor مرة واحدة

-- Extensions
create extension if not exists pgcrypto;

-- =============== customers ===============
create table if not exists customers (
  id bigserial primary key,
  name text not null,
  type text not null default 'cards' check (type in ('cards','giga')),
  phone text,
  address text,
  notes text,
  opening_balance numeric(12,2) not null default 0,
  price_per_gb numeric(12,2) not null default 0,
  last_reading_gb numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_customers_name on customers (name);

-- =============== settings ===============
create table if not exists settings (
  id bigserial primary key,
  company_name text not null default 'شبكة ون نت اللاسلكية',
  company_name_en text not null default 'Network One Net Wireless',
  logo_base64 text,
  logo_url text,
  phone text,
  address text,
  currency text not null default 'YER',
  language text not null default 'ar',
  low_stock_threshold integer not null default 10,
  default_price_per_gb numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);


-- =============== card types / stock / movements ===============
create table if not exists card_types (
  id bigserial primary key,
  name text not null unique,
  price numeric(12,2) not null default 0,
  -- per-card low stock alert (optional)
  low_stock_threshold integer not null default 0,
  alert_qty integer not null default 0,
  low_stock_alert boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists card_stock (
  id bigserial primary key,
  card_type_id bigint not null references card_types(id) on delete cascade,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(card_type_id)
);

create table if not exists card_movements (
  id bigserial primary key,
  card_type_id bigint not null references card_types(id) on delete cascade,
  movement_type text not null check (movement_type in ('IN','OUT')),
  qty integer not null check (qty > 0),
  -- Ledger date (مصدر الحقيقة لحساب الرصيد حسب التاريخ)
  movement_date date not null default (now()::date),
  -- Optional linkage to business docs (فاتورة/هدية/تالف/افتتاحي/إدخال)
  ref_type text,
  ref_id bigint,
  -- optional: vendor POS / seller isolation
  seller_user_id uuid,
  before_qty integer not null default 0,
  after_qty integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_movements_type_date on card_movements (card_type_id, created_at desc);
create index if not exists idx_card_movements_ledger_date on card_movements (card_type_id, movement_date);

-- Backward-compatible migrations (إذا كانت الجداول موجودة من قبل)
alter table if exists public.card_types
  add column if not exists low_stock_threshold integer not null default 0;
alter table if exists public.card_types
  add column if not exists alert_qty integer not null default 0;
alter table if exists public.card_types
  add column if not exists low_stock_alert boolean not null default false;

alter table if exists public.card_movements
  add column if not exists movement_date date not null default (now()::date);
alter table if exists public.card_movements
  add column if not exists ref_type text;
alter table if exists public.card_movements
  add column if not exists ref_id bigint;
alter table if exists public.card_movements
  add column if not exists seller_user_id uuid;

-- تهيئة الحركة القديمة: لو ما كان عندها movement_date نخزن تاريخ created_at
update public.card_movements
set movement_date = (created_at::date)
where movement_date is null;

-- =========================
-- Ledger-based stock (THE SOURCE OF TRUTH)
-- =========================

-- View: balances computed from ledger (لا تعتمد على card_stock)
create or replace view public.v_card_balances as
select
  ct.id as card_type_id,
  ct.name,
  ct.price,
  coalesce(sum(case when cm.movement_type='IN' then cm.qty else -cm.qty end),0)::int as quantity,
  ct.is_active
from public.card_types ct
left join public.card_movements cm on cm.card_type_id = ct.id
group by ct.id, ct.name, ct.price, ct.is_active;

-- View: movement ledger with card name/price
create or replace view public.v_card_movements as
select
  cm.id,
  cm.card_type_id,
  ct.name as card_name,
  ct.price,
  cm.movement_type,
  cm.qty,
  cm.movement_date,
  cm.ref_type,
  cm.ref_id,
  cm.seller_user_id,
  cm.before_qty,
  cm.after_qty,
  cm.note,
  cm.created_at
from public.card_movements cm
join public.card_types ct on ct.id = cm.card_type_id;

-- Aliases used by some screens (older naming)
create or replace view public.v_card_stock_summary as
select
  b.card_type_id,
  b.name,
  b.price,
  b.quantity,
  ct.low_stock_threshold,
  ct.alert_qty,
  ct.low_stock_alert,
  b.is_active
from public.v_card_balances b
join public.card_types ct on ct.id = b.card_type_id;

create or replace view public.v_card_movement_ledger as
select
  id,
  created_at,
  movement_date,
  card_type_id,
  card_name as card_type_name,
  movement_type,
  qty,
  ref_type,
  ref_id,
  seller_user_id,
  ref_type as op_type,
  before_qty,
  after_qty,
  note
from public.v_card_movements;

-- Helper: balance up to date (inclusive)
create or replace function public.card_balance_at(
  p_card_type_id bigint,
  p_date date
)
returns integer
language sql
stable
as $$
  select coalesce(sum(case when movement_type='IN' then qty else -qty end),0)::int
  from public.card_movements
  where card_type_id = p_card_type_id
    and movement_date <= coalesce(p_date, now()::date)
$$;

-- Apply movement with:
-- 1) check stock at selected date
-- 2) disallow backdated movement that would make any future balance negative
create or replace function public.apply_card_movement(
  p_card_type_id bigint,
  p_movement_type text,
  p_qty integer,
  p_note text default null,
  p_movement_date date default null,
  p_ref_type text default null,
  p_ref_id bigint default null,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_movement_date, (p_created_at::date), (now()::date));
  v_now timestamptz := coalesce(p_created_at, now());
  v_delta integer;
  v_before integer;
  v_total integer;
  v_min_future integer;
begin
  if p_card_type_id is null then
    raise exception 'card_type_id required';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be > 0';
  end if;
  if upper(p_movement_type) not in ('IN','OUT') then
    raise exception 'movement_type must be IN or OUT';
  end if;

  -- serialize per card_type to avoid race conditions
  perform pg_advisory_xact_lock(2147483647, p_card_type_id::int);

  -- current balance at date (including same-day existing movements)
  select public.card_balance_at(p_card_type_id, v_date) into v_before;
  v_delta := case when upper(p_movement_type)='IN' then p_qty else -p_qty end;

  -- check immediate availability for OUT
  if upper(p_movement_type)='OUT' and v_before < p_qty then
    raise exception 'INSUFFICIENT_STOCK: want %, available %', p_qty, v_before;
  end if;

  -- disallow backdated movement if it makes any future balance negative
  -- (we use daily deltas from v_date onwards + the new delta)
  with daily as (
    select movement_date, sum(case when movement_type='IN' then qty else -qty end)::int as delta
    from public.card_movements
    where card_type_id = p_card_type_id
      and movement_date >= v_date
    group by movement_date
  ), daily2 as (
    select
      d.movement_date,
      d.delta + case when d.movement_date = v_date then v_delta else 0 end as delta
    from daily d
    union all
    select v_date as movement_date, v_delta as delta
    where not exists (select 1 from daily where movement_date = v_date)
  ), run as (
    select
      movement_date,
      sum(delta) over (order by movement_date rows between unbounded preceding and current row) as cum_delta
    from daily2
  )
  select min(v_before + cum_delta) into v_min_future from run;

  if v_min_future is not null and v_min_future < 0 then
    raise exception 'BACKDATED_NEGATIVE_BALANCE';
  end if;

  insert into public.card_movements(
    card_type_id, movement_type, qty, movement_date,
    ref_type, ref_id,
    before_qty, after_qty,
    note, created_at
  )
  values(
    p_card_type_id,
    upper(p_movement_type),
    p_qty,
    v_date,
    p_ref_type,
    p_ref_id,
    v_before,
    v_before + v_delta,
    p_note,
    v_now
  );

  -- Update cached stock (optional) so old screens still work
  select coalesce(sum(case when movement_type='IN' then qty else -qty end),0)::int
  into v_total
  from public.card_movements
  where card_type_id = p_card_type_id;

  insert into public.card_stock(card_type_id, quantity, updated_at)
  values (p_card_type_id, v_total, now())
  on conflict (card_type_id)
  do update set quantity = excluded.quantity, updated_at = excluded.updated_at;
end;
$$;

-- Reverse movement (creates opposite movement on TODAY to keep audit + prevent rewriting the past)
create or replace function public.reverse_card_movement(
  p_movement_id bigint,
  p_note text default null,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_now timestamptz := coalesce(p_created_at, now());
  v_date date := (v_now::date);
  v_need integer;
  v_avail integer;
  v_type text;
begin
  select * into m from public.card_movements where id = p_movement_id;
  if not found then
    raise exception 'movement not found';
  end if;

  -- if original was IN, reversing means OUT today, needs current availability
  if m.movement_type = 'IN' then
    v_need := m.qty;
    v_avail := public.card_balance_at(m.card_type_id, v_date);
    if v_avail < v_need then
      raise exception 'insufficient stock';
    end if;
    v_type := 'OUT';
  else
    v_type := 'IN';
  end if;

  perform public.apply_card_movement(
    m.card_type_id,
    v_type,
    m.qty,
    coalesce(p_note, 'Reverse movement #'||m.id),
    v_date,
    'REVERSE',
    m.id,
    v_now
  );
end;
$$;

-- Adjust movement (creates correcting delta on TODAY)
create or replace function public.adjust_card_movement(
  p_movement_id bigint,
  p_new_qty integer,
  p_note text default null,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_now timestamptz := coalesce(p_created_at, now());
  v_date date := (v_now::date);
  v_diff integer;
  v_type text;
  v_avail integer;
begin
  if p_new_qty is null or p_new_qty <= 0 then
    raise exception 'new qty must be > 0';
  end if;

  select * into m from public.card_movements where id = p_movement_id;
  if not found then
    raise exception 'movement not found';
  end if;

  v_diff := p_new_qty - m.qty;
  if v_diff = 0 then
    return;
  end if;

  -- If original is IN:
  --  - increasing qty => IN diff
  --  - decreasing qty => OUT abs(diff)
  -- If original is OUT:
  --  - increasing qty => OUT diff (needs stock)
  --  - decreasing qty => IN abs(diff)
  if m.movement_type = 'IN' then
    if v_diff > 0 then
      v_type := 'IN';
    else
      v_type := 'OUT';
      v_avail := public.card_balance_at(m.card_type_id, v_date);
      if v_avail < abs(v_diff) then
        raise exception 'insufficient stock';
      end if;
    end if;
  else
    if v_diff > 0 then
      v_type := 'OUT';
      v_avail := public.card_balance_at(m.card_type_id, v_date);
      if v_avail < abs(v_diff) then
        raise exception 'INSUFFICIENT_STOCK';
      end if;
    else
      v_type := 'IN';
    end if;
  end if;

  perform public.apply_card_movement(
    m.card_type_id,
    v_type,
    abs(v_diff),
    coalesce(p_note, 'Adjust movement #'||m.id||' to qty='||p_new_qty),
    v_date,
    'ADJUST',
    m.id,
    v_now
  );
end;
$$;

-- Soft-delete card type (keeps history)
create or replace function public.card_type_delete(
  p_id bigint,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.card_types
  set is_active = false
  where id = p_id;
end;
$$;

-- =============== invoices / lines ===============
create table if not exists invoices (
  id bigserial primary key,
  number text unique,
  customer_id bigint not null references customers(id) on delete restrict,
  invoice_type text not null check (invoice_type in ('cards','giga')),
  invoice_date date not null default current_date,

  total_before_discount numeric(12,2) not null default 0,
  discount_percententent numeric(12,2) not null default 0,
  discount_valuee numeric(12,2) not null default 0,
  total_after_discountcount numeric(12,2) not null default 0,

  paid_amount numeric(12,2) not null default 0,
  remaining_amountount numeric(12,2) not null default 0,
  status text not null default 'unpaid' check (status in ('paid','unpaid')),
  note text,

  created_at timestamptz not null default now()
);

create table if not exists invoice_line_items (
  id bigserial primary key,
  invoice_id bigint not null references invoices(id) on delete cascade,

  -- cards
  card_type_id bigint references card_types(id) on delete set null,
  qty integer,
  price numeric(12,2),

  -- giga metered
  prev_reading_gb numeric(12,2),
  curr_reading_gb numeric(12,2),
  usage_gb numeric(12,2),
  price_per_gb numeric(12,2),

  line_total numeric(12,2) not null default 0
);

create index if not exists idx_invoice_customer_date on invoices (customer_id, invoice_date desc);

-- =============== payments ===============
create table if not exists payments (
  id bigserial primary key,
  customer_id bigint not null references customers(id) on delete restrict,
  invoice_id bigint references invoices(id) on delete set null,
  pay_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  payment_type text not null default 'other' check (payment_type in ('invoice','debt','other')),
  method text not null default 'cash' check (method in ('cash','transfer','other')),
  reference text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_customer_date on payments (customer_id, pay_date desc);

-- =============== expenses ===============
create table if not exists expenses (
  id bigserial primary key,
  expense_date date not null default current_date,
  category text not null,
  amount numeric(12,2) not null,
  direction text not null default 'expense' check (direction in ('expense','income')),
  method text default 'cash',
  note text,
  created_at timestamptz not null default now()
);

-- =============== helper view: stock by card type ===============
create or replace view card_types_with_stock_view as
select
  ct.id as card_type_id,
  ct.name,
  ct.price,
  coalesce(cs.quantity,0) as quantity,
  ct.is_active
from card_types ct
left join card_stock cs on cs.card_type_id = ct.id;

-- =====================
-- Ledger V2 (توحيد الرصيد + منع السالب بالتاريخ)
-- =====================

-- (اختياري) مزامنة movement_date للحركات القديمة
update public.card_movements
set movement_date = (created_at::date)
where movement_date is null;

-- View: رصيد كل نوع كرت (محسوب من الـ Ledger)
create or replace view public.v_card_balances as
select
  ct.id as card_type_id,
  ct.name,
  ct.price,
  coalesce(sum(case when cm.movement_type='IN' then cm.qty else -cm.qty end),0)::int as quantity,
  ct.is_active
from public.card_types ct
left join public.card_movements cm on cm.card_type_id = ct.id
group by ct.id, ct.name, ct.price, ct.is_active;

-- View: سجل الحركات مع اسم الكرت
create or replace view public.v_card_movements as
select
  cm.id,
  cm.card_type_id,
  ct.name as card_name,
  cm.movement_type,
  cm.qty,
  cm.movement_date,
  cm.ref_type,
  cm.ref_id,
  cm.before_qty,
  cm.after_qty,
  cm.note,
  cm.created_at
from public.card_movements cm
join public.card_types ct on ct.id = cm.card_type_id;

-- دالة مساعدة: رصيد نوع كرت حتى تاريخ معين (inclusive)
create or replace function public.card_balance_as_of(p_card_type_id bigint, p_as_of date)
returns integer
language sql
stable
as $$
  select coalesce(sum(case when movement_type='IN' then qty else -qty end),0)::int
  from public.card_movements
  where card_type_id = p_card_type_id
    and movement_date <= coalesce(p_as_of, now()::date);
$$;

-- RPC: تطبيق حركة مع تحقق من الرصيد حسب التاريخ + منع السالب في الماضي
drop function if exists public.apply_card_movement(bigint,text,integer,text,timestamptz);
drop function if exists public.apply_card_movement(bigint,text,integer,text);
create or replace function public.apply_card_movement(
  p_card_type_id bigint,
  p_movement_type text,
  p_qty integer,
  p_note text default null,
  p_movement_date date default null,
  p_ref_type text default null,
  p_ref_id bigint default null,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_movement_date, (p_created_at::date), now()::date);
  v_now  timestamptz := coalesce(p_created_at, now());
  v_delta integer;
  v_before integer;
  v_after integer;
  v_min_after integer;
begin
  if p_card_type_id is null then raise exception 'card_type_id required'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be > 0'; end if;
  if upper(p_movement_type) not in ('IN','OUT') then raise exception 'movement_type must be IN or OUT'; end if;

  -- منع التعارض (قفل على مستوى نوع الكرت)
  perform pg_advisory_xact_lock( 987654, p_card_type_id );

  v_delta := case when upper(p_movement_type)='IN' then p_qty else -p_qty end;

  -- الرصيد قبل الحركة (حتى نفس التاريخ قبل إضافة هذا السطر)
  select coalesce(sum(case when movement_type='IN' then qty else -qty end),0)::int
    into v_before
  from public.card_movements
  where card_type_id = p_card_type_id
    and movement_date <= v_date;

  if upper(p_movement_type)='OUT' and v_before < p_qty then
    raise exception 'INSUFFICIENT_STOCK: need %, available % (as of %)', p_qty, v_before, v_date;
  end if;

  -- تحقق منع السالب في الماضي: نحسب أقل رصيد ممكن من v_date إلى آخر حركة بعد إدخال هذه الحركة
  with daily as (
    select movement_date as d,
           sum(case when movement_type='IN' then qty else -qty end)::int as delta
    from public.card_movements
    where card_type_id = p_card_type_id
      and movement_date >= v_date
    group by movement_date
  ), daily_plus as (
    select d, delta from daily
    union all
    select v_date as d, v_delta as delta
  ), by_day as (
    select d, sum(delta)::int as delta
    from daily_plus
    group by d
  ), running as (
    select d,
           (v_before - 0) + sum(delta) over (order by d asc rows between unbounded preceding and current row) as bal
    from by_day
  )
  select min(bal)::int into v_min_after from running;

  if v_min_after < 0 then
    raise exception 'NEGATIVE_STOCK_NOT_ALLOWED (would go negative in history)';
  end if;

  v_after := v_before + v_delta;

  insert into public.card_movements(
    card_type_id, movement_type, qty, movement_date, ref_type, ref_id,
    before_qty, after_qty, note, created_at
  ) values (
    p_card_type_id,
    upper(p_movement_type),
    p_qty,
    v_date,
    p_ref_type,
    p_ref_id,
    v_before,
    v_after,
    p_note,
    v_now
  );

  -- تحديث كاش الرصيد (اختياري) من مجموع الـ Ledger
  insert into public.card_stock(card_type_id, quantity, updated_at)
  values (p_card_type_id, public.card_balance_as_of(p_card_type_id, '9999-12-31'::date), v_now)
  on conflict (card_type_id)
  do update set quantity = excluded.quantity, updated_at = excluded.updated_at;
end;
$$;

-- RPC: عكس حركة (حذف منطقي) — يسجل حركة عكسية بتاريخ اليوم (حتى لا نعبث بالماضي)
drop function if exists public.reverse_card_movement(bigint,text,timestamptz);
create or replace function public.reverse_card_movement(
  p_movement_id bigint,
  p_note text default null,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.card_movements%rowtype;
  v_now timestamptz := coalesce(p_created_at, now());
  v_date date := v_now::date;
  v_need int;
  v_avail int;
begin
  select * into m from public.card_movements where id = p_movement_id;
  if not found then raise exception 'movement not found'; end if;

  -- لو الحركة الأصلية IN، العكس OUT بتاريخ اليوم (تحتاج رصيد كافي اليوم)
  if m.movement_type = 'IN' then
    v_need := m.qty;
    v_avail := public.card_balance_as_of(m.card_type_id, v_date);
    if v_avail < v_need then
      raise exception 'insufficient stock';
    end if;
    perform public.apply_card_movement(m.card_type_id,'OUT',m.qty, coalesce(p_note,'Reverse')||' [DELETE]', v_date, 'DELETE', m.id, v_now);
  else
    -- الحركة الأصلية OUT، العكس IN
    perform public.apply_card_movement(m.card_type_id,'IN',m.qty, coalesce(p_note,'Reverse')||' [DELETE]', v_date, 'DELETE', m.id, v_now);
  end if;
end;
$$;

-- RPC: تعديل كمية حركة (تصحيح محاسبي) — يسجل الفرق بتاريخ اليوم
drop function if exists public.adjust_card_movement(bigint,integer,text,timestamptz);
create or replace function public.adjust_card_movement(
  p_movement_id bigint,
  p_new_qty integer,
  p_note text default null,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.card_movements%rowtype;
  v_now timestamptz := coalesce(p_created_at, now());
  v_date date := v_now::date;
  v_diff int;
begin
  if p_new_qty is null or p_new_qty <= 0 then raise exception 'new_qty must be > 0'; end if;
  select * into m from public.card_movements where id = p_movement_id;
  if not found then raise exception 'movement not found'; end if;

  v_diff := p_new_qty - m.qty;
  if v_diff = 0 then return; end if;

  if m.movement_type = 'IN' then
    -- زيادة IN = IN فرق، تقليل IN = OUT فرق
    if v_diff > 0 then
      perform public.apply_card_movement(m.card_type_id,'IN',v_diff, coalesce(p_note,'Adjust')||' [ADJUST]', v_date, 'ADJUST', m.id, v_now);
    else
      perform public.apply_card_movement(m.card_type_id,'OUT',abs(v_diff), coalesce(p_note,'Adjust')||' [ADJUST]', v_date, 'ADJUST', m.id, v_now);
    end if;
  else
    -- حركة OUT: زيادة OUT = OUT فرق، تقليل OUT = IN فرق
    if v_diff > 0 then
      perform public.apply_card_movement(m.card_type_id,'OUT',v_diff, coalesce(p_note,'Adjust')||' [ADJUST]', v_date, 'ADJUST', m.id, v_now);
    else
      perform public.apply_card_movement(m.card_type_id,'IN',abs(v_diff), coalesce(p_note,'Adjust')||' [ADJUST]', v_date, 'ADJUST', m.id, v_now);
    end if;
  end if;
end;
$$;

-- RPC: حذف نوع كرت (Soft delete)
drop function if exists public.card_type_delete(uuid,bigint);
drop function if exists public.card_type_delete(bigint);
create or replace function public.card_type_delete(
  p_id bigint,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.card_types set is_active = false where id = p_id;
end;
$$;

-- =============== customer ledger view (basic) ===============
create or replace view customer_ledger_view as
select
  c.id as customer_id,
  c.name as customer_name,
  'invoice'::text as entry_type,
  i.id as ref_id,
  i.invoice_date as entry_date,
  i.total_after_discountcount as debit,
  i.paid_amount as credit,
  i.remaining_amountount as balance_change,
  i.note as note
from customers c
join invoices i on i.customer_id = c.id

union all

select
  c.id as customer_id,
  c.name as customer_name,
  'payment'::text as entry_type,
  p.id as ref_id,
  p.pay_date as entry_date,
  0::numeric as debit,
  p.amount as credit,
  (-p.amount)::numeric as balance_change,
  p.note as note
from customers c
join payments p on p.customer_id = c.id;

