import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_LABELS, timeline, formatPrice, formatDate } from '../js/orders-format.js';

const order = (status) => ({
  status,
  paid_at: '2026-10-27T10:00:00Z',
  shipped_at: status === 'payee' ? null : '2026-10-28T09:00:00Z',
  delivered_at: status === 'livree' ? '2026-10-30T15:00:00Z' : null,
});
const flags = (status) => timeline(order(status)).map((s) => s.done);

test('STATUS_LABELS donne les libellés français', () => {
  assert.deepEqual(STATUS_LABELS, { payee: 'Payée', expediee: 'Expédiée', livree: 'Livrée' });
});

test('timeline : trois étapes dans l\'ordre', () => {
  assert.deepEqual(timeline(order('payee')).map((s) => s.key), ['payee', 'expediee', 'livree']);
  assert.deepEqual(timeline(order('payee')).map((s) => s.label), ['Payée', 'Expédiée', 'Livrée']);
});

test('timeline : étapes faites selon le statut', () => {
  assert.deepEqual(flags('payee'), [true, false, false]);
  assert.deepEqual(flags('expediee'), [true, true, false]);
  assert.deepEqual(flags('livree'), [true, true, true]);
});

test('timeline : date de chaque étape faite, null sinon', () => {
  const t = timeline(order('expediee'));
  assert.equal(t[0].date, '2026-10-27T10:00:00Z');
  assert.equal(t[1].date, '2026-10-28T09:00:00Z');
  assert.equal(t[2].date, null);
});

test('formatPrice formate en euros fr-FR', () => {
  assert.equal(formatPrice(289).replace(/[\u00a0\u202f]/g, ' '), '289,00 €');
  assert.equal(formatPrice('145').replace(/[\u00a0\u202f]/g, ' '), '145,00 €');
});

test('formatDate formate en jour mois abrégé année', () => {
  assert.equal(formatDate('2026-10-27T10:00:00Z'), '27 oct. 2026');
});
