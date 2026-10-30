import { getUser, signIn, signUp, signOut, resolveHome, sendVerificationCode, verifyEmail } from './neon-client.js';

const DEMO_PASSWORD = 'aura-demo-2026';

const $ = (id) => document.getElementById(id);
const form = $('authForm');
const message = $('authMessage');
const submitBtn = $('submitBtn');
let mode = 'login'; // 'login' | 'signup'
let pending = null; // { email, password } en attente de vérification de l'email

function show(text, isError) {
  message.textContent = text;
  message.classList.toggle('is-error', Boolean(isError));
  message.hidden = !text;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  $('verifyBtn').disabled = busy;
  $('resendBtn').disabled = busy;
  document.querySelectorAll('[data-demo]').forEach((b) => { b.disabled = busy; });
}

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  $('nameField').hidden = !signup;
  $('authTitle').textContent = signup ? 'Créer un compte' : 'Mon compte';
  $('authIntro').textContent = signup
    ? 'Un compte pour suivre vos commandes.'
    : 'Connectez-vous pour suivre vos commandes.';
  submitBtn.textContent = signup ? 'Créer mon compte' : 'Se connecter';
  $('passwordInput').autocomplete = signup ? 'new-password' : 'current-password';
  $('switchText').textContent = signup ? 'Déjà un compte ?' : 'Pas encore de compte ?';
  $('switchBtn').textContent = signup ? 'Se connecter' : 'Créer un compte';
  form.hidden = false;
  $('switchRow').hidden = false;
  $('verifyForm').hidden = true;
  pending = null;
  show('', false);
}

// Étape « code reçu par email » (inscription, ou connexion d'un compte pas encore vérifié).
function showVerify(email, password, text) {
  pending = { email, password };
  form.hidden = true;
  $('switchRow').hidden = true;
  $('verifyForm').hidden = false;
  $('authTitle').textContent = 'Vérifiez votre email';
  $('authIntro').textContent = `Saisissez le code envoyé à ${email}.`;
  $('codeInput').value = '';
  $('codeInput').focus();
  show(text, false);
}

async function login(email, password) {
  show('', false);
  setBusy(true);
  const { error, code } = await signIn(email, password);
  if (error) {
    setBusy(false);
    if (code === 'email_not_confirmed' || code === 'EMAIL_NOT_VERIFIED') {
      const sent = await sendVerificationCode(email);
      showVerify(email, password, sent.error
        ? "Votre email n'est pas encore vérifié. Demandez un nouveau code."
        : "Votre email n'est pas encore vérifié : un code vient de vous être envoyé.");
      return;
    }
    show('Email ou mot de passe incorrect.', true);
    return;
  }
  window.location.href = await resolveHome();
}

async function confirmCode(otp) {
  show('', false);
  setBusy(true);
  const { error, code } = await verifyEmail(pending.email, otp);
  if (error) {
    setBusy(false);
    show(/expir/i.test(`${code} ${error}`)
      ? 'Ce code a expiré. Demandez-en un nouveau.'
      : 'Code incorrect. Vérifiez-le et réessayez.', true);
    return;
  }
  // Connexion automatique après vérification ; sinon on se connecte avec le mot de passe saisi.
  if (!(await getUser()) && (await signIn(pending.email, pending.password)).error) {
    setBusy(false);
    setMode('login');
    show('Email vérifié. Connectez-vous.', false);
    return;
  }
  window.location.href = await resolveHome();
}

async function register(email, password, name) {
  show('', false);
  setBusy(true);
  const { error } = await signUp(email, password, name);
  if (error) {
    setBusy(false);
    show(/exist|already|registered/i.test(error)
      ? 'Un compte existe déjà avec cet email. Connectez-vous.'
      : 'Création du compte impossible. Vérifiez vos informations et réessayez.', true);
    return;
  }
  // Pas de session après l'inscription = vérification d'email requise.
  if (await getUser()) {
    window.location.href = await resolveHome();
    return;
  }
  setBusy(false);
  showVerify(email, password, 'Un code de vérification vient de vous être envoyé par email.');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('emailInput').value.trim();
  const password = $('passwordInput').value;
  if (!email || !password) {
    show('Renseignez votre email et votre mot de passe.', true);
    return;
  }
  if (mode === 'signup') {
    if (password.length < 8) {
      show('Le mot de passe doit contenir au moins 8 caractères.', true);
      return;
    }
    register(email, password, $('nameInput').value.trim() || email.split('@')[0]);
  } else {
    login(email, password);
  }
});

$('verifyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const otp = $('codeInput').value.replace(/\s/g, '');
  if (!/^\d{6}$/.test(otp)) {
    show('Le code contient 6 chiffres.', true);
    return;
  }
  confirmCode(otp);
});

$('resendBtn').addEventListener('click', async () => {
  setBusy(true);
  const { error } = await sendVerificationCode(pending.email);
  setBusy(false);
  show(error ? 'Envoi impossible pour le moment. Réessayez dans un instant.' : 'Nouveau code envoyé.', Boolean(error));
});

$('backBtn').addEventListener('click', () => setMode('login'));

$('switchBtn').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));

document.querySelectorAll('[data-demo]').forEach((btn) => {
  btn.addEventListener('click', () => login(btn.dataset.demo, DEMO_PASSWORD));
});

// Déjà connecté : proposer d'y retourner ou de se déconnecter.
(async () => {
  const user = await getUser();
  if (!user) return;
  const target = await resolveHome();
  const card = $('authCard');
  card.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = 'Vous êtes connecté';
  const p = document.createElement('p');
  p.className = 'account-muted';
  p.textContent = user.email;
  const go = document.createElement('a');
  go.className = 'btn btn-primary btn-block';
  go.href = target;
  go.style.marginTop = '20px';
  go.textContent = target === 'admin.html' ? 'Ouvrir le back-office' : 'Mes commandes';
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'btn btn-outline btn-block';
  out.textContent = 'Se déconnecter';
  out.addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
  card.append(h, p, go, out);
})();
