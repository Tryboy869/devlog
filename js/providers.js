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

export async function generateContent(providerId, apiKey, model, systemPrompt, userPrompt) {
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
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Erreur ${provider.label} (${res.status}) : ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!text) throw new Error(`Réponse vide de ${provider.label}.`);
  return text;
}

// Les modèles respectent rarement à 100% la consigne "que du JSON" — on retire les
// éventuelles barrières de code Markdown avant de parser.
export function parseJsonResponse(text) {
  const cleaned = text.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Le modèle n'a pas renvoyé un JSON exploitable. Réessaie, ou change de modèle.");
  }
}
