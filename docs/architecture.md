# Architecture

## Vue d'ensemble

```
apps/studio  (React + CodeMirror)          apps/server  (Node, 127.0.0.1)
  éditeur ─┐                                 stockage fichiers  ~/DocumentStudio
  aperçu ◄─┤  @studio/engine (même code)      exports HTML / PDF / ZIP  ◄── @studio/engine
  inspecteur                                  Chrome sans tête (PDF)
                                              CLI  studio export|check|serve
apps/desktop (Electron)
  fenêtre ── interface servie par le serveur, lancé dans un processus fils
  PDF ◄───── le serveur demande l'impression au Chromium d'Electron (IPC)
```

Un seul moteur, `packages/engine`, en TypeScript isomorphe : l'aperçu tourne dans le navigateur, les exports dans Node, avec le même code. Seul l'**environnement de rendu** change : URL servies par le serveur local pour l'aperçu, données intégrées (`data:`) pour les exports.

## Pipeline

| Étape | Fichier | Rôle |
|---|---|---|
| 1. Source | — | Markdown + front matter, jamais modifié par le rendu |
| 2. Découpage StudioMD | `scanner.ts` | lignes `:::` → arbre de composants (pile), blocs de code opaques |
| 3. Markdown | `parse.ts` | `remark` (CommonMark, GFM, maths) sur chaque segment, positions recalées |
| 4. IR | `parse.ts`, `types.ts` | arbre mdast + nœuds `component`, titres (id, numéros), ressources, diagnostics |
| 5. Thème | `themes.ts` | gabarit + surcharges → variables `--sd-*` ; palettes dérivées (sombre, diapositives) |
| 6. Rendu | `render.ts` | IR → HTML, comportement par cible, échappement systématique |
| 7. Assemblage | `targets.ts` | page de lecture · document paginé · diaporama |
| 8. Pagination | Paged.js (`assets/print.js`) | pages, marges, en-têtes, sommaire paginé, tableaux coupés |
| 9. PDF | `apps/server/src/browser.ts` | Chrome imprime le document déjà paginé |

Le contenu (IR) ne porte aucune propriété visuelle ; un changement de gabarit ne touche pas le texte (testé).

## Choix et compromis

| Choix | Pourquoi | Compromis |
|---|---|---|
| **Application de bureau Electron** plutôt que Tauri | Le PDF exige un Chromium : Electron l'embarque et imprime les documents paginés lui-même, sans Chrome installé ; la vue système de Tauri (WebKitGTK sous Linux) ne produit pas de PDF paginé fiable. Le serveur tourne tel quel dans un processus fils | Installable lourd (environ 130 Mo) |
| **Plugins déclaratifs** (JSON : attributs typés, gabarit HTML, CSS) plutôt que du code | Un plugin s'installe sans risque : rien ne s'exécute, chaque valeur est échappée selon son type, le gabarit est nettoyé | Pas de logique (calculs, données externes) dans un plugin |
| **Paged.js pour l'aperçu ET le PDF** | Le PDF est l'impression du document que l'aperçu affiche : même pagination, même moteur (Chrome) | Paged.js ignore certains sélecteurs (`:is()`, `:not()` composés, `body` dans les règles de coupure) : contourné, documenté dans `print.css` |
| **Moteur de diapositives maison** plutôt que reveal.js | Un fichier autonome léger, la même feuille de style que les documents, l'ajustement automatique du texte | Pas d'écosystème de plugins reveal |
| **Fichiers ordinaires + JSON** plutôt que SQLite | Le Markdown reste récupérable sans l'application ; aucune base opaque | Liste reconstruite par lecture des dossiers : suffisant jusqu'à quelques milliers de documents |
| **Rendu HTML maison** plutôt que `rehype-stringify` + assainisseur | Rien n'arrive au HTML sans échappement : la sécurité ne dépend pas d'une liste noire | Chaque nouveau type de nœud demande son rendu |
| **Polices embarquées** (`@fontsource`, licence OFL) | Rendu identique hors ligne et dans le PDF | 1,6 Mo de polices ; un export HTML pèse 0,5 à 1 Mo |

## Modèle de données

```
~/DocumentStudio/                     (STUDIO_HOME)
  documents/<id>/document.md          source courante
                 original.md          fichier importé, jamais réécrit
                 studio.json          { name, project, settings, createdAt, updatedAt, importedFrom }
                 assets/              images, vidéos, polices importées
                 history/<date>.md    une version au plus toutes les 2 min, 60 au plus
  themes/<id>.json                    gabarits personnels (Template)
  trash/<id>-<horodatage>/            documents supprimés
```

| Type (`packages/engine/src/types.ts`) | Contenu |
|---|---|
| `DocumentIR` | blocs, titres, ressources, diagnostics, métadonnées |
| `ComponentNode` | nom, attributs, classes, enfants, lignes début/fin |
| `ThemeTokens` | polices, échelle, couleurs, mise en page |
| `Template` | identité, catégorie, `tokens`, réglages page/diapositives, CSS propre |
| `DocSettings` | mode, gabarit, surcharges, page, diapositives, lecture, métadonnées, CSS, polices importées |

Écritures atomiques (fichier temporaire puis renommage). La collection (`project`) est un champ, pas un dossier : déplacer un document ne déplace aucun fichier.

## Sécurité

Les documents importés sont des données non fiables.

- **HTML brut** : jamais interprété, affiché comme texte (`<br>` toléré).
- **URL** : seuls `http(s)`, `mailto`, `tel`, ancres et chemins relatifs ; images `data:image/*`. Le reste est neutralisé et signalé.
- **Attributs** : toujours échappés ; couleurs et longueurs validées par motif.
- **Fichiers** : un document ne peut référencer que des fichiers de son dossier (pas de `../`). Noms de ressources nettoyés.
- **Aperçu** : iframe `sandbox="allow-scripts"` sans `allow-same-origin` ; les seuls scripts sont ceux du moteur. Les liens n'en sortent pas.
- **CSS personnalisé** : `@import`, `url()` distantes, `expression()` et balises retirés ; appliqué dans l'iframe isolée.
- **Export PDF** : toute requête réseau est bloquée pendant le rendu.
- **Serveur** : écoute `127.0.0.1` seulement ; SVG servis avec une CSP sans script.

Tests : `tests/fixtures/10-securite.md` et la section « sécurité » de `engine.test.ts`.

## Collaboration

Détail dans [collaboration.md](collaboration.md). En bref :

```
navigateur : CodeMirror + y-codemirror ─┐                    ┌─ collab.bin (état Yjs) + document.md (miroir)
             IndexedDB (hors ligne)      ├─ WebSocket /collab ┤  versions/<n>.json, comments.json, activity.jsonl
             REST /api (droits vérifiés) ┘   (y-protocols)    └─ audit.jsonl (sécurité, séparé)
```

| Choix | Pourquoi |
|---|---|
| Yjs + y-protocols, serveur WebSocket intégré | convergence des modifications concurrentes ; le serveur filtre les écritures selon le rôle |
| Commentaires en REST, pas dans le document Yjs | un commentateur peut commenter sans pouvoir écrire dans le document partagé |
| Ancres en positions relatives Yjs + citation | l'ancre suit le texte ; la citation permet de détecter un passage réécrit |
| Versions distinctes des mises à jour Yjs | l'historique lisible n'est pas le journal technique de synchronisation |
| Publications = fichiers HTML/PDF figés | un lien publié ne change pas quand le document bouge |

## Risques connus

| Risque | État |
|---|---|
| Écart aperçu / PDF | Faible : même HTML, même Paged.js, même Chrome. Les débordements sont mesurés et signalés dans les deux |
| Documents très longs | Rendu de 5 000 lignes < 1 s (testé) ; la pagination Paged.js d'une centaine de pages prend quelques secondes, l'aperçu garde l'ancienne version affichée en attendant |
| Coupure de tableaux | En-têtes répétés (testé) ; une ligne plus haute qu'une page reste un cas limite |
| Images distantes | Chargées dans l'aperçu, bloquées dans le PDF (rendu hors réseau) : à télécharger dans les fichiers du document |
| Serveur unique | Les salons temps réel vivent dans un seul processus : pas de répartition sur plusieurs serveurs |
| Plugins | Un plugin installé change le registre des composants du moteur pour tout le serveur ; un nom intégré ne peut pas être repris |
