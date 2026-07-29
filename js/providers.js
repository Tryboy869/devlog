// providers.js — Groq et OpenRouter partagent le même contrat de requête (chat completions
// façon OpenAI), donc un seul adaptateur générique suffit : seule l'URL de base change.
// Vérifié le 09/07/2026 : api.groq.com/openai/v1 et openrouter.ai/api/v1 exposent tous les
// deux GET /models et POST /chat/completions avec une authentification Bearer identique.

export const PROVIDERS = {
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
  },
  openrouter: {
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
  },
};

function headersFor(providerId, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  // OpenRouter recommande ces deux en-têtes pour l'attribution de l'app ; ça ne coûte rien
  // et ils n'ont pas d'effet sur Groq si jamais on les envoyait par erreur ailleurs.
  if (providerId === 'openrouter' && typeof window !== 'undefined') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = document.title || 'DevLog';
  }
  return headers;
}

function requireProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Fournisseur inconnu : ${providerId}`);
  return provider;
}

export async function fetchModels(providerId, apiKey) {
  const provider = requireProvider(providerId);
  const res = await fetch(`${provider.base}/models`, {
    headers: headersFor(providerId, apiKey),
  });
  if (!res.ok) {
    throw new Error(`Impossible de récupérer les modèles ${provider.label} (${res.status}). Vérifie la clé API.`);
  }
  const json = await res.json();
  const list = Array.isArray(json.data) ? json.data : [];
  // Le nom du champ diffère selon le fournisseur : context_window chez Groq,
  // context_length chez OpenRouter. On prend celui qui existe.
  return list
    .map((m) => ({ id: m.id, contextWindow: m.context_window || m.context_length || null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function generateContent(providerId, apiKey, model, systemPrompt, userPrompt, maxTokens = 4096) {
  const provider = requireProvider(providerId);
  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: headersFor(providerId, apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Erreur ${provider.label} (${res.status}) : ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const choice = json.choices && json.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (!text) throw new Error(`Réponse vide de ${provider.label}.`);
  if (choice.finish_reason === 'length') {
    console.warn(`[providers] Réponse ${provider.label} coupée par la limite de tokens (max_tokens=${maxTokens}).`);
  }
  return text;
}

// Trouve le premier objet JSON complet dans un texte, en ignorant tout ce qui l'entoure
// (prose avant/après, barrières de code Markdown) et en respectant les limites de chaînes
// pour qu'une accolade présente DANS une valeur de chaîne (ex. un exemple de code JS dans
// le champ "body") ne fausse pas le comptage.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // accolade non refermée — réponse tronquée
}

// Les modèles respectent rarement à 100% la consigne "que du JSON" — un peu de prose
// avant/après, ou des barrières de code Markdown, sont fréquents. On extrait l'objet JSON
// où qu'il soit dans la réponse plutôt que d'exiger un format parfait dès la première ligne.
export function parseJsonResponse(text) {
  const candidate = extractJsonObject(text)
    || text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("Le modèle n'a pas renvoyé un JSON exploitable. Réessaie, ou change de modèle.");
  }
}

const REPAIR_SYSTEM_PROMPT = 'Tu répares du JSON invalide. Réponds uniquement avec le JSON corrigé, sans aucun texte autour, sans balises de code Markdown.';

/**
 * Génère du contenu et le parse en JSON, avec une tentative de réparation automatique si
 * le premier essai échoue (renvoie la réponse invalide au même modèle en lui demandant de
 * la corriger). Une seule tentative de réparation : au-delà, l'erreur d'origine est
 * remontée telle quelle plutôt que de multiplier les appels sur un modèle qui ne coopère pas.
 */
export async function generateStructuredContent(providerId, apiKey, model, systemPrompt, userPrompt) {
  const raw = await generateContent(providerId, apiKey, model, systemPrompt, userPrompt);
  try {
    return { data: parseJsonResponse(raw), repaired: false };
  } catch (firstError) {
    const repairPrompt = `Le texte suivant devait être un unique objet JSON valide mais ne l'est pas (peut-être coupé, ou avec du texte autour). Corrige-le et réponds uniquement avec le JSON corrigé :\n\n${raw}`;
    let repairedRaw;
    try {
      repairedRaw = await generateContent(providerId, apiKey, model, REPAIR_SYSTEM_PROMPT, repairPrompt);
    } catch {
      throw firstError;
    }
    try {
      return { data: parseJsonResponse(repairedRaw), repaired: true };
    } catch {
      throw firstError; // le message d'erreur d'origine reste le plus utile pour l'utilisateur
    }
  }
}
