import { neon, getUser, signIn, signUp, signOut } from './neon-client.js';

const DEMO_PASSWORD = 'aura-demo-2026';

const $ = (id) => document.getElementById(id);
const form = $('authForm');
const message = $('authMessage');
const submitBtn = $('submitBtn');
let mode = 'login'; // 'login' | 'signup'

function show(text, isError) {
  message.textContent = text;
  message.classList.toggle('is-error', Boolean(isError));
  message.hidden = !text;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
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
  show('', false);
}

async function destination() {
  try {
    const { data } = await neon.schema('app').rpc('admin_scope');
    if (data) return 'admin.html';
  } catch {
    /* rôle indéterminé : espace acheteur */
  }
  return 'mes-commandes.html';
}

async function login(email, password) {
  show('', false);
  setBusy(true);
  const { error } = await signIn(email, password);
  if (error) {
    setBusy(false);
    show('Email ou mot de passe incorrect.', true);
    return;
  }
  window.location.href = await destination();
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
    window.location.href = await destination();
    return;
  }
  setBusy(false);
  show('Vérifiez votre boîte mail : un lien de confirmation vient de vous être envoyé.', false);
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

$('switchBtn').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));

document.querySelectorAll('[data-demo]').forEach((btn) => {
  btn.addEventListener('click', () => login(btn.dataset.demo, DEMO_PASSWORD));
});

// Déjà connecté : proposer d'y retourner ou de se déconnecter.
(async () => {
  const user = await getUser();
  if (!user) return;
  const target = await destination();
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
