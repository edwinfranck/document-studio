// Stockage local : un dossier par document, des fichiers ordinaires lisibles sans l'application.
//
//   <home>/documents/<id>/document.md       source courante (miroir lisible du document collaboratif)
//                         original.md       source importée, jamais modifiée
//                         studio.json       nom, projet, réglages, propriétaire, membres, liens, validation
//                         collab.bin        état Yjs (édition simultanée), jamais réinitialisé
//                         versions/<n>.json versions signées : auteur(s), résumé, source, réglages
//                         comments.json     commentaires et suggestions ancrés
//                         activity.jsonl    journal d'activité (lisible par les membres)
//                         assets/           images et médias
//   <home>/audit.jsonl                      journal de sécurité (accès, droits), séparé
//   <home>/notifications/<userId>.json      centre de notifications
//   <home>/publications/<pubId>/            instantanés publiés (HTML, PDF), liés à une version
//   <home>/blocks/<id>.json                 bibliothèque de blocs réutilisables
//   <home>/themes/<id>.json                 gabarits personnels
//   <home>/trash/                           documents supprimés (récupérables à la main)

import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  changeStats, DEFAULT_WORKFLOW, maxRole, slugify,
  type DocSettings, type LibBlock, type Role, type Template, type Workflow,
} from '@studio/engine';

export const HOME = process.env.STUDIO_HOME || join(homedir(), 'DocumentStudio');
const DOCS = join(HOME, 'documents');
const THEMES = join(HOME, 'themes');
const TRASH = join(HOME, 'trash');
const NOTIFS = join(HOME, 'notifications');
export const PUBS = join(HOME, 'publications');
const BLOCKS = join(HOME, 'blocks');
for (const d of [DOCS, THEMES, TRASH, NOTIFS, PUBS, BLOCKS]) mkdirSync(d, { recursive: true });

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/* ---------- Modèle ---------- */

export interface Member { userId: string; role: Role; addedAt: string; addedBy?: string }
export interface ShareLink {
  id: string; token: string; role: Exclude<Role, 'owner'>; label?: string;
  expiresAt?: string; revoked?: boolean; requireLogin?: boolean; allowDownload: boolean;
  createdAt: string; createdBy: string;
}
export interface PublicationRef { id: string; version: number; at: string; by: string; visibility: 'public' | 'members'; revoked?: boolean; label?: string; official: boolean }
export interface DocMetaFile {
  name: string;
  project: string;
  settings: Partial<DocSettings>;
  createdAt: string;
  updatedAt: string;
  importedFrom?: string;
  owner?: string;
  members?: Member[];
  links?: ShareLink[];
  invites?: { email: string; role: Role; at: string; by: string }[];   // invitations en attente de compte
  workflow?: Workflow;
  version?: number;                     // dernière version enregistrée
  publications?: PublicationRef[];
  branchOf?: { docId: string; baseVersion: number; base: string; name: string };
}

export interface DocSummary {
  id: string; name: string; project: string; mode: string; templateId: string; role: Role;
  createdAt: string; updatedAt: string; words: number; size: number; state: string; owner?: string; shared: boolean;
}

export interface Version {
  n: number; at: string; authors: string[]; kind: 'auto' | 'named' | 'restore' | 'publish' | 'merge' | 'import' | 'create';
  label?: string; summary: string; added: number; removed: number; markdown: string; settings: Partial<DocSettings>;
  restoredFrom?: number;
}

export interface Comment {
  id: string; kind: 'comment' | 'suggestion';
  anchor: { start?: unknown; end?: unknown; quote: string; line: number; slide?: number; page?: number };
  body: string; replacement?: string;
  author: string; authorName: string; at: string;
  replies: { id: string; author: string; authorName: string; body: string; at: string }[];
  assignee?: string; mentions: string[];
  status: 'open' | 'resolved' | 'accepted' | 'rejected';
  decidedBy?: string; decidedAt?: string;
  log: { at: string; actor: string; action: string }[];
}

export interface Activity { at: string; actor: string; actorName: string; type: string; text: string; data?: Record<string, unknown> }
export interface Notification { id: string; at: string; type: string; docId?: string; text: string; actor?: string; read: boolean; link?: string }

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const dirOf = (id: string) => {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant de document invalide.');
  const d = join(DOCS, id);
  if (!existsSync(join(d, 'studio.json'))) throw new HttpError(404, 'Document introuvable.');
  return d;
};
export const docDir = dirOf;
export const docExists = (id: string) => ID.test(id) && existsSync(join(DOCS, id, 'studio.json'));

/** Nom de fichier sûr pour une ressource (pas de chemin, pas de caractères spéciaux). */
export function safeAssetName(name: string): string {
  const base = basename(String(name)).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clean = base.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120);
  if (!clean || !/\.[a-z0-9]{2,5}$/i.test(clean)) throw new HttpError(400, 'Nom de fichier invalide (extension requise).');
  return clean;
}

export const readMeta = (id: string): DocMetaFile => JSON.parse(readFileSync(join(dirOf(id), 'studio.json'), 'utf8'));
export function writeMeta(id: string, m: DocMetaFile) { writeAtomic(join(dirOf(id), 'studio.json'), JSON.stringify(m, null, 2)); }
export function patchMeta(id: string, fn: (m: DocMetaFile) => void) { const m = readMeta(id); fn(m); writeMeta(id, m); return m; }
/** Écriture atomique : on écrit à côté puis on renomme, pour ne jamais laisser un fichier tronqué. */
export const writeAtomic = (file: string, data: string | Buffer | Uint8Array) => { const tmp = file + '.tmp'; writeFileSync(tmp, data); renameSync(tmp, file); };
const readJson = <T>(f: string, d: T): T => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d; } catch { return d; } };
const words = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
const rid = (n = 6) => randomBytes(n).toString('hex');
const now = () => new Date().toISOString();

export const readMarkdown = (id: string) => readFileSync(join(dirOf(id), 'document.md'), 'utf8');
export const writeMarkdownFile = (id: string, md: string) => writeAtomic(join(dirOf(id), 'document.md'), md);

/* ---------- Droits ---------- */

export interface Access { role: Role | null; via: 'owner' | 'member' | 'link' | null; link?: ShareLink }

/** Rôle effectif : membre ou propriétaire, et lien de partage valide s'il est présenté. */
export function accessOf(m: DocMetaFile, userId: string | null, shareToken?: string | null): Access {
  let role: Role | null = null;
  let via: Access['via'] = null;
  if (userId && m.owner === userId) return { role: 'owner', via: 'owner' };
  const mem = userId ? m.members?.find(x => x.userId === userId) : undefined;
  if (mem) { role = mem.role; via = 'member'; }
  const link = shareToken ? m.links?.find(l => l.token === shareToken) : undefined;
  if (link && !link.revoked && (!link.expiresAt || new Date(link.expiresAt).getTime() > Date.now()) && (!link.requireLogin || userId)) {
    const r = maxRole(role, link.role);
    if (r !== role) { role = r; via = 'link'; }
    return { role, via, link };
  }
  return { role, via };
}

export function findLink(token: string): { docId: string; link: ShareLink } | null {
  for (const id of readdirSync(DOCS)) {
    const m = readJson<DocMetaFile | null>(join(DOCS, id, 'studio.json'), null);
    const link = m?.links?.find(l => l.token === token);
    if (link) return { docId: id, link };
  }
  return null;
}

/* ---------- Documents ---------- */

export function listDocs(userId: string): DocSummary[] {
  const out: DocSummary[] = [];
  for (const id of readdirSync(DOCS)) {
    const dir = join(DOCS, id);
    const m = readJson<DocMetaFile | null>(join(dir, 'studio.json'), null);
    if (!m) continue;
    const a = accessOf(m, userId);
    if (!a.role) continue;
    try {
      const md = readFileSync(join(dir, 'document.md'), 'utf8');
      out.push({
        id, name: m.name, project: m.project || '', mode: m.settings.mode || 'reading', templateId: m.settings.templateId || 'corporate', role: a.role,
        createdAt: m.createdAt, updatedAt: m.updatedAt, words: words(md), size: md.length, state: (m.workflow || DEFAULT_WORKFLOW).state,
        owner: m.owner, shared: !!(m.members?.length || m.links?.some(l => !l.revoked)),
      });
    } catch { /* dossier corrompu : ignoré dans la liste, laissé intact sur disque */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listAssets(dir: string) {
  const a = join(dir, 'assets');
  if (!existsSync(a)) return [];
  return readdirSync(a).filter(f => !f.endsWith('.tmp')).map(f => ({ name: f, size: statSync(join(a, f)).size }));
}

export function getDoc(id: string) {
  const dir = dirOf(id);
  const m = readMeta(id);
  migrateHistory(id);
  return {
    id, ...m, links: undefined, invites: undefined,
    markdown: readFileSync(join(dir, 'document.md'), 'utf8'),
    assets: listAssets(dir),
    hasOriginal: existsSync(join(dir, 'original.md')),
    workflow: m.workflow || DEFAULT_WORKFLOW,
    version: m.version || 0,
  };
}

export function createDoc(input: { name?: string; project?: string; markdown?: string; settings?: Partial<DocSettings>; importedFrom?: string; branchOf?: DocMetaFile['branchOf'] }, owner?: string) {
  const name = (input.name || '').trim().slice(0, 200) || 'Sans titre';
  const id = `${slugify(name).slice(0, 48)}-${rid(3)}`;
  const dir = join(DOCS, id);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const md = input.markdown ?? `# ${name}\n\n`;
  writeFileSync(join(dir, 'document.md'), md);
  if (input.importedFrom) writeFileSync(join(dir, 'original.md'), md);
  const t = now();
  writeFileSync(join(dir, 'studio.json'), JSON.stringify({
    name, project: input.project || '', settings: input.settings || {}, createdAt: t, updatedAt: t, importedFrom: input.importedFrom,
    owner, members: [], links: [], workflow: DEFAULT_WORKFLOW, version: 0, publications: [], branchOf: input.branchOf,
  } satisfies DocMetaFile, null, 2));
  addVersion(id, { markdown: md, settings: input.settings || {}, authors: owner ? [owner] : [], kind: input.importedFrom ? 'import' : 'create' });
  logActivity(id, owner || 'system', 'created', input.branchOf ? `a créé une branche de « ${input.branchOf.name} »` : input.importedFrom ? `a importé ${input.importedFrom}` : 'a créé le document');
  return getDoc(id);
}

/** Les anciens instantanés (history/*.md) deviennent des versions sans auteur connu. */
function migrateHistory(id: string) {
  const h = join(dirOf(id), 'history');
  if (!existsSync(h)) return;
  const files = readdirSync(h).filter(f => f.endsWith('.md')).sort();
  const m = readMeta(id);
  for (const f of files) {
    addVersion(id, { markdown: readFileSync(join(h, f), 'utf8'), settings: m.settings, authors: m.owner ? [m.owner] : [], kind: 'auto', label: 'Instantané importé', at: statSync(join(h, f)).mtime.toISOString() });
  }
  renameSync(h, join(dirOf(id), 'history.migrated'));
}

export function updateMeta(id: string, patch: { settings?: Partial<DocSettings>; name?: string; project?: string }) {
  const m = patchMeta(id, m => {
    if (patch.settings) m.settings = patch.settings;
    if (typeof patch.name === 'string' && patch.name.trim()) m.name = patch.name.trim().slice(0, 200);
    if (typeof patch.project === 'string') m.project = patch.project.trim().slice(0, 120);
    m.updatedAt = now();
  });
  return { updatedAt: m.updatedAt };
}

export function touch(id: string) { patchMeta(id, m => { m.updatedAt = now(); }); }

export function deleteDoc(id: string) {
  const dir = dirOf(id);
  renameSync(dir, join(TRASH, `${id}-${Date.now()}`));
}

export function readOriginal(id: string, original: boolean) {
  const dir = dirOf(id);
  const f = join(dir, original && existsSync(join(dir, 'original.md')) ? 'original.md' : 'document.md');
  return readFileSync(f, 'utf8');
}

export function copyAssets(from: string, to: string) {
  const src = join(dirOf(from), 'assets');
  if (existsSync(src)) cpSync(src, join(dirOf(to), 'assets'), { recursive: true });
}

export function assetPath(id: string, name: string) { return join(dirOf(id), 'assets', safeAssetName(name)); }

export function putAsset(id: string, name: string, data: Buffer) {
  const clean = safeAssetName(name);
  const dir = join(dirOf(id), 'assets');
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, clean), data);
  return { name: clean, size: data.length };
}

export function deleteAsset(id: string, name: string) {
  const f = assetPath(id, name);
  if (existsSync(f)) rmSync(f);
}

/* ---------- Versions ---------- */

const vdir = (id: string) => { const d = join(dirOf(id), 'versions'); mkdirSync(d, { recursive: true }); return d; };

export function listVersions(id: string): Omit<Version, 'markdown' | 'settings'>[] {
  return readdirSync(vdir(id)).filter(f => f.endsWith('.json')).map(f => readJson<Version | null>(join(vdir(id), f), null))
    .filter((v): v is Version => !!v).sort((a, b) => b.n - a.n).map(({ markdown: _m, settings: _s, ...v }) => v);
}
export function readVersion(id: string, n: number): Version {
  const v = readJson<Version | null>(join(vdir(id), `${n}.json`), null);
  if (!v) throw new HttpError(404, `Version ${n} introuvable.`);
  return v;
}
export function latestVersion(id: string): Version | null {
  const m = readMeta(id);
  return m.version ? readVersion(id, m.version) : null;
}

/** Enregistre une version. Rien n'est créé si ni le texte ni les réglages n'ont changé (sauf version nommée). */
export function addVersion(id: string, v: { markdown: string; settings: Partial<DocSettings>; authors: string[]; kind: Version['kind']; label?: string; restoredFrom?: number; at?: string }): Version | null {
  const prev = latestVersion(id);
  if (prev && prev.markdown === v.markdown && JSON.stringify(prev.settings) === JSON.stringify(v.settings) && v.kind === 'auto') return null;
  const st = changeStats(prev?.markdown ?? '', v.markdown);
  const n = (readMeta(id).version || 0) + 1;
  const ver: Version = {
    n, at: v.at || now(), authors: [...new Set(v.authors)], kind: v.kind, label: v.label, restoredFrom: v.restoredFrom,
    summary: prev ? (JSON.stringify(prev.settings) !== JSON.stringify(v.settings) && st.added + st.removed === 0 ? 'mise en forme modifiée' : st.summary) : 'première version',
    added: st.added, removed: st.removed, markdown: v.markdown, settings: v.settings,
  };
  writeAtomic(join(vdir(id), `${n}.json`), JSON.stringify(ver));
  patchMeta(id, m => { m.version = n; });
  return ver;
}

/* ---------- Activité et audit ---------- */

let nameOf: (userId: string) => string = id => id;
export function setNameResolver(fn: (userId: string) => string) { nameOf = fn; }

export function logActivity(id: string, actor: string, type: string, text: string, data?: Record<string, unknown>) {
  const a: Activity = { at: now(), actor, actorName: nameOf(actor), type, text, data };
  appendFileSync(join(dirOf(id), 'activity.jsonl'), JSON.stringify(a) + '\n');
  return a;
}
export function listActivity(id: string, limit = 200): Activity[] {
  const f = join(dirOf(id), 'activity.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map(l => JSON.parse(l)).reverse();
}
/** Journal de sécurité, distinct : accès refusés, droits, liens. Conservé 180 jours (purge au démarrage). */
export function audit(event: string, data: Record<string, unknown>) {
  appendFileSync(join(HOME, 'audit.jsonl'), JSON.stringify({ at: now(), event, ...data }) + '\n');
}
export function purgeAudit(days = 180) {
  const f = join(HOME, 'audit.jsonl');
  if (!existsSync(f)) return;
  const limit = Date.now() - days * 86400e3;
  const keep = readFileSync(f, 'utf8').split('\n').filter(l => { try { return new Date(JSON.parse(l).at).getTime() >= limit; } catch { return false; } });
  writeAtomic(f, keep.join('\n') + (keep.length ? '\n' : ''));
}

/* ---------- Commentaires et suggestions ---------- */

const cfile = (id: string) => join(dirOf(id), 'comments.json');
export const listComments = (id: string): Comment[] => readJson(cfile(id), []);
export function saveComments(id: string, list: Comment[]) { writeAtomic(cfile(id), JSON.stringify(list, null, 2)); }
export function mutateComment(id: string, cid: string, fn: (c: Comment) => void): Comment {
  const list = listComments(id);
  const c = list.find(x => x.id === cid);
  if (!c) throw new HttpError(404, 'Commentaire introuvable.');
  fn(c);
  saveComments(id, list);
  return c;
}
export function addComment(id: string, c: Omit<Comment, 'id' | 'at' | 'replies' | 'status' | 'log'>): Comment {
  const list = listComments(id);
  const full: Comment = { ...c, id: rid(5), at: now(), replies: [], status: 'open', log: [{ at: now(), actor: c.author, action: 'created' }] };
  list.push(full);
  saveComments(id, list);
  return full;
}

/* ---------- Notifications ---------- */

const nfile = (userId: string) => join(NOTIFS, `${userId.replace(/[^\w-]/g, '')}.json`);
export const listNotifications = (userId: string): Notification[] => readJson(nfile(userId), []);
export function notify(userId: string, n: Omit<Notification, 'id' | 'at' | 'read'>) {
  if (!userId || userId.startsWith('guest:') || userId === n.actor) return;
  const list = listNotifications(userId);
  list.unshift({ ...n, id: rid(5), at: now(), read: false });
  writeAtomic(nfile(userId), JSON.stringify(list.slice(0, 300), null, 2));
}
export function markNotifications(userId: string, ids: string[] | 'all') {
  const list = listNotifications(userId).map(n => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n));
  writeAtomic(nfile(userId), JSON.stringify(list, null, 2));
}

/* ---------- Blocs réutilisables ---------- */

export interface StoredBlock extends LibBlock { owner: string; shared: boolean }
export const listBlocks = (userId: string): StoredBlock[] =>
  readdirSync(BLOCKS).filter(f => f.endsWith('.json')).map(f => readJson<StoredBlock | null>(join(BLOCKS, f), null))
    .filter((b): b is StoredBlock => !!b && (b.owner === userId || b.shared)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
export const getBlock = (id: string): StoredBlock | undefined => (ID.test(id) ? readJson<StoredBlock | undefined>(join(BLOCKS, `${id}.json`), undefined) : undefined);
export function saveBlock(input: { id?: string; name: string; description?: string; markdown: string; shared?: boolean }, userId: string): StoredBlock {
  const existing = input.id ? getBlock(input.id) : undefined;
  if (existing && existing.owner !== userId) throw new HttpError(403, 'Seul l\'auteur du bloc peut le modifier.');
  const b: StoredBlock = existing ?? { id: `${slugify(input.name).slice(0, 40)}-${rid(2)}`, name: input.name.trim().slice(0, 80) || 'Bloc', versions: [], updatedAt: now(), owner: userId, shared: input.shared ?? true };
  if (input.description !== undefined) b.description = input.description.slice(0, 300);
  if (input.name?.trim()) b.name = input.name.trim().slice(0, 80);
  if (input.shared !== undefined) b.shared = input.shared;
  const last = b.versions[b.versions.length - 1];
  if (!last || last.markdown !== input.markdown) b.versions.push({ version: (last?.version || 0) + 1, markdown: input.markdown, at: now(), author: userId });
  b.updatedAt = now();
  writeAtomic(join(BLOCKS, `${b.id}.json`), JSON.stringify(b, null, 2));
  return b;
}
export function deleteBlock(id: string, userId: string) {
  const b = getBlock(id);
  if (!b) return;
  if (b.owner !== userId) throw new HttpError(403, 'Seul l\'auteur du bloc peut le supprimer.');
  rmSync(join(BLOCKS, `${id}.json`));
}

/* ---------- Gabarits personnalisés ---------- */

export function listThemes(): Template[] {
  return readdirSync(THEMES).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return [JSON.parse(readFileSync(join(THEMES, f), 'utf8'))]; } catch { return []; }
  });
}

export function saveTheme(t: Template): Template {
  if (!t || typeof t !== 'object' || !t.tokens) throw new HttpError(400, 'Gabarit invalide : « tokens » manquant.');
  const id = t.id && ID.test(t.id) && !t.builtin ? t.id : `${slugify(t.name || 'gabarit').slice(0, 40)}-${rid(3)}`;
  const clean: Template = { ...t, id, builtin: false, name: String(t.name || 'Gabarit').slice(0, 80) };
  writeFileSync(join(THEMES, id + '.json'), JSON.stringify(clean, null, 2));
  return clean;
}

export function deleteTheme(id: string) {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide.');
  const f = join(THEMES, id + '.json');
  if (existsSync(f)) rmSync(f);
}

/* ---------- Migration : documents d'avant les comptes ---------- */

/** Les documents sans propriétaire reviennent au premier compte créé. */
export function claimOrphans(userId: string) {
  let n = 0;
  for (const id of readdirSync(DOCS)) {
    const f = join(DOCS, id, 'studio.json');
    const m = readJson<DocMetaFile | null>(f, null);
    if (m && !m.owner) { m.owner = userId; m.members ||= []; m.links ||= []; writeAtomic(f, JSON.stringify(m, null, 2)); n++; }
  }
  return n;
}

export { rid, now };
