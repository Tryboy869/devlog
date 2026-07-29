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
import { fitToContextWindow, DEFAULT_CONTEXT_WINDOW } from '../../js/context-budget.js';
import { fetchModels, generateContent, generateStructuredContent } from '../../js/providers.js';
import { sanitizeMediaField } from '../../js/svg-patterns.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CATALOG_OWNER = process.env.CATALOG_OWNER;
const CATALOG_REPO = process.env.CATALOG_REPO || '';
const AI_PROVIDER = process.env.AI_PROVIDER;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL;
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 5);
const INCLUDE_FORKS = process.env.INCLUDE_FORKS === 'true';

const GH_API = 'https://api.github.com';
const KNOWN_PROVIDERS = ['groq', 'openrouter'];

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
  if (!KNOWN_PROVIDERS.includes(AI_PROVIDER)) {
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

async function fetchModelContextWindow() {
  try {
    const models = await fetchModels(AI_PROVIDER, AI_API_KEY);
    const match = models.find((m) => m.id === AI_MODEL);
    return (match && match.contextWindow) || DEFAULT_CONTEXT_WINDOW;
  } catch {
    return DEFAULT_CONTEXT_WINDOW;
  }
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
  const contextWindow = await fetchModelContextWindow();
  console.log(`[auto-catalog] fenêtre de contexte pour ${AI_MODEL} : ${contextWindow} tokens.`);
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
      const callModelForCondense = (instruction, chunk) => generateContent(AI_PROVIDER, AI_API_KEY, AI_MODEL, instruction, chunk);
      const { text: fittedReadme, wasCondensed, passes } = await fitToContextWindow(readme, contextWindow, callModelForCondense);
      if (wasCondensed) {
        console.log(`  … README condensé en ${passes} passe(s) pour tenir dans la fenêtre de contexte.`);
      }

      const userPrompt = [
        `Dépôt source : ${repo.html_url}`,
        '',
        'Contenu du README à transformer :',
        '',
        fittedReadme,
        '',
        '---',
        '',
        'Candidats visuels détectés automatiquement (voir section "Détection de visuel") :',
        formatMediaCandidatesForPrompt(extractMediaCandidates(readme)),
      ].join('\n');
      const { data: parsed, repaired } = await generateStructuredContent(AI_PROVIDER, AI_API_KEY, AI_MODEL, systemPrompt, userPrompt);
      if (repaired) {
        console.log('  … réponse corrigée automatiquement (JSON initial invalide).');
      }
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
