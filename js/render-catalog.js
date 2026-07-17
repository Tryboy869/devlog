// render-catalog.js — rendu du hero et de la liste de catalogue, en fonctions pures
// partagées entre le navigateur (js/app.js, pour le rendu dynamique) et le build
// (build.js, pour pré-rendre la page racine afin qu'elle soit visible aux robots et
// aux aperçus de liens qui n'exécutent pas de JavaScript).

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function shortCode(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(7, '0').slice(0, 7);
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function renderHeroSection(catalog) {
  const count = catalog.length;
  const latest = catalog.reduce((acc, p) => (p.updatedAt && p.updatedAt > acc ? p.updatedAt : acc), '');
  return `
    <section id="accueil" class="hero">
      <div class="wrap hero__inner">
        <div>
          <p class="hero__kicker">Carnet de build</p>
          <h1 class="hero__title">Un catalogue de projets qui s\u2019écrit tout seul.</h1>
          <p class="hero__lead">Chaque entrée est générée à partir du README du dépôt correspondant. Une fois configuré, plus besoin d\u2019y retoucher à la main.</p>
          <div class="hero__stats">
            <div>
              <span class="hero__stat-value">${count}</span>
              <span class="hero__stat-label">${count > 1 ? 'projets' : 'projet'}</span>
            </div>
            ${latest ? `
            <div>
              <span class="hero__stat-value">${formatDate(latest)}</span>
              <span class="hero__stat-label">dernière mise à jour</span>
            </div>` : ''}
          </div>
          <div class="hero__actions">
            <a href="#projets" class="btn btn--ghost">Voir les projets \u2193</a>
          </div>
        </div>
        <div class="hero__glyph" aria-hidden="true">
          ${['brass', 'sage', 'dusty-rose'].map((color) => `
          <div class="hero__glyph-row">
            <span class="hero__glyph-dot" style="background:var(--${color})"></span>
            <div class="hero__glyph-bars">
              <span class="hero__glyph-bar hero__glyph-bar--wide"></span>
              <span class="hero__glyph-bar hero__glyph-bar--mid"></span>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </section>
  `;
}

export function renderCatalogSection(catalog, showAdminLink) {
  if (!catalog.length) {
    return `
      <section id="projets" class="empty">
        <p>Aucun projet catalogué pour l\u2019instant.</p>
        ${showAdminLink ? '<a class="link-btn" href="#administration" data-action="open-admin-nav">Ouvrir l\u2019administration pour en ajouter un</a>' : ''}
      </section>
    `;
  }
  const sorted = [...catalog].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return `
    <section id="projets" aria-label="Catalogue de projets">
      <ol class="log">
        ${sorted.map((p) => `
          <li class="log-entry">
            <span class="log-dot" aria-hidden="true"></span>
            <div class="log-meta">
              <span class="log-code">${shortCode(p.slug || p.title || '')}</span>
              <time datetime="${escapeHtml(p.updatedAt || '')}">${formatDate(p.updatedAt)}</time>
            </div>
            <h2 class="log-title"><a href="/p/${encodeURIComponent(p.slug)}.html">${escapeHtml(p.title || p.slug)}</a></h2>
            <p class="log-hook">${escapeHtml(p.hook || p.description || '')}</p>
            ${p.tags && p.tags.length ? `<ul class="log-tags">${p.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
          </li>
        `).join('')}
      </ol>
    </section>
  `;
}

export function renderContributeSection(repoUrl) {
  return `
    <section id="contribuer" class="contribute">
      <div class="wrap">
        <h2 class="admin__title">Contribuer</h2>
        <p>Ce site est généré par un outil open source : une idée, un bug, une amélioration à proposer ?</p>
        ${repoUrl
          ? `<a class="btn" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener">Voir le dépôt sur GitHub \u2197</a>`
          : '<p class="hint">Lien du dépôt non configuré (variable SITE_REPO absente du build).</p>'}
      </div>
    </section>
  `;
}
