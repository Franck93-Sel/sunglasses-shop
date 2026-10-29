import { createClient } from '@neondatabase/neon-js';

// Node n'envoie pas d'en-tête Origin et n'a pas de jar de cookies, or Neon Auth exige les deux.
// On s'authentifie donc à la main (origine = domaine de confiance), puis on branche le JWT
// sur la Data API via le mode « token externe » du SDK. Un client = une session isolée.
const ORIGIN = 'http://localhost:5500';

export async function signedInClient(email, password) {
  const authUrl = process.env.NEON_AUTH_URL;
  // Neon Auth limite les connexions (≈3 / 10 s) : on attend et on réessaie sur 429.
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${authUrl}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 11_000));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`signIn ${email}: ${body.message || res.status}`);
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ');

  const getToken = async () => {
    const r = await fetch(`${authUrl}/token`, { headers: { origin: ORIGIN, cookie } });
    if (!r.ok) throw new Error(`token ${email}: ${r.status}`);
    return (await r.json()).token;
  };

  const client = createClient({
    dataApi: { url: process.env.NEON_DATA_API_URL, getToken },
  });
  client.getToken = getToken; // utile aux tests (inspection du JWT)
  return client;
}
