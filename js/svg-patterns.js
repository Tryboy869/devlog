// svg-patterns.js — génère un petit visuel SVG animé à partir d'un descripteur court
// ({ pattern, colors, caption }) plutôt que de faire écrire un balisage SVG complet par le
// modèle. Avant ce module, le contrat demandait au modèle d'embarquer un SVG entier (avec
// bloc <style>, @keyframes, @media) comme valeur d'une chaîne JSON — un vrai terrain miné
// pour l'échappement JSON avec un petit modèle (guillemets, deux-points, accolades à
// échapper correctement). Ici, le modèle choisit juste dans une liste fermée ; le balisage
// est produit par ce code, déterministe et déjà sûr par construction (pas de sanitisation
// a posteriori nécessaire pour ce chemin, mais gardée en défense ailleurs pour compatibilité
// avec d'anciennes entrées générées sous l'ancien contrat).

const COLOR_VARS = {
  brass: 'var(--brass)',
  sage: 'var(--sage)',
  'dusty-rose': 'var(--dusty-rose)',
};

export const ALLOWED_PATTERNS = ['pulse-dots', 'bars', 'grid'];
export const ALLOWED_COLORS = Object.keys(COLOR_VARS);

function resolveColors(colors) {
  const valid = (Array.isArray(colors) ? colors : [])
    .filter((c) => ALLOWED_COLORS.includes(c));
  return valid.length ? valid : ['brass', 'sage', 'dusty-rose'];
}

function pulseDotsSvg(colors) {
  const n = 4;
  const spacing = 240 / (n + 1);
  const dots = Array.from({ length: n }, (_, i) => {
    const color = COLOR_VARS[colors[i % colors.length]];
    const cx = Math.round(spacing * (i + 1));
    const delay = (i * 0.3).toFixed(1);
    return `<circle class="d" cx="${cx}" cy="40" r="7" fill="${color}" style="animation-delay:${delay}s"/>`;
  }).join('');
  return `<svg viewBox="0 0 240 80" role="img" aria-hidden="true"><style>.d{animation:pulse 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center;}@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}@media (prefers-reduced-motion: reduce){.d{animation:none;opacity:.8}}</style>${dots}</svg>`;
}

function barsSvg(colors) {
  const heights = [24, 40, 30, 48, 20];
  const bars = heights.map((h, i) => {
    const color = COLOR_VARS[colors[i % colors.length]];
    const x = 20 + i * 42;
    const y = 60 - h;
    const delay = (i * 0.15).toFixed(2);
    return `<rect class="b" x="${x}" y="${y}" width="24" height="${h}" rx="3" fill="${color}" style="animation-delay:${delay}s"/>`;
  }).join('');
  return `<svg viewBox="0 0 240 80" role="img" aria-hidden="true"><style>.b{animation:grow 2s ease-in-out infinite;transform-box:fill-box;transform-origin:bottom;}@keyframes grow{0%,100%{transform:scaleY(.7)}50%{transform:scaleY(1)}}@media (prefers-reduced-motion: reduce){.b{animation:none}}</style>${bars}</svg>`;
}

function gridSvg(colors) {
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const color = COLOR_VARS[colors[(row + col) % colors.length]];
      const delay = ((row * 6 + col) * 0.08).toFixed(2);
      cells.push(`<rect class="c" x="${col * 40 + 4}" y="${row * 24 + 4}" width="32" height="16" rx="2" fill="${color}" style="animation-delay:${delay}s"/>`);
    }
  }
  return `<svg viewBox="0 0 240 76" role="img" aria-hidden="true"><style>.c{animation:blink 3s ease-in-out infinite;}@keyframes blink{0%,100%{opacity:.25}50%{opacity:.9}}@media (prefers-reduced-motion: reduce){.c{animation:none;opacity:.6}}</style>${cells.join('')}</svg>`;
}

const RENDERERS = {
  'pulse-dots': pulseDotsSvg,
  bars: barsSvg,
  grid: gridSvg,
};

/**
 * Valide/nettoie un champ `media` renvoyé par le modèle avant stockage. Ne fait pas
 * confiance aux valeurs reçues : un `pattern`/`colors` hors de la liste connue retombe sur
 * un descripteur sûr plutôt que d'être stocké tel quel. `svg` brut (ancien contrat) est
 * laissé passer tel quel ici — sa sanitisation a lieu au moment du rendu (voir app.js/build.js),
 * pas au moment du stockage, pour rester cohérent avec le comportement déjà en place.
 */
export function sanitizeMediaField(media) {
  if (!media || typeof media !== 'object' || !media.kind) return { kind: 'none' };
  if (media.kind === 'image' && media.url) {
    return { kind: 'image', url: String(media.url), caption: media.caption ? String(media.caption) : '' };
  }
  if (media.kind === 'youtube' && media.youtubeId) {
    return { kind: 'youtube', youtubeId: String(media.youtubeId).replace(/[^\w-]/g, ''), caption: media.caption ? String(media.caption) : '' };
  }
  if (media.kind === 'generated-svg') {
    if (media.pattern) {
      return {
        kind: 'generated-svg',
        pattern: ALLOWED_PATTERNS.includes(media.pattern) ? media.pattern : 'pulse-dots',
        colors: (Array.isArray(media.colors) ? media.colors : []).filter((c) => ALLOWED_COLORS.includes(c)),
        caption: media.caption ? String(media.caption) : '',
      };
    }
    if (media.svg) {
      return { kind: 'generated-svg', svg: String(media.svg), caption: media.caption ? String(media.caption) : '' };
    }
  }
  return { kind: 'none' };
}

/**
 * Rend un descripteur { pattern, colors } en balisage SVG sûr. `pattern` hors de la liste
 * connue retombe sur 'pulse-dots' plutôt que d'échouer silencieusement.
 */
export function renderPatternSvg({ pattern, colors } = {}) {
  const renderer = RENDERERS[pattern] || RENDERERS['pulse-dots'];
  return renderer(resolveColors(colors));
}
