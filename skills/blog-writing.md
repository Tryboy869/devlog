# Skill : rédaction d'entrée de catalogue

Transformer un README technique en entrée de blog lisible par un humain qui ne connaît pas le projet, sans perdre la précision technique et sans avoir l'air généré.

## Structure imposée (ordre fixe)

1. **Accroche (`hook`)** — deux à trois phrases denses, sur le modèle d'un abstract scientifique : quel problème existe, quelle approche le projet prend, quel résultat ou capacité concrète ça donne. Pas de mise en contexte générale, pas de montée en tension : on entre directement dans le sujet.
2. **Description (`description`)** — une seule phrase de 150 à 160 caractères maximum, pensée pour une balise meta. Doit pouvoir se lire seule, hors contexte, dans un résultat de recherche.
3. **Corps (`body`)** — développement en paragraphes de prose (pas de liste à puces sauf si le README énumère déjà une liste de fonctionnalités techniquement distinctes). Ordre : ce que le projet résout concrètement → comment il le fait (mécanisme, pas juste un nom de techno) → un exemple ou détail tiré tel quel du README (une commande, un extrait de config, un chiffre) → la stack technique en une phrase.
4. **Tags (`tags`)** — 3 à 6 mots-clés courts, en minuscules, utiles pour la découverte (langage, domaine, type de projet). Pas de tags marketing ("innovant", "puissant").
5. **Stack (`stack`)** — liste des technologies explicitement nommées dans le README. Jamais déduites ou supposées.

## Interdits explicites

Ne jamais utiliser ces tics d'écriture, qui trahissent un texte généré et cassent la crédibilité recherchée :
- Ouvertures du type "Dans le paysage en constante évolution de...", "À l'ère du...", "De nos jours..."
- Questions rhétoriques d'ouverture ("Et si on pouvait...")
- Adjectifs vides sans preuve à l'appui : "puissant", "robuste", "innovant", "révolutionnaire" — si le README ne justifie pas l'adjectif par un fait, ne l'emploie pas.
- Conclusion en résumé creux ("En résumé, ce projet est un excellent choix pour...")
- Emojis dans le corps du texte.

## Ancrage dans le réel

Chaque affirmation technique du corps doit être traçable à une phrase du README fourni. Une commande d'installation, un exemple de code, un nombre (version, benchmark, taille) cité dans le corps doit être recopié depuis la documentation source, jamais inventé ni arrondi pour "sonner mieux". Si le README ne précise pas un détail (licence, performance, statut de maintenance), ce détail n'apparaît pas dans le texte — mieux vaut une entrée plus courte qu'une entrée qui invente.

## Format de sortie

Réponds uniquement avec cet objet JSON, sans texte autour :

```json
{
  "title": "",
  "hook": "",
  "description": "",
  "body": "",
  "tags": [],
  "stack": []
}
```

`body` est du texte brut, paragraphes séparés par une ligne vide (`\n\n`) — jamais de HTML, jamais de Markdown, la mise en page est gérée ailleurs.
