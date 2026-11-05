# Projets ZIP et documentation multi-pages

Une archive ZIP de fichiers Markdown, avec leurs images et documents, devient en quelques étapes une documentation navigable, un document continu ou un ensemble de documents.

## Le parcours

1. **Importer** : bouton « Projet ZIP » de la bibliothèque (sur mobile, il ouvre le sélecteur de fichiers), ou archive glissée sur la page sur ordinateur. La progression s'affiche ; « Annuler l'import » arrête l'envoi.
2. **Analyse** : l'archive est lue sans être extraite. Le rapport donne le nombre de pages, de dossiers, d'images et d'autres fichiers, les liens entre pages, les liens cassés, l'arborescence complète et la page d'accueil proposée (`README.md`, `index.md`…). Chaque problème est situé (fichier, ligne). Quand un lien cassé a un équivalent probable (casse différente, fichier déplacé), une correction est proposée et peut être appliquée.
3. **Mode** : documentation multi-pages, document continu ou documents séparés. Le mode conseillé dépend de l'archive : pages dans des dossiers ou liées entre elles → documentation ; pages au même niveau sans lien → chapitres à fusionner.
4. **Organisation** : nom, ordre (glisser une ligne, ou flèches sur mobile), titres, pages à laisser de côté, page d'accueil.
5. **Thème** : le gabarit de départ.
6. **Construction** : tout ou rien. Si une étape échoue, ce qui a été créé est retiré et le message dit pourquoi.

Chaque étape permet de revenir en arrière ; rien n'est créé avant la dernière.

## Les trois modes

| | Documentation multi-pages | Document continu | Documents séparés |
|---|---|---|---|
| Résultat | un projet : une page par fichier | un document, un chapitre par fichier | un document par fichier, dans une collection |
| Liens entre fichiers | navigation entre pages | renvois internes (ancres) | conservés tels quels |
| Images | gardées à leur chemin d'origine | copiées dans le document | copiées dans chaque document |
| Édition web (sans serveur) | non | oui | oui |

## Lire un projet

La page s'affiche comme sur le site exporté : navigation latérale (les dossiers deviennent des groupes, leur README en est la page), fil d'Ariane, sommaire de la page, pages précédente et suivante, recherche dans toutes les pages (Ctrl+K), mode clair ou sombre. Sur mobile, la navigation passe dans un menu. Les liens entre fichiers (`./chapitre-2.md#section`) mènent à la bonne page sans recharger l'application.

Panneaux du projet : **Pages** (ordre, titres, accueil, nouvelle page, suppression), **Apparence** (gabarit, polices, couleurs, largeur de lecture, titres, tableaux, logo, pied de page des PDF, identités visuelles), **Partager** (invitations, liens, espace d'équipe, publication), **Historique** (toutes les pages réunies).

## Modifier une page

« Modifier la page » ouvre l'éditeur habituel : édition simultanée, commentaires, suggestions, versions. Les réglages changés dans une page ne valent que pour elle : seuls ses écarts sont gardés, le reste suit l'apparence du projet.

## Exporter et publier

- **Site HTML (.zip)** : une page HTML par fichier, à son chemin d'origine, ressources comprises, polices et index de recherche partagés. S'ouvre hors ligne.
- **PDF unique** : toutes les pages dans l'ordre du projet, avec ou sans couverture, sommaire paginé.
- **Un PDF par page** (.zip).
- **Archive d'origine** : le ZIP importé, intact.
- **Publication** : le site figé sous `/p/<id>/`, public ou réservé aux membres, avec le compte des consultations.

## Conventions reconnues

Les dépôts de documentation mêlent souvent Markdown, Pandoc et HTML. Sans réécrire les sources :

- une image écrite par son seul nom (`persona.png`) est retrouvée quand un seul fichier de l'archive porte ce nom (`img/persona.png`) ; s'il y a deux homonymes, rien n'est choisi au hasard et le rapport propose une correction ;
- la largeur Pandoc `![x](a.png){width=60%}` s'applique à l'image ;
- `\newpage`, `\pagebreak` et `\clearpage` seuls sur leur ligne deviennent des sauts de page à l'impression ; les autres commandes LaTeX isolées (`\vspace{3em}`) sont ignorées et signalées ;
- `<img>`, `<a href>` et `<br>` sont reconstruits par le moteur à partir de leurs seuls attributs sûrs (source, texte alternatif, dimensions, alignement, adresse) ; le reste du HTML s'affiche en texte ;
- plusieurs pages au même titre (« Workshop ») sont distinguées par leur sous-titre de front matter, à défaut par leur nom de fichier ; un README sans titre prend le nom de son dossier.

## Ce qui est conservé

- L'archive importée (`sites/<id>/original.zip`), jamais modifiée.
- Chaque fichier Markdown tel qu'importé (`sites/<id>/sources/`, et « Télécharger le fichier importé » dans chaque page), même quand une correction de lien a été appliquée.
- L'arborescence et les noms des fichiers, pour les pages comme pour les ressources.

## Sécurité et limites

- Aucun fichier de l'archive n'est exécuté. Les pages HTML, scripts et exécutables sont refusés et listés (« non importé »), comme les fichiers système des outils de compression.
- Un chemin qui sort du dossier (`../`), un chemin absolu ou un nom illisible est refusé.
- Deux fichiers qui ne diffèrent que par la casse : le second est refusé et signalé.
- Limites réglables : `STUDIO_IMPORT_MAX_MB` (archive décompressée, 300 Mo), `STUDIO_IMPORT_MAX_FILE_MB` (fichier, 50 Mo), `STUDIO_IMPORT_MAX_FILES` (2 000), `STUDIO_IMPORT_MAX_DEPTH` (12 niveaux de dossiers).
- Les droits du projet valent pour toutes ses pages ; un lien de partage du projet ouvre ses pages.
