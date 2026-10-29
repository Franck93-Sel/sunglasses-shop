import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.9.0-beta';
import { NEON_AUTH_URL, NEON_DATA_API_URL } from './config.js';

export const neon = createClient({
  auth: { url: NEON_AUTH_URL },
  dataApi: { url: NEON_DATA_API_URL },
});

function messageOf(error) {
  return (error && (error.message || error.statusText)) || 'Une erreur est survenue.';
}

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

export async function signIn(email, password) {
  try {
    const { error } = await neon.auth.signIn.email({ email, password });
    return error ? { error: messageOf(error) } : {};
  } catch (e) {
    return { error: messageOf(e) };
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

// Page d'accueil de l'espace connecté : back-office pour un admin, sinon commandes.
export async function resolveHome() {
  try {
    const { data } = await neon.schema('app').rpc('admin_scope');
    if (data) return 'admin.html';
  } catch {
    /* rôle indéterminé : espace acheteur */
  }
  return 'mes-commandes.html';
}
