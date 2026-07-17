// context-budget.js — estimation de tokens et condensation séquentielle d'un texte source
// trop long pour la fenêtre de contexte du modèle choisi. Partagé entre le navigateur
// (js/app.js) et l'automatisation (.github/scripts/auto-catalog.mjs) : aucune API
// spécifique à un environnement, juste du texte et une fonction d'appel injectée.

const CHARS_PER_TOKEN = 3.5; // estimation volontairement prudente (sous-estime la marge dispo)
const SYSTEM_PROMPT_RESERVE_TOKENS = 1200; // orchestrator.md + blog-writing.md + marge de réponse
export const DEFAULT_CONTEXT_WINDOW = 8192; // hypothèse prudente si le fournisseur ne renvoie rien

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function splitIntoSections(text) {
  const byHeaders = String(text || '').split(/\n(?=#{1,3}\s)/);
  if (byHeaders.length > 1) return byHeaders;
  return text.split(/\n\s*\n/).filter(Boolean);
}

export function chunkText(text, maxCharsPerChunk) {
  const sections = splitIntoSections(text);
  const chunks = [];
  let current = '';
  for (const section of sections) {
    if (current && (current.length + section.length + 2) > maxCharsPerChunk) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n\n' : '') + section;
    // Une section à elle seule plus grande que le budget : découpe brutale en blocs.
    while (current.length > maxCharsPerChunk) {
      chunks.push(current.slice(0, maxCharsPerChunk));
      current = current.slice(maxCharsPerChunk);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export const CONDENSE_INSTRUCTION = [
  "Condense cet extrait de documentation technique : garde tous les faits concrets",
  "(commandes, extraits de code, noms d'API, chiffres, noms de fichiers), supprime le",
  'remplissage. Réponds uniquement avec le texte condensé, sans commentaire ni préambule.',
].join(' ');

/**
 * Si `text` tient dans le budget de tokens du modèle, le renvoie tel quel. Sinon, le
 * découpe en sections et condense chaque section séquentiellement via `callModel`
 * (signature : async (instruction, chunk) => texteCondensé), avant de les rassembler.
 * Le modèle final ne voit jamais plus que ce que sa fenêtre de contexte peut tenir,
 * quelle que soit la longueur du README d'origine — au prix d'appels supplémentaires
 * si besoin, exécutés séquentiellement.
 */
export async function fitToContextWindow(text, contextWindow, callModel, depth = 0) {
  const budgetTokens = Math.max(1000, (contextWindow || DEFAULT_CONTEXT_WINDOW) - SYSTEM_PROMPT_RESERVE_TOKENS);

  if (estimateTokens(text) <= budgetTokens) {
    return { text, wasCondensed: depth > 0, passes: depth };
  }
  if (depth >= 3) {
    // Garde-fou : au-delà de 3 passes de condensation, on tronque plutôt que de boucler
    // indéfiniment sur un cas pathologique (README de plusieurs mégaoctets).
    const maxChars = Math.floor(budgetTokens * CHARS_PER_TOKEN);
    return { text: text.slice(0, maxChars), wasCondensed: true, passes: depth, truncated: true };
  }

  const maxCharsPerChunk = Math.floor(budgetTokens * CHARS_PER_TOKEN * 0.5);
  const chunks = chunkText(text, maxCharsPerChunk);
  const condensedParts = [];
  for (const chunk of chunks) {
    const condensed = await callModel(CONDENSE_INSTRUCTION, chunk);
    condensedParts.push(condensed);
  }
  const combined = condensedParts.join('\n\n');
  return fitToContextWindow(combined, contextWindow, callModel, depth + 1);
}
