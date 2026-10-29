// Tests de sécurité de la base (RLS + droits) à travers la vraie Data API Neon.
// Préparation et nettoyage via la connexion propriétaire (DATABASE_URL, jamais affichée).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { signedInClient } from './helpers/session.mjs';

const SCHEMA = 'app';
const ORIGIN = 'http://localhost:5500';
const DEMO_PASSWORD = 'aura-demo-2026';
const sql = neon(process.env.DATABASE_URL);

const BUYER = 'rls-buyer@aura-demo.fr';
const STRANGER = 'rls-stranger@aura-demo.fr';
const DEMO_ADMIN = 'admin@aura-demo.fr';
const PRIVATE_ADMIN = process.env.RLS_ADMIN_EMAIL; // rôle « admin privé » (scope all) en test
const ADMIN_PASSWORD = process.env.RLS_ADMIN_PASSWORD; // mot de passe aléatoire de rls-admin
const USER_PASSWORD = process.env.RLS_USER_PASSWORD; // mot de passe aléatoire de rls-buyer / rls-stranger

const ids = {}; // commandes de test : own, messy, other, delivered, demo
let buyer, stranger, demoAdmin, privateAdmin;
let privateAdminId; // la ligne admins « all » n'existe que le temps des tests

const findUser = (email) => sql`select id::text as id from neon_auth."user" where email = ${email}`;

// Inscription brute (Node n'a ni Origin ni cookies pour le SDK), seulement si le compte manque
// (Neon Auth limite le débit des inscriptions : 429). L'inscription étant publique, un compte
// trouvé par email peut appartenir à quelqu'un d'autre : on prouve qu'il est à nous en se
// connectant avec le mot de passe attendu et en comparant l'id, AVANT toute écriture
// (emailVerified, app.admins). Échec de connexion => la suite échoue, rien n'est écrit.
async function ensureAccount(email, password) {
  if (!password) throw new Error(`mot de passe manquant pour ${email} (tests/.env)`);
  if (!(await findUser(email)).length) {
    const res = await fetch(`${process.env.NEON_AUTH_URL}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password, name: email.split('@')[0] }),
    });
    if (!res.ok) throw new Error(`signUp ${email}: ${res.status}`);
  }
  const [row] = await findUser(email);
  if (!row) throw new Error(`compte introuvable après inscription : ${email}`);
  const client = await signedInClient(email, password); // lève si le mot de passe ne correspond pas
  if (client.userId !== row.id) throw new Error(`compte ${email} : id de session inattendu, abandon`);
  await sql`update neon_auth."user" set "emailVerified" = true where id::text = ${row.id}`;
  return { id: row.id, client };
}

async function insertOrder({ email, total, status = 'payee', isDemo = false, product = 'RLS test item' }) {
  const [o] = await sql.query(
    `insert into ${SCHEMA}.orders (email, total, status, is_demo) values ($1, $2, $3, $4) returning id`,
    [email, total, status, isDemo],
  );
  await sql.query(
    `insert into ${SCHEMA}.order_items (order_id, product_name, unit_price, quantity) values ($1, $2, $3, 1)`,
    [o.id, product, total],
  );
  return o.id;
}

async function dbOrder(id) {
  const [row] = await sql.query(`select * from ${SCHEMA}.orders where id = $1`, [id]);
  return row;
}

const orders = (client) => client.schema(SCHEMA).from('orders');

before(async () => {
  // En série : le helper réessaie si Neon Auth limite le débit (429).
  ({ client: buyer } = await ensureAccount(BUYER, USER_PASSWORD));
  ({ client: stranger } = await ensureAccount(STRANGER, USER_PASSWORD));
  const demo = await ensureAccount(DEMO_ADMIN, DEMO_PASSWORD);
  demoAdmin = demo.client;
  await ensureAccount('client@aura-demo.fr', DEMO_PASSWORD); // compte démo acheteur (Task 3)
  const priv = await ensureAccount(PRIVATE_ADMIN, ADMIN_PASSWORD);
  privateAdmin = priv.client;

  // admin@aura-demo.fr : scope « demo » permanent (utilisé par le site).
  await sql.query(
    `insert into ${SCHEMA}.admins (user_id, scope) values ($1, 'demo')
     on conflict (user_id) do update set scope = excluded.scope`,
    [demo.id],
  );
  // rls-admin : scope « all » temporaire, supprimé dans after().
  privateAdminId = priv.id;
  await sql.query(
    `insert into ${SCHEMA}.admins (user_id, scope) values ($1, 'all')
     on conflict (user_id) do update set scope = excluded.scope`,
    [privateAdminId],
  );

  ids.own = await insertOrder({ email: BUYER, total: 120 });
  ids.messy = await insertOrder({ email: '  RLS-Buyer@Aura-Demo.FR ', total: 80 });
  ids.other = await insertOrder({ email: 'rls-test@aura-demo.fr', total: 200 });
  ids.delivered = await insertOrder({ email: 'rls-test@aura-demo.fr', total: 50, status: 'livree' });
  ids.demo = await insertOrder({ email: 'rls-demo@aura-demo.fr', total: 99, isDemo: true });
}, { timeout: 180_000 });

after(async () => {
  // Retire l'accès « all » du compte de test, même si la préparation a échoué en route.
  const [row] = PRIVATE_ADMIN ? await findUser(PRIVATE_ADMIN) : [];
  const adminId = privateAdminId ?? row?.id;
  if (adminId) await sql.query(`delete from ${SCHEMA}.admins where user_id = $1 and scope = 'all'`, [adminId]);
  const list = Object.values(ids);
  if (list.length) await sql.query(`delete from ${SCHEMA}.orders where id = any($1::bigint[])`, [list]);
});

test('buyer sees own order', async () => {
  const { data, error } = await orders(buyer).select('id, email, order_number').eq('id', ids.own);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.match(data[0].order_number, /^AUR-\d{4,}$/);
});

test('email linking ignores case', async () => {
  const row = await dbOrder(ids.messy);
  assert.equal(row.email, BUYER, 'email normalisé en base');
  const { data, error } = await orders(buyer).select('id').eq('id', ids.messy);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

test('email normalisation also applies on update', async () => {
  await sql.query(`update ${SCHEMA}.orders set email = $1 where id = $2`, ['  RLS-Update@Aura-Demo.FR ', ids.delivered]);
  try {
    assert.equal((await dbOrder(ids.delivered)).email, 'rls-update@aura-demo.fr');
  } finally {
    await sql.query(`update ${SCHEMA}.orders set email = $1 where id = $2`, ['rls-test@aura-demo.fr', ids.delivered]);
  }
});

test('buyer sees only own orders, with items', async () => {
  const { data, error } = await orders(buyer).select('id, email, order_items(product_name)');
  assert.equal(error, null);
  assert.ok(data.length >= 2);
  assert.ok(data.every((o) => o.email === BUYER));
  assert.ok(data.every((o) => o.order_items.length === 1));
});

test('stranger sees nothing', async () => {
  const { data, error } = await orders(stranger).select('id');
  assert.equal(error, null);
  assert.equal(data.length, 0);
  const items = await stranger.schema(SCHEMA).from('order_items').select('id');
  assert.equal(items.error, null);
  assert.equal(items.data.length, 0);
  const kpis = await stranger.schema(SCHEMA).from('admin_kpis').select('*');
  assert.equal(kpis.error, null);
  assert.ok(kpis.data.length === 0 || (Number(kpis.data[0].order_count) === 0 && !Number(kpis.data[0].revenue)));
});

test('unverified email sees nothing', async () => {
  await sql`update neon_auth."user" set "emailVerified" = false where email = ${BUYER}`;
  try {
    const { data, error } = await orders(buyer).select('id');
    assert.equal(error, null);
    assert.equal(data.length, 0);
  } finally {
    await sql`update neon_auth."user" set "emailVerified" = true where email = ${BUYER}`;
  }
});

test('anonymous gets nothing', async () => {
  const res = await fetch(`${process.env.NEON_DATA_API_URL}/orders?select=id`, {
    headers: { 'accept-profile': SCHEMA },
  });
  // La passerelle Neon refuse les requêtes sans JWT (400) avant même PostgREST.
  assert.ok([400, 401, 403].includes(res.status), `anonymous: ${res.status}`);
});

test('admin_scope rpc', async () => {
  assert.equal((await privateAdmin.schema(SCHEMA).rpc('admin_scope')).data, 'all');
  assert.equal((await demoAdmin.schema(SCHEMA).rpc('admin_scope')).data, 'demo');
  const b = await buyer.schema(SCHEMA).rpc('admin_scope');
  assert.equal(b.error, null);
  assert.equal(b.data, null);
});

test('buyer cannot update status', async () => {
  const { data, error } = await orders(buyer).update({ status: 'expediee' }).eq('id', ids.own).select();
  assert.equal(error, null);
  assert.equal(data.length, 0);
  assert.equal((await dbOrder(ids.own)).status, 'payee');
});

test('demo admin sees only demo orders', async () => {
  const { data, error } = await orders(demoAdmin).select('id, is_demo');
  assert.equal(error, null);
  assert.ok(data.some((o) => String(o.id) === String(ids.demo)));
  assert.ok(data.every((o) => o.is_demo === true));
  const kpis = await demoAdmin.schema(SCHEMA).from('admin_kpis').select('*');
  assert.equal(kpis.error, null);
  const [count] = await sql.query(`select count(*)::int n from ${SCHEMA}.orders where is_demo`);
  assert.equal(Number(kpis.data[0].order_count), count.n);
});

test('demo admin cannot update a real order', async () => {
  const { data, error } = await orders(demoAdmin).update({ status: 'expediee' }).eq('id', ids.other).select();
  assert.equal(error, null);
  assert.equal(data.length, 0);
  assert.equal((await dbOrder(ids.other)).status, 'payee');
});

test('demo admin cannot set is_demo or email', async () => {
  const a = await orders(demoAdmin).update({ is_demo: false }).eq('id', ids.demo);
  assert.ok(a.error, 'is_demo doit être refusé');
  assert.equal(a.error.code, '42501');
  const b = await orders(demoAdmin).update({ email: 'pirate@example.com' }).eq('id', ids.demo);
  assert.ok(b.error, 'email doit être refusé');
  assert.equal(b.error.code, '42501');
  const row = await dbOrder(ids.demo);
  assert.equal(row.is_demo, true);
  assert.equal(row.email, 'rls-demo@aura-demo.fr');
});

test('demo admin can ship a demo order', async () => {
  const { data, error } = await orders(demoAdmin).update({ status: 'expediee' }).eq('id', ids.demo).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].status, 'expediee');
});

test('private admin sees all and can ship', async () => {
  const all = await orders(privateAdmin).select('id').in('id', Object.values(ids));
  assert.equal(all.error, null);
  assert.equal(all.data.length, Object.values(ids).length);
  const { data, error } = await orders(privateAdmin).update({ status: 'expediee' }).eq('id', ids.other).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const row = await dbOrder(ids.other);
  assert.equal(row.status, 'expediee');
  assert.ok(row.shipped_at);
  assert.match(row.tracking_number, /^FR-AURA-\d{5}$/);
});

test('status cannot go backwards', async () => {
  const { error } = await orders(privateAdmin).update({ status: 'payee' }).eq('id', ids.delivered);
  assert.equal(error?.code, '23514', 'retour en arrière refusé par le trigger');
  assert.equal((await dbOrder(ids.delivered)).status, 'livree');
});

test('nobody can insert from the browser', async () => {
  for (const client of [buyer, demoAdmin, privateAdmin]) {
    const { error } = await orders(client).insert({ email: BUYER, total: 1 });
    assert.equal(error?.code, '42501', 'insert orders refusé');
    const items = await client.schema(SCHEMA).from('order_items').insert({ order_id: ids.own, product_name: 'x', unit_price: 1, quantity: 1 });
    assert.equal(items.error?.code, '42501', 'insert order_items refusé');
  }
  const [n] = await sql.query(`select count(*)::int n from ${SCHEMA}.orders where email = $1`, [BUYER]);
  assert.equal(n.n, 2);
});

test('nobody can delete from the browser', async () => {
  const { error } = await orders(privateAdmin).delete().eq('id', ids.own);
  assert.equal(error?.code, '42501', 'delete refusé');
  assert.ok(await dbOrder(ids.own));
});
