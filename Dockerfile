# Document Studio, serveur collaboratif : comptes, édition simultanée, exports PDF par Chromium.
#   docker build -t document-studio .
#   docker run -p 4317:4317 -v studio-data:/data document-studio
# Pour une équipe, servir derrière HTTPS : voir deploy/ et docs/hebergement.md.

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# Serveur et interface seulement (pas l'application de bureau) ; puis le serveur avec ses seules dépendances de production.
RUN pnpm install --frozen-lockfile --filter "@studio/server..." --filter "@studio/app..." \
 && pnpm build \
 && pnpm --filter @studio/server deploy --prod --legacy /out/server \
 && rm -rf /out/server/test \
 && mkdir -p /out/studio && cp -r apps/studio/dist /out/studio/dist

FROM node:22-bookworm-slim
# Chromium pour les PDF ; polices de secours pour les caractères absents des polices embarquées.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app
ENV NODE_ENV=production \
    STUDIO_HOST=0.0.0.0 \
    STUDIO_PORT=4317 \
    STUDIO_HOME=/data \
    STUDIO_CHROME=/usr/bin/chromium \
    STUDIO_CHROME_NO_SANDBOX=1
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["server/node_modules/.bin/tsx", "server/src/main.ts"]
