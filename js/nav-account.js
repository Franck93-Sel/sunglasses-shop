// Résout la destination de l'icône compte sans bloquer la page.
// Si le SDK ne charge pas, le lien reste sur compte.html (href statique).
const link = document.getElementById('accountLink');

if (link) {
  import('./neon-client.js')
    .then(async ({ getUser, resolveHome }) => {
      const user = await getUser();
      if (!user) return;
      const target = await resolveHome();
      link.setAttribute('href', target);
      link.setAttribute('aria-label', 'Mon espace');
    })
    .catch(() => {
      /* SDK indisponible : le lien reste compte.html */
    });
}
