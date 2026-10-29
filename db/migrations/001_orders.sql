-- 001_orders.sql — commandes, lignes, admins, RLS (schéma `app`, exposé par la Data API Neon).
-- Appliqué via le MCP Neon (run_sql_transaction) en tant que propriétaire (neondb_owner).
-- Rôles Data API : `authenticated` (JWT Neon Auth), `anonymous` (sans jeton : aucun droit).

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- Tables ------------------------------------------------------------------

create sequence app.order_number_seq start 1001;

create table app.orders (
  id                    bigint generated always as identity primary key,
  order_number          text not null unique default 'AUR-' || nextval('app.order_number_seq'),
  email                 text not null,
  total                 numeric(10,2) not null,
  status                text not null default 'payee' check (status in ('payee','expediee','livree')),
  tracking_number       text,
  paid_at               timestamptz not null default now(),
  shipped_at            timestamptz,
  delivered_at          timestamptz,
  stripe_session_id     text unique,
  is_demo               boolean not null default false,
  shipped_email_sent_at timestamptz
);
create index orders_email_idx on app.orders (email);

create table app.order_items (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references app.orders on delete cascade,
  product_name text not null,
  unit_price   numeric(10,2) not null,
  quantity     int not null check (quantity > 0)
);
create index order_items_order_id_idx on app.order_items (order_id);

create table app.admins (
  user_id text primary key,
  scope   text not null check (scope in ('all','demo'))
);

-- Fonctions d'identité (SECURITY DEFINER : lisent neon_auth / app.admins sans droit direct) ------

create function app.current_email() returns text
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select lower(u.email) from neon_auth."user" u
  where u.id::text = auth.user_id() and u."emailVerified"
$$;

create function app.admin_scope() returns text
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select a.scope from app.admins a where a.user_id = auth.user_id()
$$;

revoke all on function app.current_email() from public;
revoke all on function app.admin_scope() from public;
grant execute on function app.current_email() to authenticated;
grant execute on function app.admin_scope() to authenticated;

-- Triggers ----------------------------------------------------------------

create function app.normalize_email() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

create trigger orders_normalize_email
before insert or update of email on app.orders
for each row execute function app.normalize_email();

create function app.order_status_transition() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp
as $$
declare
  rank_old int := array_position(array['payee','expediee','livree'], old.status);
  rank_new int := array_position(array['payee','expediee','livree'], new.status);
begin
  if rank_new < rank_old then
    raise exception 'Retour de statut interdit : % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status then
    if new.status in ('expediee','livree') then
      new.shipped_at := coalesce(new.shipped_at, now());
      if new.tracking_number is null then
        new.tracking_number := 'FR-AURA-' || lpad((random() * 99999)::int::text, 5, '0');
      end if;
    end if;
    if new.status = 'livree' then
      new.delivered_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger orders_status_transition
before update on app.orders
for each row execute function app.order_status_transition();

-- RLS ---------------------------------------------------------------------

alter table app.orders enable row level security;
alter table app.order_items enable row level security;
alter table app.admins enable row level security; -- aucune policy : illisible via la Data API

create policy orders_select on app.orders for select to authenticated
using (
  email = (select app.current_email())
  or (select app.admin_scope()) = 'all'
  or ((select app.admin_scope()) = 'demo' and is_demo)
);

create policy orders_update on app.orders for update to authenticated
using (
  (select app.admin_scope()) = 'all'
  or ((select app.admin_scope()) = 'demo' and is_demo)
)
with check (
  (select app.admin_scope()) = 'all'
  or ((select app.admin_scope()) = 'demo' and is_demo)
);

create policy order_items_select on app.order_items for select to authenticated
using (exists (select 1 from app.orders o where o.id = order_items.order_id));

-- KPI admin (security_invoker : la RLS de l'appelant s'applique) -------------

create view app.admin_kpis with (security_invoker = true) as
select
  coalesce(sum(o.total), 0)::numeric(10,2)            as revenue,
  count(*)::int                                       as order_count,
  (count(*) filter (where o.status = 'payee'))::int   as to_ship,
  (select i.product_name from app.order_items i
   group by i.product_name
   order by sum(i.quantity) desc, i.product_name
   limit 1)                                           as top_product
from app.orders o;

-- Droits ------------------------------------------------------------------

grant select on app.orders, app.order_items, app.admin_kpis to authenticated;
grant update (status, tracking_number) on app.orders to authenticated;
-- Pas d'INSERT/DELETE pour personne côté navigateur ; rien pour `anonymous`.

notify pgrst, 'reload schema';
-- NB : la 1re fois, la Data API a renvoyé PGRST106 pour `app` (schéma déclaré avant d'exister) ;
-- il a fallu ré-enregistrer la config (update_data_api db_schemas ["public","app"]).
