# Collaboration

Le serveur Document Studio (`pnpm start`) ajoute comptes, partage, édition simultanée, commentaires, suggestions, historique signé, validation et publication. L'édition web hébergée sur Vercel reste en solo : un site statique ne peut pas tenir les connexions temps réel.

## Héberger pour une équipe

| Usage | Commande |
|---|---|
| Sur son poste | `pnpm start` → http://127.0.0.1:4317 |
| Réseau local (bureau, salle) | `STUDIO_HOST=0.0.0.0 pnpm start` → http://<ip-du-poste>:4317 |
| Serveur (VPS) | derrière un proxy HTTPS qui transmet les WebSocket (`/collab`) |
| Inscriptions fermées | `STUDIO_SIGNUP=invite` : seules les adresses invitées sur un document peuvent créer un compte |

Exemple nginx :

```nginx
location / {
  proxy_pass http://127.0.0.1:4317;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-Proto $scheme;   # cookie de session « Secure » en HTTPS
  proxy_read_timeout 1h;
}
```

Le premier compte créé devient propriétaire des documents déjà présents.

## Rôles

| | Lecteur | Commentateur | Éditeur | Propriétaire |
|---|:-:|:-:|:-:|:-:|
| Lire, télécharger (si le lien l'autorise) | ✓ | ✓ | ✓ | ✓ |
| Commenter, répondre, suggérer | | ✓ | ✓ | ✓ |
| Modifier, accepter ou refuser une suggestion, résoudre, assigner | | | ✓ | ✓ |
| Demander une relecture, créer une branche | | | ✓ | ✓ |
| Inviter, liens, publier, restaurer une version, supprimer | | | | ✓ |

Les droits sont vérifiés par le serveur sur chaque requête et sur la connexion temps réel : un lecteur dont le navigateur serait modifié ne peut toujours rien écrire. Un changement de rôle ou une révocation s'applique aux connexions déjà ouvertes.

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

## Validation et publication

États : Brouillon, En révision, À corriger, En attente de validation, Approuvé, Publié, Archivé. Le propriétaire fixe le nombre de validations requises. Une validation porte sur une version précise ; toute modification ultérieure demande une nouvelle validation avant une publication officielle. Ouvrir le document ne vaut jamais validation.

Publier fige une version : `/p/<id>` (lecture), `/p/<id>/slides`, `/p/<id>/print`, `/p/<id>/pdf`. Visibilité publique ou réservée aux membres, retrait possible. Quand le document change, la publication est marquée obsolète.

## Branches, blocs, notifications

- **Branche** : copie de travail liée à une version. La fusion est à trois voies : les changements faits entre-temps sur le principal sont conservés ; un conflit reste entre marqueurs à trancher, jamais résolu en silence.
- **Blocs réutilisables** : `:::include {block="id" version=2} :::`. Le bloc reste à sa version jusqu'à « Mettre à jour » ; « Détacher » le remplace par une copie indépendante.
- **Notifications** dans l'application : invitations, mentions, assignations, réponses, suggestions, demandes de relecture, décisions, publications.

## Données

| Où | Quoi |
|---|---|
| `~/DocumentStudio/users.json` | comptes (mot de passe haché scrypt) |
| `sessions.json` | sessions (jeton en cookie httpOnly, 30 jours) |
| `documents/<id>/` | source, état Yjs, versions, commentaires, journal d'activité, médias |
| `audit.jsonl` | journal de sécurité (connexions, refus, droits, liens), conservé 180 jours |
| `publications/<id>/` | instantanés publiés |
| `notifications/`, `blocks/`, `themes/` | centre de notifications, bibliothèque de blocs, gabarits |
| navigateur (IndexedDB) | copie locale du document collaboratif, pour le travail hors ligne |

Les collaborateurs voient : le texte, les réglages, les commentaires, l'historique, l'activité et les présences du document. Ils ne voient pas les adresses e-mail des autres comptes, sauf dans la fenêtre de partage du propriétaire.

## Ce qui n'est pas fait

- Notifications par e-mail : aucun envoi de courrier n'est configuré ; les notifications restent dans l'application.
- Commentaires sur une zone précise d'une page PDF : les commentaires visent le texte source ou une diapositive.
- Suivi des modifications en tapant directement (mode Word) : une suggestion se rédige dans le panneau de commentaires.
- Espaces d'équipe (documents, gabarits et membres partagés par groupe) : les droits sont posés document par document.
- Statistiques de consultation des publications.
