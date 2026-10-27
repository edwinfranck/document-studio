# Document Studio

Des fichiers Markdown vers des documents soignés : **page de lecture HTML**, **PDF paginé** et **diaporama HTML**, à partir du même texte. Le contenu ne change jamais quand on change de présentation.

*Turn plain Markdown into a polished reading page, a paginated PDF or an HTML slide deck, from the same source. 12 templates, live preview, a Markdown extension for layout components (StudioMD). French UI. MIT.*

**Essayer en ligne : https://document-studio-gules.vercel.app** (édition web, voir plus bas)

## Deux éditions

| | Serveur (`pnpm start`) | Édition web (Vercel) |
|---|---|---|
| Documents | fichiers ordinaires dans `~/DocumentStudio` | dans le navigateur (IndexedDB), sur cet appareil seulement |
| Comptes, partage, rôles, liens révocables | oui | non |
| Édition simultanée, commentaires, suggestions | oui | non |
| Versions signées, comparaison, validation, publication | oui | historique local seulement |
| PDF | généré par Chrome, téléchargé directement | boîte d'impression du navigateur : « Enregistrer au format PDF » |
| HTML, diaporama, paquet ZIP | oui | oui, générés dans la page |
| CLI `studio export` | oui | non |

La collaboration est décrite dans [docs/collaboration.md](docs/collaboration.md), avec l'hébergement pour une équipe (réseau local ou serveur HTTPS).

L'interface détecte seule le serveur local ; sans lui, elle bascule sur le stockage du navigateur. Aucun document ne quitte l'appareil dans l'édition web.

## Lancer en local

```sh
git clone https://github.com/edwinfranck/document-studio && cd document-studio
pnpm install
pnpm dev          # interface http://localhost:5317 (serveur local sur :4317)
pnpm start        # version compilée, tout sur http://127.0.0.1:4317
```

Les documents vivent dans `~/DocumentStudio` (variable `STUDIO_HOME` pour changer). Le PDF utilise Google Chrome installé (`STUDIO_CHROME=/chemin` sinon) : aucun service externe, rien ne part sur le réseau.

## En ligne de commande

```sh
pnpm studio export rapport.md                          # rapport.html, page de lecture autonome
pnpm studio export rapport.md --pdf --template editorial
pnpm studio export deck.md --slides --pdf              # une diapositive par page
pnpm studio export rapport.md --zip --pdf --out _sorties/
pnpm studio check rapport.md                           # diagnostics ; code de sortie 1 si erreur
pnpm studio templates                                  # gabarits disponibles
```

Un `rapport.studio.json` posé à côté du fichier (exporté depuis l'application) fixe gabarit et réglages.

## L'écran de travail

| Zone | Contenu |
|---|---|
| Gauche | Source (coloration, complétion `:::`, recherche Ctrl+F, diagnostics), plan, fichiers du document, panneau Problèmes |
| Centre | Aperçu réel : le HTML qui sera exporté. Zoom, largeur mobile/tablette, pages, diapositives. Cliquer un bloc ouvre ses réglages et place le curseur dans la source |
| Droite | Thème, document, typographie, couleurs (contraste WCAG), mise en page, composants, médias, en-têtes et pieds de page, export, mode expert |

Coller ou glisser une image dans la source l'ajoute au document et l'insère. Annuler / rétablir couvrent le texte et les réglages. Sauvegarde automatique, historique des versions, fichier importé conservé intact.

## Ce qui est fait

| Phase | État |
|---|---|
| 1. Socle : import, édition, aperçu en direct, gabarits, couleurs et polices, PDF, HTML, sauvegarde | fait, testé |
| 2. Qualité éditoriale : pagination (titres, paragraphes, tableaux), couvertures, sommaire paginé, en-têtes/pieds, images, typographie avancée, HTML autonome | fait, testé |
| 3. Présentations : découpage auto/manuel, navigation, plein écran, transitions, notes et vue présentateur, ajustement du texte, export HTML/PDF | fait |
| 4. StudioMD : grammaire, 24 composants, validation, complétion, documentation | fait, testé |
| 5. Gabarits perso (dupliquer, renommer, supprimer, importer/exporter), collections, paquet ZIP | fait |
| A. Responsive : ordinateur (3 panneaux), tablette (panneaux superposés), mobile (une vue, navigation en bas) | fait, vérifié à 390, 1024 et 1600 px |
| B. Comptes, rôles lecteur / commentateur / éditeur / propriétaire, invitations, liens (expiration, compte exigé, téléchargement), révocation | fait, testé |
| C. Édition simultanée (Yjs), présences, curseurs, reprise hors ligne, fichier modifié hors de l'application fusionné | fait, testé |
| D. Versions signées et regroupées, comparaison au mot, restauration non destructive, commentaires ancrés, suggestions, activité | fait, testé |
| E. Validation éditoriale, publications liées à une version, publications obsolètes signalées, notifications dans l'application | fait, testé |
| F. Blocs réutilisables versionnés, branches et fusion à trois voies, comparaison de deux gabarits | fait, testé |
| Notifications par e-mail, commentaires sur une zone de page PDF, espaces d'équipe | **non construit** (voir docs/collaboration.md) |
| Édition web hébergée (stockage navigateur, sans collaboration) | fait |
| Application de bureau (Tauri) | non construit : le moteur est prêt à être habillé |

12 gabarits : Éditorial, Documentation technique, Rapport corporate, Rapport de direction, Support pédagogique, Suisse, Académique, Brutaliste, KERNEL, Diapositives minimales, Cinématique, Formation.

## Déployer l'édition web

Site statique, aucune fonction serveur :

```sh
pnpm build:web            # -> apps/studio/dist
vercel --prod             # la configuration est dans vercel.json
```

## Tests

```sh
pnpm test                     # moteur (67) + serveur (52) : collaboration de bout en bout, exports PDF réels, non-régression visuelle
pnpm test:update-snapshots    # après un changement voulu d'un gabarit
pnpm typecheck
```

Corpus dans `tests/fixtures/` : document simple, rapport long, tableaux larges, code, images locales, accents et symboles, StudioMD imbriqué, présentation, document mal formé, contenu hostile.

## Fichiers

| Chemin | Rôle |
|---|---|
| `packages/engine/` | moteur : analyse, IR, thèmes, rendu des trois sorties, CSS et scripts embarqués (`src/assets/`) |
| `apps/server/` | stockage, API, exports, CLI (`bin/studio.mjs`) |
| `apps/studio/` | interface |
| `docs/studiomd.md` | grammaire StudioMD |
| `docs/composants.md` | référence des composants (générée : `pnpm docs`) |
| `docs/architecture.md` | pipeline, choix, données, sécurité |
| `docs/collaboration.md` | rôles, temps réel, versions, commentaires, validation, publication, hébergement |

## Licence

MIT. Les polices embarquées (Inter, Fraunces, Newsreader, Source Serif 4, IBM Plex, DM Sans, Lexend, Space Grotesk, JetBrains Mono, Anton) sont sous licence SIL Open Font License, via [Fontsource](https://fontsource.org).
