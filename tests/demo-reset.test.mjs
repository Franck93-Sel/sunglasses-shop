// Test de app.reset_demo() via la connexion propriétaire (DATABASE_URL, jamais affichée).
// Fichier séparé : reset_demo supprime TOUTES les commandes is_demo, ce qui perturberait rls.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const REAL_EMAIL = 'demo-reset-real@aura-demo.fr';
let realId;

after(async () => {
  if (realId) await sql.query('delete from app.orders where id = $1', [realId]);
});

test('reset_demo restores the demo set', async () => {
  const [real] = await sql.query(
    `insert into app.orders (email, total, status, is_demo) values ($1, 99, 'payee', false) returning id`,
    [REAL_EMAIL],
  );
  realId = real.id;
  const [{ n: realBefore }] = await sql`select count(*)::int n from app.orders where not is_demo`;

  await sql`select app.reset_demo()`;
  // Altération : une commande démo supprimée, une autre modifiée.
  await sql`delete from app.orders where is_demo and status = 'livree' and email = 'client@aura-demo.fr'`;
  await sql`update app.orders set total = 1 where is_demo and status = 'payee'`;
  await sql`select app.reset_demo()`;

  const [c] = await sql`select count(*)::int n from app.orders where is_demo`;
  assert.equal(c.n, 6);
  const mine = await sql`select status, tracking_number, shipped_at, delivered_at from app.orders
    where is_demo and email = 'client@aura-demo.fr' order by status`;
  assert.deepEqual(mine.map((o) => o.status), ['expediee', 'livree']);
  assert.equal(mine[0].tracking_number, 'FR-DEMO-88213');
  assert.ok(mine[1].delivered_at && mine[1].shipped_at);
  const [p] = await sql`select count(*)::int n from app.orders where is_demo and status = 'payee'`;
  assert.equal(p.n, 2);
  // Totaux cohérents avec les lignes.
  const bad = await sql`select o.id from app.orders o join app.order_items i on i.order_id = o.id
    where o.is_demo group by o.id, o.total having sum(i.unit_price * i.quantity) <> o.total`;
  assert.equal(bad.length, 0);
  const [{ n: realAfter }] = await sql`select count(*)::int n from app.orders where not is_demo`;
  assert.equal(realAfter, realBefore);
  const [still] = await sql`select total from app.orders where id = ${realId}`;
  assert.equal(Number(still.total), 99);
});
