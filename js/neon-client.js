import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.9.0-beta';
import { NEON_AUTH_URL, NEON_DATA_API_URL } from './config.js';

export const neon = createClient({
  auth: { url: NEON_AUTH_URL },
  dataApi: { url: NEON_DATA_API_URL },
});

function messageOf(error) {
  return (error && (error.message || error.statusText)) || 'Une erreur est survenue.';
}

// Le SDK renvoie ou lève (AuthApiError) selon les cas : on garde message et code.
const failure = (error) => ({ error: messageOf(error), code: error && error.code });

export async function getUser() {
  try {
    const { data } = await neon.auth.getSession();
    const user = data && data.user;
    if (!data || !data.session || !user) return null;
    return { id: user.id, email: user.email, name: user.name };
  } catch {
    return null;
  }
}

// JWT de la session, comme le SDK pour la Data API (vérifié côté n8n) ; null si non connecté.
export async function getAccessToken() {
  try {
    const { data } = await neon.auth.getSession();
    return (data && data.session && data.session.token) || null;
  } catch {
    return null;
  }
}

export async function signIn(email, password) {
  try {
    const { error } = await neon.auth.signIn.email({ email, password });
    return error ? failure(error) : {};
  } catch (e) {
    return failure(e);
  }
}

// Vérification de l'email par code (Neon Auth, méthode « Verification code »).
export async function sendVerificationCode(email) {
  try {
    const { error } = await neon.auth.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
    return error ? { error: messageOf(error) } : {};
  } catch (e) {
    return { error: messageOf(e) };
  }
}

export async function verifyEmail(email, otp) {
  try {
    const { error } = await neon.auth.emailOtp.verifyEmail({ email, otp });
    return error ? failure(error) : {};
  } catch (e) {
    return failure(e);
  }
}

export async function signUp(email, password, name) {
  try {
    const { error } = await neon.auth.signUp.email({ email, password, name });
    return error ? { error: messageOf(error) } : {};
  } catch (e) {
    return { error: messageOf(e) };
  }
}

export async function signOut() {
  try {
    await neon.auth.signOut();
  } catch {
    /* session déjà absente */
  }
}

export async function requireUser(redirectTo = 'compte.html') {
  const user = await getUser();
  if (!user) {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}

// Contournement Neon Data API (mesuré le 2026-11-02) : après quelques minutes sans requête,
// la toute première requête arrive parfois SANS identité (auth.user_id() vide côté base).
// La RLS répond alors comme à un inconnu : liste vide ou admin_scope null, sans erreur.
// La requête suivante est normale. On « réveille » donc la Data API avec un « qui suis-je ? »
// (app.current_email) jusqu'à ce qu'elle reconnaisse le compte, avant les vraies requêtes.
// Seulement pour un email vérifié : sinon current_email() vaut null normalement.
let dataApiReady = null;

export function whenDataApiReady(attempts = 4) {
  dataApiReady ??= (async () => {
    let user;
    try {
      const { data } = await neon.auth.getSession();
      user = data && data.session && data.user;
    } catch {
      return false;
    }
    if (!user || !user.emailVerified || !user.email) return false;
    const expected = user.email.trim().toLowerCase();
    for (let i = 0; i < attempts; i += 1) {
      try {
        const { data, error } = await neon.schema('app').rpc('current_email');
        if (!error && data === expected) return true;
      } catch {
        /* nouvel essai */
      }
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
    return false;
  })().then((ready) => {
    if (!ready) dataApiReady = null; // pas reconnu : on réessaiera au prochain appel
    return ready;
  });
  return dataApiReady;
}

// Page d'accueil de l'espace connecté : back-office pour un admin, sinon commandes.
// Une erreur (jeton pas encore pris en compte juste après la connexion, base qui se réveille)
// ne vaut pas « pas admin » : on réessaie avant de conclure.
export async function isAdmin(attempts = 3) {
  await whenDataApiReady();
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { data, error } = await neon.schema('app').rpc('admin_scope');
      if (!error) return Boolean(data);
    } catch {
      /* nouvel essai */
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
  }
  return false; // rôle toujours indéterminé : espace acheteur
}

export async function resolveHome() {
  return (await isAdmin()) ? 'admin.html' : 'mes-commandes.html';
}
