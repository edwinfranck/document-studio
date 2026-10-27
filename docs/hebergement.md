# Hébergement

Trois façons de faire tourner le serveur Document Studio, du poste seul à l'équipe.

| Usage | Comment |
|---|---|
| Seul, sur son poste | l'application de bureau, ou `pnpm start` → http://127.0.0.1:4317 |
| Réseau local (bureau, salle de cours) | `STUDIO_HOST=0.0.0.0 pnpm start` → http://<ip-du-poste>:4317 |
| Équipe, en ligne | Docker derrière HTTPS (ci-dessous) |

## Serveur d'équipe avec Docker

Sur un serveur Linux avec Docker et un nom de domaine qui pointe vers lui :

```sh
git clone https://github.com/edwinfranck/document-studio && cd document-studio
cp deploy/.env.example .env      # renseigner STUDIO_DOMAIN, puis l'envoi d'e-mails
docker compose up -d
```

`docker-compose.yml` lance deux services :

- `studio` : le serveur, ses données dans le volume `studio-data` (`/data`) ;
- `caddy` : HTTPS automatique (Let's Encrypt) et relais des WebSocket de l'édition simultanée.

L'image est aussi publiée à chaque mise à jour de `main` : `ghcr.io/edwinfranck/document-studio:latest`.

Seule, sans proxy : `docker run -p 4317:4317 -v studio-data:/data ghcr.io/edwinfranck/document-studio`.

## Variables

| Variable | Rôle | Défaut |
|---|---|---|
| `STUDIO_HOME` | dossier des données | `~/DocumentStudio` (`/data` dans l'image) |
| `STUDIO_HOST`, `STUDIO_PORT` | adresse d'écoute | `127.0.0.1`, `4317` (`0.0.0.0` dans l'image) |
| `STUDIO_PUBLIC_URL` | adresse publique, pour les liens des e-mails | `http://127.0.0.1:4317` |
| `STUDIO_SIGNUP` | `invite` : seules les adresses invitées (document ou espace) créent un compte | `open` |
| `STUDIO_ADMINS` | adresses administratrices, séparées par des virgules (le premier compte l'est toujours) | — |
| `STUDIO_SMTP_URL` | serveur d'envoi : `smtps://utilisateur:motdepasse@smtp.exemple.org:465` | aucun envoi |
| `STUDIO_MAIL_FROM` | expéditeur des e-mails | `Document Studio <no-reply@localhost>` |
| `STUDIO_MAIL_DIR` | écrit les e-mails dans ce dossier au lieu de les envoyer (essais) | — |
| `STUDIO_CHROME` | chemin de Chrome ou Chromium pour les PDF | recherche automatique |
| `STUDIO_CHROME_NO_SANDBOX` | `1` en conteneur (le bac à sable de Chromium n'y a pas les espaces de noms requis) | `1` dans l'image |

## Autre proxy que Caddy

Le proxy doit transmettre les WebSocket de `/collab` et l'en-tête `X-Forwarded-Proto` (le cookie de session devient `Secure` en HTTPS). Avec nginx :

```nginx
location / {
  proxy_pass http://127.0.0.1:4317;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  client_max_body_size 60m;      # images et vidéos déposées dans les documents
}
```

## Sauvegarde

Tout tient dans le dossier des données : fichiers ordinaires et JSON, Markdown lisible sans l'application.

```sh
docker run --rm -v document-studio_studio-data:/data -v "$PWD":/sauvegarde alpine tar czf /sauvegarde/studio-$(date +%F).tgz -C /data .
```

Restaurer : arrêter le service, décompresser l'archive dans le volume, relancer.

## Conservation

- Journal de sécurité (`audit.jsonl`) : 180 jours, purgé au démarrage.
- Documents supprimés : déplacés dans `trash/`, récupérables à la main.
- Consultations des publications : compteurs par jour sur 400 jours, sans adresse IP ni identifiant.
