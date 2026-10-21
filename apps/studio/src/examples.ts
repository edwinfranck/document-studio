// Documents d'exemple proposés depuis la bibliothèque.
export const EXAMPLES = {
  guide: `---
title: Guide StudioMD
subtitle: Le Markdown habituel, plus des composants pour la mise en page
author: Document Studio
version: "1.0"
---

# Le Markdown reste du Markdown

Tout fichier \`.md\` ordinaire fonctionne tel quel : **gras**, *italique*, [liens](https://commonmark.org), listes, tableaux, citations et code.

> Les extensions sont facultatives. Un composant s'ouvre par \`:::nom\` et se ferme par \`:::\`.

| Élément | Syntaxe | Rendu |
|---|---|---|
| Titre | \`## Titre\` | section numérotable |
| Tâche | \`- [x] fait\` | case cochée |
| Formule | \`$E = mc^2$\` | $E = mc^2$ |

- [x] Importer un fichier
- [ ] Choisir un gabarit
- [ ] Exporter en PDF

# Composants de contenu

:::callout {type="info" title="Encadré"}
Les types disponibles : \`info\`, \`note\`, \`tip\`, \`success\`, \`warning\`, \`danger\`. Les raccourcis \`:::warning\` ou \`:::tip\` fonctionnent aussi.
:::

:::warning
Un composant mal nommé n'efface jamais son contenu : il est encadré et signalé dans le panneau Problèmes.
:::

:::details {title="Un accordéon"}
Replié en lecture, toujours déplié à l'impression.
:::

:::tabs
:::tab {title="macOS"}
\`brew install pandoc\`
:::
:::tab {title="Linux"}
\`sudo apt install pandoc\`
:::
:::

:::pullquote {author="Robert Bringhurst"}
La typographie existe pour honorer le contenu.
:::

\`\`\`ts title="exemple.ts" lines
export function moyenne(notes: number[]): number {
  return notes.reduce((a, b) => a + b, 0) / notes.length;
}
\`\`\`

# Mise en page

:::stats
- label: Projets accompagnés
  value: 24
- label: Ateliers
  value: 12
- label: Participants
  value: 180
  hint: +40 % sur un an
:::

:::columns {ratio="3:2"}
:::column
## Deux colonnes

Les colonnes s'empilent sur téléphone et restent côte à côte à l'impression.
:::
:::column
:::card {title="Une carte" tone="accent"}
Pour isoler une information.
:::
:::
:::

:::grid {cols=3}
:::card {title="Un"}
Première case.
:::
:::card {title="Deux"}
Deuxième case.
:::
:::card {title="Trois"}
Troisième case.
:::
:::

:::section {bg="primary"}
## Section à fond coloré

Pour marquer un temps fort.
:::

# Rapport

:::pagebreak :::

Un saut de page force une nouvelle page à l'impression et une nouvelle diapositive en présentation. Une note de bas de page[^1] se place en fin de document.

[^1]: Comme celle-ci.

:::references
1. Bringhurst, R. *The Elements of Typographic Style*, 2004.
:::
`,
  deck: `---
title: Stratégie 2027
subtitle: Trois priorités pour l'année
author: Votre nom
date: Octobre 2026
---

# Où en est-on ?

## Un an de croissance

:::stats
- label: Étudiants accompagnés
  value: 180
- label: Projets
  value: 24
- label: Partenaires
  value: 9
:::

## Ce qui a marché

- Des ateliers courts et pratiques
- Un jury d'entreprises à chaque fin de cycle
- Un lieu ouvert tard le soir

:::notes
Insister sur le jury : c'est ce que les étudiants citent le plus.
:::

---

Le progrès n'est pas un lieu : c'est un rythme.

# Les trois priorités

## 1. Industrialiser l'accompagnement

:::columns
:::column
### Aujourd'hui
- Suivi au cas par cas
- Pas de jalons communs
:::
:::column
### Demain
- Parcours en quatre étapes
- Jalons partagés avec les mentors
:::
:::

## 2. Ouvrir aux entreprises

Un appel à projets par trimestre, porté par un partenaire.

## 3. Mesurer

Trois indicateurs suivis chaque mois : présence, avancement, satisfaction.

:::slide {layout="center" bg="dark"}
# Merci

Questions ?
:::
`,
};
