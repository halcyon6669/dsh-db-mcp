\set ON_ERROR_STOP on

-- =====================================================================
-- dsh-db-mcp sample data for openGauss / GaussDB
-- =====================================================================
-- Three schemas, each covering a different relation-graph scenario:
--
--   sales   declared foreign keys, a multi-hop chain, a self reference,
--           a many-to-many junction, unique business keys
--   ops     no declared keys at all: joins that exist only in practice,
--           so they have to be proposed by hand or mined out of the log
--   public  awkward shapes: a cycle, values that point at nothing, one
--           parent with hundreds of children, and a view that must be
--           ignored by relation discovery
--
-- Ids are explicit rather than generated so the scenarios are reproducible
-- and so the values noted below are the ones worth pasting into trace_by_key.
-- =====================================================================

drop schema if exists sales cascade;
drop schema if exists ops cascade;
drop view if exists public.warehouse_load;
drop table if exists public.stock_move cascade;
drop table if exists public.warehouse cascade;
drop table if exists public.orphan_note cascade;
drop table if exists public.ticket cascade;

create schema sales;
create schema ops;

-- ---------------------------------------------------------------------
-- sales: the declared path
-- ---------------------------------------------------------------------

create table sales.customer (
  id         integer primary key,
  code       varchar(20) not null,
  name       varchar(80) not null,
  region     varchar(20) not null,
  created_at timestamp
);
create unique index customer_code_key on sales.customer (code);

create table sales.category (
  id        integer primary key,
  parent_id integer references sales.category (id),
  name      varchar(60) not null
);

create table sales.product (
  id          integer primary key,
  sku         varchar(32) not null,
  name        varchar(80) not null,
  category_id integer references sales.category (id),
  price       numeric(10,2) not null
);
create unique index product_sku_key on sales.product (sku);

create table sales.account (
  id         integer primary key,
  account_no varchar(16) not null,
  owner      varchar(80) not null
);
create unique index account_no_key on sales.account (account_no);

create table sales.sales_order (
  id          integer primary key,
  order_no    varchar(24) not null,
  customer_id integer not null references sales.customer (id),
  account_id  integer references sales.account (id),
  status      varchar(12) not null,
  placed_at   timestamp,
  total       numeric(12,2) not null
);
create unique index sales_order_no_key on sales.sales_order (order_no);
create index sales_order_customer on sales.sales_order (customer_id);

create table sales.sales_order_item (
  id         integer primary key,
  order_id   integer not null references sales.sales_order (id),
  product_id integer not null references sales.product (id),
  qty        integer not null,
  unit_price numeric(10,2) not null
);
create index sales_order_item_order on sales.sales_order_item (order_id);
create index sales_order_item_product on sales.sales_order_item (product_id);

-- ---------------------------------------------------------------------
-- ops: joins nobody declared
-- ---------------------------------------------------------------------

create table ops.shipment (
  id         integer primary key,
  order_id   integer not null,          -- points at sales.sales_order.id
  carrier    varchar(24) not null,
  status     varchar(12) not null,      -- IN_TRANSIT / DELIVERED / LOST
  shipped_at timestamp
);
create index shipment_order on ops.shipment (order_id);

create table ops.tracking_event (
  id          integer primary key,
  shipment_id integer not null,         -- points at ops.shipment.id
  code        varchar(20) not null,
  at          timestamp not null
);
create index tracking_event_shipment on ops.tracking_event (shipment_id);

-- composite key: a column that is indexed but not unique on its own
create table ops.ledger (
  account_no varchar(16) not null,
  seq        integer not null,
  amount     numeric(12,2) not null,
  primary key (account_no, seq)
);

-- ---------------------------------------------------------------------
-- public: the awkward shapes
-- ---------------------------------------------------------------------

-- a self reference that can form a cycle
create table public.ticket (
  id         integer primary key,
  parent_id  integer references public.ticket (id),
  related_id integer references public.ticket (id),
  subject    varchar(80) not null,
  status     varchar(12) not null
);

-- values that point at rows which do not exist
create table public.orphan_note (
  id        integer primary key,
  ticket_id integer,
  body      varchar(120) not null
);

-- one parent, hundreds of children
create table public.warehouse (
  id   integer primary key,
  code varchar(12) not null
);
create unique index warehouse_code_key on public.warehouse (code);

create table public.stock_move (
  id           bigint primary key,
  warehouse_id integer not null references public.warehouse (id),
  sku          varchar(32) not null,
  qty          integer not null,
  moved_at     timestamp
);
create index stock_move_warehouse on public.stock_move (warehouse_id);

create view public.warehouse_load as
select w.id as warehouse_id, w.code, count(m.id) as moves
  from public.warehouse w
  left join public.stock_move m on m.warehouse_id = w.id
 group by w.id, w.code;

-- ---------------------------------------------------------------------
-- data
-- ---------------------------------------------------------------------

insert into sales.customer (id, code, name, region, created_at) values
  (1, 'C-1001', 'Northwind Traders',  'north', timestamp '2024-01-05 09:00:00'),
  (2, 'C-1002', 'Contoso Ltd',        'south', timestamp '2024-01-19 09:00:00'),
  (3, 'C-1003', 'Fabrikam Inc',       'east',  timestamp '2024-02-02 09:00:00'),
  (4, 'C-1004', 'Initech',            'north', timestamp '2024-02-16 09:00:00'),
  (5, 'C-1005', 'Umbrella Group',     'south', timestamp '2024-03-01 09:00:00'),
  (6, 'C-1006', 'Globex Corporation', 'east',  timestamp '2024-03-15 09:00:00');

insert into sales.category (id, parent_id, name) values
  (1, null, 'All'),
  (2, 1,    'Hardware'),
  (3, 1,    'Software'),
  (4, 2,    'Laptops'),
  (5, 3,    'Licenses');

insert into sales.product (id, sku, name, category_id, price) values
  (1, 'SKU-0001', 'Laptop 13 inch',      4,  899.00),
  (2, 'SKU-0002', 'Laptop 15 inch',      4, 1249.00),
  (3, 'SKU-0003', 'Docking station',     2,  189.00),
  (4, 'SKU-0004', 'External monitor',    2,  329.00),
  (5, 'SKU-0005', 'Office suite license', 5,  129.00),
  (6, 'SKU-0006', 'Database license',    5, 2499.00),
  (7, 'SKU-0007', 'Backup agent',        3,   79.00),
  (8, 'SKU-0008', 'Support plan',        1,  499.00);

insert into sales.account (id, account_no, owner) values
  (1, 'ACC-0001', 'Northwind AP'),
  (2, 'ACC-0002', 'Contoso AP'),
  (3, 'ACC-0003', 'Fabrikam AP');

-- 30 orders, ids 1001..1030, cycling over the six customers
insert into sales.sales_order (id, order_no, customer_id, account_id, status, placed_at, total)
select 1000 + n,
       'ORD-' || (1000 + n),
       1 + (n % 6),
       case when n % 6 < 3 then 1 + (n % 3) else null end,
       case when n % 7 = 0 then 'CANCELLED'
            when n % 5 = 0 then 'DRAFT'
            when n % 11 = 0 then 'VOID'
            else 'POSTED' end,
       timestamp '2024-04-01 09:00:00' + (n * interval '1 day'),
       (n % 9 + 1) * 125.50
  from generate_series(1, 30) as n;

-- two items per order: the many-to-many junction
insert into sales.sales_order_item (id, order_id, product_id, qty, unit_price)
select 2000 + n,
       1000 + ((n - 1) / 2 + 1),
       1 + (n % 8),
       1 + (n % 4),
       19.99 + (n % 5) * 10
  from generate_series(1, 60) as n;

-- 20 shipments for orders 1001..1020, three carriers, mixed states
insert into ops.shipment (id, order_id, carrier, status, shipped_at)
select 5000 + n,
       1000 + n,
       case when n % 3 = 0 then 'UPS' when n % 3 = 1 then 'DHL' else 'FedEx' end,
       case when n % 6 = 0 then 'LOST'
            when n % 4 = 0 then 'DELIVERED'
            else 'IN_TRANSIT' end,
       timestamp '2024-05-02 08:00:00' + (n * interval '1 day')
  from generate_series(1, 20) as n;

-- three tracking events per shipment
insert into ops.tracking_event (id, shipment_id, code, at)
select 6000 + n,
       5000 + ((n - 1) / 3 + 1),
       case when n % 3 = 0 then 'DELIVERED'
            when n % 3 = 1 then 'PICKED_UP'
            else 'IN_TRANSIT' end,
       timestamp '2024-05-03 08:00:00' + (n * interval '6 hours')
  from generate_series(1, 60) as n;

-- ledger rows on the composite key
insert into ops.ledger (account_no, seq, amount) values
  ('ACC-0001', 1,  250.00),
  ('ACC-0001', 2,  130.50),
  ('ACC-0002', 1,  980.00),
  ('ACC-0003', 1,   75.25),
  ('ACC-0003', 2,  410.00);

-- ticket 1 <- 2 <- 3 <- 4 is a four-deep chain; 7 <-> 8 is a cycle
insert into public.ticket (id, parent_id, related_id, subject, status) values
  (1, null, null, 'Login fails after upgrade',      'OPEN'),
  (2, null, null, 'Cannot reach the login page',    'OPEN'),
  (3, null, null, 'DNS resolves to the wrong host', 'CLOSED'),
  (4, null, null, 'Stale resolver cache',           'CLOSED'),
  (5, null, 6,    'Duplicate of the billing issue', 'OPEN'),
  (6, null, 5,    'Billing shows the wrong currency', 'OPEN'),
  (7, null, null, 'Cycle A',                        'OPEN'),
  (8, null, null, 'Cycle B',                        'OPEN'),
  (9, null, null, 'Standalone ticket',              'OPEN');

update public.ticket set parent_id = 1 where id = 2;
update public.ticket set parent_id = 2 where id = 3;
update public.ticket set parent_id = 3 where id = 4;
update public.ticket set parent_id = 8 where id = 7;
update public.ticket set parent_id = 7 where id = 8;

-- 999 and 1234 point at nothing: the walk has to stop somewhere
insert into public.orphan_note (id, ticket_id, body) values
  (1,    1, 'seen on the test box'),
  (2,    3, 'reproduced after a restart'),
  (3,  999, 'references a ticket that was deleted'),
  (4, 1234, 'imported from the old tracker'),
  (5, null, 'no ticket at all');

insert into public.warehouse (id, code) values
  (1, 'WH-01'),
  (2, 'WH-02'),
  (3, 'WH-03');

-- WH-01 carries 300 moves (fanout far past the trust threshold),
-- WH-02 carries 4, WH-03 carries none
insert into public.stock_move (id, warehouse_id, sku, qty, moved_at)
select n,
       case when n <= 300 then 1 when n <= 304 then 2 else 3 end,
       'SKU-' || lpad(((n % 8) + 1)::text, 4, '0'),
       1 + (n % 20),
       timestamp '2024-06-01 07:00:00' + (n * interval '1 hour')
  from generate_series(1, 304) as n;

-- ---------------------------------------------------------------------
-- a summary, so the seed can be checked at a glance
-- ---------------------------------------------------------------------

select 'customer'    as table_name, count(*) as rows from sales.customer
union all select 'category',    count(*) from sales.category
union all select 'product',     count(*) from sales.product
union all select 'account',     count(*) from sales.account
union all select 'sales_order', count(*) from sales.sales_order
union all select 'order_item',  count(*) from sales.sales_order_item
union all select 'shipment',    count(*) from ops.shipment
union all select 'tracking',    count(*) from ops.tracking_event
union all select 'ledger',      count(*) from ops.ledger
union all select 'ticket',      count(*) from public.ticket
union all select 'orphan_note', count(*) from public.orphan_note
union all select 'warehouse',   count(*) from public.warehouse
union all select 'stock_move',  count(*) from public.stock_move
order by 1;
