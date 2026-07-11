// app.js — orchestre tout ce qui se passe dans le navigateur : configuration, lecture/écriture
// GitHub, appel au fournisseur IA, rendu du catalogue public et du panneau d'administration.
// Le pré-rendu SEO (pages /p/*.html, sitemap.xml, robots.txt, llms.txt) est un moment
// d'exécution séparé : il tourne côté build (voir build.js), jamais ici.

import { getFile, putFile, saveToken, getToken, clearToken, detectTokenScope } from './github.js';
import { PROVIDERS, fetchModels, generateContent, parseJsonResponse } from './providers.js';
import { buildBlogWritingPrompt } from './skills.js';

const CONFIG_KEY = 'devlog_config';
const root = document.getElementById('app');

// ---------- Config locale (tout reste dans ce navigateur) ----------

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function isConfigComplete(cfg) {
  return Boolean(cfg.owner && cfg.repo && cfg.provider && cfg.apiKey && cfg.model);
}

// ---------- Petits utilitaires ----------

function slugify(str) {
  return String(str).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shortCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(7, '0').slice(0, 7);
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function renderBodyHtml(text) {
  const paragraphs = String(text || '').split(/\n\s*\n/).filter((p) => p.trim());
  const html = paragraphs.map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
  return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
}

// ---------- État ----------

const state = {
  config: loadConfig(),
  token: getToken(),
  catalog: [],
  showAdmin: false,
  availableModels: [],
  message: null, // { text, kind: 'info' | 'success' | 'warn' | 'error' }
  scopeWarning: null,
  busy: false,
  draftTarget: '', // valeur non soumise du champ "dépôt à cataloguer", préservée entre deux rendus
  lastGenerated: null, // aperçu du dernier projet écrit, affiché tant que l'admin ne l'a pas fermé
};

function setMessage(text, kind = 'info') {
  state.message = text ? { text, kind } : null;
  render();
}

// ---------- Cooldown (garde-fou de fréquence, 100% côté navigateur) ----------

async function checkCooldown() {
  const { owner, repo, cooldownHours } = state.config;
  const existing = await getFile(owner, repo, 'state.json', state.token).catch(() => null);
  let data = {};
  if (existing && !Array.isArray(existing)) {
    try { data = JSON.parse(existing.content); } catch { data = {}; }
  }
  const hours = Number(cooldownHours) || 0;
  if (!data.lastRun || hours <= 0) return { ok: true };
  const elapsedHours = (Date.now() - new Date(data.lastRun).getTime()) / 3_600_000;
  if (elapsedHours < hours) {
    return { ok: false, waitHours: Math.max(1, Math.ceil(hours - elapsedHours)) };
  }
  return { ok: true };
}

async function updateStateAfterRun() {
  const { owner, repo, cooldownHours } = state.config;
  const existing = await getFile(owner, repo, 'state.json', state.token).catch(() => null);
  let data = {};
  if (existing && !Array.isArray(existing)) {
    try { data = JSON.parse(existing.content); } catch { data = {}; }
  }
  data.lastRun = new Date().toISOString();
  data.cooldownHours = Number(cooldownHours) || 0;
  await putFile(owner, repo, 'state.json', JSON.stringify(data, null, 2), 'chore: update state.json', state.token);
}

// ---------- Bootstrap ----------

async function init() {
  try {
    const res = await fetch('/catalog.json', { cache: 'no-store' });
    state.catalog = res.ok ? await res.json() : [];
  } catch {
    state.catalog = [];
  }
  render();
}

// ---------- Rendu ----------

function render() {
  root.innerHTML = `
    ${renderHeader()}
    ${state.message ? renderMessage() : ''}
    <main class="wrap">
      ${renderCatalog()}
      ${state.showAdmin ? renderAdmin() : ''}
    </main>
  `;
}

function renderHeader() {
  return `
    <header class="site-header">
      <div class="wrap site-header__inner">
        <span class="brand">devlog<span class="brand__dot">.</span></span>
        <button type="button" class="link-btn" data-action="toggle-admin">
          ${state.showAdmin ? 'Fermer l\u2019administration' : 'Administration'}
        </button>
      </div>
    </header>
  `;
}

function renderMessage() {
  const kind = state.message.kind;
  return `
    <div class="banner banner--${kind}" role="status" aria-live="polite">
      ${escapeHtml(state.message.text)}
    </div>
  `;
}

function renderCatalog() {
  if (!state.catalog.length) {
    return `
      <section class="empty">
        <p>Aucun projet catalogué pour l\u2019instant.</p>
        ${!state.showAdmin ? '<button type="button" class="link-btn" data-action="toggle-admin">Ouvrir l\u2019administration pour en ajouter un</button>' : ''}
      </section>
    `;
  }
  const sorted = [...state.catalog].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return `
    <section aria-label="Catalogue de projets">
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

function renderAdmin() {
  const cfg = state.config;
  const complete = isConfigComplete(cfg) && state.token;
  return `
    <section class="admin" aria-label="Administration">
      <h2 class="admin__title">Configuration</h2>
      ${renderConfigForm()}
      ${complete ? renderGenerateForm() : '<p class="hint">Renseigne un token, un dépôt, un fournisseur et une clé API pour débloquer l\u2019ajout de projets.</p>'}
      ${state.lastGenerated ? renderPreview(state.lastGenerated) : ''}
    </section>
  `;
}

function renderPreview(project) {
  return `
    <section class="preview" aria-label="Aperçu du dernier projet généré">
      <div class="preview__head">
        <h3 class="admin__title">Aperçu — dernière génération</h3>
        <button type="button" class="link-btn" data-action="close-preview">Fermer</button>
      </div>
      <h1 class="project-title">${escapeHtml(project.title)}</h1>
      ${project.hook ? `<p class="project-hook">${escapeHtml(project.hook)}</p>` : ''}
      <div class="project-body">${renderBodyHtml(project.body)}</div>
      ${project.tags && project.tags.length ? `<ul class="project-tags">${project.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      ${project.stack && project.stack.length ? `<ul class="project-stack">${project.stack.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
    </section>
  `;
}

function renderConfigForm() {
  const cfg = state.config;
  const providerOptions = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}" ${cfg.provider === id ? 'selected' : ''}>${p.label}</option>`)
    .join('');
  const modelOptions = state.availableModels
    .map((m) => `<option value="${m}" ${cfg.model === m ? 'selected' : ''}>${escapeHtml(m)}</option>`)
    .join('');

  return `
    <form data-form="config" class="form" novalidate>
      <label class="field">
        <span>Token GitHub</span>
        <input type="password" name="token" placeholder="ghp_... ou github_pat_..." value="${state.token ? '\u2022'.repeat(12) : ''}" autocomplete="off">
        <small class="field__hint">Classique ou fine-grained, au choix \u2014 stocké uniquement dans ce navigateur.</small>
      </label>
      ${state.scopeWarning ? `<p class="banner banner--warn">${escapeHtml(state.scopeWarning)}</p>` : ''}

      <div class="field-row">
        <label class="field">
          <span>Propriétaire du dépôt</span>
          <input type="text" name="owner" placeholder="ex. Tryboy869" value="${escapeHtml(cfg.owner || '')}">
        </label>
        <label class="field">
          <span>Dépôt (catalogue)</span>
          <input type="text" name="repo" placeholder="ex. devlog" value="${escapeHtml(cfg.repo || '')}">
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span>Fournisseur IA</span>
          <select name="provider">
            <option value="">\u2014</option>
            ${providerOptions}
          </select>
        </label>
        <label class="field">
          <span>Clé API</span>
          <input type="password" name="apiKey" placeholder="clé du fournisseur choisi" value="${escapeHtml(cfg.apiKey || '')}" autocomplete="off">
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span>Modèle</span>
          <div class="field-inline">
            <select name="model">
              <option value="">\u2014</option>
              ${modelOptions}
            </select>
            <button type="button" class="btn btn--ghost" data-action="fetch-models">Récupérer les modèles</button>
          </div>
        </label>
        <label class="field">
          <span>Délai minimum entre deux runs (heures)</span>
          <input type="number" name="cooldownHours" min="0" step="1" value="${cfg.cooldownHours ?? 0}">
        </label>
      </div>

      <div class="form__actions">
        <button type="submit" class="btn">Enregistrer la configuration</button>
        ${state.token ? '<button type="button" class="btn btn--ghost" data-action="clear-token">Oublier le token</button>' : ''}
      </div>
    </form>
  `;
}

function renderGenerateForm() {
  return `
    <form data-form="generate" class="form">
      <label class="field">
        <span>Dépôt à cataloguer</span>
        <input type="text" name="target" placeholder="proprietaire/depot" value="${escapeHtml(state.draftTarget)}" required>
        <small class="field__hint">Doit contenir un README.md lisible avec ce token.</small>
      </label>
      <div class="form__actions">
        <button type="submit" class="btn" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Génération en cours…' : 'Générer l\u2019entrée de catalogue'}</button>
      </div>
    </form>
  `;
}

// ---------- Actions ----------

async function handleFetchModels() {
  const form = root.querySelector('[data-form="config"]');
  const provider = form.provider.value;
  const apiKey = form.apiKey.value.trim();
  if (!provider || !apiKey) {
    setMessage('Choisis un fournisseur et renseigne une clé API avant de récupérer les modèles.', 'warn');
    return;
  }
  setMessage('Récupération des modèles…');
  try {
    state.availableModels = await fetchModels(provider, apiKey);
    setMessage(`${state.availableModels.length} modèle(s) récupéré(s).`, 'success');
  } catch (e) {
    setMessage(e.message, 'error');
  }
}

async function handleSaveConfigSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const tokenInput = form.token.value.trim();

  if (tokenInput && !tokenInput.startsWith('\u2022')) {
    saveToken(tokenInput);
    state.token = tokenInput;
    setMessage('Vérification du token…');
    const scope = await detectTokenScope(tokenInput);
    state.scopeWarning = scope.known && scope.broad
      ? 'Ce token a accès à tous tes dépôts (scope "repo" classique). Un token fine-grained limité à ce seul dépôt réduit les dégâts en cas de fuite \u2014 mais le choix reste le tien.'
      : null;
  }

  state.config = {
    owner: form.owner.value.trim(),
    repo: form.repo.value.trim(),
    provider: form.provider.value,
    apiKey: form.apiKey.value.trim(),
    model: form.model.value,
    cooldownHours: Number(form.cooldownHours.value) || 0,
  };
  saveConfig(state.config);
  setMessage('Configuration enregistrée.', 'success');
}

async function handleClearToken() {
  clearToken();
  state.token = '';
  state.scopeWarning = null;
  render();
}

async function handleGenerateSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  const target = e.target.target.value.trim();
  state.draftTarget = '';
  const [targetOwner, targetRepo] = target.split('/').map((s) => s && s.trim());

  if (!targetOwner || !targetRepo) {
    setMessage('Format attendu : proprietaire/depot', 'error');
    return;
  }

  state.busy = true;
  render();

  try {
    setMessage('Vérification du délai minimum…');
    const cooldown = await checkCooldown();
    if (!cooldown.ok) {
      setMessage(`Trop tôt : réessaie dans environ ${cooldown.waitHours}h.`, 'warn');
      return;
    }

    setMessage(`Lecture du README de ${targetOwner}/${targetRepo}…`);
    const readmeFile = await getFile(targetOwner, targetRepo, 'README.md', state.token);
    if (!readmeFile || Array.isArray(readmeFile)) {
      setMessage(`Aucun README.md trouvé sur ${targetOwner}/${targetRepo}.`, 'error');
      return;
    }

    setMessage('Génération du contenu par l\u2019IA…');
    const { systemPrompt, userPrompt } = await buildBlogWritingPrompt(
      readmeFile.content,
      `https://github.com/${targetOwner}/${targetRepo}`
    );
    const raw = await generateContent(
      state.config.provider, state.config.apiKey, state.config.model, systemPrompt, userPrompt
    );
    const parsed = parseJsonResponse(raw);

    const slug = slugify(targetRepo);
    const now = new Date().toISOString();
    const existingProjectFile = await getFile(state.config.owner, state.config.repo, `projects/${slug}.json`, state.token).catch(() => null);
    let createdAt = now;
    if (existingProjectFile && !Array.isArray(existingProjectFile)) {
      try { createdAt = JSON.parse(existingProjectFile.content).createdAt || now; } catch { /* garde now */ }
    }

    const project = {
      slug,
      title: parsed.title || targetRepo,
      hook: parsed.hook || '',
      description: parsed.description || '',
      body: parsed.body || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      stack: Array.isArray(parsed.stack) ? parsed.stack : [],
      repoUrl: `https://github.com/${targetOwner}/${targetRepo}`,
      createdAt,
      updatedAt: now,
    };

    setMessage('Écriture sur GitHub…');
    await putFile(
      state.config.owner, state.config.repo, `projects/${slug}.json`,
      JSON.stringify(project, null, 2),
      `feat: ajoute/actualise ${slug}`,
      state.token
    );
    await updateStateAfterRun();

    state.catalog = state.catalog.filter((p) => p.slug !== slug).concat(project);
    state.lastGenerated = project;
    setMessage(`"${project.title}" écrit dans /projects/${slug}.json. Le prochain build régénérera le catalogue et les pages SEO.`, 'success');
  } catch (err) {
    setMessage(err.message || String(err), 'error');
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- Délégation d'événements (survit aux re-rendus) ----------

// Synchronise en continu les champs non encore soumis vers l'état, pour qu'un re-rendu
// déclenché par une autre action (ex. clic sur "Récupérer les modèles") ne fasse jamais
// disparaître ce que l'admin est en train de taper ailleurs sur la page.
root.addEventListener('input', (e) => {
  const configForm = e.target.closest('[data-form="config"]');
  if (configForm && e.target.name !== 'token') {
    state.config = {
      ...state.config,
      owner: configForm.owner.value,
      repo: configForm.repo.value,
      provider: configForm.provider.value,
      apiKey: configForm.apiKey.value,
      model: configForm.model.value,
      cooldownHours: Number(configForm.cooldownHours.value) || 0,
    };
    return;
  }
  const generateForm = e.target.closest('[data-form="generate"]');
  if (generateForm) {
    state.draftTarget = generateForm.target.value;
  }
});

root.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'toggle-admin') {
    state.showAdmin = !state.showAdmin;
    render();
  } else if (action === 'fetch-models') {
    handleFetchModels();
  } else if (action === 'clear-token') {
    handleClearToken();
  } else if (action === 'close-preview') {
    state.lastGenerated = null;
    render();
  }
});

root.addEventListener('submit', (e) => {
  const formType = e.target.dataset && e.target.dataset.form;
  if (formType === 'config') handleSaveConfigSubmit(e);
  if (formType === 'generate') handleGenerateSubmit(e);
});

document.addEventListener('DOMContentLoaded', init);
