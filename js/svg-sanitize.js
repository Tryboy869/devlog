// svg-sanitize.js — nettoyage minimal mais ciblé d'un SVG généré par l'IA avant de
// l'embarquer tel quel dans une page statique. Utilisé côté build.js et
// auto-catalog.mjs (environnement Node, sans DOM ni DOMPurify disponibles).
// Ne retire QUE les vecteurs d'exécution connus : balises <script>/<foreignObject>,
// attributs on*, et href pointant vers javascript:/data:.

export function sanitizeGeneratedSvg(input) {
  if (typeof input !== 'string') return '';
  let s = input.trim();

  // Doit être un fragment SVG autonome, sinon on rejette entièrement plutôt que de
  // deviner ce qu'on nous a donné.
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return '';

  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  s = s.replace(/@import\s+[^;]+;/gi, '');
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\s(?:xlink:)?href\s*=\s*"\s*(?:javascript|data):[^"]*"/gi, '');
  s = s.replace(/\s(?:xlink:)?href\s*=\s*'\s*(?:javascript|data):[^']*'/gi, '');

  return s;
}
