// Projets ZIP : lecture sûre de l'archive, analyse (pages, ressources, liens, entrée, organisation),
// fusion en un document continu, résolution des chemins relatifs. Commun au serveur et au navigateur.
import { unzipSync } from 'fflate';
import { slugify } from './parse.ts';
import type { SearchDoc, SiteContext, SiteNavItem } from './types.ts';

/* ---------- Lecture de l'archive ---------- */

export interface ArchiveLimits { maxFiles: number; maxTotalBytes: number; maxFileBytes: number; maxDepth: number }
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = { maxFiles: 2000, maxTotalBytes: 300 * 1024 * 1024, maxFileBytes: 50 * 1024 * 1024, maxDepth: 12 };

export type FileKind = 'markdown' | 'image' | 'document' | 'media' | 'font' | 'data' | 'blocked' | 'other';
export interface ArchiveFile { path: string; size: number; kind: FileKind; data?: Uint8Array; status: 'ok' | 'rejected'; reason?: string }

const EXT: [RegExp, FileKind][] = [
  [/\.(md|markdown|mdown|mkd)$/i, 'markdown'],
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i, 'image'],
  [/\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub)$/i, 'document'],
  [/\.(mp4|webm|mov|mp3|ogg|wav|m4a)$/i, 'media'],
  [/\.(woff2?|ttf|otf)$/i, 'font'],
  [/\.(txt|csv|tsv|json|ya?ml|xml|toml|bib)$/i, 'data'],
  // jamais exécutés ni servis tels quels : du code ou des pages qui pourraient en contenir
  [/\.(html?|xhtml|js|mjs|cjs|ts|jsx|tsx|php|py|rb|pl|sh|bash|zsh|bat|cmd|ps1|exe|dll|so|dylib|app|msi|jar|apk|vbs|wasm|scr|com|lnk|hta)$/i, 'blocked'],
];
export const fileKind = (path: string): FileKind => EXT.find(([re]) => re.test(path))?.[1] ?? 'other';

/** Chemin sûr à l'intérieur de l'archive, en notation « a/b/c.md ». null si le chemin sort du dossier ou est illisible. */
export function safeArchivePath(raw: string): string | null {
  const p = String(raw).replace(/\\/g, '/');
  if (!p || /[\u0000-\u001f]/.test(p) || /^([a-z]:|\/)/i.test(p)) return null;
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/** Fichiers système glissés par les outils de compression : ignorés, mais signalés. */
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/;

/** Ouvre l'archive sans rien écrire sur disque. Les fichiers refusés restent listés, avec la raison. */
export function readArchive(bytes: Uint8Array, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): { files: ArchiveFile[]; root: string } {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Ce fichier n\'est pas une archive ZIP lisible.');
  const files: ArchiveFile[] = [];
  let total = 0, count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter: f => {
        if (f.name.endsWith('/')) return false;
        const path = safeArchivePath(f.name);
        const reject = (reason: string) => { files.push({ path: path || f.name, size: f.originalSize, kind: fileKind(f.name), status: 'rejected', reason }); return false; };
        if (!path) return reject('chemin dangereux (sortie du dossier ou chemin absolu)');
        if (JUNK.test(path)) return reject('fichier système de l\'outil de compression');
        if (path.split('/').length - 1 > limits.maxDepth) return reject(`dossiers trop profonds (plus de ${limits.maxDepth} niveaux)`);
        if (fileKind(path) === 'blocked') return reject('type de fichier non autorisé (code ou page exécutable), jamais ouvert');
        if (f.originalSize > limits.maxFileBytes) return reject(`fichier trop volumineux (plus de ${Math.round(limits.maxFileBytes / 1048576)} Mo)`);
        if (++count > limits.maxFiles) return reject(`trop de fichiers (plus de ${limits.maxFiles})`);
        if ((total += f.originalSize) > limits.maxTotalBytes) return reject(`archive trop volumineuse une fois décompressée (plus de ${Math.round(limits.maxTotalBytes / 1048576)} Mo)`);
        return true;
      },
    });
  } catch (e: any) {
    throw new Error(`Archive corrompue ou incomplète : ${e?.message || e}`);
  }
  for (const [name, data] of Object.entries(raw)) {
    const path = safeArchivePath(name)!;
    // la taille annoncée peut mentir : on vérifie la taille réelle
    if (data.length > limits.maxFileBytes) { files.push({ path, size: data.length, kind: fileKind(path), status: 'rejected', reason: 'fichier trop volumineux' }); continue; }
    files.push({ path, size: data.length, kind: fileKind(path), data, status: 'ok' });
  }
  // Archive qui enveloppe tout dans un seul dossier (« projet/… ») : ce dossier devient la racine.
  const ok = files.filter(f => f.status === 'ok');
  const tops = new Set(ok.map(f => f.path.split('/')[0]));
  let root = '';
  if (ok.length && tops.size === 1 && ok.every(f => f.path.includes('/'))) {
    root = [...tops][0];
    for (const f of files) if (f.path.startsWith(root + '/')) f.path = f.path.slice(root.length + 1);
  }
  // deux fichiers qui ne diffèrent que par la casse se marchent dessus sur certains systèmes
  const seen = new Map<string, ArchiveFile>();
  for (const f of files.filter(x => x.status === 'ok')) {
    const k = f.path.toLowerCase();
    if (seen.has(k)) { f.status = 'rejected'; f.reason = `même nom que « ${seen.get(k)!.path} » (seule la casse diffère)`; delete f.data; }
    else seen.set(k, f);
  }
  return { files: files.sort((a, b) => naturalCompare(a.path, b.path)), root };
}

/* ---------- Chemins ---------- */

export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Résout un lien relatif écrit dans `from` (« ../images/a.png ») en chemin d'archive. null s'il sort de l'archive. */
export function resolveArchivePath(from: string, href: string): string | null {
  let h = href.split(/[?#]/)[0];
  try { h = decodeURIComponent(h); } catch { /* lien mal encodé : gardé tel quel */ }
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null;
  const parts = h.startsWith('/') ? [] : dirOf(from).split('/').filter(Boolean);
  for (const seg of h.replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/') || null;
}

/** Trouve le fichier visé par un lien : chemin exact, sinon le seul fichier de l'archive qui porte ce nom
 *  (« persona.png » écrit sans son dossier « img/ », convention fréquente). Jamais de choix entre deux homonymes. */
export function archiveResolver(paths: Iterable<string>) {
  const all = new Set(paths);
  const byName = new Map<string, string | null>();
  for (const p of all) { const n = p.split('/').pop()!.toLowerCase(); byName.set(n, byName.has(n) ? null : p); }
  return (from: string, href: string): { path: string; byName: boolean } | null => {
    const t = resolveArchivePath(from, href);
    if (!t) return null;
    if (all.has(t)) return { path: t, byName: false };
    const n = byName.get(t.split('/').pop()!.toLowerCase());
    return n ? { path: n, byName: true } : null;
  };
}

/** Chemin relatif de `from` (un fichier) vers `to` (un fichier), pour les sites exportés. */
export function relativePath(from: string, to: string): string {
  const a = dirOf(from).split('/').filter(Boolean), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
}

/* ---------- Analyse ---------- */

export interface ArchiveLink { href: string; line: number; image: boolean; kind: 'page' | 'resource' | 'anchor' | 'external'; target?: string; anchor?: string; broken: boolean; suggestion?: string }
export interface ArchivePage { path: string; title: string; words: number; size: number; empty: boolean; headings: { depth: number; text: string; id: string }[]; links: ArchiveLink[]; duplicateOf?: string }
export interface ArchiveProblem { level: 'error' | 'warning' | 'info'; path?: string; line?: number; message: string; fix?: { from: string; to: string } }
export interface ArchiveReport {
  name: string;
  root: string;
  files: Omit<ArchiveFile, 'data'>[];
  pages: ArchivePage[];
  folders: string[];
  resources: { path: string; size: number; kind: FileKind; usedBy: string[] }[];
  entry: string | null;
  entryReason: string;
  kind: 'single' | 'chapters' | 'documentation';
  kindReason: string;
  suggestedMode: 'site' | 'merge' | 'separate';
  order: string[];
  stats: { pages: number; folders: number; resources: number; images: number; rejected: number; bytes: number; internalLinks: number; externalLinks: number; brokenLinks: number };
  problems: ArchiveProblem[];
}

const decoder = new TextDecoder('utf-8');
export const textOfFile = (f: { data?: Uint8Array }) => (f.data ? decoder.decode(f.data).replace(/^﻿/, '').replace(/\r\n?/g, '\n') : '');

/** Front matter retiré, lignes de code clôturé masquées : ce qui reste est analysé. */
function scan(md: string) {
  const fm = /^---[ \t]*\n([\s\S]*?)\n(---|\.\.\.)[ \t]*(\n|$)/.exec(md);
  const fmTitle = fm ? /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] : undefined;
  const fmSubtitle = fm ? /^subtitle:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] : undefined;
  const lines = md.split('\n');
  const prose: (string | null)[] = [];
  let fence: string | null = null;
  const fmLines = fm ? fm[0].split('\n').length - (fm[0].endsWith('\n') ? 1 : 0) : 0;
  lines.forEach((l, i) => {
    if (i < fmLines) { prose.push(null); return; }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (l.trim().startsWith(fence)) fence = null; prose.push(null); return; }
    prose.push(fence ? null : l);
  });
  return { fmTitle, fmSubtitle, prose };
}

/** Liens et images d'une page : en ligne « [x](url) », « ![x](url) » et définitions « [id]: url ». */
export function findRefs(md: string): { href: string; line: number; image: boolean }[] {
  const out: { href: string; line: number; image: boolean }[] = [];
  const { prose } = scan(md);
  prose.forEach((l, i) => {
    if (l === null) return;
    const clean = l.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    for (const m of clean.matchAll(/(!?)\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)/g)) out.push({ href: m[2], line: i + 1, image: m[1] === '!' });
    for (const m of clean.matchAll(/<(img|a)\s[^>]*?\b(src|href)\s*=\s*["']?([^"'\s>]+)/gi)) out.push({ href: m[3], line: i + 1, image: m[1].toLowerCase() === 'img' });
    const def = /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(\s+["'(].*)?$/.exec(clean);
    if (def) out.push({ href: def[1], line: i + 1, image: /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(def[1]) });
  });
  return out;
}

function headingsOf(md: string) {
  const out: { depth: number; text: string; id: string }[] = [];
  const used = new Map<string, number>();
  for (const l of scan(md).prose) {
    const m = l && /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (!m) continue;
    const text = m[2].replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    let id = slugify(text);
    if (/^\d/.test(id)) id = 's-' + id;
    const k = used.get(id) || 0;
    used.set(id, k + 1);
    out.push({ depth: m[1].length, text, id: k ? `${id}-${k + 1}` : id });
  }
  return out;
}

export const humanize = (path: string) => {
  const base = path.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, '').replace(/[-_]+/g, ' ').trim() || path;
  return base.charAt(0).toUpperCase() + base.slice(1);
};

const ENTRY = /^(readme|index|_index|accueil|home|introduction|intro|sommaire)\.(md|markdown)$/i;
const SUMMARY = /^(summary|_sidebar|toc|table-des-matieres)\.(md|markdown)$/i;

function hash(d: Uint8Array) { let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + d.length; }

/** Rapport d'analyse : rien n'est modifié, rien n'est écarté sans être listé. */
export function analyzeArchive(name: string, archive: { files: ArchiveFile[]; root: string }): ArchiveReport {
  const files = archive.files;
  const ok = files.filter(f => f.status === 'ok');
  const exists = new Set(ok.map(f => f.path));
  const lower = new Map(ok.map(f => [f.path.toLowerCase(), f.path]));
  const byBase = new Map<string, string[]>();
  for (const f of ok) { const b = f.path.split('/').pop()!.toLowerCase(); byBase.set(b, [...(byBase.get(b) || []), f.path]); }
  const mdFiles = ok.filter(f => f.kind === 'markdown');
  const problems: ArchiveProblem[] = [];
  const used = new Map<string, Set<string>>();

  const suggest = (target: string) => lower.get(target.toLowerCase()) || (byBase.get(target.split('/').pop()!.toLowerCase()) || [])[0];
  const find = archiveResolver(exists);
  const hashes = new Map<string, string>();
  const pages: ArchivePage[] = mdFiles.map(f => {
    const md = textOfFile(f);
    const { fmTitle, fmSubtitle } = scan(md);
    const headings = headingsOf(md);
    const file = f.path.split('/').pop()!;
    // README ou index sans titre : le nom de son dossier dit mieux ce qu'il présente
    const folderTitle = dirOf(f.path) && ENTRY.test(file) ? humanize(dirOf(f.path).split('/').pop()! + '.md') : undefined;
    const words = md.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
    const page: ArchivePage = {
      path: f.path, size: f.size, words, empty: !md.trim(), headings,
      title: (fmTitle || headings.find(h => h.depth === 1)?.text || folderTitle || fmSubtitle || humanize(f.path)).slice(0, 160),
      links: [],
    };
    (page as any).subtitle = fmSubtitle;
    const h = hash(f.data!);
    if (md.trim() && hashes.has(h)) { page.duplicateOf = hashes.get(h); problems.push({ level: 'info', path: f.path, message: `Contenu identique à « ${page.duplicateOf} ».` }); }
    else hashes.set(h, f.path);
    if (page.empty) problems.push({ level: 'warning', path: f.path, message: 'Fichier Markdown vide : il sera importé tel quel, comme une page vide.' });
    for (const r of findRefs(md)) {
      const href = r.href;
      if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('//')) { page.links.push({ ...r, kind: 'external', broken: false }); continue; }
      if (href.startsWith('#')) { page.links.push({ ...r, kind: 'anchor', anchor: href.slice(1), broken: false }); continue; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { page.links.push({ ...r, kind: 'external', broken: false }); continue; }
      const target = resolveArchivePath(f.path, href);
      const anchor = href.includes('#') ? href.slice(href.indexOf('#') + 1) : undefined;
      const isPage = !!target && fileKind(target) === 'markdown';
      // « ./chapitre » sans extension : souvent un lien vers « chapitre.md »
      const named = target && !exists.has(target) ? find(f.path, href) : null;
      const resolved = target && (exists.has(target) ? target : exists.has(target + '.md') ? target + '.md' : exists.has(target + '/README.md') ? target + '/README.md' : exists.has(target + '/index.md') ? target + '/index.md' : named?.path || null);
      if (named && resolved === named.path) problems.push({ level: 'info', path: f.path, line: r.line, message: `« ${href} » trouvé par son nom : ${named.path}. La source n'est pas modifiée.` });
      const link: ArchiveLink = { ...r, kind: isPage || resolved?.endsWith('.md') ? 'page' : 'resource', target: resolved || target || undefined, anchor, broken: !resolved };
      if (!resolved) {
        const s = target ? suggest(target) : undefined;
        if (s) link.suggestion = relativePath(f.path, s) + (anchor ? '#' + anchor : '');
        const rejected = target && files.find(x => x.path === target && x.status === 'rejected');
        problems.push({
          level: 'warning', path: f.path, line: r.line,
          message: rejected ? `${r.image ? 'Image' : 'Lien'} vers « ${target} », refusé à l'import (${rejected.reason}).`
            : target ? `${r.image ? 'Image introuvable' : 'Lien cassé'} : « ${href} » ne correspond à aucun fichier de l'archive.${s ? ` Proposition : « ${link.suggestion} ».` : ''}`
            : `Lien « ${href} » qui sort de l'archive : il ne pourra pas être suivi.`,
          fix: s ? { from: href, to: link.suggestion! } : undefined,
        });
      } else if (!resolved.endsWith('.md') || link.kind === 'resource') {
        used.set(resolved, (used.get(resolved) || new Set()).add(f.path));
      }
      page.links.push(link);
    }
    return page;
  });

  // Titres en double (« Workshop » partout) : le sous-titre, à défaut le nom du fichier, les distingue dans la navigation.
  const count = new Map<string, number>();
  for (const p of pages) count.set(p.title.toLowerCase(), (count.get(p.title.toLowerCase()) || 0) + 1);
  for (const p of pages) {
    const sub = (p as any).subtitle as string | undefined;
    delete (p as any).subtitle;
    if ((count.get(p.title.toLowerCase()) || 0) > 1) p.title = (sub && sub.toLowerCase() !== p.title.toLowerCase() ? sub : humanize(p.path)).slice(0, 160);
  }

  // Ancres vers une autre page : signalées si le titre visé n'existe pas
  const byPath = new Map(pages.map(p => [p.path, p]));
  for (const p of pages) for (const l of p.links) {
    if (l.kind === 'page' && !l.broken && l.anchor && l.target) {
      const t = byPath.get(l.target);
      if (t && !t.headings.some(h => h.id === l.anchor || slugify(h.text) === l.anchor)) problems.push({ level: 'info', path: p.path, line: l.line, message: `Ancre « #${l.anchor} » absente de « ${l.target} » : le lien mènera en haut de la page.` });
    }
  }

  for (const f of files.filter(x => x.status === 'rejected')) problems.push({ level: f.kind === 'blocked' ? 'warning' : 'info', path: f.path, message: `Non importé : ${f.reason}. Le fichier reste dans l'archive d'origine, conservée.` });

  const folders = [...new Set(ok.flatMap(f => { const parts = f.path.split('/').slice(0, -1); return parts.map((_, i) => parts.slice(0, i + 1).join('/')); }))].sort(naturalCompare);
  const resources = ok.filter(f => f.kind !== 'markdown').map(f => ({ path: f.path, size: f.size, kind: f.kind, usedBy: [...(used.get(f.path) || [])] }));
  for (const r of resources) if (!r.usedBy.length && r.kind === 'image') problems.push({ level: 'info', path: r.path, message: 'Image qu\'aucune page n\'utilise : conservée avec les fichiers du projet.' });

  // Entrée : README ou index le moins profond ; à défaut, la seule page ou la première dans l'ordre.
  const summary = pages.find(p => SUMMARY.test(p.path.split('/').pop()!) && !p.path.includes('/'));
  const entries = pages.filter(p => ENTRY.test(p.path.split('/').pop()!)).sort((a, b) => a.path.split('/').length - b.path.split('/').length || naturalCompare(a.path, b.path));
  // Ordre proposé : celui d'un sommaire (SUMMARY.md, _sidebar.md) s'il existe, sinon l'arborescence, page d'accueil de chaque dossier en tête.
  let order: string[] = [];
  if (summary) for (const l of summary.links) if (l.kind === 'page' && l.target && !l.broken && !order.includes(l.target) && l.target !== summary.path) order.push(l.target);
  const rest = pages.map(p => p.path).filter(p => !order.includes(p) && p !== summary?.path).sort((a, b) => {
    const da = dirOf(a), db = dirOf(b);
    if (da !== db) return da === '' ? -1 : db === '' ? 1 : (a.startsWith(db + '/') ? 1 : b.startsWith(da + '/') ? -1 : naturalCompare(da, db));
    const ea = ENTRY.test(a.split('/').pop()!), eb = ENTRY.test(b.split('/').pop()!);
    return ea !== eb ? (ea ? -1 : 1) : naturalCompare(a, b);
  });
  order = [...order, ...rest];
  if (summary) order.push(summary.path);
  const entry = entries[0]?.path || (pages.length === 1 ? pages[0].path : order[0]) || null;
  if (entry) order = [entry, ...order.filter(p => p !== entry)];
  const entryReason = entries[0] ? `« ${entries[0].path.split('/').pop()} » est la page d'accueil habituelle d'un dossier de documentation.` : pages.length === 1 ? 'C\'est la seule page.' : 'Aucun README ni index : la première page dans l\'ordre des fichiers sert d\'accueil.';

  const internal = pages.reduce((n, p) => n + p.links.filter(l => l.kind === 'page').length, 0);
  const external = pages.reduce((n, p) => n + p.links.filter(l => l.kind === 'external').length, 0);
  const broken = pages.reduce((n, p) => n + p.links.filter(l => l.broken).length, 0);
  const mdFolders = new Set(pages.map(p => dirOf(p.path)).filter(Boolean));
  let kind: ArchiveReport['kind'], kindReason: string, suggestedMode: ArchiveReport['suggestedMode'];
  if (pages.length <= 1) { kind = 'single'; kindReason = 'Une seule page Markdown.'; suggestedMode = 'merge'; }
  else if (mdFolders.size || internal || summary) { kind = 'documentation'; kindReason = [mdFolders.size ? `pages réparties dans ${mdFolders.size} dossier${mdFolders.size > 1 ? 's' : ''}` : '', internal ? `${internal} lien${internal > 1 ? 's' : ''} entre pages` : '', summary ? 'un sommaire' : ''].filter(Boolean).join(', ') + ' : une documentation à parcourir.'; suggestedMode = 'site'; }
  else { kind = 'chapters'; kindReason = 'Pages au même niveau, sans lien entre elles : des chapitres à lire à la suite.'; suggestedMode = 'merge'; }
  if (!pages.length) problems.unshift({ level: 'error', message: 'Aucun fichier Markdown (.md ou .markdown) dans l\'archive : rien à importer.' });

  return {
    name, root: archive.root,
    files: files.map(({ data: _d, ...f }) => f),
    pages, folders, resources, entry, entryReason, kind, kindReason, suggestedMode, order,
    stats: { pages: pages.length, folders: folders.length, resources: resources.length, images: resources.filter(r => r.kind === 'image').length, rejected: files.filter(f => f.status === 'rejected').length, bytes: ok.reduce((n, f) => n + f.size, 0), internalLinks: internal, externalLinks: external, brokenLinks: broken },
    problems,
  };
}

/* ---------- Réécriture des liens ---------- */

/** Remplace les URL des liens et images hors du code. `fn` renvoie la nouvelle URL, ou undefined pour garder. */
export function rewriteRefs(md: string, fn: (href: string, image: boolean) => string | undefined): string {
  const { prose } = scan(md);
  return md.split('\n').map((l, i) => {
    if (prose[i] === null || prose[i] === undefined) return l;
    let out = l.replace(/(!?)(\[(?:[^\]\\]|\\.)*\]\(\s*<?)([^)\s>]+)(>?(?:\s+["'(][^)]*["')])?\s*\))/g, (m, bang, a, href, b) => {
      const n = fn(href, bang === '!');
      return n === undefined ? m : `${bang}${a}${n}${b}`;
    });
    out = out.replace(/^( {0,3}\[[^\]]+\]:\s*<?)(\S+?)(>?(\s+["'(].*)?)$/, (m, a, href, b) => {
      const n = fn(href, /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(href));
      return n === undefined ? m : `${a}${n}${b}`;
    });
    return out;
  }).join('\n');
}

/** Nom de ressource à plat pour un document unique : « images/schema.png » -> « images-schema.png ». */
export const flatAssetName = (path: string) => path.replace(/\//g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(-120);

/* ---------- Document continu ---------- */

export interface ArchiveMergeResult { markdown: string; assets: { path: string; name: string }[]; chapters: { path: string; title: string; anchor: string }[] }

/** Fusionne les pages choisies en un document : un chapitre par page, liens entre pages changés en ancres,
 *  ressources ramenées dans les fichiers du document. Les fichiers d'origine ne sont pas modifiés. */
export function mergeArchive(pages: { path: string; markdown: string; title: string }[], allPaths: Set<string>, title: string): ArchiveMergeResult {
  const used = new Set<string>();
  const find = archiveResolver(allPaths);
  const chapters = pages.map(p => {
    const h1 = headingsOf(p.markdown).find(h => h.depth === 1);
    let anchor = h1 ? h1.id : slugify(p.title);
    if (/^\d/.test(anchor)) anchor = 's-' + anchor;
    let k = 1; const base = anchor;
    while (used.has(anchor)) anchor = `${base}-${++k}`;
    used.add(anchor);
    return { path: p.path, title: p.title, anchor };
  });
  const byPath = new Map(chapters.map(c => [c.path, c]));
  const assets = new Map<string, string>();
  const parts = pages.map((p, i) => {
    let md = p.markdown.replace(/^---[ \t]*\n[\s\S]*?\n(---|\.\.\.)[ \t]*(\n|$)/, '');
    md = rewriteRefs(md, href => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return undefined;
      const target = resolveArchivePath(p.path, href);
      if (!target) return undefined;
      const page = byPath.get(target) || byPath.get(target + '.md');
      if (page) {
        const anchor = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
        return '#' + (anchor || page.anchor);
      }
      const file = find(p.path, href)?.path;
      if (file && fileKind(file) !== 'markdown') {
        const name = flatAssetName(file);
        assets.set(file, name);
        return `./assets/${name}`;
      }
      return undefined;
    });
    // chaque chapitre ouvre sur un titre de niveau 1, qui porte son ancre
    if (!/^\s*#\s+\S/.test(md.replace(/^\s*\n/, ''))) md = `# ${chapters[i].title}\n\n${md}`;
    return md.trim();
  });
  return {
    markdown: `---\ntitle: ${JSON.stringify(title)}\n---\n\n${parts.join('\n\n')}\n`,
    assets: [...assets].map(([path, name]) => ({ path, name })),
    chapters,
  };
}

/* ---------- Projets multi-pages ---------- */

export interface SitePageRef { id: string; path: string; title: string }
export interface SiteNavNode { title: string; page?: SitePageRef; folder?: string; children: SiteNavNode[] }

/** Arborescence de navigation : les dossiers deviennent des groupes, leur README ou index en est la page. */
export function siteNav(pages: SitePageRef[]): SiteNavNode[] {
  const root: SiteNavNode = { title: '', children: [] };
  const folders = new Map<string, SiteNavNode>([['', root]]);
  const folder = (dir: string): SiteNavNode => {
    if (folders.has(dir)) return folders.get(dir)!;
    const parent = folder(dirOf(dir));
    const node: SiteNavNode = { title: humanize(dir.split('/').pop()! + '.md'), folder: dir, children: [] };
    parent.children.push(node);
    folders.set(dir, node);
    return node;
  };
  for (const p of pages) {
    const dir = dirOf(p.path);
    if (dir && ENTRY.test(p.path.split('/').pop()!) && !folders.get(dir)?.page) {
      const f = folder(dir);
      f.page = p; f.title = p.title;
      continue;
    }
    folder(dir).children.push({ title: p.title, page: p, children: [] });
  }
  return root.children;
}

/** Résolution des liens d'une page de projet : page voisine, fichier du projet, ou rien (comportement normal). */
export function siteLinkResolver(pages: SitePageRef[], files: Set<string>, current: string, out: { page: (id: string, anchor: string) => string; file: (path: string) => string }) {
  const byPath = new Map(pages.map(p => [p.path, p]));
  const find = archiveResolver(files);
  return (href: string): string | null | undefined => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return undefined;
    const target = resolveArchivePath(current, href);
    if (!target) return undefined;
    const anchor = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
    const page = byPath.get(target) || byPath.get(target + '.md') || byPath.get(target + '/README.md') || byPath.get(target + '/index.md');
    if (page) return out.page(page.id, anchor);
    const f = find(current, href);
    if (f) return out.file(f.path);
    return fileKind(target) === 'markdown' ? null : undefined;
  };
}

/** Texte d'une page pour la recherche : sans balisage, titres repérés par leur ancre. */
export function searchDoc(id: string, path: string, title: string, md: string): SearchDoc {
  const text = md.replace(/^---[ \t]*\n[\s\S]*?\n(---|\.\.\.)[ \t]*(\n|$)/, '')
    .replace(/^ {0,3}:{3,}.*$/gm, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/^ {0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '').replace(/[*_`~|]/g, ' ').replace(/\s+/g, ' ').trim();
  return { id, path, title, headings: headingsOf(md).filter(h => h.depth >= 2).map(({ id: hid, text: t }) => ({ id: hid, text: t })), text: text.slice(0, 20000) };
}

/** Contexte de rendu d'une page de projet : navigation, fil d'Ariane, pages voisines. */
export function siteContext(site: { name: string; logo?: string; pages: SitePageRef[]; entry?: string }, current: string, href: (id: string) => string, search?: SiteContext['search']): SiteContext {
  const toItems = (nodes: SiteNavNode[]): SiteNavItem[] => nodes.map(n => ({ title: n.title, id: n.page?.id, folder: n.folder, children: toItems(n.children) }));
  const nav = siteNav(site.pages);
  const i = site.pages.findIndex(p => p.id === current);
  const page = site.pages[i];
  const crumbs: SiteContext['crumbs'] = [{ title: site.name, id: site.entry || site.pages[0]?.id }];
  if (page) {
    const parts = dirOf(page.path).split('/').filter(Boolean);
    let node: SiteNavNode | undefined;
    let level = nav;
    for (let k = 0; k < parts.length; k++) {
      node = level.find(n => n.folder === parts.slice(0, k + 1).join('/'));
      if (!node) break;
      if (node.page?.id !== current) crumbs.push({ title: node.title, id: node.page?.id });
      level = node.children;
    }
    if (page.id !== crumbs[0].id) crumbs.push({ title: page.title, id: page.id });
  }
  return {
    name: site.name, logo: site.logo, nav: toItems(nav), current, href, home: site.entry || site.pages[0]?.id,
    prev: i > 0 ? { id: site.pages[i - 1].id, title: site.pages[i - 1].title } : undefined,
    next: i >= 0 && i < site.pages.length - 1 ? { id: site.pages[i + 1].id, title: site.pages[i + 1].title } : undefined,
    crumbs, search,
  };
}
