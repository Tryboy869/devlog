# DevLog

Catalogue de projets développeur qui se rédige et se met à jour tout seul : tu donnes un dépôt à lire, une IA transforme son `README.md` en entrée de blog, et tout est commité directement sur GitHub — depuis ton navigateur pour un ajout ponctuel, ou tout seul via GitHub Actions pour une mise à jour automatique. Aucun serveur à toi ne tourne jamais.

Le site a trois sections : **Accueil** (présentation), **Projets** (le catalogue, en carnet de build chronologique) et **Contribuer** (lien vers ce dépôt) — accessibles via le menu ☰ dans l'en-tête.

## Démarrage

1. **Fork** ce dépôt.
2. Sur [vercel.com](https://vercel.com), importe ton fork. Framework preset : *Other*. Vercel détecte automatiquement `vercel.json` (build `npm run build`, dossier de sortie `.`).
3. Dans les réglages du projet Vercel, ajoute ces variables d'environnement (aucune n'est un secret) :
   - `SITE_URL` — l'URL de ton déploiement (ex. `https://ton-projet.vercel.app`), utilisée dans `sitemap.xml`/`robots.txt`/`llms.txt`.
   - `SITE_REPO` — `TonPseudo/ton-fork` (ex. `Tryboy869/devlog`), utilisée pour le lien dans la section Contribuer.
4. Déploie. Le premier build génère `p/example-project.html`, `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt` à partir de l'exemple fourni dans `projects/`.
5. Ouvre le site déployé, menu ☰ → **Administration**, renseigne :
   - un token GitHub (classique ou [fine-grained](https://github.com/settings/tokens?type=beta), au choix),
   - le propriétaire et le nom de **ton fork** (là où le catalogue va écrire),
   - un fournisseur IA (Groq ou OpenRouter) et sa clé API,
   - clique **Récupérer les modèles**, puis choisis-en un dans la liste — c'est une étape à part entière, le formulaire de génération ne s'affiche que quand ce champ est rempli.
6. Renseigne le dépôt à cataloguer (`proprietaire/depot` ou un lien GitHub complet, les deux marchent) et lance la génération. Supprime ensuite `projects/example-project.json`, qui ne sert qu'à amorcer le tout premier build.

Chaque écriture déclenche automatiquement un nouveau build Vercel, qui régénère la page SEO du projet, le catalogue et les fichiers de découvrabilité.

## Automatisation (sans navigateur)

En plus du bouton manuel, `.github/workflows/auto-catalog.yml` tourne sur un cron et catalogue tout seul : il découvre tous tes dépôts publics (hors forks et hors ce dépôt), et ne (re)génère que ceux qui sont nouveaux ou poussés plus récemment que leur dernière entrée — pas besoin de maintenir une liste.

Pour l'activer, dans les réglages GitHub du dépôt :

- **Settings → Secrets and variables → Actions → Secrets** : ajoute `AI_API_KEY` (la clé du fournisseur choisi).
- **Settings → Secrets and variables → Actions → Variables** : ajoute `AI_PROVIDER` (`groq` ou `openrouter`) et `AI_MODEL` (un identifiant valide chez ce fournisseur).
- Optionnel : secret `CATALOG_PAT` si tu veux cataloguer aussi des dépôts privés (le token par défaut d'Actions ne lit que le public) ; variable `MAX_PER_RUN` pour changer la limite de dépôts traités par passage (5 par défaut).
- La fréquence se règle directement dans `.github/workflows/auto-catalog.yml`, ligne `cron:` — le format est du cron standard.
- Un lancement manuel est possible depuis l'onglet **Actions → Auto-catalogue → Run workflow**.

## Ce qui vit où

- **Dans le navigateur du visiteur** (`js/*.js`, à la visite) : configuration, lecture/écriture GitHub, appel au fournisseur IA. Rien de tout ça ne tourne sur un serveur.
- **Au build Vercel** (`build.js`, à chaque push) : lecture de `projects/*.json`, génération des pages statiques `p/*.html`, de `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt`.
- **Dans GitHub Actions** (`.github/scripts/auto-catalog.mjs`, sur cron) : découverte des dépôts, lecture des README, appel IA, écriture de `projects/*.json` — puis commit/push géré par le workflow.

Voir `skills/orchestrator.md`, `skills/blog-writing.md` et `skills/seo-sitemaps.md` pour les règles exactes suivies par ces trois étapes.

## Sécurité

- Le token GitHub et la clé du fournisseur IA (chemin manuel) restent en `localStorage`, envoyés uniquement à `api.github.com` et à l'API du fournisseur choisi. Côté automatisation, `AI_API_KEY` et `CATALOG_PAT` restent des secrets GitHub Actions, jamais exposés dans les logs.
- Un token classique fonctionne, mais un [token fine-grained](https://github.com/settings/tokens?type=beta) limité à ce seul dépôt réduit les dégâts en cas de fuite — l'app affiche un avertissement non bloquant si elle détecte un token à accès large, sans jamais forcer le choix.
- Tout contenu injecté dans le DOM passe par un échappement HTML systématique, avec [DOMPurify](https://github.com/cure53/DOMPurify) en filet de sécurité — un README malveillant ne peut pas faire exécuter de script dans le navigateur de l'admin.

## Limites connues de cette version

- `build.js` et `auto-catalog.mjs` ont été exécutés et testés localement (syntaxe validée, logique vérifiée contre un faux serveur GitHub/IA simulant plusieurs scénarios : dépôt neuf, dépôt existant, fork à exclure, projet déjà à jour, dépôt sans README).
- Les appels réels à `api.github.com`, Groq et OpenRouter avec de vrais identifiants n'ont pas pu être testés en conditions réelles dans l'environnement où ce projet a été construit. La forme des requêtes suit la documentation de chaque fournisseur, mais teste le flux complet avec tes propres identifiants avant de t'y fier pour un vrai dépôt.
- Groq déprécie parfois des modèles sans préavis long : si `Récupérer les modèles` renvoie une erreur, vérifie d'abord que le modèle choisi est toujours actif.
