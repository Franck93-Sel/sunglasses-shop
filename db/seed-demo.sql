-- seed-demo.sql — jeu de démonstration et remise à zéro (schéma `app`).
-- Appliqué via le MCP Neon en tant que propriétaire. Appelé par n8n (propriétaire) pour réinitialiser la démo.
-- Ne touche JAMAIS aux commandes is_demo = false. Lignes insérées avec leur statut final
-- (le trigger before update ne joue que sur UPDATE).
create or replace function app.reset_demo() returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  oid bigint;
begin
  delete from app.orders where is_demo;  -- order_items part en cascade

  -- client@aura-demo.fr : une expédiée, une livrée
  insert into app.orders (email,total,status,tracking_number,paid_at,shipped_at,delivered_at,is_demo)
    values ('client@aura-demo.fr',420,'expediee','FR-DEMO-88213',now()-interval '5 days',now()-interval '3 days',null,true) returning id into oid;
  insert into app.order_items (order_id,product_name,unit_price,quantity) values (oid,'Éclipse',420,1);

  insert into app.orders (email,total,status,tracking_number,paid_at,shipped_at,delivered_at,is_demo)
    values ('client@aura-demo.fr',640,'livree','FR-DEMO-70452',now()-interval '21 days',now()-interval '19 days',now()-interval '15 days',true) returning id into oid;
  insert into app.order_items (order_id,product_name,unit_price,quantity) values (oid,'L''Ombre',350,1),(oid,'Horizon',290,1);

  -- autres clients fictifs : 2 payées, 1 expédiée, 1 livrée
  insert into app.orders (email,total,status,paid_at,is_demo)
    values ('leo.m@aura-demo.fr',520,'payee',now()-interval '1 day',true) returning id into oid;
  insert into app.order_items (order_id,product_name,unit_price,quantity) values (oid,'Zénith',520,1);

  insert into app.orders (email,total,status,paid_at,is_demo)
    values ('sam.r@aura-demo.fr',760,'payee',now()-interval '2 hours',true) returning id into oid;
  insert into app.order_items (order_id,product_name,unit_price,quantity) values (oid,'Soleil Noir',380,2);

  insert into app.orders (email,total,status,tracking_number,paid_at,shipped_at,is_demo)
    values ('leo.m@aura-demo.fr',450,'expediee','FR-DEMO-91034',now()-interval '4 days',now()-interval '2 days',true) returning id into oid;
  insert into app.order_items (order_id,product_name,unit_price,quantity) values (oid,'Mirage',450,1);

  insert into app.orders (email,total,status,tracking_number,paid_at,shipped_at,delivered_at,is_demo)
    values ('camille.d@aura-demo.fr',580,'livree','FR-DEMO-65127',now()-interval '12 days',now()-interval '10 days',now()-interval '7 days',true) returning id into oid;
  insert into app.order_items (order_id,product_name,unit_price,quantity) values (oid,'Horizon',290,2);
end $$;

revoke all on function app.reset_demo() from public;
revoke all on function app.reset_demo() from authenticated, anonymous;
