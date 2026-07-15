// media.js — extraction déterministe de candidats visuels depuis un README brut
// (images, GIFs, vidéos YouTube), en excluant les badges de statut. Partagé tel quel
// entre le navigateur (js/app.js) et l'automatisation (.github/scripts/auto-catalog.mjs) :
// aucune API spécifique à un environnement, uniquement du traitement de texte.

const BADGE_HOST_RE = /shields\.io|badgen\.net|badge\.fury\.io|img\.shields|visitor-badge|counter\.(dev|seva)|coveralls\.io\/repos|codecov\.io\/gh|travis-ci|github\.com\/[^/\s]+\/[^/\s]+\/(?:workflows|actions\/workflows)\/[^\s]*badge\.svg|badge\.svg(?:\?|$)/i;

function isLikelyBadge(url) {
  return BADGE_HOST_RE.test(url);
}

/**
 * Repère les images (Markdown + HTML) et liens YouTube dans un texte de README.
 * Retourne une liste ordonnée de candidats, sans doublons, badges de statut exclus.
 */
export function extractMediaCandidates(readmeContent, limit = 6) {
  const text = String(readmeContent || '');
  const found = [];
  const seen = new Set();

  const add = (item) => {
    const key = `${item.type}:${item.url || item.id}`;
    if (seen.has(key) || found.length >= limit) return;
    seen.add(key);
    found.push(item);
  };

  const mdImageRe = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = mdImageRe.exec(text))) {
    if (!isLikelyBadge(m[2])) add({ type: 'image', url: m[2], alt: m[1] || '' });
  }

  const htmlImgRe = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi;
  while ((m = htmlImgRe.exec(text))) {
    if (isLikelyBadge(m[1])) continue;
    const altMatch = /alt=["']([^"']*)["']/i.exec(m[0]);
    add({ type: 'image', url: m[1], alt: altMatch ? altMatch[1] : '' });
  }

  const ytRe = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/g;
  while ((m = ytRe.exec(text))) {
    add({ type: 'youtube', id: m[1] });
  }

  return found;
}

/**
 * Formate la liste de candidats en bloc de texte lisible à inclure dans le prompt IA.
 */
export function formatMediaCandidatesForPrompt(candidates) {
  if (!candidates.length) {
    return 'Aucun visuel exploitable détecté automatiquement dans ce README (hors badges de statut).';
  }
  return candidates
    .map((c, i) => (c.type === 'youtube'
      ? `${i + 1}. [vidéo YouTube] https://youtu.be/${c.id}`
      : `${i + 1}. [image] ${c.url}${c.alt ? ` (alt fourni : "${c.alt}")` : ''}`))
    .join('\n');
}
