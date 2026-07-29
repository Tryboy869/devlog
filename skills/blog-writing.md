# Skill : rédaction d'entrée de catalogue

Transformer un README technique en entrée de blog lisible par un humain qui ne connaît pas le projet, avec une vraie profondeur technique — pas un résumé marketing qui glisse sur la surface.

## Structure imposée

1. **Accroche (`hook`)** — deux à trois phrases denses, sur le modèle d'un abstract scientifique : quel problème existe, quelle approche le projet prend, quel résultat ou capacité concrète ça donne.
2. **Description (`description`)** — une seule phrase de 150 à 160 caractères maximum, pensée pour une balise meta.
3. **Corps (`body`)** — voir "Format du corps" ci-dessous. C'est ici que se joue la profondeur technique.
4. **Tags (`tags`)** — 3 à 6 mots-clés courts, en minuscules.
5. **Stack (`stack`)** — technologies explicitement nommées dans le README, jamais déduites.

## Format du corps : Markdown restreint, pas du texte brut

`body` est du **Markdown** (rendu par un vrai moteur des deux côtés, build et aperçu) : titres `##`/`###`, blocs de code ```` ``` ````, listes `-`, gras `**`. Structure imposée, dans cet ordre :

1. Un paragraphe d'ouverture (le problème concret que ça résout), sans titre.
2. `## Comment ça marche` — le mécanisme réel. **Si le README contient une commande d'installation, un extrait de config, un appel d'API ou un exemple de code, il DOIT apparaître ici dans un bloc de code, recopié tel quel.** Un article technique sans un seul extrait de code concret quand la source en fournit un n'a aucune profondeur — c'est le défaut le plus fréquent à éviter. S'il n'y a vraiment aucun extrait exploitable dans le README, explique le mécanisme en prose précise plutôt que d'inventer du code.
3. `## Stack` (optionnel si déjà clair) — pas juste une liste de logos : pourquoi ces choix, si le README l'explique.
4. Une conclusion de une à deux phrases, jamais un résumé creux.

## Détection de visuel

Le prompt utilisateur inclut une liste de "candidats visuels" détectés automatiquement dans le README (images, GIFs, vidéos YouTube — les badges de statut type shields.io sont déjà exclus en amont). Remplis le champ `media` selon ce qui est disponible :

- **Au moins un candidat pertinent** (vraie capture d'écran, diagramme, démo — pas un logo isolé) → choisis le meilleur : `{"kind": "image", "url": "...", "caption": "..."}` ou `{"kind": "youtube", "youtubeId": "...", "caption": "..."}`. Le caption décrit ce que ça montre, jamais "capture d'écran du projet" (creux).
- **Aucun candidat pertinent** → choisis un motif géométrique abstrait plutôt que d'écrire du balisage toi-même (le rendu SVG est produit par du code, pas par toi — ça évite les erreurs d'échappement) : `{"kind": "generated-svg", "pattern": "pulse-dots|bars|grid", "colors": ["brass","sage","dusty-rose"], "caption": "..."}`. `pattern` doit être exactement une de ces trois valeurs. `colors` : 1 à 3 valeurs parmi exactement `brass`, `sage`, `dusty-rose` (jamais un code couleur, jamais un autre nom). Choisis le motif et les couleurs en cohérence avec les tags/la stack du projet, sans logique stricte à respecter au-delà de ça.
- Si vraiment rien ne convient (cas rare) → `{"kind": "none"}`.

**Important : le champ `svg` n'existe plus dans ce contrat. N'écris jamais de balisage `<svg>...` toi-même — utilise uniquement `pattern` et `colors`.**

## Interdits explicites

Ne jamais utiliser ces tics d'écriture :
- Ouvertures du type "Dans le paysage en constante évolution de...", "À l'ère du...", "De nos jours..."
- Questions rhétoriques d'ouverture
- Adjectifs vides sans preuve à l'appui : "puissant", "robuste", "innovant" — si le README ne justifie pas l'adjectif par un fait, ne l'emploie pas
- Conclusion en résumé creux ("En résumé, ce projet est un excellent choix pour...")
- Emojis dans le corps du texte

## Ancrage dans le réel

Chaque affirmation technique du corps doit être traçable à une phrase du README fourni. Une commande, un extrait de code, un chiffre cité doit venir de la documentation source, jamais inventé. Si le README ne précise pas un détail, ce détail n'apparaît pas — mieux vaut une entrée plus courte qu'une entrée qui invente.

## Format de sortie

Réponds uniquement avec cet objet JSON, sans texte autour, sans balises de code Markdown englobantes :

```json
{
  "title": "",
  "hook": "",
  "description": "",
  "body": "",
  "tags": [],
  "stack": [],
  "media": { "kind": "image|youtube|generated-svg|none", "url": "", "youtubeId": "", "pattern": "", "colors": [], "caption": "" }
}
```
