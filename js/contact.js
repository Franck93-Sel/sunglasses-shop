import { WEB3FORMS_ACCESS_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const form = $('contactForm');
const message = $('contactMessage');
const submitBtn = $('contactSubmit');

function show(text, isError) {
  message.textContent = text;
  message.classList.toggle('is-error', Boolean(isError));
  message.hidden = !text;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi…';
  show('');

  const data = new FormData(form);
  data.append('access_key', WEB3FORMS_ACCESS_KEY);
  data.append('from_name', 'AURA — Formulaire de contact');
  // Sujet de l'email reçu : préfixé pour le repérer dans Gmail.
  data.set('subject', `[AURA Contact] ${data.get('subject')}`);

  try {
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: data,
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message || `HTTP ${res.status}`);
    form.reset();
    show('Message envoyé. Nous vous répondrons sous 24h.');
  } catch (err) {
    console.error('Envoi du formulaire de contact échoué :', err);
    show("L'envoi a échoué. Merci de réessayer dans un instant.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Envoyer le message';
  }
});
