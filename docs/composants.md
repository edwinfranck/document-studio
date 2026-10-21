# Référence des composants StudioMD

> Fichier généré par `pnpm docs` depuis `packages/engine/src/registry.ts`. Ne pas éditer à la main.

## Contenu

### `callout` · Encadré

Met en valeur une information, un conseil ou un avertissement.

Alias : `info` (type=info), `note` (type=note), `tip` (type=tip), `success` (type=success), `warning` (type=warning), `danger` (type=danger), `attention` (type=warning), `important` (type=danger).

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `type` | `info` `note` `tip` `success` `warning` `danger` | `info` | Nature de l'encadré, qui fixe sa couleur et son icône. |
| `title` | string |  | Titre affiché en tête. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Encadré coloré avec icône. | Identique, jamais coupé entre deux pages s'il tient sur une page. | Encadré agrandi à la taille de la diapositive. |

```md
:::callout {type="warning" title="Attention"}
La salle ferme à 18 h.
:::
```

### `details` · Accordéon

Contenu repliable, ouvert d'un clic.

Alias : `accordion`.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `title` * | string |  | Libellé toujours visible. |
| `open` | boolean |  | Ouvert au chargement. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Repliable (<details>). | Toujours déplié : le titre puis le contenu. | Toujours déplié. |

```md
:::details {title="Voir le détail du calcul"}
Le total inclut la TVA.
:::
```

### `tabs` · Onglets

Plusieurs variantes d'un même contenu, une visible à la fois.

Contenu : Markdown (composants imbriqués permis).

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Onglets cliquables. | Chaque onglet à la suite, sous son titre. | Chaque onglet à la suite, sous son titre. |

```md
:::tabs
:::tab {title="macOS"}
`brew install pandoc`
:::
:::tab {title="Linux"}
`apt install pandoc`
:::
:::
```

### `tab` · Onglet

Un onglet d'un bloc d'onglets.

Se place dans un bloc `tabs`.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `title` * | string |  | Libellé de l'onglet. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Panneau d'onglet. | Section titrée. | Section titrée. |

```md
:::tab {title="Windows"}
…
:::
```

### `pullquote` · Citation mise en valeur

Une phrase en grand, avec son auteur.

Alias : `quote`.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `author` | string |  | Auteur de la citation. |
| `source` | string |  | Fonction, ouvrage ou date. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Citation en grand corps. | Citation en grand corps, insécable. | Occupe la diapositive. |

```md
:::pullquote {author="Grace Hopper"}
Le plus dangereux : « on a toujours fait comme ça ».
:::
```

### `image` · Image légendée

Image avec légende, largeur et alignement.

Alias : `figure`.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `src` * | url |  | Chemin relatif au document ou URL. |
| `alt` | string |  | Texte alternatif (accessibilité). Fortement recommandé. |
| `caption` | string |  | Légende sous l'image. |
| `width` | string |  | Largeur : 50%, 320px… Par défaut, la largeur du texte. |
| `align` | `center` `left` `right` `full` | `center` | Alignement ; full déborde sur toute la largeur. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Figure légendée. | Figure insécable, image et légende sur la même page. | Image ajustée à l'espace disponible. |

```md
:::image {src="./assets/atelier.jpg" alt="Atelier" caption="Session de travail"}
:::
```

### `gallery` · Galerie

Grille d'images ; chaque image markdown du bloc devient une vignette légendée par son texte alternatif.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `cols` | number | `3` | Nombre de colonnes. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Grille responsive. | Grille, insécable si possible. | Grille. |

```md
:::gallery {cols=2}
![Avant](./avant.jpg)
![Après](./apres.jpg)
:::
```

### `video` · Vidéo

Vidéo locale ou distante (fichier mp4/webm).

Contenu : aucun.

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `src` * | url |  | Fichier vidéo. |
| `poster` | url |  | Image affichée avant lecture et dans le PDF. |
| `caption` | string |  | Légende. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Lecteur vidéo. | Image de l'affiche (ou un cadre) avec la légende et le lien : le PDF ne lit pas les vidéos. | Lecteur vidéo. |

```md
:::video {src="./demo.mp4" poster="./demo.jpg" caption="Démonstration"}
:::
```

## Mise en page

### `columns` · Colonnes

Contenu en colonnes ; chaque colonne est un bloc :::column.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `count` | number |  | Nombre de colonnes (par défaut, le nombre de blocs column). |
| `ratio` | string |  | Proportions, ex. « 2:1 ». |
| `gap` | `small` `medium` `large` | `medium` | Espace entre colonnes. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Colonnes, empilées sur mobile. | Colonnes. | Colonnes. |

```md
:::columns {count=2}
:::column
## Réalisations
…
:::
:::column
## Prochaines étapes
…
:::
:::
```

### `column` · Colonne

Une colonne d'un bloc :::columns.

Se place dans un bloc `columns`.

Contenu : Markdown (composants imbriqués permis).

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Colonne. | Colonne. | Colonne. |

```md
:::column
…
:::
```

### `grid` · Grille

Grille automatique : chaque bloc enfant (carte, image, paragraphe) occupe une case.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `cols` | number | `3` | Nombre de colonnes. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Grille responsive. | Grille. | Grille. |

```md
:::grid {cols=3}
:::card {title="Un"}
…
:::
:::card {title="Deux"}
…
:::
:::
```

### `card` · Carte

Bloc encadré avec titre facultatif.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `title` | string |  | Titre de la carte. |
| `tone` | `default` `primary` `accent` `muted` | `default` | Teinte de fond. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Carte. | Carte insécable. | Carte. |

```md
:::card {title="Objectif"}
Former 200 étudiants.
:::
```

### `stats` · Chiffres clés

Rangée de chiffres clés. Contenu : une liste YAML de label / value (et hint facultatif).

Alias : `kpi`.

Contenu : données YAML.

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Rangée de chiffres. | Rangée de chiffres insécable. | Chiffres en très grand. |

```md
:::stats
- label: Projets accompagnés
  value: 24
- label: Participants
  value: 180
  hint: +40 % sur un an
:::
```

### `section` · Section à fond

Bloc avec fond coloré, pleine largeur si demandé.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `bg` | string | `surface` | Fond : surface, primary, accent, dark, ou une couleur #hex. |
| `full` | boolean |  | Déborde sur toute la largeur de la page. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Bande de couleur. | Bloc de couleur (fonds imprimés). | Fond de la zone. |

```md
:::section {bg="primary"}
## Notre ambition
…
:::
```

### `aside` · Encadré latéral

Note de marge : à côté du texte sur grand écran, en ligne ailleurs.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `title` | string |  | Titre. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Dans la marge sur grand écran. | Encadré en ligne, corps réduit. | Encadré. |

```md
:::aside {title="Le saviez-vous ?"}
…
:::
```

### `spacer` · Espace

Espace vertical contrôlé.

Contenu : aucun.

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `size` | `small` `medium` `large` `xlarge` | `medium` | Hauteur. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Espace. | Espace (supprimé en haut de page). | Espace. |

```md
:::spacer {size="large"} :::
```

## Présentation

### `slide` · Diapositive

Une diapositive explicite, avec sa mise en page et son fond.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `layout` | `default` `cover` `section` `center` `split` `image` `statement` `closing` | `default` | Mise en page. |
| `bg` | string |  | Fond : light, dark, primary, accent, ou #hex. |
| `image` | url |  | Image de fond. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Section ordinaire (le contenu reste lisible). | Section ordinaire. | Une diapositive. |

```md
:::slide {layout="center" bg="dark"}
# Merci
:::
```

### `notes` · Notes du présentateur

Visibles seulement dans la vue présentateur.

Contenu : Markdown (composants imbriqués permis).

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Masquées. | Masquées. | Vue présentateur (touche P). |

```md
:::notes
Rappeler les chiffres de l'an dernier.
:::
```

## Rapport

### `cover` · Couverture personnalisée

Remplace le contenu de la couverture générée à partir des métadonnées.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `bg` | string |  | Fond : primary, dark, accent ou #hex. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| En-tête du document. | Première page. | Première diapositive. |

```md
:::cover
# Rapport annuel
2026
:::
```

### `toc` · Sommaire

Sommaire à cet endroit (sinon, selon le gabarit).

Contenu : aucun.

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `depth` | number | `2` | Profondeur des titres listés. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Sommaire en ligne. | Sommaire avec numéros de page. | Diapositive de sommaire. |

```md
:::toc {depth=2} :::
```

### `pagebreak` · Saut de page

Force une nouvelle page à l'impression ; coupe aussi la diapositive.

Alias : `newpage`.

Contenu : aucun.

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Invisible. | Nouvelle page. | Nouvelle diapositive. |

```md
:::pagebreak :::
```

### `appendix` · Annexe

Annexe : nouvelle page, titres préfixés « Annexe A », « Annexe B »…

Contenu : Markdown (composants imbriqués permis).

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Section titrée. | Commence sur une nouvelle page. | Diapositives ordinaires. |

```md
:::appendix
## Méthodologie
…
:::
```

### `references` · Références

Bibliographie : une liste dont chaque élément est une référence.

Alias : `bibliography`.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `title` | string | `Références` | Titre de la section. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Liste numérotée en retrait. | Liste numérotée, retrait suspendu. | Liste. |

```md
:::references
1. Bringhurst, R. *The Elements of Typographic Style*, 2004.
:::
```

### `table` · Tableau

Options de présentation pour le tableau markdown qu'il contient.

Contenu : Markdown (composants imbriqués permis).

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `caption` | string |  | Légende. |
| `style` | `lines` `zebra` `grid` `minimal` |  | Style (sinon celui du gabarit). |
| `compact` | boolean |  | Corps et cellules réduits, pour les tableaux larges. |
| `wide` | boolean |  | Utilise toute la largeur de la page. |

| Lecture | Impression / PDF | Diaporama |
|---|---|---|
| Défilement horizontal si trop large. | En-têtes répétés sur chaque page ; réduit si trop large. | Tableau. |

```md
:::table {caption="Budget 2026" style="zebra" compact}
| Poste | Montant |
|---|--:|
| Matériel | 1 200 € |
:::
```
