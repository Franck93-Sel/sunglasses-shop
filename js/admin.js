import { neon, requireUser, signOut, getAccessToken, whenDataApiReady } from './neon-client.js';
import { N8N_ORDER_STATUS_WEBHOOK } from './config.js';
import { STATUS_LABELS, formatPrice, formatDate } from './orders-format.js';

const $ = (id) => document.getElementById(id);

// Même ordre que le trigger app.order_status_transition : pas de retour en arrière.
const STATUS_ORDER = ['payee', 'expediee', 'livree'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showStatus(text) {
  $('adminError').hidden = true;
  $('adminStatus').textContent = text;
  $('adminStatus').hidden = false;
}

function showError(text) {
  $('adminStatus').hidden = true;
  $('adminError').textContent = text;
  $('adminError').hidden = false;
}

async function loadKpis() {
  const { data, error } = await neon.schema('app').from('admin_kpis').select('*').single();
  if (error) throw error;
  $('kpiRevenue').textContent = formatPrice(data.revenue);
  $('kpiCount').textContent = String(data.order_count);
  $('kpiToShip').textContent = String(data.to_ship);
  $('kpiTop').textContent = data.top_product || '—';
}

function buildSelect(order) {
  const select = el('select', 'status-select');
  select.setAttribute('aria-label', `Statut de la commande ${order.order_number}`);
  STATUS_ORDER.slice(STATUS_ORDER.indexOf(order.status)).forEach((status) => {
    const option = el('option', null, STATUS_LABELS[status]);
    option.value = status;
    select.append(option);
  });
  select.value = order.status;
  select.disabled = select.options.length === 1; // dernier statut : rien à choisir
  select.addEventListener('change', () => changeStatus(order, select));
  return select;
}

function renderRow(order) {
  const row = el('tr');
  const cell = el('td');
  cell.append(buildSelect(order));
  row.append(
    el('td', null, order.order_number),
    el('td', 'hide-sm', formatDate(order.paid_at)),
    el('td', null, order.email),
    el('td', null, formatPrice(order.total)),
    cell,
  );
  return row;
}

const WEBHOOK_TIMEOUT_MS = 15000;

// Renvoie le corps { sent, simulated }, ou null si le webhook a échoué (réseau, HTTP, JSON, délai).
async function notifyShipped(orderId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(N8N_ORDER_STATUS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function changeStatus(order, select) {
  const previous = order.status;
  const next = select.value;
  if (next === previous) return;
  select.disabled = true;
  try {
    const { data, error } = await neon
      .schema('app')
      .from('orders')
      .update({ status: next })
      .eq('id', order.id)
      .select('id, status')
      .single();
    if (error || !data) throw error || new Error('no row');
    order.status = data.status;
  } catch {
    select.value = previous;
    select.disabled = select.options.length === 1;
    showError(`Impossible de mettre à jour la commande ${order.order_number}. Le statut n'a pas été modifié.`);
    return;
  }

  let message = `Commande ${order.order_number} : statut « ${STATUS_LABELS[next]} ».`;
  let failed = false;
  if (next === 'expediee') {
    const result = await notifyShipped(order.id);
    if (!result) {
      message = "Statut mis à jour, l'email n'a pas pu être envoyé";
      failed = true;
    } else if (result.sent) {
      message = 'Email « Votre commande est en route » envoyé au client';
    } else {
      message = "Statut mis à jour. L'email avait déjà été envoyé.";
    }
  }

  const cell = select.parentElement;
  const fresh = buildSelect(order);
  cell.replaceChildren(fresh);
  fresh.focus();
  if (failed) showError(message);
  else showStatus(message);

  try {
    await loadKpis();
  } catch {
    showError("Statut mis à jour, mais les indicateurs n'ont pas pu être actualisés.");
  }
}

async function init() {
  const error = $('adminError');
  try {
    const user = await requireUser();
    if (!user) return;

    $('navGreeting').textContent = `Admin · ${user.name || user.email.split('@')[0]}`;
    $('navUser').hidden = false;
    $('signOutBtn').addEventListener('click', async () => {
      await signOut();
      window.location.href = 'compte.html';
    });

    await whenDataApiReady(); // sinon un admin peut être pris pour un acheteur (voir neon-client.js)
    const { data: scope, error: scopeErr } = await neon.schema('app').rpc('admin_scope');
    if (scopeErr) throw scopeErr;
    if (!scope) {
      window.location.href = 'mes-commandes.html';
      return;
    }

    const { data, error: err } = await neon
      .schema('app')
      .from('orders')
      .select('id, order_number, email, total, status, paid_at')
      .order('paid_at', { ascending: false });
    if (err) throw err;
    $('ordersBody').replaceChildren(...data.map(renderRow));
    await loadKpis();
  } catch (e) {
    console.error(e);
    error.textContent = 'Impossible de charger le back-office pour le moment. Vérifiez votre connexion et réessayez.';
    error.hidden = false;
  }
}

init();
