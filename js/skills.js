// skills.js — Charge les fichiers SKILL.md (servis comme fichiers statiques par le même
// déploiement) et assemble le prompt système. robots.txt/sitemap.xml/llms.txt ne passent
// jamais par ici : ils sont générés de façon déterministe par build.js (voir seo-sitemaps.md).

import { extractMediaCandidates, formatMediaCandidatesForPrompt } from './media.js';

const SKILL_PATHS = {
  orchestrator: '/skills/orchestrator.md',
  blogWriting: '/skills/blog-writing.md',
  articleWriting: '/skills/article-writing.md',
};

const cache = {};

async function loadSkill(key) {
  if (cache[key]) return cache[key];
  const res = await fetch(SKILL_PATHS[key]);
  if (!res.ok) throw new Error(`Impossible de charger le skill "${key}" (${res.status}).`);
  const text = await res.text();
  cache[key] = text;
  return text;
}

export async function buildBlogWritingPrompt(readmeContent, repoUrl) {
  const [orchestrator, blogWriting] = await Promise.all([
    loadSkill('orchestrator'),
    loadSkill('blogWriting'),
  ]);
  const systemPrompt = `${orchestrator}\n\n---\n\n${blogWriting}`;
  const mediaCandidates = extractMediaCandidates(readmeContent);
  const userPrompt = [
    `Dépôt source : ${repoUrl}`,
    '',
    'Contenu du README à transformer :',
    '',
    readmeContent,
    '',
    '---',
    '',
    'Candidats visuels détectés automatiquement (voir section "Détection de visuel") :',
    formatMediaCandidatesForPrompt(mediaCandidates),
  ].join('\n');
  return { systemPrompt, userPrompt };
}

export async function buildArticleWritingPrompt(title, notes, series) {
  const [orchestrator, articleWriting] = await Promise.all([
    loadSkill('orchestrator'),
    loadSkill('articleWriting'),
  ]);
  const systemPrompt = `${orchestrator}\n\n---\n\n${articleWriting}`;
  const userPrompt = [
    `Titre proposé par l'admin : ${title}`,
    series && series.name ? `Série : "${series.name}", partie ${series.part || '?'}${series.total ? ` sur ${series.total}` : ''}` : 'Pas de série.',
    '',
    "Notes / plan fournis par l'admin à structurer et développer :",
    '',
    notes,
  ].join('\n');
  return { systemPrompt, userPrompt };
}
