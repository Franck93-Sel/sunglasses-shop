// Formatage des commandes : fonctions pures, sans DOM ni SDK.

export const STATUS_LABELS = { payee: 'Payée', expediee: 'Expédiée', livree: 'Livrée' };

const STEPS = [
  { key: 'payee', dateField: 'paid_at' },
  { key: 'expediee', dateField: 'shipped_at' },
  { key: 'livree', dateField: 'delivered_at' },
];

export function timeline(order) {
  const reached = STEPS.findIndex((s) => s.key === order.status);
  return STEPS.map((step, i) => {
    const done = i <= reached;
    return {
      key: step.key,
      label: STATUS_LABELS[step.key],
      done,
      date: done ? order[step.dateField] || null : null,
    };
  });
}

const priceFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });

export function formatPrice(n) {
  return priceFormat.format(Number(n));
}

export function formatDate(iso) {
  return dateFormat.format(new Date(iso));
}
