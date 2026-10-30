-- 002_drop_demo.sql — retrait du mode démo (2026-10-30).
-- Supprime les commandes fictives, la remise à zéro et le rôle « admin démo ».
-- Les commandes réelles (is_demo = false) ne sont pas touchées.

begin;

delete from app.orders where is_demo;            -- order_items part en cascade
drop function if exists app.reset_demo();

delete from app.admins where scope = 'demo';
alter table app.admins drop constraint admins_scope_check;
alter table app.admins add constraint admins_scope_check check (scope = 'all');

drop policy orders_select on app.orders;
drop policy orders_update on app.orders;

alter table app.orders drop column is_demo;

create policy orders_select on app.orders for select to authenticated
using (
  email = (select app.current_email())
  or (select app.admin_scope()) = 'all'
);

create policy orders_update on app.orders for update to authenticated
using ((select app.admin_scope()) = 'all')
with check ((select app.admin_scope()) = 'all');

commit;
