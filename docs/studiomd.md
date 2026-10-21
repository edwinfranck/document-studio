# StudioMD : grammaire

StudioMD ajoute des **composants** au Markdown (CommonMark + GFM + formules `$…$`). Un fichier `.md` ordinaire n'a rien à changer : sans composant, il se rend tel quel.

La référence de chaque composant (attributs, comportement par sortie, exemple) est dans [composants.md](composants.md), générée depuis le registre du moteur.

## Forme d'un composant

```md
:::callout {type="warning" title="Attention"}
Contenu Markdown, **composants imbriqués** permis.
:::
```

- **Ouverture** : une ligne qui commence par au moins trois deux-points (`:::`, retrait de 0 à 3 espaces), suivis du nom du composant, puis, en option, d'attributs entre accolades. L'espace entre le nom et l'accolade est facultatif.
- **Fermeture** : une ligne qui ne contient que `:::` (trois deux-points ou plus).
- **Forme courte** : un composant sans contenu peut s'écrire sur une ligne : `:::pagebreak :::`.
- **Noms** : lettres, chiffres, `-` et `_`, sans distinction de casse. Les alias (`warning`, `tip`, `kpi`…) donnent des attributs implicites.

## Imbrication

La fermeture referme toujours **le composant ouvert le plus récent** (une pile). Le nombre de deux-points ne compte pas : `:::` suffit à tous les niveaux.

```md
:::columns {count=2}
:::column
## Gauche
:::
:::column
## Droite
:::
:::
```

Lire de haut en bas : `columns` s'ouvre, `column` s'ouvre, `:::` ferme `column`, etc. Le dernier `:::` ferme `columns`.

Les **blocs de code** (` ``` ` ou `~~~`) sont opaques : un `:::` à l'intérieur n'ouvre ni ne ferme rien.

## Attributs

```md
{type="info" title='Il a dit \"oui\"' count=2 open .classe #ancre}
```

| Forme | Sens |
|---|---|
| `clé="valeur"` ou `clé='valeur'` | chaîne ; `\"` et `\\` échappent le caractère suivant |
| `clé=valeur` | valeur sans espace ni `}` |
| `clé` | drapeau booléen (vrai) |
| `.nom` | classe CSS ajoutée au composant (ciblable par le CSS personnalisé) |
| `#nom` | identifiant d'ancre |

## Échappement

Pour écrire `:::` en début de ligne sans ouvrir de composant : `\:::texte`.

## Données

Les composants à contenu « données » (`stats`) lisent leur corps en YAML :

```md
:::stats
- label: Participants
  value: 180
  hint: +40 % sur un an
:::
```

## Validation : rien ne disparaît en silence

Chaque défaut produit un diagnostic avec son numéro de ligne (panneau Problèmes, `studio check`) :

| Situation | Gravité | Rendu |
|---|---|---|
| Composant inconnu | avertissement, avec suggestion (« vouliez-vous `callout` ? ») | contenu affiché dans un cadre « Composant inconnu » |
| Composant jamais fermé | erreur | fermé en fin de document, contenu conservé |
| `:::` sans composant ouvert | avertissement | ligne affichée telle quelle |
| Attribut inconnu | information | ignoré |
| Valeur hors liste (`type="urgent"`) | avertissement | valeur par défaut |
| Attribut obligatoire manquant (`src`) | erreur | cadre « image manquante » |
| Données YAML illisibles | erreur | données affichées brutes |
| Composant hors de son parent (`column` hors `columns`) | avertissement | rendu comme un bloc simple |
| Image introuvable | avertissement | cadre avec le chemin |
| HTML brut | avertissement | affiché comme texte (jamais interprété) |
| Lien `javascript:` / `data:` | avertissement | lien neutralisé |

## Une cible, un comportement

Chaque composant déclare son rendu pour les trois sorties. Un composant interactif devient statique là où l'interaction n'existe pas :

| | Lecture | Impression / PDF | Diaporama |
|---|---|---|---|
| `tabs` | onglets cliquables | chaque onglet à la suite, titré | idem |
| `details` | repliable | déplié | déplié |
| `video` | lecteur | affiche + légende + lien | lecteur |
| `pagebreak` | invisible | nouvelle page | nouvelle diapositive |
| `notes` | masqué | masqué | vue présentateur (touche P) |

## Diapositives

Sans aucun composant, un document devient un diaporama : chaque titre de niveau 1 ou 2 ouvre une diapositive (réglable : H1, H1–H2, H1–H3, manuel), une ligne `---` coupe aussi. Pour un contrôle fin :

```md
:::slide {layout="center" bg="dark"}
# Merci
:::notes
Annoncer la date du prochain point.
:::
:::
```

Mises en page détectées seules : `section` (titre seul), `statement` (une phrase courte), `image` (seulement des images). Une diapositive trop chargée voit son texte réduit jusqu'à 70 %, puis est signalée.

## Front matter

Facultatif, en YAML : `title`, `subtitle`, `author`, `organization`, `date`, `version`, `lang`. Sans `title`, le premier titre `#` devient le titre du document et le paragraphe ou la citation qui le suit, son sous-titre.

## Ajouter un composant

1. Le déclarer dans `packages/engine/src/registry.ts` : nom, attributs typés, type de contenu, comportement par cible, exemple. La validation, la complétion de l'éditeur, l'inspecteur et la documentation en découlent.
2. Écrire son rendu dans `component()` (`packages/engine/src/render.ts`), avec une branche par cible si nécessaire, et son style dans `assets/content.css`.
3. `pnpm docs`, puis `pnpm test`.

Le rendu n'accepte aucune chaîne non échappée : texte via `text()`, attributs via `esc()`, URL via `safeHref()` / `safeSrc()`, couleurs via `safeColor()`.
