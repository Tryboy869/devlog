// skills.js — Charge les fichiers SKILL.md (servis comme fichiers statiques par le même
// déploiement) et assemble le prompt système. robots.txt/sitemap.xml/llms.txt ne passent
// jamais par ici : ils sont générés de façon déterministe par build.js (voir seo-sitemaps.md).

const SKILL_PATHS = {
  orchestrator: '/skills/orchestrator.md',
  blogWriting: '/skills/blog-writing.md',
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
  const userPrompt = `Dépôt source : ${repoUrl}\n\nContenu du README à transformer :\n\n${readmeContent}`;
  return { systemPrompt, userPrompt };
}
