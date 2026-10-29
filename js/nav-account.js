// Résout la destination de l'icône compte sans bloquer la page.
// Si le SDK ne charge pas, le lien reste sur compte.html (href statique).
const link = document.getElementById('accountLink');

if (link) {
  import('./neon-client.js')
    .then(async ({ neon, getUser }) => {
      const user = await getUser();
      if (!user) return;
      let target = 'mes-commandes.html';
      try {
        const { data } = await neon.schema('app').rpc('admin_scope');
        if (data) target = 'admin.html';
      } catch {
        /* rôle indéterminé : espace acheteur */
      }
      link.setAttribute('href', target);
      link.setAttribute('aria-label', 'Mon espace');
    })
    .catch(() => {
      /* SDK indisponible : le lien reste compte.html */
    });
}
