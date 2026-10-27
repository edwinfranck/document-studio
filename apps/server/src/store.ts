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
//   <home>/spaces.json                      espaces d'équipe : membres, rôle par défaut
//   <home>/brands/<id>.json, brands/<id>/   identités visuelles (logos, couleurs, polices, couverture)
//   <home>/plugins/<id>.json                plugins de composants (déclaratifs)
//   <home>/workflow-templates.json          modèles de validation réutilisables
//   <home>/mailqueue/<userId>.json          notifications en attente du résumé quotidien
//   <home>/trash/                           documents supprimés (récupérables à la main)

import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  brandSummary, changeStats, DEFAULT_WORKFLOW, maxRole, slugify,
  type Brand, type DocSettings, type LibBlock, type Role, type Template, type Workflow, type WorkflowTemplate,
} from '@studio/engine';

export const HOME = process.env.STUDIO_HOME || join(homedir(), 'DocumentStudio');
const DOCS = join(HOME, 'documents');
const THEMES = join(HOME, 'themes');
const TRASH = join(HOME, 'trash');
const NOTIFS = join(HOME, 'notifications');
export const PUBS = join(HOME, 'publications');
const BLOCKS = join(HOME, 'blocks');
const BRANDS = join(HOME, 'brands');
export const PLUGINS = join(HOME, 'plugins');
export const MAILQ = join(HOME, 'mailqueue');
for (const d of [DOCS, THEMES, TRASH, NOTIFS, PUBS, BLOCKS, BRANDS, PLUGINS, MAILQ]) mkdirSync(d, { recursive: true });

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
  space?: string;                       // espace d'équipe auquel le document appartient
  spaceRole?: Exclude<Role, 'owner'>;   // rôle donné aux membres de l'espace
}

export interface DocSummary {
  id: string; name: string; project: string; mode: string; templateId: string; role: Role;
  createdAt: string; updatedAt: string; words: number; size: number; state: string; owner?: string; shared: boolean; space?: string;
}

export interface Version {
  n: number; at: string; authors: string[]; kind: 'auto' | 'named' | 'restore' | 'publish' | 'merge' | 'import' | 'create';
  label?: string; summary: string; added: number; removed: number; markdown: string; settings: Partial<DocSettings>;
  restoredFrom?: number;
}

export interface Comment {
  id: string; kind: 'comment' | 'suggestion';
  anchor: { start?: unknown; end?: unknown; quote: string; line: number; slide?: number; page?: number; rect?: { x: number; y: number; w: number; h: number }; excerpt?: string };
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

export interface Access { role: Role | null; via: 'owner' | 'member' | 'space' | 'link' | null; link?: ShareLink }

/** Rôle effectif : propriétaire, membre, membre de l'espace du document, et lien de partage valide s'il est présenté. */
export function accessOf(m: DocMetaFile, userId: string | null, shareToken?: string | null): Access {
  let role: Role | null = null;
  let via: Access['via'] = null;
  if (userId && m.owner === userId) return { role: 'owner', via: 'owner' };
  const mem = userId ? m.members?.find(x => x.userId === userId) : undefined;
  if (mem) { role = mem.role; via = 'member'; }
  const sm = userId && m.space ? getSpace(m.space)?.members.find(x => x.userId === userId) : undefined;
  if (sm) {
    // l'administrateur d'un espace édite tous ses documents ; les membres reçoivent le rôle fixé par le document
    const r = maxRole(role, sm.role === 'admin' ? 'editor' : m.spaceRole || 'editor');
    if (r !== role) { role = r; via = 'space'; }
  }
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
        owner: m.owner, shared: !!(m.members?.length || m.links?.some(l => !l.revoked)), space: m.space,
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
export type Delivery = (userId: string, n: Notification) => 'off' | 'app' | 'email';
let delivery: Delivery = () => 'app';
let emailHook: (userId: string, n: Notification) => void = () => {};
/** Les préférences de chaque compte décident du canal ; l'e-mail est confié au serveur (app.ts). */
export function setDelivery(d: Delivery, email: (userId: string, n: Notification) => void) { delivery = d; emailHook = email; }
export function notify(userId: string, n: Omit<Notification, 'id' | 'at' | 'read'>) {
  if (!userId || userId.startsWith('guest:') || userId === n.actor) return;
  const full: Notification = { ...n, id: rid(5), at: now(), read: false };
  const ch = delivery(userId, full);
  if (ch === 'off') return;
  const list = listNotifications(userId);
  list.unshift(full);
  writeAtomic(nfile(userId), JSON.stringify(list.slice(0, 300), null, 2));
  if (ch === 'email') emailHook(userId, full);
}

/* ---------- Résumé quotidien ---------- */

const qfile = (userId: string) => join(MAILQ, `${userId.replace(/[^\w-]/g, '')}.json`);
export const readQueue = (userId: string): { since: string; items: Notification[] } => readJson(qfile(userId), { since: now(), items: [] });
export function enqueue(userId: string, n: Notification) { const q = readQueue(userId); q.items.push(n); writeAtomic(qfile(userId), JSON.stringify(q)); }
export function takeQueue(userId: string) { const q = readQueue(userId); writeAtomic(qfile(userId), JSON.stringify({ since: now(), items: [] })); return q; }
export const queuedUsers = () => readdirSync(MAILQ).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
export function markNotifications(userId: string, ids: string[] | 'all') {
  const list = listNotifications(userId).map(n => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n));
  writeAtomic(nfile(userId), JSON.stringify(list, null, 2));
}

/* ---------- Blocs réutilisables ---------- */

export interface StoredBlock extends LibBlock { owner: string; shared: boolean; space?: string }
/** Visible : à son auteur ; aux membres de son espace ; à tous si partagé sans espace. */
export const visibleTo = (x: { owner: string; shared?: boolean; space?: string }, userId: string) =>
  x.owner === userId || (x.space ? !!getSpace(x.space)?.members.some(m => m.userId === userId) : x.shared !== false);
export const listBlocks = (userId: string): StoredBlock[] =>
  readdirSync(BLOCKS).filter(f => f.endsWith('.json')).map(f => readJson<StoredBlock | null>(join(BLOCKS, f), null))
    .filter((b): b is StoredBlock => !!b && visibleTo(b, userId)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
export const getBlock = (id: string): StoredBlock | undefined => (ID.test(id) ? readJson<StoredBlock | undefined>(join(BLOCKS, `${id}.json`), undefined) : undefined);
export function saveBlock(input: { id?: string; name: string; description?: string; markdown: string; shared?: boolean; space?: string | null }, userId: string): StoredBlock {
  const existing = input.id ? getBlock(input.id) : undefined;
  if (existing && existing.owner !== userId) throw new HttpError(403, 'Seul l\'auteur du bloc peut le modifier.');
  const b: StoredBlock = existing ?? { id: `${slugify(input.name).slice(0, 40)}-${rid(2)}`, name: input.name.trim().slice(0, 80) || 'Bloc', versions: [], updatedAt: now(), owner: userId, shared: input.shared ?? true };
  if (input.description !== undefined) b.description = input.description.slice(0, 300);
  if (input.name?.trim()) b.name = input.name.trim().slice(0, 80);
  if (input.shared !== undefined) b.shared = input.shared;
  if (input.space !== undefined) b.space = checkSpaceMember(input.space, userId);
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

/** Gabarits personnels : communs au serveur, sauf ceux rangés dans un espace (visibles de ses membres). */
export function listThemes(userId?: string): Template[] {
  return readdirSync(THEMES).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return [JSON.parse(readFileSync(join(THEMES, f), 'utf8'))]; } catch { return []; }
  }).filter((t: Template & { space?: string }) => !t.space || userId === undefined || !!getSpace(t.space)?.members.some(m => m.userId === userId));
}

export function saveTheme(t: Template & { space?: string | null }, userId?: string): Template {
  if (!t || typeof t !== 'object' || !t.tokens) throw new HttpError(400, 'Gabarit invalide : « tokens » manquant.');
  const id = t.id && ID.test(t.id) && !t.builtin ? t.id : `${slugify(t.name || 'gabarit').slice(0, 40)}-${rid(3)}`;
  const clean: Template & { space?: string } = { ...t, id, builtin: false, name: String(t.name || 'Gabarit').slice(0, 80), space: userId && t.space ? checkSpaceMember(t.space, userId) : undefined };
  writeFileSync(join(THEMES, id + '.json'), JSON.stringify(clean, null, 2));
  return clean;
}

export function deleteTheme(id: string) {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide.');
  const f = join(THEMES, id + '.json');
  if (existsSync(f)) rmSync(f);
}

/* ---------- Espaces d'équipe ---------- */

export interface SpaceMember { userId: string; role: 'admin' | 'member'; addedAt: string }
export interface Space { id: string; name: string; description?: string; createdAt: string; createdBy: string; members: SpaceMember[]; invites: { email: string; role: 'admin' | 'member'; at: string }[] }
const SPACES = join(HOME, 'spaces.json');
export const listSpaces = (): Space[] => readJson(SPACES, []);
export const getSpace = (id: string) => listSpaces().find(s => s.id === id);
export const spacesOf = (userId: string) => listSpaces().filter(s => s.members.some(m => m.userId === userId));
export function mutateSpaces(fn: (list: Space[]) => void) { const l = listSpaces(); fn(l); writeAtomic(SPACES, JSON.stringify(l, null, 2)); return l; }
/** Vérifie qu'on range un objet dans un espace dont on est membre ; null retire l'espace. */
export function checkSpaceMember(space: string | null | undefined, userId: string): string | undefined {
  if (!space) return undefined;
  if (!getSpace(space)?.members.some(m => m.userId === userId)) throw new HttpError(403, 'Vous n\'êtes pas membre de cet espace.');
  return space;
}
export const docsInSpace = (space: string) => readdirSync(DOCS).filter(id => readJson<DocMetaFile | null>(join(DOCS, id, 'studio.json'), null)?.space === space);

/* ---------- Identités visuelles ---------- */

const bfile = (id: string) => join(BRANDS, `${id}.json`);
export const brandDir = (id: string) => { if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide.'); return join(BRANDS, id); };
export const getBrand = (id: string): Brand | undefined => (ID.test(id) ? readJson<Brand | undefined>(bfile(id), undefined) : undefined);
export const listBrands = (userId: string): Brand[] =>
  readdirSync(BRANDS).filter(f => f.endsWith('.json')).map(f => readJson<Brand | null>(join(BRANDS, f), null))
    .filter((b): b is Brand => !!b && visibleTo(b, userId)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
/** Modifier une identité : son auteur, ou un administrateur de son espace. */
export const canEditBrand = (b: Brand, userId: string) => b.owner === userId || (!!b.space && !!getSpace(b.space)?.members.some(m => m.userId === userId && m.role === 'admin'));
export function saveBrand(input: Partial<Brand>, userId: string): Brand {
  const prev = input.id ? getBrand(input.id) : undefined;
  if (prev && !canEditBrand(prev, userId)) throw new HttpError(403, 'Seuls l\'auteur et les administrateurs de l\'espace modifient cette identité.');
  const str = (v: unknown, n = 120) => String(v ?? '').slice(0, n);
  const colors = Object.fromEntries(Object.entries(input.colors ?? prev?.colors ?? {}).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(String(v))));
  const fonts = Object.fromEntries(Object.entries(input.fonts ?? prev?.fonts ?? {}).filter(([k, v]) => ['heading', 'body', 'mono'].includes(k) && v).map(([k, v]) => [k, str(v, 80)]));
  const hf = (x: any) => (x ? { left: str(x.left, 200), center: str(x.center, 200), right: str(x.right, 200) } : undefined);
  const next: Brand = {
    id: prev?.id || `${slugify(input.name || 'identite').slice(0, 40)}-${rid(2)}`,
    name: str(input.name ?? prev?.name, 80).trim() || 'Identité', description: input.description !== undefined ? str(input.description, 300) : prev?.description,
    version: prev?.version || 0, updatedAt: now(), owner: prev?.owner || userId,
    space: input.space !== undefined ? checkSpaceMember(input.space, userId) : prev?.space,
    colors, fonts: fonts as Brand['fonts'], templateId: input.templateId !== undefined ? str(input.templateId, 80) || undefined : prev?.templateId,
    logos: (input.logos ?? prev?.logos ?? []).filter(l => l && typeof l.file === 'string').map(l => ({ file: safeAssetName(l.file), label: str(l.label, 60) })),
    cover: input.cover !== undefined ? str(input.cover, 4000) || undefined : prev?.cover,
    header: input.header !== undefined ? hf(input.header) : prev?.header, footer: input.footer !== undefined ? hf(input.footer) : prev?.footer,
    organization: input.organization !== undefined ? str(input.organization, 120) || undefined : prev?.organization,
    history: prev?.history || [],
  };
  const summary = brandSummary(prev, next);
  if (!prev || summary !== 'aucun changement visible') {
    next.version += 1;
    next.history = [...next.history, { version: next.version, at: next.updatedAt, author: userId, summary }].slice(-100);
  }
  writeAtomic(bfile(next.id), JSON.stringify(next, null, 2));
  return next;
}
export function deleteBrand(id: string, userId: string) {
  const b = getBrand(id);
  if (!b) return;
  if (!canEditBrand(b, userId)) throw new HttpError(403, 'Seuls l\'auteur et les administrateurs de l\'espace suppriment cette identité.');
  rmSync(bfile(id));
  if (existsSync(brandDir(id))) renameSync(brandDir(id), join(TRASH, `brand-${id}-${Date.now()}`));
}

/* ---------- Plugins ---------- */

export const listPluginFiles = (): unknown[] => readdirSync(PLUGINS).filter(f => f.endsWith('.json')).sort().flatMap(f => { const p = readJson<unknown>(join(PLUGINS, f), null); return p ? [p] : []; });
export function savePluginFile(p: { id: string }) { writeAtomic(join(PLUGINS, `${p.id}.json`), JSON.stringify(p, null, 2)); }
export function deletePluginFile(id: string) { if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide.'); const f = join(PLUGINS, `${id}.json`); if (existsSync(f)) rmSync(f); }

/* ---------- Modèles de validation ---------- */

const WFT = join(HOME, 'workflow-templates.json');
export const listWorkflowTemplates = (userId: string): WorkflowTemplate[] => readJson<WorkflowTemplate[]>(WFT, []).filter(t => visibleTo({ ...t, shared: false }, userId));
export function saveWorkflowTemplate(input: Partial<WorkflowTemplate>, userId: string, validUser: (id: string) => boolean): WorkflowTemplate {
  const all = readJson<WorkflowTemplate[]>(WFT, []);
  const prev = input.id ? all.find(t => t.id === input.id) : undefined;
  if (prev && prev.owner !== userId) throw new HttpError(403, 'Seul l\'auteur du modèle peut le modifier.');
  const reviewers = [...new Set((input.reviewers || []).filter(validUser))];
  if (!reviewers.length) throw new HttpError(400, 'Un modèle de validation compte au moins un relecteur.');
  const t: WorkflowTemplate = {
    id: prev?.id || rid(4), name: String(input.name || '').trim().slice(0, 80) || 'Modèle de validation', reviewers,
    requiredApprovals: Math.max(0, Math.min(reviewers.length, Number(input.requiredApprovals) || 0)), owner: prev?.owner || userId,
    space: input.space !== undefined ? checkSpaceMember(input.space, userId) : prev?.space, updatedAt: now(),
  };
  writeAtomic(WFT, JSON.stringify([...all.filter(x => x.id !== t.id), t], null, 2));
  return t;
}
export function deleteWorkflowTemplate(id: string, userId: string) {
  const all = readJson<WorkflowTemplate[]>(WFT, []);
  const t = all.find(x => x.id === id);
  if (t && t.owner !== userId) throw new HttpError(403, 'Seul l\'auteur du modèle peut le supprimer.');
  writeAtomic(WFT, JSON.stringify(all.filter(x => x.id !== id), null, 2));
}

/* ---------- Statistiques de consultation des publications ---------- */
// Aucune donnée personnelle : ni adresse IP ni identifiant. Les visiteurs uniques du jour sont comptés
// par une empreinte salée d'un sel tiré au hasard chaque jour et jamais écrit sur disque.

export interface PubStats { total: number; formats: Record<string, number>; days: Record<string, { views: number; visitors: number }>; last?: string }
const salt = { day: '', value: '' };
const seenToday = new Map<string, Set<string>>();
export function recordView(pubId: string, format: string, fingerprint: string) {
  const day = now().slice(0, 10);
  if (salt.day !== day) { salt.day = day; salt.value = rid(16); seenToday.clear(); }
  const f = join(PUBS, pubId, 'stats.json');
  const st = readJson<PubStats>(f, { total: 0, formats: {}, days: {} });
  st.total += 1;
  st.formats[format] = (st.formats[format] || 0) + 1;
  const d = (st.days[day] ||= { views: 0, visitors: 0 });
  d.views += 1;
  const h = createHash('sha256').update(salt.value + fingerprint).digest('hex').slice(0, 16);
  const set = seenToday.get(pubId) || new Set<string>();
  if (!set.has(h)) { set.add(h); d.visitors += 1; seenToday.set(pubId, set); }
  st.last = now();
  // 400 jours au plus
  const keys = Object.keys(st.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete st.days[k];
  writeAtomic(f, JSON.stringify(st));
}
export const pubStats = (pubId: string): PubStats => readJson(join(PUBS, pubId, 'stats.json'), { total: 0, formats: {}, days: {} });

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
