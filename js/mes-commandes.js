import { neon, requireUser, signOut, isAdmin, whenDataApiReady } from './neon-client.js';
import { STATUS_LABELS, timeline, formatPrice, formatDate } from './orders-format.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
}

function renderTimeline(order) {
  const steps = timeline(order);
  const track = el('div', 'timeline');
  const labels = el('div', 'tl-labels');
  steps.forEach((step, i) => {
    if (i > 0) track.append(el('span', 'tl-bar' + (step.done ? ' on' : '')));
    track.append(el('span', 'tl-dot' + (step.done ? ' on' : '')));
    labels.append(el('span', null, step.date ? `${step.label} · ${shortDate(step.date)}` : step.label));
  });
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `Étapes : ${steps.filter((s) => s.done).map((s) => s.label).join(', ')}`);
  return [track, labels];
}

function renderOrder(order) {
  const card = el('article', 'order-card');

  const head = el('div', 'order-head');
  const left = el('div');
  left.append(el('strong', null, order.order_number), el('span', 'account-muted', ` · ${formatDate(order.paid_at)}`));
  const right = el('div');
  right.append(
    el('span', `order-badge status-${order.status}`, STATUS_LABELS[order.status] || order.status),
    el('strong', 'order-total', formatPrice(order.total)),
  );
  head.append(left, right);

  const items = (order.order_items || []).map((i) => `${i.product_name} × ${i.quantity}`).join(' · ');
  const itemsLine = el('p', 'order-items', items);
  if (order.tracking_number) {
    itemsLine.append(document.createTextNode(' — Suivi : '), el('span', 'order-tracking', order.tracking_number));
  }

  card.append(head, ...renderTimeline(order), itemsLine);
  return card;
}

function renderEmpty(email) {
  const box = el('div', 'account-card orders-empty');
  const link = el('a', 'btn btn-primary', 'Découvrir la collection');
  link.href = 'shop.html';
  box.append(
    el('h2', null, "Aucune commande pour l'instant"),
    el('p', 'account-muted', `Les commandes passées avec ${email} apparaissent ici automatiquement.`),
    link,
  );
  return box;
}

async function init() {
  const user = await requireUser();
  if (!user) return;

  $('navGreeting').textContent = `Bonjour, ${user.name || user.email.split('@')[0]}`;
  $('navUser').hidden = false;
  $('signOutBtn').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'compte.html';
  });
  // Un admin arrivé ici (redirection ou lien direct) garde un accès au back-office.
  isAdmin().then((admin) => {
    $('adminLink').hidden = !admin;
    $('adminLinkSep').hidden = !admin;
  });

  const count = $('ordersCount');
  const list = $('ordersList');
  const error = $('ordersError');
  try {
    await whenDataApiReady(); // sinon « 0 commande » possible après une pause (voir neon-client.js)
    const { data, error: err } = await neon
      .schema('app')
      .from('orders')
      .select('*, order_items(*)')
      .order('paid_at', { ascending: false });
    if (err) throw err;
    if (!data || data.length === 0) {
      count.hidden = true;
      list.replaceChildren(renderEmpty(user.email));
      return;
    }
    count.textContent = data.length === 1 ? '1 commande' : `${data.length} commandes`;
    list.replaceChildren(...data.map(renderOrder));
  } catch {
    count.hidden = true;
    error.textContent = 'Impossible de charger vos commandes pour le moment. Vérifiez votre connexion et réessayez.';
    error.hidden = false;
  }
}

init();
