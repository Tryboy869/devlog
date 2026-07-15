# DevLog

Catalogue de projets développeur qui se rédige et se met à jour tout seul : tu donnes un dépôt à lire, une IA transforme son `README.md` en entrée de blog, et tout est commité directement sur GitHub — depuis ton navigateur pour un ajout ponctuel, ou tout seul via GitHub Actions pour une mise à jour automatique. Aucun serveur à toi ne tourne jamais.

Le site a trois sections : **Accueil** (présentation), **Projets** (le catalogue, en carnet de build chronologique) et **Contribuer** (lien vers ce dépôt) — accessibles via le menu ☰ dans l'en-tête.

## Démarrage

1. **Fork** ce dépôt.
2. Sur [vercel.com](https://vercel.com), importe ton fork. Framework preset : *Other*. Vercel détecte automatiquement `vercel.json` (build `npm run build`, dossier de sortie `.`).
3. Dans les réglages du projet Vercel (Settings → Environment Variables), coche **"Enable access to System Environment Variables"** — une seule case à cocher, rien à taper. `SITE_URL` et `SITE_REPO` s'en déduisent automatiquement (URL de production et dépôt Git déjà connus de Vercel). Tu peux quand même forcer `SITE_URL`/`SITE_REPO` manuellement si besoin (domaine personnalisé, etc.), mais ce n'est plus nécessaire par défaut.
4. Déploie. Le premier build génère `p/example-project.html`, `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt` à partir de l'exemple fourni dans `projects/`.
5. Ouvre le site déployé, menu ☰ → **Administration**, renseigne :
   - un token GitHub (classique ou [fine-grained](https://github.com/settings/tokens?type=beta), au choix),
   - le propriétaire et le nom de **ton fork** (là où le catalogue va écrire),
   - un fournisseur IA (Groq ou OpenRouter) et sa clé API,
   - clique **Récupérer les modèles**, puis choisis-en un dans la liste — c'est une étape à part entière, le formulaire de génération ne s'affiche que quand ce champ est rempli.
6. Renseigne le dépôt à cataloguer (`proprietaire/depot` ou un lien GitHub complet, les deux marchent) et lance la génération. Supprime ensuite `projects/example-project.json`, qui ne sert qu'à amorcer le tout premier build.

Chaque écriture déclenche automatiquement un nouveau build Vercel, qui régénère la page SEO du projet, le catalogue et les fichiers de découvrabilité.

## Visuel de chaque projet

Trois niveaux, du plus automatique au plus spécifique :

1. **Couverture** — chaque page de projet affiche automatiquement l'image sociale GitHub du dépôt source (`opengraph.githubassets.com`, généré par GitHub lui-même, sans rien à configurer).
2. **Média détecté** — avant d'appeler l'IA, le README est scanné pour des images/GIFs/vidéos YouTube pertinents (les badges de statut type shields.io sont exclus automatiquement). Si quelque chose de pertinent existe, l'IA choisit le meilleur et l'embarque dans la page (image, ou vidéo YouTube en iframe).
3. **SVG généré** — si le README n'a vraiment aucun visuel exploitable, l'IA génère un petit motif SVG animé (abstrait, en rapport avec les tags/la stack) plutôt que de laisser la page sans aucun signal visuel. Ce SVG passe par un nettoyage strict (balises `<script>`, attributs `on*`, `@import`, `href` en `javascript:`/`data:` retirés) avant d'être affiché, aussi bien côté build que côté aperçu navigateur.

Le corps (`body`) de chaque entrée est du **Markdown** (titres, blocs de code, listes, gras), rendu par [marked](https://github.com/markedjs/marked) des deux côtés — build et aperçu. Le skill `blog-writing.md` impose qu'un extrait de code du README apparaisse dans une section "Comment ça marche" quand la source en fournit un : l'objectif est une vraie profondeur technique, pas un résumé marketing.

## Automatisation (sans navigateur)

En plus du bouton manuel, `.github/workflows/auto-catalog.yml` tourne sur un cron et catalogue tout seul : il découvre tous tes dépôts publics (hors forks et hors ce dépôt), et ne (re)génère que ceux qui sont nouveaux ou poussés plus récemment que leur dernière entrée — pas besoin de maintenir une liste.

Pour l'activer, **tout se passe depuis le panneau Administration** : une fois le fournisseur/clé/modèle renseignés (étape 5 ci-dessus), la section "Automatisation" propose une fréquence (heure / jour / semaine / cron personnalisé), une limite de dépôts par passage, et un champ optionnel pour un token couvrant aussi tes dépôts privés. Le bouton **Activer l'automatisation** pousse tout ça directement vers GitHub :

- la clé IA part chiffrée (chiffrement scellé libsodium, calculé dans ce navigateur avec la vraie clé publique du dépôt — jamais en clair sur le réseau) comme secret `AI_API_KEY` ;
- fournisseur/modèle/limite deviennent des variables de dépôt (`AI_PROVIDER`, `AI_MODEL`, `MAX_PER_RUN`) ;
- si renseigné, le token pour dépôts privés part chiffré comme secret `CATALOG_PAT` ;
- la ligne `cron:` de `.github/workflows/auto-catalog.yml` est réécrite selon la fréquence choisie.

Aucune page GitHub à visiter. Un lancement manuel reste possible depuis l'onglet **Actions → Auto-catalogue → Run workflow** si tu ne veux pas attendre le prochain passage planifié.

## Ce qui vit où

- **Dans le navigateur du visiteur** (`js/*.js`, à la visite) : configuration, lecture/écriture GitHub, appel au fournisseur IA. Rien de tout ça ne tourne sur un serveur.
- **Au build Vercel** (`build.js`, à chaque push) : lecture de `projects/*.json`, génération des pages statiques `p/*.html`, de `catalog.json`, `sitemap.xml`, `robots.txt` et `llms.txt`.
- **Dans GitHub Actions** (`.github/scripts/auto-catalog.mjs`, sur cron) : découverte des dépôts, lecture des README, appel IA, écriture de `projects/*.json` — puis commit/push géré par le workflow.

Voir `skills/orchestrator.md`, `skills/blog-writing.md` et `skills/seo-sitemaps.md` pour les règles exactes suivies par ces trois étapes.

## Dépannage

**Le cron ne semble jamais se déclencher** — comportement documenté de GitHub, pas un bug : après tout changement de planification, GitHub peut mettre 15 minutes à plus d'une heure à le "reconnaître", et le premier passage n'a lieu qu'au prochain horaire programmé après cette reconnaissance. Pour tester sans attendre : onglet **Actions → Auto-catalogue → Run workflow** (déclenchement manuel, indépendant du cron). Si ça ne produit rien non plus, c'est un vrai bug (secret/variable manquant) — vérifie les logs de ce run.

## Sécurité

- Le token GitHub et la clé du fournisseur IA (chemin manuel) restent en `localStorage`, envoyés uniquement à `api.github.com` et à l'API du fournisseur choisi. Côté automatisation, les valeurs sensibles (`AI_API_KEY`, `CATALOG_PAT`) sont chiffrées dans ce navigateur avec la vraie clé publique du dépôt (chiffrement scellé libsodium, via [TweetNaCl](https://github.com/dchest/tweetnacl-js)) avant tout envoi — GitHub est seul à pouvoir les déchiffrer, jamais exposées en clair sur le réseau ni dans les logs Actions.
- Un token classique fonctionne, mais un [token fine-grained](https://github.com/settings/tokens?type=beta) limité à ce seul dépôt réduit les dégâts en cas de fuite — l'app affiche un avertissement non bloquant si elle détecte un token à accès large, sans jamais forcer le choix.
- Tout contenu injecté dans le DOM passe par un échappement HTML systématique, avec [DOMPurify](https://github.com/cure53/DOMPurify) en filet de sécurité — un README malveillant ne peut pas faire exécuter de script dans le navigateur de l'admin.

## Limites connues de cette version

- `build.js` et `auto-catalog.mjs` ont été exécutés et testés localement (syntaxe validée, logique vérifiée contre un faux serveur GitHub/IA simulant plusieurs scénarios : dépôt neuf, dépôt existant, fork à exclure, projet déjà à jour, dépôt sans README).
- Le chiffrement scellé utilisé pour pousser les secrets Actions a été vérifié de bout en bout : chiffré avec le code réel de `github.js` (chargé comme de vraies balises `<script>`), puis déchiffré avec une bibliothèque indépendante (PyNaCl/libsodium) pour confirmer que le résultat est authentiquement déchiffrable — pas seulement "a l'air correct".
- Les appels réels à `api.github.com`, Groq et OpenRouter avec de vrais identifiants n'ont pas pu être testés en conditions réelles dans l'environnement où ce projet a été construit. La forme des requêtes suit la documentation de chaque fournisseur, mais teste le flux complet avec tes propres identifiants avant de t'y fier pour un vrai dépôt.
- Groq déprécie parfois des modèles sans préavis long : si `Récupérer les modèles` renvoie une erreur, vérifie d'abord que le modèle choisi est toujours actif.
