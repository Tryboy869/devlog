#!/usr/bin/env node
// auto-catalog.mjs — tourne dans GitHub Actions (cron), PAS dans un navigateur.
// Découvre automatiquement les dépôts publics du compte, catalogue ceux qui sont
// nouveaux ou qui ont été poussés plus récemment que leur dernière entrée, écrit
// les fichiers projects/*.json sur le disque. C'est le workflow (auto-catalog.yml)
// qui commit et push ensuite via git — ce script ne fait que lire l'API GitHub et
// écrire des fichiers locaux, jamais d'appel à l'API Contents/Git Data.

import fs from 'node:fs';
import path from 'node:path';
import { extractMediaCandidates, formatMediaCandidatesForPrompt } from '../../js/media.js';
import { sanitizeGeneratedSvg } from '../../js/svg-sanitize.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CATALOG_OWNER = process.env.CATALOG_OWNER;
const CATALOG_REPO = process.env.CATALOG_REPO || '';
const AI_PROVIDER = process.env.AI_PROVIDER;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL;
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 5);
const INCLUDE_FORKS = process.env.INCLUDE_FORKS === 'true';

const GH_API = 'https://api.github.com';
const PROVIDERS = {
  groq: { base: 'https://api.groq.com/openai/v1' },
  openrouter: { base: 'https://openrouter.ai/api/v1' },
};

function requireEnv() {
  const missing = [];
  if (!GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!CATALOG_OWNER) missing.push('CATALOG_OWNER');
  if (!AI_PROVIDER) missing.push('AI_PROVIDER');
  if (!AI_API_KEY) missing.push('AI_API_KEY');
  if (!AI_MODEL) missing.push('AI_MODEL');
  if (missing.length) {
    console.error(`[auto-catalog] variables manquantes : ${missing.join(', ')} — configure les secrets/variables du dépôt (voir README.md).`);
    process.exit(1);
  }
  if (!PROVIDERS[AI_PROVIDER]) {
    console.error(`[auto-catalog] AI_PROVIDER inconnu : "${AI_PROVIDER}" (attendu : groq ou openrouter).`);
    process.exit(1);
  }
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function slugify(str) {
  return String(str).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

async function listOwnedRepos(owner) {
  const repos = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${GH_API}/users/${owner}/repos?per_page=100&page=${page}&type=owner&sort=pushed`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`Impossible de lister les dépôts de ${owner} (${res.status})`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos.filter((r) => (INCLUDE_FORKS || !r.fork) && r.name.toLowerCase() !== CATALOG_REPO.toLowerCase());
}

function loadExistingProject(slug) {
  const file = path.join('projects', `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchReadme(owner, repo) {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/readme`, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lecture du README de ${owner}/${repo} échouée (${res.status})`);
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

function loadSkillsPrompt() {
  const orchestrator = fs.readFileSync(path.join('skills', 'orchestrator.md'), 'utf8');
  const blogWriting = fs.readFileSync(path.join('skills', 'blog-writing.md'), 'utf8');
  return `${orchestrator}\n\n---\n\n${blogWriting}`;
}

function parseJsonResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function sanitizeMediaField(media) {
  if (!media || typeof media !== 'object' || !media.kind) return { kind: 'none' };
  if (media.kind === 'generated-svg') {
    const safeSvg = sanitizeGeneratedSvg(media.svg);
    return safeSvg ? { kind: 'generated-svg', svg: safeSvg, caption: media.caption || '' } : { kind: 'none' };
  }
  if (media.kind === 'image' && media.url) {
    return { kind: 'image', url: String(media.url), caption: media.caption || '' };
  }
  if (media.kind === 'youtube' && media.youtubeId) {
    return { kind: 'youtube', youtubeId: String(media.youtubeId).replace(/[^\w-]/g, ''), caption: media.caption || '' };
  }
  return { kind: 'none' };
}

async function generateContent(systemPrompt, userPrompt) {
  const provider = PROVIDERS[AI_PROVIDER];
  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Erreur ${AI_PROVIDER} (${res.status}) : ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!text) throw new Error(`Réponse vide de ${AI_PROVIDER}.`);
  return text;
}

async function main() {
  requireEnv();
  console.log(`[auto-catalog] découverte des dépôts publics de ${CATALOG_OWNER}...`);
  const repos = await listOwnedRepos(CATALOG_OWNER);
  console.log(`[auto-catalog] ${repos.length} dépôt(s) candidat(s) (hors forks et hors ${CATALOG_REPO || 'ce dépôt'}).`);

  const candidates = repos.filter((repo) => {
    const existing = loadExistingProject(slugify(repo.name));
    return !existing || new Date(repo.pushed_at) > new Date(existing.updatedAt || 0);
  });
  console.log(`[auto-catalog] ${candidates.length} dépôt(s) à (re)cataloguer.`);

  const toProcess = candidates.slice(0, MAX_PER_RUN);
  if (candidates.length > toProcess.length) {
    console.log(`[auto-catalog] ${candidates.length - toProcess.length} en attente pour un prochain passage (MAX_PER_RUN=${MAX_PER_RUN}).`);
  }

  if (!toProcess.length) {
    console.log('[auto-catalog] rien à faire, tout est déjà à jour.');
    return;
  }

  const systemPrompt = loadSkillsPrompt();
  fs.mkdirSync('projects', { recursive: true });

  let written = 0;
  for (const repo of toProcess) {
    const slug = slugify(repo.name);
    console.log(`[auto-catalog] ${repo.full_name}...`);

    const readme = await fetchReadme(repo.owner.login, repo.name);
    if (!readme) {
      console.log('  ! pas de README.md, ignoré.');
      continue;
    }

    try {
      const userPrompt = [
        `Dépôt source : ${repo.html_url}`,
        '',
        'Contenu du README à transformer :',
        '',
        readme,
        '',
        '---',
        '',
        'Candidats visuels détectés automatiquement (voir section "Détection de visuel") :',
        formatMediaCandidatesForPrompt(extractMediaCandidates(readme)),
      ].join('\n');
      const raw = await generateContent(systemPrompt, userPrompt);
      const parsed = parseJsonResponse(raw);
      const existing = loadExistingProject(slug);
      const now = new Date().toISOString();

      const project = {
        slug,
        title: parsed.title || repo.name,
        hook: parsed.hook || '',
        description: parsed.description || '',
        body: parsed.body || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        stack: Array.isArray(parsed.stack) ? parsed.stack : [],
        media: sanitizeMediaField(parsed.media),
        repoUrl: repo.html_url,
        createdAt: (existing && existing.createdAt) || now,
        updatedAt: now,
      };

      fs.writeFileSync(path.join('projects', `${slug}.json`), JSON.stringify(project, null, 2), 'utf8');
      written += 1;
      console.log(`  → projects/${slug}.json écrit.`);
    } catch (err) {
      console.error(`  ✗ ${repo.full_name} : ${err.message}`);
    }
  }

  console.log(`[auto-catalog] terminé — ${written} fichier(s) écrit(s) ou mis à jour.`);
}

main().catch((err) => {
  console.error('[auto-catalog] erreur fatale :', err);
  process.exit(1);
});
