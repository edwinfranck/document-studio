// Document Studio, application de bureau.
// Le serveur local tourne dans un processus Node (celui d'Electron) ; l'interface s'ouvre dans une fenêtre.
// Les PDF sont imprimés par le Chromium d'Electron : aucun navigateur à installer à côté.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { fork } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Installé : serveur et interface dans les ressources (scripts/prepare.mjs). En développement : le dépôt.
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'studio', 'server') : path.join(__dirname, '..', 'server');
const SERVER_MAIN = path.join(SERVER_DIR, 'src', 'main.ts');
const TSX = pathToFileURL(require.resolve('tsx', { paths: [SERVER_DIR] })).href;

let server = null;
let base = '';
let win = null;

const freePort = () => new Promise((ok, ko) => {
  const s = net.createServer();
  s.unref();
  s.on('error', ko);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/** Imprime en PDF un document produit par le moteur, dans une fenêtre cachée sans accès réseau. */
async function renderPdf(html, kind) {
  const file = path.join(os.tmpdir(), `document-studio-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(file, html);
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, partition: 'export' } });
  w.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  const js = code => w.webContents.executeJavaScript(code);
  const until = async (code, ms = 60000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await js(code);
      if (v) return v;
      if (Date.now() > end) throw new Error('Délai dépassé pendant la préparation du PDF.');
      await new Promise(r => setTimeout(r, 120));
    }
  };
  try {
    await w.loadFile(file);
    let info = {};
    if (kind === 'print') {
      info = await until('window.__SD_PAGED || null');
      if (info.error) throw new Error('Pagination impossible : ' + info.error);
    } else if (kind === 'slides') {
      await until("document.documentElement.dataset.ready === '1'");
      info = await js('({ count: window.SD.count, overflows: window.SD.overflows() })');
    } else await js('document.fonts.ready.then(() => true)');
    const pdf = await w.webContents.printToPDF({
      preferCSSPageSize: true, printBackground: true, generateTaggedPDF: true, generateDocumentOutline: true,
      ...(kind === 'reading' ? { pageSize: 'A4', margins: { top: 0.71, bottom: 0.71, left: 0.63, right: 0.63 } } : {}),
    });
    return { pdf, info };
  } finally {
    w.destroy();
    fs.rmSync(file, { force: true });
  }
}

async function startServer() {
  const port = await freePort();
  server = fork(SERVER_MAIN, [], {
    cwd: SERVER_DIR,
    execArgv: ['--import', TSX],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', STUDIO_HOST: '127.0.0.1', STUDIO_PORT: String(port), STUDIO_PDF_VIA_PARENT: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  server.on('message', async m => {
    if (!m || m.type !== 'pdf') return;
    try {
      const r = await renderPdf(m.html, m.kind);
      server.send({ type: 'pdf-result', id: m.id, pdf: Buffer.from(r.pdf).toString('base64'), info: r.info });
    } catch (e) { server.send({ type: 'pdf-result', id: m.id, error: e.message || String(e) }); }
  });
  server.on('exit', code => {
    if (app.isQuitting) return;
    dialog.showErrorBox('Document Studio', `Le serveur local s'est arrêté (code ${code}). Relancez l'application.`);
    app.quit();
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* pas encore prêt */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Le serveur local ne répond pas.');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 380, minHeight: 500, show: false, backgroundColor: '#f7f7f8', title: 'Document Studio',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Liens externes dans le navigateur ; diaporama et aperçus (blob:) dans une fenêtre de l'application.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || url.startsWith(base)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 800, autoHideMenuBar: true } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.once('ready-to-show', () => win.show());
  win.loadURL(base);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'Fichier', submenu: [{ label: 'Dossier des documents', click: () => shell.openPath(process.env.STUDIO_HOME || path.join(os.homedir(), 'DocumentStudio')) }, { type: 'separator' }, { role: 'quit', label: 'Quitter' }] },
      { label: 'Édition', submenu: [{ role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' }, { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
      { label: 'Affichage', submenu: [{ role: 'reload', label: 'Recharger' }, { role: 'togglefullscreen', label: 'Plein écran' }, { type: 'separator' }, { role: 'resetZoom', label: 'Taille réelle' }, { role: 'zoomIn', label: 'Zoom avant' }, { role: 'zoomOut', label: 'Zoom arrière' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'Outils de développement' }] },
    ]));
    try { await startServer(); createWindow(); }
    catch (e) { dialog.showErrorBox('Document Studio', e.message); app.quit(); }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { app.isQuitting = true; if (server && !server.killed) server.kill('SIGTERM'); });
}

module.exports = { renderPdf };
