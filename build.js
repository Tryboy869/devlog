#!/usr/bin/env node
// build.js — étape de build Vercel, déclenchée à chaque push (voir seo-sitemaps.md pour les
// règles exactes suivies ici). Ne fait aucun appel réseau, ne lit aucun secret : uniquement
// les fichiers /projects/*.json déjà commités par le navigateur du propriétaire.
// C'est ce script qui règle à la fois la découvrabilité (Google, sitemaps, llms.txt) et le
// problème de 404 au rechargement d'un lien profond, puisqu'il produit de vraies pages statiques.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PROJECTS_DIR = path.join(ROOT, 'projects');
const PAGES_DIR = path.join(ROOT, 'p');
// SITE_URL et SITE_REPO se déduisent automatiquement des variables système que Vercel
// fournit déjà tout seul (aucune saisie manuelle requise) : il suffit d'avoir coché
// "Enable access to System Environment Variables" une fois dans Settings → Environment
// Variables sur Vercel. On garde SITE_URL/SITE_REPO en override manuel si jamais besoin
// (domaine personnalisé non reflété par Vercel, dépôt renommé, etc.).
const AUTO_SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : null;
const AUTO_SITE_REPO = (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG)
  ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
  : null;

const SITE_URL = (process.env.SITE_URL || AUTO_SITE_URL || 'https://example.vercel.app').replace(/\/$/, '');
const SITE_REPO = process.env.SITE_REPO || AUTO_SITE_REPO || ''; // "Tryboy869/devlog" — section Contribuer

if (!process.env.SITE_URL && !AUTO_SITE_URL) {
  console.warn('[build] SITE_URL non détecté automatiquement — active "System Environment Variables" dans les réglages Vercel, ou force SITE_URL manuellement.');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Empêche un </script> présent dans les données de casser la balise JSON-LD.
function jsonLdSafe(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function loadProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8');
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.warn(`[build] ${f} ignoré (JSON invalide) : ${e.message}`);
        return null;
      }
    })
    .filter((p) => p && p.slug);
}

function bodyToHtml(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');
}

function renderProjectPage(project) {
  const title = escapeHtml(project.title || project.slug);
  const description = escapeHtml(project.description || project.hook || '');
  const url = `${SITE_URL}/p/${project.slug}.html`;
  const ldJson = jsonLdSafe({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title || project.slug,
    description: project.description || project.hook || '',
    dateCreated: project.createdAt,
    dateModified: project.updatedAt,
    url,
    codeRepository: project.repoUrl,
    keywords: (project.tags || []).join(', '),
  });

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — DevLog</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <link rel="stylesheet" href="/css/style.css">
  <script type="application/ld+json">${ldJson}</script>
</head>
<body>
  <header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="/">devlog<span class="brand__dot">.</span></a>
    </div>
  </header>
  <main class="wrap project-page">
    <a class="project-back" href="/">&larr; retour au catalogue</a>
    <h1 class="project-title">${title}</h1>
    ${project.hook ? `<p class="project-hook">${escapeHtml(project.hook)}</p>` : ''}
    <div class="project-body">${bodyToHtml(project.body)}</div>
    ${project.tags && project.tags.length ? `<ul class="project-tags">${project.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
    ${project.stack && project.stack.length ? `<ul class="project-stack">${project.stack.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
    <p class="project-meta">
      ${project.repoUrl ? `Dépôt source : <a href="${escapeHtml(project.repoUrl)}">${escapeHtml(project.repoUrl)}</a><br>` : ''}
      Mis à jour le ${escapeHtml((project.updatedAt || '').slice(0, 10))}
    </p>
  </main>
</body>
</html>
`;
}

function buildCatalogJson(projects) {
  return {
    siteRepo: SITE_REPO ? `https://github.com/${SITE_REPO.replace(/^https?:\/\/github\.com\//i, '')}` : null,
    projects: projects.map((p) => ({
      slug: p.slug,
      title: p.title,
      hook: p.hook,
      description: p.description,
      tags: p.tags || [],
      updatedAt: p.updatedAt,
    })),
  };
}

function buildSitemap(projects) {
  const urls = [
    `  <url>\n    <loc>${SITE_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ...projects.map((p) => `  <url>\n    <loc>${SITE_URL}/p/${p.slug}.html</loc>\n    <lastmod>${escapeHtml((p.updatedAt || '').slice(0, 10))}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function buildRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function groupByDominantTag(projects) {
  const groups = new Map();
  for (const p of projects) {
    const tag = (p.tags && p.tags[0]) || 'projets';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(p);
  }
  return groups;
}

function buildLlmsTxt(projects) {
  const lines = [
    '# DevLog',
    '',
    '> Catalogue de projets développeur, généré à partir de leurs README. Utile pour retrouver ce que fait chaque projet, sa stack et son dépôt source.',
    '',
  ];
  const groups = groupByDominantTag(projects);
  for (const [tag, list] of groups) {
    lines.push(`## ${tag}`, '');
    for (const p of list) {
      lines.push(`- [${p.title}](${SITE_URL}/p/${p.slug}.html): ${p.description || p.hook || ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const projects = loadProjects();
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  for (const project of projects) {
    fs.writeFileSync(path.join(PAGES_DIR, `${project.slug}.html`), renderProjectPage(project), 'utf8');
  }

  fs.writeFileSync(path.join(ROOT, 'catalog.json'), JSON.stringify(buildCatalogJson(projects), null, 2), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), buildSitemap(projects), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), buildRobots(), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), buildLlmsTxt(projects), 'utf8');

  console.log(`[build] ${projects.length} projet(s) — pages, catalog.json, sitemap.xml, robots.txt, llms.txt régénérés.`);
}

main();
