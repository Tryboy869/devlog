# Skill : fichiers de découvrabilité

Ce skill documente les règles exactes que suit `build.js` pour générer `robots.txt`, `sitemap.xml` et `llms.txt` à chaque build. Ces trois fichiers sont produits mécaniquement à partir des fichiers `/projects/*.json` déjà rédigés par le skill `blog-writing.md` — il n'y a pas de nouvel appel IA à faire ici, seulement une transformation de données fidèle à ces règles. Ce document sert de référence si la génération doit un jour être refaite à la main ou par un modèle.

## robots.txt — moteurs de recherche classiques

Contrôle l'accès des crawlers. Autorise tout, pointe vers le sitemap :

```
User-agent: *
Allow: /

Sitemap: {SITE_URL}/sitemap.xml
```

## sitemap.xml — moteurs de recherche classiques

Format XML standard du protocole sitemap. Une entrée `<url>` par page réelle (la racine + une par page de projet générée dans `/p/`) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{SITE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>{SITE_URL}/p/{slug}.html</loc>
    <lastmod>{updatedAt en ISO 8601}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
```

N'inclut jamais une URL qui ne correspond pas à un fichier réellement généré. Ne liste jamais de doublon.

## llms.txt — agents et modèles de langage

Ne remplace ni robots.txt ni sitemap.xml, ne les duplique pas non plus (pas question d'y lister chaque page avec les mêmes métadonnées que le sitemap). Sert un public différent : les agents qui font de la récupération de documentation en direct. Quatre éléments, dans cet ordre exact, en Markdown :

1. **Titre H1** en tout premier élément du fichier — nom du catalogue.
2. **Citation en bloc** (`>`), une à trois phrases : ce que couvre le site et à qui il s'adresse. Jamais de superlatif marketing.
3. **Sections thématiques** (`##`) groupant les projets par tag dominant plutôt qu'une liste plate.
4. **Liens annotés**, un par projet, avec une vraie description utile — jamais "cliquez ici" ou "en savoir plus". Réutilise directement le champ `description` déjà rédigé pour ce projet plutôt que d'en inventer une nouvelle.

```markdown
# {Nom du catalogue}

> {1 à 3 phrases : ce que couvre ce catalogue et pour qui}

## {Tag dominant}

- [{title}]({SITE_URL}/p/{slug}.html): {description}
```

Limites à respecter : pas de section qui liste plus d'une vingtaine de liens sans sous-découpage, pas de version `llms-full.txt` avec le contenu intégral tant que le nombre de projets reste gérable en un seul fichier `llms.txt` — au-delà, préférer garder un index qui pointe vers les pages plutôt qu'un fichier qui grossit indéfiniment.
