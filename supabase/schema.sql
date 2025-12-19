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
  before_qty integer not null default 0,
  after_qty integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_movements_type_date on card_movements (card_type_id, created_at desc);

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

