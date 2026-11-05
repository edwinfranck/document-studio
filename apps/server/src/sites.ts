// Projets multi-pages et import d'archives ZIP.
//
//   <home>/sites/<id>/site.json      nom, pages (ordre, titres), page d'accueil, réglages communs, membres, liens, publications
//                     files/         ressources du projet, à leur chemin d'origine (« images/schema.png »)
//                     sources/       fichiers Markdown tels qu'importés, jamais réécrits
//                     original.zip   archive importée, conservée intacte
//                     activity.jsonl journal du projet (pages ajoutées, réglages, publications)
// Chaque page est un document ordinaire (versions, commentaires, édition simultanée), marqué « site ».

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  analyzeArchive, archiveResolver, BUILTIN_TEMPLATES, DEFAULT_ARCHIVE_LIMITS, dirOf, flatAssetName, fontFaceCss, merge, mergeArchive, readArchive, relativePath, render,
  resolveArchivePath, rewriteRefs, safeArchivePath, searchDoc, siteContext, siteLinkResolver, slugify, textOfFile,
  type ArchiveFile, type ArchiveLimits, type ArchiveReport, type DocSettings, type RenderEnv, type SitePageRef,
} from '@studio/engine';
import { dataUri, FONTS_DIR, katexEmbeddedCss, nodeEnv } from '@studio/engine/node';
import * as S from './store.ts';

export const SITES = join(S.HOME, 'sites');
mkdirSync(SITES, { recursive: true });

export interface SiteMeta extends Pick<S.DocMetaFile, 'owner' | 'members' | 'links' | 'invites' | 'space' | 'spaceRole' | 'publications'> {
  id: string; name: string; description?: string; createdAt: string; updatedAt: string;
  pages: SitePageRef[];
  entry?: string;
  settings: Partial<DocSettings>;
  logo?: string;
  source?: { zip: string; importedAt: string; by: string; mode: 'site'; excluded: string[]; rejected: { path: string; reason: string }[] };
}

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const siteDir = (id: string) => { if (!ID.test(id)) throw new S.HttpError(400, 'Identifiant de projet invalide.'); return join(SITES, id); };
export const siteExists = (id: string) => ID.test(id) && existsSync(join(SITES, id, 'site.json'));
export function readSite(id: string): SiteMeta {
  if (!siteExists(id)) throw new S.HttpError(404, 'Projet introuvable.');
  return JSON.parse(readFileSync(join(siteDir(id), 'site.json'), 'utf8'));
}
export function writeSite(m: SiteMeta) { S.writeAtomic(join(siteDir(m.id), 'site.json'), JSON.stringify(m, null, 2)); }
export function patchSite(id: string, fn: (m: SiteMeta) => void) { const m = readSite(id); fn(m); m.updatedAt = new Date().toISOString(); writeSite(m); return m; }

S.setSiteAccess((sid, userId, share) => (siteExists(sid) ? S.accessOf(readSite(sid) as unknown as S.DocMetaFile, userId, share) : null));
export const siteAccessOf = (m: SiteMeta, userId: string | null, share?: string | null) => S.accessOf(m as unknown as S.DocMetaFile, userId, share);

export function listSites(userId: string) {
  return readdirSync(SITES).filter(siteExists).map(readSite).flatMap(m => {
    const a = siteAccessOf(m, userId);
    return a.role ? [{ id: m.id, name: m.name, description: m.description, pages: m.pages.length, updatedAt: m.updatedAt, role: a.role, space: m.space, templateId: m.settings.templateId || 'corporate' }] : [];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findSiteLink(token: string) {
  for (const id of readdirSync(SITES).filter(siteExists)) {
    const m = readSite(id);
    const link = m.links?.find(l => l.token === token);
    if (link) return { siteId: id, link, name: m.name };
  }
  return null;
}

/* ---------- Fichiers du projet ---------- */

export function siteFiles(id: string): { path: string; size: number }[] {
  const root = join(siteDir(id), 'files');
  const out: { path: string; size: number }[] = [];
  const walk = (dir: string, rel: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f), r = rel ? `${rel}/${f}` : f;
      if (statSync(p).isDirectory()) walk(p, r); else if (!f.endsWith('.tmp')) out.push({ path: r, size: statSync(p).size });
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
export function siteFilePath(id: string, path: string) {
  const p = safeArchivePath(path);
  if (!p) throw new S.HttpError(400, 'Chemin invalide.');
  return join(siteDir(id), 'files', ...p.split('/'));
}
export function putSiteFile(id: string, path: string, data: Uint8Array) {
  const f = siteFilePath(id, path);
  mkdirSync(join(f, '..'), { recursive: true });
  S.writeAtomic(f, data);
}

export function logSite(id: string, actor: string, type: string, text: string, page?: string) {
  appendFileSync(join(siteDir(id), 'activity.jsonl'), JSON.stringify({ at: new Date().toISOString(), actor, type, text, page }) + '\n');
}
export function siteActivity(id: string, nameOf: (u: string) => string) {
  const m = readSite(id);
  const f = join(siteDir(id), 'activity.jsonl');
  const own = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const pages = m.pages.flatMap(p => (S.docExists(p.id) ? S.listActivity(p.id, 100).map(a => ({ ...a, page: p.id, pageTitle: p.title })) : []));
  return [...own.map(a => ({ ...a, actorName: nameOf(a.actor), pageTitle: m.pages.find(p => p.id === a.page)?.title })), ...pages].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
}

/* ---------- Réglages communs ---------- */

/** Réglages d'une page : ceux du projet, puis ce que la page change pour elle seule. */
export const pageSettings = (site: SiteMeta, own: Partial<DocSettings>): Partial<DocSettings> => merge(site.settings as any, own as any) as Partial<DocSettings>;

/* ---------- Environnements de rendu ---------- */

/** Page rendue seule (export, PDF) : images du projet intégrées, liens vers les autres pages conservés. */
export function embedEnv(m: SiteMeta, page: SitePageRef): RenderEnv {
  const files = new Set(siteFiles(m.id).map(f => f.path));
  const find = archiveResolver(files);
  const base = nodeEnv();
  return {
    ...base,
    resolveAsset(src) {
      if (/^(https?:|data:)/i.test(src)) return base.resolveAsset(src);
      const t = find(page.path, src);
      return t ? dataUri(siteFilePath(m.id, t.path)) : null;
    },
    resolveLink: siteLinkResolver(m.pages, files, page.path, { page: (id, a) => `${(m.pages.find(p => p.id === id)!.path).replace(/\.(md|markdown)$/i, '.html')}${a ? '#' + a : ''}`, file: p => p }),
  };
}

const htmlPath = (p: string) => p.replace(/\.(md|markdown|mdown|mkd)$/i, '.html');
const encodePath = (p: string) => p.split('/').map(s => (s === '..' ? s : encodeURIComponent(s))).join('/');

/** Site statique : une page HTML par page du projet, ressources à leur place, recherche et polices partagées. */
export function buildStaticSite(m: SiteMeta, markdownOf: (id: string) => string, settingsOf: (id: string) => Partial<DocSettings>, themes: any[]): Record<string, Uint8Array> {
  const files = siteFiles(m.id);
  const fileSet = new Set(files.map(f => f.path));
  const find = archiveResolver(fileSet);
  const out: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  const fonts = new Set<string>();
  const katex = katexEmbeddedCss();
  const index = m.pages.map(p => searchDoc(p.id, p.path, p.title, markdownOf(p.id)));
  out['_static/search-index.js'] = enc.encode(`window.__SD_SEARCH=${JSON.stringify(index).replace(/</g, '\\u003c')};`);
  const logo = m.logo && fileSet.has(m.logo) ? m.logo : undefined;
  for (const p of m.pages) {
    const at = htmlPath(p.path);
    const rel = (to: string) => encodePath(relativePath(at, to));
    const env: RenderEnv = {
      context: 'export',
      resolveAsset: src => {
        if (/^(https?:|data:)/i.test(src)) return src;
        const t = find(p.path, src);
        return t ? rel(t.path) : null;
      },
      fontCss: fam => fontFaceCss(fam, f => { fonts.add(f); return rel(`_static/fonts/${f}`); }),
      pagedjs: { inline: '' },
      katexCss: katex,
      resolveLink: siteLinkResolver(m.pages, fileSet, p.path, { page: (id, a) => rel(htmlPath(m.pages.find(x => x.id === id)!.path)) + (a ? '#' + a : ''), file: f => rel(f) }),
    };
    const ctx = siteContext({ name: m.name, logo: logo && rel(logo), pages: m.pages, entry: m.entry }, p.id, id => rel(htmlPath(m.pages.find(x => x.id === id)!.path)), { src: rel('_static/search-index.js') });
    out[at] = enc.encode(render(markdownOf(p.id), { ...settingsOf(p.id), mode: 'reading' }, env, [...BUILTIN_TEMPLATES, ...themes], undefined, ctx).html);
  }
  for (const f of files) out[f.path] ||= readFileSync(siteFilePath(m.id, f.path));
  for (const f of fonts) out[`_static/fonts/${f}`] = readFileSync(join(FONTS_DIR, f));
  const entry = m.pages.find(p => p.id === m.entry) || m.pages[0];
  if (entry && !out['index.html']) out['index.html'] = enc.encode(`<!doctype html><meta charset="utf-8"><title>${m.name.replace(/</g, '&lt;')}</title><meta http-equiv="refresh" content="0;url=${encodePath(htmlPath(entry.path))}"><a href="${encodePath(htmlPath(entry.path))}">${m.name.replace(/</g, '&lt;')}</a>`);
  return out;
}

/** Toutes les pages en un document (PDF unique) : chapitres dans l'ordre du projet, images intégrées. */
export function mergedDocument(m: SiteMeta, markdownOf: (id: string) => string) {
  const files = new Set(siteFiles(m.id).map(f => f.path));
  const r = mergeArchive(m.pages.map(p => ({ path: p.path, title: p.title, markdown: markdownOf(p.id) })), files, m.name);
  const byName = new Map(r.assets.map(a => [a.name, a.path]));
  const base = nodeEnv();
  const env: RenderEnv = {
    ...base,
    resolveAsset(src) {
      if (/^(https?:|data:)/i.test(src)) return base.resolveAsset(src);
      const name = src.replace(/^\.\/assets\//, '');
      return byName.has(name) ? dataUri(siteFilePath(m.id, byName.get(name)!)) : null;
    },
  };
  return { markdown: r.markdown, env };
}

/* ---------- Import d'une archive ---------- */

export function importLimits(): ArchiveLimits {
  const n = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
  return {
    maxFiles: n(process.env.STUDIO_IMPORT_MAX_FILES, DEFAULT_ARCHIVE_LIMITS.maxFiles),
    maxTotalBytes: n(process.env.STUDIO_IMPORT_MAX_MB, DEFAULT_ARCHIVE_LIMITS.maxTotalBytes / 1048576) * 1048576,
    maxFileBytes: n(process.env.STUDIO_IMPORT_MAX_FILE_MB, DEFAULT_ARCHIVE_LIMITS.maxFileBytes / 1048576) * 1048576,
    maxDepth: n(process.env.STUDIO_IMPORT_MAX_DEPTH, DEFAULT_ARCHIVE_LIMITS.maxDepth),
  };
}

interface Pending { id: string; user: string; name: string; zip: Uint8Array; files: ArchiveFile[]; report: ArchiveReport; at: number }
const pending = new Map<string, Pending>();
const sweep = () => { for (const [k, p] of pending) if (Date.now() - p.at > 3600e3) pending.delete(k); };

/** Étape 1 : analyse. Rien n'est créé tant que l'utilisateur n'a pas validé. */
export function startImport(user: string, name: string, zip: Uint8Array) {
  sweep();
  const a = readArchive(zip, importLimits());
  const report = analyzeArchive(name, a);
  const id = randomBytes(8).toString('hex');
  pending.set(id, { id, user, name, zip, files: a.files, report, at: Date.now() });
  return { id, report };
}
export function cancelImport(id: string, user: string) { const p = pending.get(id); if (p && p.user === user) pending.delete(id); }

export interface ImportPlan {
  mode: 'site' | 'merge' | 'separate';
  name?: string;
  /** Pages retenues, dans l'ordre voulu. */
  order: string[];
  entry?: string;
  templateId?: string;
  /** Corrections proposées par l'analyse et acceptées : lien remplacé dans la page. */
  fixes?: { path: string; from: string; to: string }[];
  titles?: Record<string, string>;
}

/** Étape 2 : construction. Tout ou rien : en cas d'échec, ce qui a été créé est retiré. */
export function commitImport(id: string, user: string, plan: ImportPlan) {
  const p = pending.get(id);
  if (!p || p.user !== user) throw new S.HttpError(404, 'Analyse expirée ou introuvable : réimportez l\'archive.');
  const files = new Map(p.files.filter(f => f.status === 'ok').map(f => [f.path, f]));
  const order = (plan.order || []).filter(x => files.get(x)?.kind === 'markdown');
  if (!order.length) throw new S.HttpError(400, 'Choisissez au moins une page à importer.');
  const title = (path: string) => String(plan.titles?.[path] || p.report.pages.find(x => x.path === path)?.title || path).slice(0, 160);
  const textOf = (path: string) => {
    let md = textOfFile(files.get(path)!);
    const fixes = (plan.fixes || []).filter(f => f.path === path);
    if (fixes.length) md = rewriteRefs(md, href => fixes.find(f => f.from === href)?.to);
    return md;
  };
  const name = String(plan.name || p.name.replace(/\.zip$/i, '') || 'Projet importé').trim().slice(0, 120);
  const settings: Partial<DocSettings> = plan.templateId ? { templateId: plan.templateId } : {};
  const created: string[] = [];
  const rollback = () => { for (const d of created) { try { S.deleteDoc(d); } catch { /* déjà retiré */ } } };
  try {
    if (plan.mode === 'merge') {
      const m = mergeArchive(order.map(x => ({ path: x, title: title(x), markdown: textOf(x) })), new Set(files.keys()), name);
      const doc = S.createDoc({ name, markdown: m.markdown, settings: { ...settings, page: { breakBeforeH1: true } }, importedFrom: p.name }, user);
      created.push(doc.id);
      for (const a of m.assets) S.putAsset(doc.id, a.name, Buffer.from(files.get(a.path)!.data!));
      writeFileSync(join(S.docDir(doc.id), 'source.zip'), p.zip);
      pending.delete(id);
      return { kind: 'doc' as const, id: doc.id };
    }
    if (plan.mode === 'separate') {
      const ids: string[] = [];
      const find = archiveResolver(files.keys());
      for (const path of order) {
        const used = new Map<string, string>();
        const md = rewriteRefs(textOf(path), href => {
          const t = !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href) && find(path, href)?.path;
          if (!t || files.get(t)!.kind === 'markdown') return undefined;
          const n = flatAssetName(t);
          used.set(n, t);
          return `./assets/${n}`;
        });
        const doc = S.createDoc({ name: title(path), project: name, markdown: md, settings, importedFrom: `${p.name} › ${path}` }, user);
        created.push(doc.id);
        // la source importée reste celle de l'archive, liens d'origine compris
        writeFileSync(join(S.docDir(doc.id), 'original.md'), textOfFile(files.get(path)!));
        for (const [n, t] of used) S.putAsset(doc.id, n, Buffer.from(files.get(t)!.data!));
        ids.push(doc.id);
      }
      pending.delete(id);
      return { kind: 'docs' as const, ids, project: name };
    }
    // Projet multi-pages : préparé à côté, puis mis en place d'un seul geste.
    const sid = `${slugify(name).slice(0, 40) || 'projet'}-${randomBytes(3).toString('hex')}`;
    const stage = join(SITES, `.import-${sid}`);
    mkdirSync(join(stage, 'files'), { recursive: true });
    mkdirSync(join(stage, 'sources'), { recursive: true });
    try {
      writeFileSync(join(stage, 'original.zip'), p.zip);
      for (const f of files.values()) {
        const dir = f.kind === 'markdown' ? 'sources' : 'files';
        const dest = join(stage, dir, ...f.path.split('/'));
        mkdirSync(join(dest, '..'), { recursive: true });
        writeFileSync(dest, f.data!);
      }
      const pages: SitePageRef[] = [];
      for (const path of order) {
        const doc = S.createDoc({ name: title(path), markdown: textOf(path), settings: {}, importedFrom: `${p.name} › ${path}` }, user);
        created.push(doc.id);
        writeFileSync(join(S.docDir(doc.id), 'original.md'), textOfFile(files.get(path)!));
        S.patchMeta(doc.id, m => { m.site = sid; m.sitePath = path; });
        pages.push({ id: doc.id, path, title: title(path) });
      }
      const now = new Date().toISOString();
      const entry = pages.find(x => x.path === (plan.entry || p.report.entry))?.id || pages[0].id;
      const meta: SiteMeta = {
        id: sid, name, createdAt: now, updatedAt: now, owner: user, members: [], links: [], invites: [], publications: [],
        // une documentation se lit sans numéros de sections ; le gabarit peut les remettre dans « Apparence »
        pages, entry, settings: { ...settings, overrides: { layout: { numbering: false } } },
        source: {
          zip: p.name, importedAt: now, by: user, mode: 'site',
          excluded: p.report.pages.map(x => x.path).filter(x => !order.includes(x)),
          rejected: p.report.files.filter(f => f.status === 'rejected').map(f => ({ path: f.path, reason: f.reason || '' })),
        },
      };
      writeFileSync(join(stage, 'site.json'), JSON.stringify(meta, null, 2));
      writeFileSync(join(stage, 'activity.jsonl'), JSON.stringify({ at: now, actor: user, type: 'imported', text: `a importé ${p.name} : ${pages.length} page${pages.length > 1 ? 's' : ''}` }) + '\n');
      renameSync(stage, join(SITES, sid));
    } catch (e) {
      rmSync(stage, { recursive: true, force: true });
      throw e;
    }
    pending.delete(id);
    return { kind: 'site' as const, id: sid };
  } catch (e) {
    rollback();
    throw e;
  }
}

export function deleteSite(id: string) {
  const m = readSite(id);
  for (const p of m.pages) if (S.docExists(p.id)) S.deleteDoc(p.id);
  renameSync(siteDir(id), join(S.HOME, 'trash', `site-${id}-${Date.now()}`));
}
