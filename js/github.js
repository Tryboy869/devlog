// github.js — Tout l'accès GitHub passe par l'API Contents (pas de git complet dans le navigateur).
// Le token ne quitte jamais ce navigateur : il est stocké en localStorage et envoyé uniquement à api.github.com.

const API = 'https://api.github.com';
const TOKEN_KEY = 'devlog_github_token';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// --- Encodage UTF-8 sûr pour l'API Contents (base64) ---
// btoa/atob natifs ne gèrent que du Latin1 : on passe par TextEncoder/TextDecoder
// pour ne pas casser les caractères accentués ou les emojis dans les README.

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- Stockage du token ---

export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// --- Détection (best-effort) d'un token à accès large ---
// GitHub renvoie un header X-OAuth-Scopes pour les tokens classiques.
// Les tokens fine-grained ne renvoient généralement pas ce header : dans ce cas
// on ne peut rien affirmer, donc on ne montre aucun avertissement (on ne bloque jamais,
// on informe seulement quand on a un signal positif de large accès).

export async function detectTokenScope(token) {
  try {
    const res = await fetch(`${API}/user`, { headers: authHeaders(token) });
    if (!res.ok) return { known: false, broad: false, scopes: [] };
    const scopesHeader = res.headers.get('x-oauth-scopes');
    if (!scopesHeader || !scopesHeader.trim()) {
      return { known: false, broad: false, scopes: [] };
    }
    const scopes = scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
    return { known: true, broad: scopes.includes('repo'), scopes };
  } catch {
    return { known: false, broad: false, scopes: [] };
  }
}

// --- Lecture ---
// Retourne null si le fichier n'existe pas, un tableau si `path` est un dossier,
// ou { content, sha } si c'est un fichier.

export async function getFile(owner, repo, path, token) {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path}`,
    { headers: authHeaders(token) }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Lecture GitHub échouée (${res.status}) sur ${owner}/${repo}/${path} : ${body.message || ''}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  return { content: base64ToUtf8(data.content), sha: data.sha };
}

// --- Écriture (création ou mise à jour, sha géré automatiquement) ---

export async function putFile(owner, repo, path, content, message, token, branch) {
  const existing = await getFile(owner, repo, path, token).catch(() => null);
  const sha = existing && !Array.isArray(existing) ? existing.sha : undefined;

  const body = {
    message,
    content: utf8ToBase64(content),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Écriture GitHub échouée (${res.status}) sur ${owner}/${repo}/${path} : ${err.message || ''}`);
  }
  return res.json();
}

// --- Liste d'un dossier (raccourci lisible, même appel que getFile) ---

export async function listDir(owner, repo, path, token) {
  const result = await getFile(owner, repo, path, token);
  if (result === null) return [];
  if (!Array.isArray(result)) throw new Error(`${path} est un fichier, pas un dossier.`);
  return result;
}
