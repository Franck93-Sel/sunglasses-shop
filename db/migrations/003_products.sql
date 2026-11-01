-- 003_products.sql — catalogue produits (2026-11-01).
-- Source unique des noms et prix : lue par le site (affichage) et par n8n (prix de la session Stripe).
-- Lecture publique (rôle `anonymous` de la Data API) ; aucune écriture depuis le navigateur.
-- Pour changer un prix : console Neon (SQL Editor / Tables), en tant que propriétaire.

begin;

create table app.products (
  id         int primary key,
  name       text not null unique,
  brand      text not null default 'AURA',
  price      numeric(10,2) not null check (price > 0),
  category   text not null check (category in ('homme','femme','accessoires')),
  image      text not null,
  active     boolean not null default true,
  sort_order int not null default 0
);

insert into app.products (id, name, price, category, image, sort_order) values
  (1, 'L''Ombre',     350, 'homme', 'img/product-1.png', 1),
  (2, 'Éclipse',      420, 'femme', 'img/product-2.png', 2),
  (3, 'Soleil Noir',  380, 'homme', 'img/product-3.png', 3),
  (4, 'Horizon',      290, 'femme', 'img/product-4.png', 4),
  (5, 'Mirage',       450, 'homme', 'img/product-6.png', 5),
  (6, 'Zénith',       520, 'femme', 'img/product-5.png', 6);

alter table app.products enable row level security;

-- Un produit désactivé disparaît de la boutique (et n8n refuse de le vendre).
create policy products_select on app.products for select to anonymous, authenticated
using (active);

grant usage on schema app to anonymous;
grant select on app.products to anonymous, authenticated;
-- Pas d'INSERT/UPDATE/DELETE pour les rôles de la Data API.

commit;

notify pgrst, 'reload schema';
