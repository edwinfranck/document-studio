// Édition web : documents, ressources, gabarits et historique dans IndexedDB.
// Les exports se font dans la page avec le même moteur ; le PDF passe par la boîte d'impression.
import { zipSync, strToU8 } from 'fflate';
import { BUILTIN_TEMPLATES, FONT_MANIFEST, fontFaceCss, installedPlugins, registerPlugins, render, resolveTheme, slugify, type DocSettings, type RenderEnv, type Target, type Template } from '@studio/engine';
import type { Asset, Backend, Doc, DocSummary, ExportRequest } from './api.ts';
import { findAsset } from './env.ts';

interface DocRecord { id: string; name: string; project: string; settings: Partial<DocSettings>; markdown: string; original?: string; createdAt: string; updatedAt: string; importedFrom?: string }
interface AssetRecord { key: string; doc: string; name: string; blob: Blob }
interface SnapRecord { key: string; doc: string; at: string; markdown: string }

const HISTORY_EVERY_MS = 2 * 60_000;
const PLUGINS_KEY = 'ds-plugins';
const storedPlugins = (): unknown[] => { try { const v = JSON.parse(localStorage.getItem(PLUGINS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const HISTORY_KEEP = 60;

/* ---------- IndexedDB minimal ---------- */

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ||= new Promise((ok, ko) => {
    const r = indexedDB.open('document-studio', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('assets', { keyPath: 'key' }).createIndex('doc', 'doc');
      d.createObjectStore('themes', { keyPath: 'id' });
      d.createObjectStore('history', { keyPath: 'key' }).createIndex('doc', 'doc');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(new Error('Stockage du navigateur indisponible (navigation privée ?).'));
  }));
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
async function store(name: string, mode: IDBTransactionMode = 'readonly') { return (await db()).transaction(name, mode).objectStore(name); }
const getAll = async <T>(name: string) => req<T[]>((await store(name)).getAll());
const getOne = async <T>(name: string, key: string) => req<T | undefined>((await store(name)).get(key));
const put = async (name: string, v: unknown) => req((await store(name, 'readwrite')).put(v));
const del = async (name: string, key: string) => req((await store(name, 'readwrite')).delete(key));
const byDoc = async <T>(name: string, doc: string) => req<T[]>((await store(name)).index('doc').getAll(doc));

/* ---------- Ressources en mémoire (data: pour l'aperçu isolé) ---------- */

const dataUrls = new Map<string, string>();
const objectUrls = new Map<string, string>();
const toDataUrl = (b: Blob) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(r.error); r.readAsDataURL(b); });
async function cacheAsset(a: AssetRecord) {
  dataUrls.set(a.key, await toDataUrl(a.blob));
  if (!objectUrls.has(a.key)) objectUrls.set(a.key, URL.createObjectURL(a.blob));
}

const words = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
const newId = (name: string) => `${slugify(name).slice(0, 48)}-${Math.random().toString(16).slice(2, 8)}`;
const notFound = () => new Error('Document introuvable.');

async function loadDoc(id: string): Promise<Doc> {
  const r = await getOne<DocRecord>('docs', id);
  if (!r) throw notFound();
  const assets = await byDoc<AssetRecord>('assets', id);
  await Promise.all(assets.filter(a => !dataUrls.has(a.key)).map(cacheAsset));
  return {
    id: r.id, name: r.name, project: r.project, settings: r.settings, markdown: r.markdown, createdAt: r.createdAt, updatedAt: r.updatedAt,
    importedFrom: r.importedFrom, hasOriginal: r.original !== undefined, assets: assets.map(a => ({ name: a.name, size: a.blob.size })),
  };
}

/* ---------- Export dans le navigateur ---------- */

const fetchText = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} : ${r.status}`); return r.text(); };
const fetchData = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} : ${r.status}`); return toDataUrl(await r.blob()); };
let pagedjs: Promise<string> | null = null;
let katexEmbedded: Promise<string> | null = null;
const fontData = new Map<string, Promise<string>>();

async function exportEnv(docId: string, assets: Asset[], families: string[], math: boolean): Promise<RenderEnv> {
  const files = families.flatMap(f => (FONT_MANIFEST[f] || []).map(x => x.file));
  for (const f of files) if (!fontData.has(f)) fontData.set(f, fetchData(`/fonts/${f}`));
  const fonts = new Map(await Promise.all(files.map(async f => [f, await fontData.get(f)!] as const)));
  pagedjs ||= fetchText('/vendor/paged.js');
  if (math) katexEmbedded ||= fetchText('/vendor/katex.css').then(async css => {
    const urls = [...new Set([...css.matchAll(/url\((\/vendor\/katex\/fonts\/[^)]+\.woff2)\)/g)].map(m => m[1]))];
    const data = new Map(await Promise.all(urls.map(async u => [u, await fetchData(u)] as const)));
    return css.replace(/url\((\/vendor\/katex\/fonts\/[^)]+\.woff2)\)/g, (_, u) => `url(${data.get(u)})`);
  });
  return {
    context: 'export',
    resolveAsset(src) {
      if (/^(https?:|data:)/i.test(src)) return src;
      const a = findAsset(src, assets);
      return a ? dataUrls.get(`${docId}/${a.name}`) || null : null;
    },
    fontCss: fams => fontFaceCss(fams, f => fonts.get(f) || `/fonts/${f}`),
    pagedjs: { inline: await pagedjs },
    katexCss: math ? await katexEmbedded! : '',
  };
}

async function renderFor(doc: Doc, settings: Partial<DocSettings>, markdown: string, mode: Target, templates: Template[]) {
  const t = resolveTheme(settings, templates).tokens;
  const families = [...new Set([t.fonts.heading, t.fonts.body, t.fonts.mono])];
  const env = await exportEnv(doc.id, doc.assets, families, /\$/.test(markdown));
  return render(markdown, { ...settings, mode }, env, templates);
}

/** Imprime un document dans un cadre caché, une fois paginé : la boîte d'impression propose « Enregistrer en PDF ». */
function printHtml(html: string, kind: 'print' | 'slides'): Promise<void> {
  return new Promise((ok, ko) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0';
    f.srcdoc = html;
    document.body.appendChild(f);
    const started = Date.now();
    const tick = () => {
      const w = f.contentWindow as any;
      const done = kind === 'print' ? w?.__SD_PAGED : w?.document?.documentElement?.dataset.ready === '1';
      if (done?.error) { f.remove(); ko(new Error('Pagination impossible : ' + done.error)); return; }
      if (done) {
        w.focus();
        w.print();                                   // bloquant jusqu'à la fermeture de la boîte
        setTimeout(() => f.remove(), 1000);
        ok();
        return;
      }
      if (Date.now() - started > 60_000) { f.remove(); ko(new Error('Pagination trop longue.')); return; }
      setTimeout(tick, 150);
    };
    f.onload = () => setTimeout(tick, 100);
  });
}

export function browserBackend(): Backend {
  const userThemes = () => getAll<Template>('themes');
  const allTemplates = async () => [...BUILTIN_TEMPLATES, ...(await userThemes())];
  const self: Backend = {
    kind: 'browser', home: 'ce navigateur', pdf: 'print-dialog', collab: false,
    async list() {
      const all = await getAll<DocRecord>('docs');
      return all.map<DocSummary>(r => ({ id: r.id, name: r.name, project: r.project, mode: r.settings.mode || 'reading', templateId: r.settings.templateId || 'corporate', createdAt: r.createdAt, updatedAt: r.updatedAt, words: words(r.markdown), size: r.markdown.length }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get: loadDoc,
    async create(d) {
      const name = (d.name || '').trim() || 'Sans titre';
      const now = new Date().toISOString();
      const md = d.markdown ?? `# ${name}\n\n`;
      const r: DocRecord = { id: newId(name), name, project: d.project || '', settings: d.settings || {}, markdown: md, original: d.importedFrom ? md : undefined, createdAt: now, updatedAt: now, importedFrom: d.importedFrom };
      await put('docs', r);
      return loadDoc(r.id);
    },
    async update(id, patch) {
      const r = await getOne<DocRecord>('docs', id);
      if (!r) throw notFound();
      if (typeof patch.markdown === 'string' && patch.markdown !== r.markdown) {
        const snaps = (await byDoc<SnapRecord>('history', id)).sort((a, b) => a.at.localeCompare(b.at));
        const last = snaps[snaps.length - 1];
        if (!last || Date.now() - new Date(last.at).getTime() > HISTORY_EVERY_MS) {
          const at = new Date().toISOString();
          await put('history', { key: `${id}/${at}`, doc: id, at, markdown: r.markdown });
          for (const old of snaps.slice(0, Math.max(0, snaps.length + 1 - HISTORY_KEEP))) await del('history', old.key);
        }
        r.markdown = patch.markdown;
      }
      if (patch.settings) r.settings = patch.settings;
      if (typeof patch.name === 'string' && patch.name.trim()) r.name = patch.name.trim().slice(0, 200);
      if (typeof patch.project === 'string') r.project = patch.project.trim().slice(0, 120);
      r.updatedAt = new Date().toISOString();
      await put('docs', r);
      return { updatedAt: r.updatedAt };
    },
    async remove(id) {
      for (const a of await byDoc<AssetRecord>('assets', id)) await del('assets', a.key);
      for (const h of await byDoc<SnapRecord>('history', id)) await del('history', h.key);
      await del('docs', id);
    },
    async duplicate(id) {
      const src = await getOne<DocRecord>('docs', id);
      if (!src) throw notFound();
      const copy = await self.create({ name: `${src.name} (copie)`, project: src.project, markdown: src.markdown, settings: src.settings });
      for (const a of await byDoc<AssetRecord>('assets', id)) await self.putAsset(copy.id, a.name, a.blob);
      return loadDoc(copy.id);
    },
    async history(id) {
      return (await byDoc<SnapRecord>('history', id)).sort((a, b) => b.at.localeCompare(a.at)).map(h => ({ id: h.at, at: h.at, size: h.markdown.length }));
    },
    async snapshot(id, snap) {
      const h = await getOne<SnapRecord>('history', `${id}/${snap}`);
      if (!h) throw new Error('Instantané introuvable.');
      return { markdown: h.markdown };
    },
    async putAsset(id, name, data) {
      const clean = name.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[\\/]/).pop()!.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120);
      if (!/\.[a-z0-9]{2,5}$/i.test(clean)) throw new Error('Nom de fichier invalide (extension requise).');
      const rec: AssetRecord = { key: `${id}/${clean}`, doc: id, name: clean, blob: data };
      await put('assets', rec);
      const old = objectUrls.get(rec.key);
      if (old) { URL.revokeObjectURL(old); objectUrls.delete(rec.key); }
      await cacheAsset(rec);
      return { name: clean, size: data.size };
    },
    async deleteAsset(id, name) {
      await del('assets', `${id}/${name}`);
      dataUrls.delete(`${id}/${name}`);
    },
    assetUrl: (id, name) => objectUrls.get(`${id}/${name}`) || '',
    previewAssetUrl: (id, name) => dataUrls.get(`${id}/${name}`) || null,
    themes: userThemes,
    async saveTheme(t) {
      const id = t.id && !t.builtin && !BUILTIN_TEMPLATES.some(b => b.id === t.id) ? t.id : newId(t.name || 'gabarit');
      const clean: Template = { ...t, id, builtin: false, name: String(t.name || 'Gabarit').slice(0, 80) };
      await put('themes', clean);
      return clean;
    },
    deleteTheme: id => del('themes', id),
    // Plugins de l'édition web : gardés dans ce navigateur, vérifiés par le moteur avant installation.
    plugins: async () => installedPlugins(),
    async installPlugin(p) {
      const id = String((p as any)?.id || '');
      const next = [...storedPlugins().filter((x: any) => x?.id !== id), p];
      const r = registerPlugins(next);
      const err = r.errors.find(e => e.id === (id || '?'));
      if (err) { registerPlugins(storedPlugins()); throw new Error(`Plugin refusé : ${err.problems.join(' ')}`); }
      try { localStorage.setItem(PLUGINS_KEY, JSON.stringify(next)); } catch { /* stockage plein ou bloqué */ }
      return r.installed;
    },
    async removePlugin(id) {
      const next = storedPlugins().filter((x: any) => x?.id !== id);
      try { localStorage.setItem(PLUGINS_KEY, JSON.stringify(next)); } catch { /* stockage bloqué */ }
      return registerPlugins(next).installed;
    },
    async exportFile(id, b: ExportRequest) {
      const doc = await loadDoc(id);
      const settings = b.settings ?? doc.settings;
      const markdown = b.markdown ?? doc.markdown;
      const templates = await allTemplates();
      const base = doc.name.replace(/[\\/:*?"<>|]+/g, '-');
      const mode = (['reading', 'print', 'slides'].includes(b.mode) ? b.mode : 'reading') as Target;
      if (b.format === 'html') {
        const r = await renderFor(doc, settings, markdown, mode, templates);
        return { blob: new Blob([r.html], { type: 'text/html' }), name: `${base}${mode === 'slides' ? ' - diaporama' : mode === 'print' ? ' - impression' : ''}.html`, info: null };
      }
      if (b.format === 'pdf') {
        const target: Target = mode === 'slides' ? 'slides' : 'print';
        const r = await renderFor(doc, settings, markdown, target, templates);
        await printHtml(r.html, target === 'slides' ? 'slides' : 'print');
        return { blob: new Blob(), name: `${base}.pdf`, info: null, printed: true };
      }
      if (b.format === 'zip') {
        const slug = slugify(doc.name).slice(0, 60) || 'document';
        const files: Record<string, Uint8Array> = {
          [`${slug}/document.md`]: strToU8(markdown),
          [`${slug}/studio.json`]: strToU8(JSON.stringify({ name: doc.name, settings }, null, 2)),
          [`${slug}/${slug}.html`]: strToU8((await renderFor(doc, settings, markdown, 'reading', templates)).html),
          [`${slug}/${slug}-diaporama.html`]: strToU8((await renderFor(doc, settings, markdown, 'slides', templates)).html),
          [`${slug}/${slug}-impression.html`]: strToU8((await renderFor(doc, settings, markdown, 'print', templates)).html),
        };
        for (const a of await byDoc<AssetRecord>('assets', id)) files[`${slug}/assets/${a.name}`] = new Uint8Array(await a.blob.arrayBuffer());
        files[`${slug}/LISEZMOI.txt`] = strToU8(`${doc.name}\n\n${slug}.html             page de lecture autonome (hors ligne)\n${slug}-diaporama.html   présentation : flèches, F plein écran, P vue présentateur\n${slug}-impression.html  version paginée : l'ouvrir puis Imprimer > Enregistrer en PDF\ndocument.md            source Markdown\nstudio.json            réglages de mise en forme\nassets/                images et médias\n`);
        return { blob: new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }), name: `${slug}.zip`, info: null };
      }
      throw new Error(`Format inconnu : ${b.format}`);
    },
    async source(id, original) {
      const r = await getOne<DocRecord>('docs', id);
      if (!r) throw notFound();
      const text = original && r.original !== undefined ? r.original : r.markdown;
      return { blob: new Blob([text], { type: 'text/markdown' }), name: `${r.name}${original ? ' (original)' : ''}.md` };
    },
    async settingsFile(id) {
      const r = await getOne<DocRecord>('docs', id);
      if (!r) throw notFound();
      return { blob: new Blob([JSON.stringify({ name: r.name, settings: r.settings }, null, 2)], { type: 'application/json' }), name: `${r.name}.studio.json` };
    },
  };
  return self;
}
