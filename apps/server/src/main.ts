// Démarrage du serveur local. Par défaut il n'écoute que sur 127.0.0.1 ; pour collaborer à plusieurs,
// STUDIO_HOST=0.0.0.0 (réseau local) ou un hébergement derrière HTTPS (voir docs/collaboration.md).
import { createApp } from './app.ts';
import { HOME } from './store.ts';
import { flushAll } from './collab.ts';
import { closeBrowser, findChrome } from './browser.ts';

const PORT = Number(process.env.STUDIO_PORT || 4317);
const HOST = process.env.STUDIO_HOST || '127.0.0.1';
const server = createApp();
server.listen(PORT, HOST, () => {
  console.log(`Document Studio : http://${HOST}:${PORT}  ·  données dans ${HOME}`);
  if (!findChrome()) console.warn('Aucun Chrome trouvé : l\'export PDF sera indisponible (STUDIO_CHROME=/chemin/vers/chrome).');
});
const stop = async () => { flushAll(); await closeBrowser().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
