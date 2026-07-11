# DevLog

Catalogue de projets développeur qui se rédige et se met à jour tout seul : tu donnes un dépôt à lire, une IA transforme son `README.md` en entrée de blog, et tout est commité directement sur GitHub depuis ton navigateur — aucun serveur à toi ne tourne jamais.

## Démarrage

1. **Fork** ce dépôt.
2. Sur [vercel.com](https://vercel.com), importe ton fork. Framework preset : *Other*. Vercel détecte automatiquement `vercel.json` (build `npm run build`, dossier de sortie `.`).
3. Dans les réglages du projet Vercel, ajoute une variable d'environnement `SITE_URL` avec l'URL de ton déploiement (ex. `https://ton-projet.vercel.app`) — elle sert uniquement à écrire les bonnes URLs absolues dans `sitemap.xml`, `robots.txt` et `llms.txt` au moment du build. Ce n'est pas un secret.
4. Déploie. Le premier build génère `p/example-project.html`, `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt` à partir de l'exemple fourni dans `projects/`.
5. Ouvre le site déployé, clique sur **Administration**, renseigne :
   - un token GitHub (classique ou [fine-grained](https://github.com/settings/tokens?type=beta), au choix — fine-grained limité à ce seul dépôt est plus prudent),
   - le propriétaire et le nom de **ton fork** (là où le catalogue va écrire),
   - un fournisseur IA (Groq ou OpenRouter) et sa clé API,
   - récupère les modèles disponibles et choisis-en un.
6. Renseigne le dépôt `proprietaire/nom` d'un de tes projets à cataloguer et lance la génération. Une fois committé, supprime `projects/example-project.json` (il ne sert qu'à amorcer le tout premier build).

Chaque écriture déclenche automatiquement un nouveau build Vercel, qui régénère la page SEO du projet, le catalogue et les fichiers de découvrabilité.

## Ce qui vit où

- **Dans le navigateur du visiteur** (`js/*.js`, à la visite) : configuration, lecture/écriture GitHub, appel au fournisseur IA. Rien de tout ça ne tourne sur un serveur.
- **Au build Vercel** (`build.js`, à chaque push) : lecture de `projects/*.json`, génération des pages statiques `p/*.html`, de `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt`.

Voir `skills/orchestrator.md`, `skills/blog-writing.md` et `skills/seo-sitemaps.md` pour les règles exactes suivies par chacune de ces deux étapes.

## Sécurité

- Le token GitHub et la clé du fournisseur IA restent en `localStorage`, envoyés uniquement à `api.github.com` et à l'API du fournisseur choisi.
- Un token classique fonctionne, mais un [token fine-grained](https://github.com/settings/tokens?type=beta) limité à ce seul dépôt réduit les dégâts en cas de fuite — l'app affiche un avertissement non bloquant si elle détecte un token à accès large, sans jamais forcer le choix.
- Tout contenu injecté dans le DOM passe par un échappement HTML systématique, avec [DOMPurify](https://github.com/cure53/DOMPurify) en filet de sécurité — un README malveillant ne peut pas faire exécuter de script dans le navigateur de l'admin.

## Limites connues de cette version

Ce projet a été généré et vérifié autant que possible sans identifiants réels :

- `build.js` a été exécuté localement contre `projects/example-project.json` et produit bien `p/example-project.html`, `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt` — vérifié.
- La syntaxe de tous les fichiers `.js` a été validée (`node --check`) — vérifié.
- Les appels réels à `api.github.com`, à Groq et à OpenRouter **n'ont pas pu être testés en conditions réelles** faute de token et de clé API dans cet environnement. La forme des requêtes suit exactement la documentation de chaque fournisseur, mais teste le flux complet (config → génération → écriture → build) avec tes propres identifiants avant de t'y fier pour un vrai dépôt.
- Groq déprécie parfois des modèles sans préavis long : si `Récupérer les modèles` renvoie une erreur, vérifie d'abord que le modèle choisi est toujours actif.
