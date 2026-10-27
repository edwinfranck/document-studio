# Collaboration

Le serveur Document Studio (`pnpm start`, l'image Docker ou l'application de bureau) ajoute comptes, espaces d'équipe, partage, édition simultanée, commentaires, suggestions, historique signé, validation, publication et notifications par e-mail. L'édition web hébergée sur Vercel reste en solo : un site statique ne peut pas tenir les connexions temps réel.

Héberger pour une équipe (Docker, HTTPS, e-mails, sauvegardes) : [hebergement.md](hebergement.md).

Le premier compte créé devient propriétaire des documents déjà présents et administrateur du serveur (installation des plugins).

## Rôles

| | Lecteur | Commentateur | Éditeur | Propriétaire |
|---|:-:|:-:|:-:|:-:|
| Lire, télécharger (si le lien l'autorise) | ✓ | ✓ | ✓ | ✓ |
| Commenter, répondre, suggérer | | ✓ | ✓ | ✓ |
| Modifier, accepter ou refuser une suggestion, résoudre, assigner | | | ✓ | ✓ |
| Demander une relecture, créer une branche | | | ✓ | ✓ |
| Inviter, liens, ranger dans un espace, publier, restaurer une version, supprimer | | | | ✓ |

Les droits sont vérifiés par le serveur sur chaque requête et sur la connexion temps réel : un lecteur dont le navigateur serait modifié ne peut toujours rien écrire. Un changement de rôle ou une révocation s'applique aux connexions déjà ouvertes.

**Espaces d'équipe** : un espace réunit des membres (administrateurs ou membres). Un document rangé dans un espace est ouvert à ses membres avec le rôle choisi par son propriétaire (lecteur, commentateur ou éditeur) ; les administrateurs de l'espace en sont éditeurs. Retirer quelqu'un de l'espace coupe aussitôt ses connexions. Gabarits, identités, blocs et modèles de validation peuvent être rangés dans un espace : seuls ses membres les voient. Supprimer un espace rend les documents à leurs seuls propriétaires.

**Liens** : rôle, expiration (24 h à 90 jours), compte exigé ou non, téléchargement autorisé ou non, révocation immédiate. Pour un document confidentiel, exiger un compte : un lien difficile à deviner n'est pas une autorisation.

## Édition simultanée

- Modèle : Yjs. La source est un `Y.Text`, les réglages un `Y.Map`. Deux personnes peuvent écrire dans le même paragraphe : les deux saisies sont conservées.
- Présences : avatars en haut, curseurs nommés dans la source ; cliquer un avatar mène à sa ligne.
- Coupure réseau : les modifications sont gardées dans le navigateur (IndexedDB), l'état affiche « Hors ligne · modifications en attente », tout est renvoyé à la reconnexion.
- Annuler (Ctrl+Z) ne revient que sur ses propres modifications.
- `document.md` reste un fichier lisible, réécrit à chaque modification. Modifié à la main pendant que l'application tourne, il est fusionné comme une modification (version « Modifié hors de l'application »), jamais écrasé.

## Versions

Une version porte un numéro, une date, ses auteurs, un résumé (« section ajoutée : Budget · +42 mots ») et le texte complet. Regroupement :

1. quand une autre personne commence à écrire, la version de la précédente est enregistrée ;
2. après 30 s sans frappe, si la dernière version a plus de 5 min ;
3. quand le dernier participant quitte le document ;
4. à chaque action explicite : version nommée, restauration, demande de relecture, validation, publication, fusion.

Restaurer crée une nouvelle version : rien n'est effacé. Comparer deux versions affiche les lignes ajoutées et supprimées, affinées au mot, et à part les changements de mise en forme.

## Commentaires et suggestions

- Ancrés au texte par des positions relatives Yjs : ils suivent le passage quand il bouge. Passage réécrit ou supprimé : le commentaire l'indique (« Passage modifié »).
- Réponses, mentions `@nom` (notifiées), assignation, résolution, réouverture, journal de chaque fil.
- En diaporama, le commentaire mémorise la diapositive.
- Suggestion : texte de remplacement proposé (vide = suppression). Accepter l'applique au bon endroit ; si le passage a changé depuis, le serveur refuse et demande de relire.
- **Mode suggestion** (bouton « Suggérer » au-dessus de la source) : on tape directement dans le texte, comme avec le suivi des modifications d'un traitement de texte. Le document partagé n'est pas touché : les ajouts sont soulignés, les suppressions barrées, l'aperçu montre la version proposée. « Envoyer » découpe les changements au mot et crée une suggestion par changement. Si d'autres ont modifié le document pendant la saisie, chaque changement est replacé dans le texte actuel ; celui dont le passage a été réécrit est écarté et signalé. Accessible dès le rôle commentateur.
- **Zone d'une page** (bouton « Zone », en mode Impression) : on trace un rectangle sur la page paginée. Le commentaire garde la page, la zone (en proportion de la page, donc stable au zoom) et le texte qui s'y trouve. Les zones ouvertes sont numérotées sur les pages ; un clic ouvre le fil.

## Validation et publication

**Modèles de validation** : une liste de relecteurs et un nombre de validations, enregistrés depuis « Demander une relecture » et réappliqués d'un clic. Un relecteur du modèle qui n'a pas accès au document est signalé.

États : Brouillon, En révision, À corriger, En attente de validation, Approuvé, Publié, Archivé. Le propriétaire fixe le nombre de validations requises. Une validation porte sur une version précise ; toute modification ultérieure demande une nouvelle validation avant une publication officielle. Ouvrir le document ne vaut jamais validation.

Publier fige une version : `/p/<id>` (lecture), `/p/<id>/slides`, `/p/<id>/print`, `/p/<id>/pdf`. Visibilité publique ou réservée aux membres, retrait possible. Quand le document change, la publication est marquée obsolète.

**Consultations** : chaque publication compte ses ouvertures par format et par jour, et ses visiteurs du jour. Aucune adresse IP ni aucun identifiant n'est conservé : un visiteur est reconnu le temps d'une journée par une empreinte salée d'une clé tirée au hasard chaque jour, gardée en mémoire seulement. Historique de 400 jours.

## Identités visuelles

Une identité réunit logos, couleurs, polices, gabarit, couverture (bloc `:::cover`), en-tête et pied de page, organisation. On la gère dans Paramètres → Identités et on l'applique depuis le panneau Propriétés → Identité visuelle. Appliquer :

- modifie la présentation (réglages), jamais le texte, sauf la couverture si on la demande ;
- copie les logos dans les fichiers du document, qui reste lisible et exportable sans la bibliothèque ;
- note la version appliquée. Quand l'identité change, le document affiche « Version 4 disponible : couleurs, logos » et propose « Mettre à jour » ; rien ne change sans ce clic.

Chaque version d'une identité garde sa date, son auteur et un résumé des changements. Seuls l'auteur et les administrateurs de son espace la modifient.

## Notifications

Centre de notifications dans l'application, et e-mail quand le serveur sait en envoyer. Chaque compte règle, par catégorie (invitations, mentions et assignations, commentaires, suggestions, relectures, publications, autres changements), le canal : aucune, application, e-mail. Les e-mails partent aussitôt ou en un résumé quotidien. La frappe ne notifie jamais personne. Une adresse invitée sans compte reçoit un e-mail d'invitation.

## Branches et blocs

- **Branche** : copie de travail liée à une version. La fusion est à trois voies : les changements faits entre-temps sur le principal sont conservés ; un conflit reste entre marqueurs à trancher, jamais résolu en silence.
- **Blocs réutilisables** : `:::include {block="id" version=2} :::`. Le bloc reste à sa version jusqu'à « Mettre à jour » ; « Détacher » le remplace par une copie indépendante.

## Données

| Où | Quoi |
|---|---|
| `~/DocumentStudio/users.json` | comptes (mot de passe haché scrypt) |
| `sessions.json` | sessions (jeton en cookie httpOnly, 30 jours) |
| `documents/<id>/` | source, état Yjs, versions, commentaires, journal d'activité, médias |
| `audit.jsonl` | journal de sécurité (connexions, refus, droits, liens), conservé 180 jours |
| `publications/<id>/` | instantanés publiés |
| `notifications/`, `mailqueue/` | centre de notifications, résumés quotidiens en attente |
| `spaces.json` | espaces d'équipe, membres, invitations |
| `blocks/`, `themes/`, `brands/`, `workflow-templates.json` | blocs, gabarits, identités visuelles (et leurs logos), modèles de validation |
| `plugins/` | plugins de composants installés |
| `publications/<id>/stats.json` | compteurs de consultation (aucune donnée personnelle) |
| navigateur (IndexedDB) | copie locale du document collaboratif, pour le travail hors ligne |

Les collaborateurs voient : le texte, les réglages, les commentaires, l'historique, l'activité et les présences du document. Ils ne voient pas les adresses e-mail des autres comptes, sauf dans la fenêtre de partage du propriétaire.

## Limites connues

- Un seul processus serveur : les salons temps réel ne se répartissent pas sur plusieurs machines.
- Le mode suggestion travaille sur le texte source ; les changements de mise en forme (gabarit, couleurs) ne passent pas par les suggestions.
- Une zone de page vise la pagination du moment : si le texte se déplace d'une page à l'autre, la zone garde sa page et sa citation, qui permet de la retrouver.
