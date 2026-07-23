// app.js — orchestre tout ce qui se passe dans le navigateur : configuration, lecture/écriture
// GitHub, appel au fournisseur IA, rendu du site public (accueil, catalogue, contribution)
// et du panneau d'administration.
// Le pré-rendu SEO (pages /p/*.html, sitemap.xml, robots.txt, llms.txt) est un moment
// d'exécution séparé : il tourne côté build (voir build.js), jamais ici.

import { getFile, putFile, saveToken, getToken, clearToken, detectTokenScope, setActionsSecret, setActionsVariable } from './github.js';
import { PROVIDERS, fetchModels, generateContent, parseJsonResponse } from './providers.js';
import { buildBlogWritingPrompt, buildArticleWritingPrompt } from './skills.js';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@18.0.6/lib/marked.esm.js';
import { fitToContextWindow, DEFAULT_CONTEXT_WINDOW } from './context-budget.js';
import { escapeHtml, shortCode, formatDate, renderHeroSection, renderCatalogSection, renderArticlesSection, renderContributeSection } from './render-catalog.js';

marked.setOptions({ gfm: true, breaks: false });

const CONFIG_KEY = 'devlog_config';
const root = document.getElementById('app');

const CRON_PRESETS = {
  hourly: { label: 'Toutes les heures', cron: '0 * * * *' },
  daily: { label: 'Tous les jours à 6h', cron: '0 6 * * *' },
  weekly: { label: 'Chaque lundi à 6h', cron: '0 6 * * 1' },
};

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

function missingConfigFields(cfg, hasToken) {
  const missing = [];
  if (!hasToken) missing.push('token GitHub');
  if (!cfg.owner) missing.push('propriétaire du dépôt');
  if (!cfg.repo) missing.push('nom du dépôt');
  if (!cfg.provider) missing.push('fournisseur IA');
  if (!cfg.apiKey) missing.push('clé API');
  if (!cfg.model) missing.push('modèle (à récupérer puis choisir)');
  return missing;
}

// ---------- Petits utilitaires ----------

function slugify(str) {
  return String(str).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

function renderBodyHtml(text) {
  const html = marked.parse(String(text || ''));
  if (!window.DOMPurify) return html;
  return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true } });
}

function renderMediaHtml(media) {
  if (!media || media.kind === 'none' || !media.kind) return '';
  const caption = media.caption ? `<figcaption>${escapeHtml(media.caption)}</figcaption>` : '';

  if (media.kind === 'image' && media.url) {
    return `<figure class="project-media"><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.caption || '')}" loading="lazy" class="project-media-img">${caption}</figure>`;
  }
  if (media.kind === 'youtube' && media.youtubeId) {
    const id = String(media.youtubeId).replace(/[^\w-]/g, '');
    if (!id) return '';
    return `<figure class="project-media"><div class="project-media-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${escapeHtml(media.caption || 'Démonstration vidéo')}" loading="lazy" allow="picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>${caption}</figure>`;
  }
  if (media.kind === 'generated-svg' && media.svg) {
    const safeSvg = window.DOMPurify
      ? window.DOMPurify.sanitize(media.svg, { USE_PROFILES: { svg: true, svgFilters: true } })
      : '';
    if (!safeSvg) return '';
    return `<figure class="project-media project-media--svg"><div class="project-media-svg">${safeSvg}</div>${caption}</figure>`;
  }
  return '';
}

// Accepte "proprietaire/depot" ET une URL GitHub complète (avec ou sans protocole,
// www., .git, ou chemin supplémentaire type /tree/main) — corrige le format rigide
// d'origine qui n'acceptait que "proprietaire/depot".
function parseRepoInput(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (/^github\.com\//i.test(s)) {
    s = s.slice('github.com/'.length);
  }
  const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
}

// ---------- État ----------

const state = {
  config: loadConfig(),
  token: getToken(),
  catalog: [],
  articles: [],
  siteRepo: null, // URL du dépôt du site lui-même, pour la section "Contribuer" — vient de catalog.json
  navOpen: false,
  showAdmin: false,
  availableModels: [],
  message: null, // { text, kind: 'info' | 'success' | 'warn' | 'error' }
  scopeWarning: null,
  busy: false,
  draftTarget: '', // valeur non soumise du champ "dépôt à cataloguer", préservée entre deux rendus
  lastGenerated: null, // aperçu du dernier projet écrit, affiché tant que l'admin ne l'a pas fermé
  automationBusy: false,
  automationFrequency: 'daily',
  automationCustomCron: '',
  maxPerRun: 5,
  catalogPat: '',
  articleBusy: false,
  draftArticleTitle: '',
  draftArticleNotes: '',
  draftArticleSeries: '',
  draftArticlePart: '',
  draftArticleTotal: '',
  lastGeneratedArticle: null,
};

function setMessage(text, kind = 'info') {
  state.message = text ? { text, kind } : null;
  render();
}

// ---------- Cooldown (garde-fou de fréquence, 100% côté navigateur) ----------
// Note : pour une génération qui tourne toute seule sans navigateur ouvert, voir
// .github/workflows/auto-catalog.yml — ce garde-fou-ci ne concerne que ce bouton manuel.

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

async function updateWorkflowSchedule(owner, repo, cronExpression, token) {
  const path = '.github/workflows/auto-catalog.yml';
  const file = await getFile(owner, repo, path, token);
  if (!file || Array.isArray(file)) {
    throw new Error(`${path} introuvable sur ce dépôt \u2014 l\u2019automatisation n\u2019a pas pu être configurée.`);
  }
  const updated = file.content.replace(/(-\s*cron:\s*)"[^"]*"/, `$1"${cronExpression}"`);
  if (updated === file.content) {
    throw new Error('Ligne "cron:" introuvable dans le workflow \u2014 a-t-il été modifié manuellement ?');
  }
  await putFile(owner, repo, path, updated, `chore: fréquence auto-catalogue \u2192 ${cronExpression}`, token);
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
    const data = res.ok ? await res.json() : null;
    if (Array.isArray(data)) {
      // ancien format (juste un tableau) — compatibilité si un vieux build traîne encore
      state.catalog = data;
    } else if (data) {
      state.catalog = Array.isArray(data.projects) ? data.projects : [];
      state.articles = Array.isArray(data.articles) ? data.articles : [];
      state.siteRepo = data.siteRepo || null;
    }
  } catch {
    state.catalog = [];
    state.articles = [];
  }
  render();
}

// ---------- Rendu ----------

function render() {
  root.innerHTML = `
    ${renderHeader()}
    ${state.message ? renderMessage() : ''}
    <main>
      ${renderHeroSection(state.catalog)}
      <div class="wrap">
        ${renderCatalogSection(state.catalog, !state.showAdmin)}
        ${state.articles.length ? renderArticlesSection(state.articles) : ''}
      </div>
      ${renderContributeSection(state.siteRepo || (state.config.owner && state.config.repo ? `https://github.com/${state.config.owner}/${state.config.repo}` : null))}
      ${state.showAdmin ? `<div class="wrap">${renderAdmin()}</div>` : ''}
    </main>
  `;
}

function renderHeader() {
  return `
    <header class="site-header">
      <div class="wrap site-header__inner">
        <a class="brand" href="#accueil">devlog<span class="brand__dot">.</span></a>
        <button type="button" class="hamburger" data-action="toggle-nav" aria-label="Menu" aria-expanded="${state.navOpen ? 'true' : 'false'}">
          <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
        </button>
      </div>
      ${state.navOpen ? renderNav() : ''}
    </header>
  `;
}

function renderNav() {
  return `
    <nav class="nav-panel" aria-label="Navigation principale">
      <a href="#accueil" data-action="close-nav">Accueil</a>
      <a href="#projets" data-action="close-nav">Projets</a>
      <a href="#articles" data-action="close-nav">Articles</a>
      <a href="#contribuer" data-action="close-nav">Contribuer</a>
      <a href="#administration" data-action="open-admin-nav">Administration</a>
    </nav>
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

function renderAdmin() {
  const cfg = state.config;
  const complete = isConfigComplete(cfg) && state.token;
  const missing = missingConfigFields(cfg, Boolean(state.token));
  return `
    <section id="administration" class="admin" aria-label="Administration">
      <h2 class="admin__title">Configuration</h2>
      ${renderConfigForm()}
      ${complete
        ? renderGenerateForm()
        : `<p class="hint">Il manque encore : ${missing.map(escapeHtml).join(', ')}.</p>`}
      ${complete ? renderArticleForm() : ''}
      ${complete ? renderAutomation() : ''}
      ${state.lastGenerated ? renderPreview(state.lastGenerated, 'Aperçu — dernier projet généré', 'close-preview') : ''}
      ${state.lastGeneratedArticle ? renderPreview(state.lastGeneratedArticle, 'Aperçu — dernier article généré', 'close-article-preview') : ''}
    </section>
  `;
}

function renderArticleForm() {
  return `
    <section class="article-form" aria-label="Nouvel article">
      <h3 class="admin__title">Nouvel article</h3>
      <form data-form="article" class="form">
        <label class="field">
          <span>Titre</span>
          <input type="text" name="articleTitle" placeholder="ex. Pourquoi on a choisi l'API Contents plutôt que git complet" value="${escapeHtml(state.draftArticleTitle)}" autocomplete="off">
        </label>
        <label class="field">
          <span>Notes / plan</span>
          <textarea name="articleNotes" rows="6" placeholder="Points en vrac, brouillon, plan sommaire — l'IA structure et développe à partir de ça.">${escapeHtml(state.draftArticleNotes)}</textarea>
        </label>
        <div class="field-row">
          <label class="field">
            <span>Série (optionnel)</span>
            <input type="text" name="articleSeries" placeholder="ex. Construire DevLog" value="${escapeHtml(state.draftArticleSeries)}" autocomplete="off">
          </label>
          <label class="field">
            <span>Partie / total (optionnel)</span>
            <div class="field-inline">
              <input type="number" name="articlePart" min="1" step="1" placeholder="1" value="${escapeHtml(state.draftArticlePart)}">
              <input type="number" name="articleTotal" min="1" step="1" placeholder="sur combien ?" value="${escapeHtml(state.draftArticleTotal)}">
            </div>
          </label>
        </div>
        <div class="form__actions">
          <button type="submit" class="btn" ${state.articleBusy ? 'disabled' : ''}>${state.articleBusy ? 'Génération en cours…' : 'Générer l\u2019article'}</button>
        </div>
      </form>
    </section>
  `;
}

function renderAutomation() {
  const frequencyOptions = Object.entries(CRON_PRESETS)
    .map(([id, p]) => `<option value="${id}" ${state.automationFrequency === id ? 'selected' : ''}>${p.label}</option>`)
    .join('');
  return `
    <section class="automation" aria-label="Automatisation">
      <h3 class="admin__title">Automatisation (sans navigateur)</h3>
      <p class="hint">Réutilise le fournisseur, la clé et le modèle déjà renseignés ci-dessus. Pousse tout ça comme secret/variables GitHub Actions, et règle la fréquence du workflow \u2014 rien à configurer côté GitHub.</p>
      <form data-form="automation" class="form">
        <div class="field-row">
          <label class="field">
            <span>Fréquence</span>
            <select name="frequency">
              ${frequencyOptions}
              <option value="custom" ${state.automationFrequency === 'custom' ? 'selected' : ''}>Personnalisée (cron)</option>
            </select>
          </label>
          <label class="field">
            <span>Dépôts traités par passage</span>
            <input type="number" name="maxPerRun" min="1" step="1" value="${state.maxPerRun}">
          </label>
        </div>
        ${state.automationFrequency === 'custom' ? `
        <label class="field">
          <span>Expression cron</span>
          <input type="text" name="customCron" placeholder="0 6 * * *" value="${escapeHtml(state.automationCustomCron)}" autocomplete="off" spellcheck="false">
          <small class="field__hint">Format cron standard, en UTC.</small>
        </label>` : ''}
        <label class="field">
          <span>Token pour dépôts privés (optionnel)</span>
          <input type="password" name="catalogPat" placeholder="laisser vide pour dépôts publics uniquement" value="${escapeHtml(state.catalogPat)}" autocomplete="off" spellcheck="false">
          <small class="field__hint">Poussé comme secret CATALOG_PAT. Sans ça, seuls tes dépôts publics sont catalogués automatiquement.</small>
        </label>
        <div class="form__actions">
          <button type="submit" class="btn" ${state.automationBusy ? 'disabled' : ''}>${state.automationBusy ? 'Configuration en cours…' : 'Activer l\u2019automatisation'}</button>
        </div>
      </form>
    </section>
  `;
}

function renderPreview(entry, title = 'Aperçu — dernière génération', closeAction = 'close-preview') {
  return `
    <section class="preview" aria-label="${escapeHtml(title)}">
      <div class="preview__head">
        <h3 class="admin__title">${escapeHtml(title)}</h3>
        <button type="button" class="link-btn" data-action="${closeAction}">Fermer</button>
      </div>
      <h1 class="project-title">${escapeHtml(entry.title)}</h1>
      ${entry.hook ? `<p class="project-hook">${escapeHtml(entry.hook)}</p>` : ''}
      ${renderMediaHtml(entry.media)}
      <div class="project-body">${renderBodyHtml(entry.body)}</div>
      ${entry.tags && entry.tags.length ? `<ul class="project-tags">${entry.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      ${entry.stack && entry.stack.length ? `<ul class="project-stack">${entry.stack.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
    </section>
  `;
}

function renderConfigForm() {
  const cfg = state.config;
  const providerOptions = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}" ${cfg.provider === id ? 'selected' : ''}>${p.label}</option>`)
    .join('');
  const modelOptions = state.availableModels
    .map((m) => `<option value="${escapeHtml(m.id)}" ${cfg.model === m.id ? 'selected' : ''}>${escapeHtml(m.id)}${m.contextWindow ? ` (${Math.round(m.contextWindow / 1000)}k ctx)` : ''}</option>`)
    .join('');

  return `
    <form data-form="config" class="form" novalidate>
      <label class="field">
        <span>Token GitHub</span>
        <input type="password" name="token" placeholder="ghp_… ou github_pat_…" value="${state.token ? '\u2022'.repeat(12) : ''}" autocomplete="off" spellcheck="false">
        ${state.token
          ? '<small class="field__hint field__hint--ok">\u2713 Token enregistré dans ce navigateur. Laisse ce champ tel quel pour le garder, ou colle-en un nouveau pour le remplacer.</small>'
          : '<small class="field__hint">Classique ou fine-grained, au choix \u2014 stocké uniquement dans ce navigateur.</small>'}
      </label>
      ${state.scopeWarning ? `<p class="banner banner--warn">${escapeHtml(state.scopeWarning)}</p>` : ''}

      <div class="field-row">
        <label class="field">
          <span>Propriétaire du dépôt</span>
          <input type="text" name="owner" placeholder="ex. Tryboy869" value="${escapeHtml(cfg.owner || '')}" autocomplete="off" spellcheck="false">
        </label>
        <label class="field">
          <span>Dépôt (catalogue)</span>
          <input type="text" name="repo" placeholder="ex. devlog" value="${escapeHtml(cfg.repo || '')}" autocomplete="off" spellcheck="false">
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
          <input type="password" name="apiKey" placeholder="clé du fournisseur choisi" value="${escapeHtml(cfg.apiKey || '')}" autocomplete="off" spellcheck="false">
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
          ${!state.availableModels.length ? '<small class="field__hint">Il faut cliquer ici et choisir un modèle : c\u2019est un champ à part entière, pas juste une info.</small>' : ''}
        </label>
        <label class="field">
          <span>Délai minimum entre deux runs manuels (heures)</span>
          <input type="number" name="cooldownHours" min="0" step="1" value="${cfg.cooldownHours ?? 0}">
          <small class="field__hint">Pour une génération qui tourne sans que tu ouvres le site, voir le workflow GitHub Actions automatique (section Contribuer → dépôt → .github/workflows).</small>
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
        <input type="text" name="target" placeholder="proprietaire/depot ou https://github.com/proprietaire/depot" value="${escapeHtml(state.draftTarget)}" autocomplete="off" spellcheck="false" required>
        <small class="field__hint">Les deux formats marchent : "proprietaire/depot" ou un lien GitHub complet. Doit contenir un README.md lisible avec ce token.</small>
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
    setMessage(`${state.availableModels.length} modèle(s) récupéré(s) — choisis-en un dans la liste juste au-dessus.`, 'success');
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
    const scope = await detectTokenScope(tokenInput);
    state.scopeWarning = scope.known && scope.broad
      ? 'Ce token a accès à tous tes dépôts (scope "repo" classique). Un token fine-grained limité à ce seul dépôt réduit les dégâts en cas de fuite \u2014 mais le choix reste le tien.'
      : null;
  }

  const selectedModelInfo = state.availableModels.find((m) => m.id === form.model.value);
  state.config = {
    owner: form.owner.value.trim(),
    repo: form.repo.value.trim(),
    provider: form.provider.value,
    apiKey: form.apiKey.value.trim(),
    model: form.model.value,
    modelContextWindow: selectedModelInfo ? selectedModelInfo.contextWindow : state.config.modelContextWindow,
    cooldownHours: Number(form.cooldownHours.value) || 0,
  };
  saveConfig(state.config);

  const stillMissing = missingConfigFields(state.config, Boolean(state.token));
  setMessage(
    stillMissing.length
      ? `Configuration enregistrée, mais incomplète — il manque : ${stillMissing.join(', ')}.`
      : 'Configuration enregistrée et complète : le formulaire de génération est maintenant disponible plus bas.',
    stillMissing.length ? 'warn' : 'success'
  );
}

async function handleClearToken() {
  if (!window.confirm('Oublier le token GitHub enregistré dans ce navigateur ?')) return;
  clearToken();
  state.token = '';
  state.scopeWarning = null;
  render();
}

async function handleActivateAutomation(e) {
  e.preventDefault();
  if (state.automationBusy) return;
  const form = e.target;
  const frequency = form.frequency.value;
  const cronExpression = frequency === 'custom'
    ? form.customCron.value.trim()
    : CRON_PRESETS[frequency].cron;

  if (!cronExpression) {
    setMessage('Renseigne une expression cron valide.', 'error');
    return;
  }

  state.automationFrequency = frequency;
  if (frequency === 'custom') state.automationCustomCron = cronExpression;
  state.maxPerRun = Number(form.maxPerRun.value) || 5;
  state.catalogPat = form.catalogPat.value.trim();
  state.automationBusy = true;
  render();

  const { owner, repo, provider, apiKey, model } = state.config;

  try {
    setMessage('Envoi de la clé IA comme secret GitHub Actions…');
    await setActionsSecret(owner, repo, 'AI_API_KEY', apiKey, state.token);

    setMessage('Configuration des variables (fournisseur, modèle, limite)…');
    await setActionsVariable(owner, repo, 'AI_PROVIDER', provider, state.token);
    await setActionsVariable(owner, repo, 'AI_MODEL', model, state.token);
    await setActionsVariable(owner, repo, 'MAX_PER_RUN', String(state.maxPerRun), state.token);

    if (state.catalogPat) {
      setMessage('Envoi du token pour dépôts privés…');
      await setActionsSecret(owner, repo, 'CATALOG_PAT', state.catalogPat, state.token);
    }

    setMessage('Réglage de la fréquence du workflow…');
    await updateWorkflowSchedule(owner, repo, cronExpression, state.token);

    setMessage(
      `Automatisation activée (${cronExpression}, UTC). Premier passage au prochain déclenchement planifié \u2014 ou lance-le tout de suite depuis l\u2019onglet Actions \u2192 Auto-catalogue \u2192 Run workflow.`,
      'success'
    );
  } catch (err) {
    setMessage(err.message || String(err), 'error');
  } finally {
    state.automationBusy = false;
    render();
  }
}

async function handleGenerateSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  const target = e.target.target.value.trim();
  state.draftTarget = '';
  const parsed = parseRepoInput(target);

  if (!parsed) {
    setMessage('Format attendu : proprietaire/depot, ou un lien GitHub complet.', 'error');
    return;
  }
  const { owner: targetOwner, repo: targetRepo } = parsed;

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

    setMessage('Adaptation du README à la fenêtre de contexte du modèle…');
    const contextWindow = state.config.modelContextWindow || DEFAULT_CONTEXT_WINDOW;
    const callModelForCondense = (instruction, chunk) => generateContent(
      state.config.provider, state.config.apiKey, state.config.model, instruction, chunk
    );
    const { text: fittedReadme, wasCondensed, passes, truncated } = await fitToContextWindow(
      readmeFile.content, contextWindow, callModelForCondense
    );
    if (wasCondensed) {
      setMessage(`README condensé en ${passes} passe(s) pour tenir dans la fenêtre de contexte (${contextWindow} tokens)${truncated ? ' — encore trop long, tronqué en dernier recours' : ''}…`);
    }

    setMessage('Génération du contenu par l\u2019IA…');
    const { systemPrompt, userPrompt } = await buildBlogWritingPrompt(
      fittedReadme,
      `https://github.com/${targetOwner}/${targetRepo}`
    );
    const raw = await generateContent(
      state.config.provider, state.config.apiKey, state.config.model, systemPrompt, userPrompt
    );
    const parsedContent = parseJsonResponse(raw);

    const slug = slugify(targetRepo);
    const now = new Date().toISOString();
    const existingProjectFile = await getFile(state.config.owner, state.config.repo, `projects/${slug}.json`, state.token).catch(() => null);
    let createdAt = now;
    if (existingProjectFile && !Array.isArray(existingProjectFile)) {
      try { createdAt = JSON.parse(existingProjectFile.content).createdAt || now; } catch { /* garde now */ }
    }

    const project = {
      slug,
      title: parsedContent.title || targetRepo,
      hook: parsedContent.hook || '',
      description: parsedContent.description || '',
      body: parsedContent.body || '',
      tags: Array.isArray(parsedContent.tags) ? parsedContent.tags : [],
      stack: Array.isArray(parsedContent.stack) ? parsedContent.stack : [],
      media: parsedContent.media && typeof parsedContent.media === 'object' ? parsedContent.media : { kind: 'none' },
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

async function handleGenerateArticleSubmit(e) {
  e.preventDefault();
  if (state.articleBusy) return;
  const form = e.target;
  const title = form.articleTitle.value.trim();
  const notes = form.articleNotes.value.trim();
  const seriesName = form.articleSeries.value.trim();
  const seriesPart = form.articlePart.value.trim();
  const seriesTotal = form.articleTotal.value.trim();

  if (!title || !notes) {
    setMessage('Un titre et des notes sont nécessaires pour générer un article.', 'error');
    return;
  }

  state.draftArticleTitle = '';
  state.draftArticleNotes = '';
  state.draftArticleSeries = '';
  state.draftArticlePart = '';
  state.draftArticleTotal = '';
  state.articleBusy = true;
  render();

  try {
    setMessage('Génération de l\u2019article par l\u2019IA…');
    const { systemPrompt, userPrompt } = await buildArticleWritingPrompt(
      title, notes, seriesName ? { name: seriesName, part: seriesPart, total: seriesTotal } : null
    );
    const raw = await generateContent(
      state.config.provider, state.config.apiKey, state.config.model, systemPrompt, userPrompt
    );
    const parsedContent = parseJsonResponse(raw);

    const slug = slugify(parsedContent.title || title);
    const now = new Date().toISOString();
    const existingArticleFile = await getFile(state.config.owner, state.config.repo, `articles/${slug}.json`, state.token).catch(() => null);
    let createdAt = now;
    if (existingArticleFile && !Array.isArray(existingArticleFile)) {
      try { createdAt = JSON.parse(existingArticleFile.content).createdAt || now; } catch { /* garde now */ }
    }

    const article = {
      slug,
      title: parsedContent.title || title,
      hook: parsedContent.hook || '',
      description: parsedContent.description || '',
      body: parsedContent.body || '',
      tags: Array.isArray(parsedContent.tags) ? parsedContent.tags : [],
      media: parsedContent.media && typeof parsedContent.media === 'object' ? parsedContent.media : { kind: 'none' },
      series: seriesName || null,
      seriesPart: seriesPart ? Number(seriesPart) : null,
      seriesTotal: seriesTotal ? Number(seriesTotal) : null,
      createdAt,
      updatedAt: now,
    };

    setMessage('Écriture sur GitHub…');
    await putFile(
      state.config.owner, state.config.repo, `articles/${slug}.json`,
      JSON.stringify(article, null, 2),
      `feat: ajoute/actualise l'article ${slug}`,
      state.token
    );

    state.articles = state.articles.filter((a) => a.slug !== slug).concat(article);
    state.lastGeneratedArticle = article;
    setMessage(`"${article.title}" écrit dans /articles/${slug}.json. Le prochain build régénérera le site.`, 'success');
  } catch (err) {
    setMessage(err.message || String(err), 'error');
  } finally {
    state.articleBusy = false;
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
    const selectedModelInfo = state.availableModels.find((m) => m.id === configForm.model.value);
    state.config = {
      ...state.config,
      owner: configForm.owner.value,
      repo: configForm.repo.value,
      provider: configForm.provider.value,
      apiKey: configForm.apiKey.value,
      model: configForm.model.value,
      modelContextWindow: selectedModelInfo ? selectedModelInfo.contextWindow : state.config.modelContextWindow,
      cooldownHours: Number(configForm.cooldownHours.value) || 0,
    };
    return;
  }
  const generateForm = e.target.closest('[data-form="generate"]');
  if (generateForm) {
    state.draftTarget = generateForm.target.value;
    return;
  }
  const articleForm = e.target.closest('[data-form="article"]');
  if (articleForm) {
    state.draftArticleTitle = articleForm.articleTitle.value;
    state.draftArticleNotes = articleForm.articleNotes.value;
    state.draftArticleSeries = articleForm.articleSeries.value;
    state.draftArticlePart = articleForm.articlePart.value;
    state.draftArticleTotal = articleForm.articleTotal.value;
    return;
  }
  const automationForm = e.target.closest('[data-form="automation"]');
  if (automationForm) {
    const changedFrequency = e.target.name === 'frequency';
    state.automationFrequency = automationForm.frequency.value;
    state.maxPerRun = automationForm.maxPerRun.value;
    if (automationForm.customCron) state.automationCustomCron = automationForm.customCron.value;
    state.catalogPat = automationForm.catalogPat.value;
    if (changedFrequency) render(); // pour afficher/masquer le champ cron personnalisé
  }
});

root.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'toggle-admin') {
    state.showAdmin = !state.showAdmin;
    render();
  } else if (action === 'toggle-nav') {
    state.navOpen = !state.navOpen;
    render();
  } else if (action === 'close-nav') {
    state.navOpen = false;
    render();
  } else if (action === 'open-admin-nav') {
    state.navOpen = false;
    state.showAdmin = true;
    render();
  } else if (action === 'fetch-models') {
    handleFetchModels();
  } else if (action === 'clear-token') {
    handleClearToken();
  } else if (action === 'close-preview') {
    state.lastGenerated = null;
    render();
  } else if (action === 'close-article-preview') {
    state.lastGeneratedArticle = null;
    render();
  }
});

root.addEventListener('submit', (e) => {
  const formType = e.target.dataset && e.target.dataset.form;
  if (formType === 'config') handleSaveConfigSubmit(e);
  if (formType === 'generate') handleGenerateSubmit(e);
  if (formType === 'article') handleGenerateArticleSubmit(e);
  if (formType === 'automation') handleActivateAutomation(e);
});

document.addEventListener('DOMContentLoaded', init);
