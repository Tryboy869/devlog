# Skill : rédaction d'article

Transformer des notes ou un plan fournis par l'administrateur en un article autonome — pas lié à un dépôt précis, plutôt une explication de fonctionnement, un concept, un retour d'expérience. Même exigence de profondeur technique et mêmes interdits que pour une entrée de catalogue.

## Différence avec `blog-writing.md`

Il n'y a pas de README source ici : la matière première, ce sont les notes que l'admin a tapées (un titre + quelques points, parfois juste un brouillon en vrac). Le travail consiste à structurer et développer, pas à résumer — contrairement à un README qui contient déjà des faits établis, des notes en vrac demandent de les organiser en un raisonnement suivi.

## Structure imposée

Le corps (`body`) est le même Markdown restreint (titres `##`/`###`, blocs de code, listes, gras) que pour une entrée de catalogue.

1. Un paragraphe d'ouverture qui pose le sujet et pourquoi il compte, sans titre.
2. Une ou plusieurs sections `##` qui développent les points des notes fournies, dans un ordre logique (pas forcément l'ordre dans lequel l'admin les a tapés si un autre ordre raconte mieux l'histoire).
3. Si les notes mentionnent une commande, un extrait de code ou un exemple concret, il apparaît dans un bloc de code — même règle que pour les projets : une affirmation technique sans rien de concret pour l'étayer est à éviter.
4. Une conclusion courte, jamais un résumé creux.

## Série (optionnel)

Si l'admin indique que cet article fait partie d'une série (nom + numéro de partie), mentionne-le naturellement en une phrase quelque part dans l'ouverture ou la conclusion (ex: "deuxième partie d'une série sur X — la première expliquait Y"), sans que ça devienne un gimmick répété à chaque paragraphe.

## Visuel

Si l'admin a fourni une URL d'image ou de vidéo YouTube directement, elle est déjà dans le champ `media` du contrat de sortie — reprends-la telle quelle avec une légende pertinente. Sinon, même règle que pour les projets : génère un petit SVG animé abstrait (voir les contraintes strictes dans `blog-writing.md`, section "Détection de visuel" — mêmes règles ici, notamment le bloc `<style>` avec `prefers-reduced-motion`).

## Interdits explicites

Les mêmes que `blog-writing.md` : pas d'ouvertures type "dans le paysage en constante évolution de...", pas d'adjectifs vides sans preuve, pas de conclusion en résumé creux, pas d'emoji dans le corps.

## Ancrage dans le réel

Chaque affirmation technique doit être traçable aux notes fournies par l'admin. Si les notes ne précisent pas un détail, ce détail n'apparaît pas dans l'article — jamais d'invention pour combler un blanc.

## Format de sortie

Réponds uniquement avec cet objet JSON, sans texte autour, sans balises de code Markdown englobantes :

```json
{
  "title": "",
  "hook": "",
  "description": "",
  "body": "",
  "tags": [],
  "media": { "kind": "image|youtube|generated-svg|none", "url": "", "youtubeId": "", "svg": "", "caption": "" }
}
```
