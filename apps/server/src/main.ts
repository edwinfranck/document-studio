// Serveur local de Document Studio : API de stockage, exports, polices, et l'interface compilée.
// N'écoute que sur 127.0.0.1 : rien n'est exposé au réseau.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS_DIR, KATEX_DIR, MIME, PAGEDJS_FILE } from '@studio/engine/node';
import * as S from './store.ts';
import { exportPdf, exportZip, renderHtml, type ExportInput } from './export.ts';
import { closeBrowser, findChrome } from './browser.ts';
import type { DocSettings, Target } from '@studio/engine';

const PORT = Number(process.env.STUDIO_PORT || 4317);
const UI_DIST = resolve(fileURLToPath(import.meta.url), '../../../studio/dist');
const MAX_BODY = 60 * 1024 * 1024;

type Handler = (req: IncomingMessage, res: ServerResponse, p: Record<string, string>, url: URL) => Promise<void> | void;
const routes: { method: string; re: RegExp; keys: string[]; fn: Handler }[] = [];
const route = (method: string, path: string, fn: Handler) => {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, fn });
};

const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const send = (res: ServerResponse, body: Buffer | string, type: string, filename?: string) => {
  const h: Record<string, string> = { 'content-type': type, 'cache-control': 'no-store' };
  if (filename) h['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  res.writeHead(200, h);
  res.end(body);
};

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) throw new S.HttpError(413, 'Fichier trop volumineux (60 Mo au plus).');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const bodyJson = async (req: IncomingMessage) => {
  const b = await body(req);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw new S.HttpError(400, 'JSON invalide.'); }
};

function serveFile(res: ServerResponse, file: string, cors = false, immutable = false) {
  if (!existsSync(file) || !statSync(file).isFile()) { json(res, { error: 'Fichier introuvable.' }, 404); return; }
  const h: Record<string, string> = { 'content-type': MIME[extname(file).toLowerCase()] || ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' } as Record<string, string>)[extname(file)] || 'application/octet-stream' };
  // L'aperçu est une iframe isolée (origine nulle) : polices et scripts doivent autoriser toute origine.
  if (cors) h['access-control-allow-origin'] = '*';
  h['cache-control'] = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
  h['x-content-type-options'] = 'nosniff';
  if (extname(file).toLowerCase() === '.svg') h['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  res.writeHead(200, h);
  createReadStream(file).pipe(res);
}

const exportInput = (id: string, overrides: { settings?: Partial<DocSettings>; markdown?: string }): ExportInput => {
  const d = S.getDoc(id);
  return { markdown: overrides.markdown ?? d.markdown, settings: overrides.settings ?? d.settings, dir: S.docDir(id), name: d.name, themes: S.listThemes() };
};

/* ---------- Routes ---------- */

route('GET', '/api/health', (_q, res) => json(res, { ok: true, home: S.HOME, chrome: findChrome() }));

route('GET', '/api/docs', (_q, res) => json(res, S.listDocs()));
route('POST', '/api/docs', async (req, res) => json(res, S.createDoc(await bodyJson(req)), 201));
route('GET', '/api/docs/:id', (_q, res, p) => json(res, S.getDoc(p.id)));
route('PUT', '/api/docs/:id', async (req, res, p) => json(res, S.updateDoc(p.id, await bodyJson(req))));
route('DELETE', '/api/docs/:id', (_q, res, p) => { S.deleteDoc(p.id); json(res, { ok: true }); });
route('POST', '/api/docs/:id/duplicate', (_q, res, p) => json(res, S.duplicateDoc(p.id), 201));
route('GET', '/api/docs/:id/source', (_q, res, p, url) => {
  const d = S.getDoc(p.id);
  const original = url.searchParams.get('original') === '1';
  send(res, S.readOriginal(p.id, original), 'text/markdown; charset=utf-8', `${d.name}${original ? ' (original)' : ''}.md`);
});
route('GET', '/api/docs/:id/settings', (_q, res, p) => {
  const d = S.getDoc(p.id);
  send(res, JSON.stringify({ name: d.name, settings: d.settings }, null, 2), 'application/json', `${d.name}.studio.json`);
});
route('GET', '/api/docs/:id/history', (_q, res, p) => json(res, S.listHistory(p.id)));
route('GET', '/api/docs/:id/history/:snap', (_q, res, p) => json(res, { markdown: S.readHistory(p.id, p.snap) }));

route('GET', '/api/docs/:id/assets/:name', (_q, res, p) => serveFile(res, S.assetPath(p.id, decodeURIComponent(p.name))));
route('PUT', '/api/docs/:id/assets/:name', async (req, res, p) => json(res, S.putAsset(p.id, decodeURIComponent(p.name), await body(req)), 201));
route('DELETE', '/api/docs/:id/assets/:name', (_q, res, p) => { S.deleteAsset(p.id, decodeURIComponent(p.name)); json(res, { ok: true }); });

route('POST', '/api/docs/:id/export', async (req, res, p) => {
  const b = await bodyJson(req);
  const format = String(b.format || 'html');
  const mode: Target = ['reading', 'print', 'slides'].includes(b.mode) ? b.mode : 'reading';
  const input = exportInput(p.id, b);
  const base = input.name.replace(/[\\/:*?"<>|]+/g, '-');
  if (format === 'html') {
    const r = renderHtml(input, mode);
    send(res, r.html, 'text/html; charset=utf-8', `${base}${mode === 'slides' ? ' - diaporama' : mode === 'print' ? ' - impression' : ''}.html`);
  } else if (format === 'pdf') {
    const r = await exportPdf(input, mode);
    res.setHeader('x-studio-info', encodeURIComponent(JSON.stringify(r.info)));
    send(res, r.pdf, 'application/pdf', `${base}.pdf`);
  } else if (format === 'zip') {
    const z = await exportZip(input, b.pdf !== false && !!findChrome());
    send(res, z.zip, 'application/zip', z.filename);
  } else throw new S.HttpError(400, `Format inconnu : ${format}`);
});

route('GET', '/api/themes', (_q, res) => json(res, S.listThemes()));
route('POST', '/api/themes', async (req, res) => json(res, S.saveTheme(await bodyJson(req)), 201));
route('DELETE', '/api/themes/:id', (_q, res, p) => { S.deleteTheme(p.id); json(res, { ok: true }); });

/* Ressources du moteur pour l'aperçu */
const inside = (root: string, rel: string) => {
  const f = normalize(join(root, rel));
  if (!f.startsWith(root + sep)) throw new S.HttpError(400, 'Chemin invalide.');
  return f;
};
route('GET', '/fonts/:file', (_q, res, p) => serveFile(res, inside(FONTS_DIR, p.file), true, true));
route('GET', '/vendor/paged.js', (_q, res) => serveFile(res, PAGEDJS_FILE, true));
route('GET', '/vendor/katex/fonts/:file', (_q, res, p) => serveFile(res, inside(join(KATEX_DIR, 'fonts'), p.file), true, true));
let katexCss = '';
route('GET', '/vendor/katex.css', (_q, res) => {
  katexCss ||= readFileSync(join(KATEX_DIR, 'katex.min.css'), 'utf8').replace(/url\(fonts\//g, 'url(/vendor/katex/fonts/');
  res.writeHead(200, { 'content-type': 'text/css', 'access-control-allow-origin': '*' });
  res.end(katexCss);
});

/* ---------- Serveur ---------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      await r.fn(req, res, params, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) return json(res, { error: 'Route inconnue.' }, 404);
    // Interface compilée (pnpm build) ; en développement, Vite la sert lui-même.
    if (existsSync(UI_DIST)) {
      const file = url.pathname === '/' ? join(UI_DIST, 'index.html') : inside(UI_DIST, url.pathname);
      return serveFile(res, existsSync(file) ? file : join(UI_DIST, 'index.html'), false, url.pathname.startsWith('/assets/'));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Interface non compilée : lancez « pnpm dev » ou « pnpm build ».');
  } catch (e: any) {
    const status = e instanceof S.HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, { error: e.message || 'Erreur interne.' }, status);
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Document Studio : http://127.0.0.1:${PORT}  ·  documents dans ${S.HOME}`);
  if (!findChrome()) console.warn('Aucun Chrome trouvé : l\'export PDF sera indisponible (STUDIO_CHROME=/chemin/vers/chrome).');
});
const stop = async () => { await closeBrowser().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
