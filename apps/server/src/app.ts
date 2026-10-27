// Serveur HTTP de Document Studio : comptes, documents, partage, collaboration, versions, commentaires,
// validation, publications, blocs, exports. Chaque route vérifie les droits côté serveur.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import {
  can, DEFAULT_WORKFLOW, publishBlockers, ROLE_LABELS, ROLES, threeWayMerge, WORKFLOW_LABELS,
  type Action, type DocSettings, type Role, type Target, type WorkflowState,
} from '@studio/engine';
import { FONTS_DIR, KATEX_DIR, MIME, PAGEDJS_FILE } from '@studio/engine/node';
import * as S from './store.ts';
import * as A from './auth.ts';
import * as C from './collab.ts';
import { exportPdf, exportZip, renderHtml, type ExportInput } from './export.ts';
import { findChrome } from './browser.ts';

const UI_DIST = resolve(fileURLToPath(import.meta.url), '../../../studio/dist');
const MAX_BODY = 60 * 1024 * 1024;

S.setNameResolver(id => (id === 'system' ? 'Document Studio' : id.startsWith('guest:') ? 'Invité' : A.userById(id)?.name || 'Compte supprimé'));
S.purgeAudit();

/* ---------- HTTP ---------- */

type Ctx = { req: IncomingMessage; res: ServerResponse; p: Record<string, string>; url: URL; user: A.User | null; share: string | null };
type Handler = (c: Ctx) => Promise<void> | void;
const routes: { method: string; re: RegExp; keys: string[]; fn: Handler }[] = [];
const route = (method: string, path: string, fn: Handler) => {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, fn });
};

const json = (res: ServerResponse, data: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
};
const send = (res: ServerResponse, body: Buffer | string, type: string, filename?: string, inline = false) => {
  const h: Record<string, string> = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (filename) h['content-disposition'] = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`;
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
const bodyJson = async (req: IncomingMessage): Promise<any> => {
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

const inside = (root: string, rel: string) => {
  const f = normalize(join(root, rel));
  if (!f.startsWith(root + sep)) throw new S.HttpError(400, 'Chemin invalide.');
  return f;
};

/* ---------- Identité et droits ---------- */

const needUser = (c: Ctx) => { if (!c.user) throw new S.HttpError(401, 'Connectez-vous pour continuer.'); return c.user; };

/** Contrôle d'accès d'une route de document. Tout refus est consigné dans le journal de sécurité. */
function guard(c: Ctx, action: Action) {
  const id = c.p.id;
  const meta = S.readMeta(id);
  const access = S.accessOf(meta, c.user?.id || null, c.share);
  if (!can(access.role, action) || (action === 'download' && access.via === 'link' && access.link && !access.link.allowDownload)) {
    S.audit('denied', { doc: id, action, user: c.user?.id || null, via: access.via, ip: c.req.socket.remoteAddress });
    if (!access.role) throw new S.HttpError(c.user ? 403 : 401, c.user ? 'Vous n\'avez pas accès à ce document.' : 'Connectez-vous pour accéder à ce document.');
    throw new S.HttpError(403, `Action réservée : votre rôle (${ROLE_LABELS[access.role]}) ne le permet pas.`);
  }
  const guestName = String(c.req.headers['x-guest-name'] || 'Invité').slice(0, 40);
  const actor = c.user?.id || `guest:${(c.share || '').slice(0, 8)}`;
  const actorName = c.user?.name || `${decodeURIComponent(guestName)} (invité)`;
  return { id, meta, role: access.role!, access, actor, actorName };
}

/** Texte et réglages courants : ceux du salon collaboratif s'il est ouvert, sinon ceux du disque. */
function current(id: string) {
  const r = C.liveRoom(id);
  return r ? { markdown: r.markdown, settings: r.settings } : { markdown: S.readMarkdown(id), settings: S.readMeta(id).settings };
}

const blockResolver = (actor: string) => (bid: string) => { const b = S.getBlock(bid); return b && (b.shared || b.owner === actor) ? b : undefined; };

function exportInput(id: string, actor: string, over: { settings?: Partial<DocSettings>; markdown?: string } = {}): ExportInput {
  const d = current(id);
  return { markdown: over.markdown ?? d.markdown, settings: over.settings ?? d.settings, dir: S.docDir(id), name: S.readMeta(id).name, themes: S.listThemes(), blocks: blockResolver(actor) };
}

/** Membres d'un document. Les adresses e-mail ne sont montrées qu'au propriétaire (fenêtre de partage). */
const members = (m: S.DocMetaFile, withEmail = false) => [
  ...(m.owner ? [{ userId: m.owner, role: 'owner' as Role }] : []),
  ...(m.members || []),
].map(x => {
  const u = A.userById(x.userId);
  return { ...x, user: u ? { ...A.pub(u), email: withEmail ? u.email : '' } : null };
});

function notifyMembers(id: string, actor: string, text: string, type: string, only?: string[]) {
  const m = S.readMeta(id);
  const ids = only || [m.owner, ...(m.members || []).map(x => x.userId)].filter(Boolean) as string[];
  for (const u of new Set(ids)) S.notify(u, { type, docId: id, text, actor, link: `#/doc/${id}` });
}

function publicDoc(c: Ctx, id: string, role: Role) {
  const d = S.getDoc(id);
  const cur = current(id);
  const m = S.readMeta(id);
  const latest = S.latestVersion(id);
  return {
    ...d, markdown: cur.markdown, settings: cur.settings, role,
    members: members(m, can(role, 'share')),
    links: can(role, 'share') ? m.links : undefined,
    invites: can(role, 'share') ? m.invites : undefined,
    publications: (m.publications || []).map(p => ({ ...p, stale: !!latest && p.version < latest.n && S.readVersion(id, p.version).markdown !== cur.markdown })),
    branchOf: m.branchOf ? { docId: m.branchOf.docId, baseVersion: m.branchOf.baseVersion, name: m.branchOf.name } : undefined,
    presence: C.presence(id),
  };
}

/* ---------- Comptes ---------- */

route('GET', '/api/health', c => json(c.res, { ok: true, home: S.HOME, chrome: findChrome(), auth: true, collab: true, signup: process.env.STUDIO_SIGNUP === 'invite' ? 'invite' : 'open' }));

route('GET', '/api/auth/state', c => json(c.res, { hasUsers: A.hasUsers(), me: c.user ? A.pub(c.user) : null }));

const invitedEmail = (email: string) => allInvites().some(i => i.email === email);
function allInvites() {
  const out: { email: string; role: Role; docId: string }[] = [];
  for (const d of readdirSync(join(S.HOME, 'documents')).filter(S.docExists)) for (const i of S.readMeta(d).invites || []) out.push({ ...i, docId: d });
  return out;
}

route('POST', '/api/auth/register', async c => {
  const first = !A.hasUsers();
  const u = A.register(await bodyJson(c.req), invitedEmail);
  if (first) { const n = S.claimOrphans(u.id); if (n) S.audit('claim', { user: u.id, docs: n }); }
  // Invitations en attente pour cette adresse : le compte devient membre des documents concernés.
  for (const inv of allInvites().filter(i => i.email === u.email)) {
    S.patchMeta(inv.docId, m => {
      m.members = [...(m.members || []).filter(x => x.userId !== u.id), { userId: u.id, role: inv.role, addedAt: new Date().toISOString() }];
      m.invites = (m.invites || []).filter(i => i.email !== u.email);
    });
    S.logActivity(inv.docId, u.id, 'joined', `a rejoint le document (${ROLE_LABELS[inv.role]})`);
  }
  S.audit('register', { user: u.id });
  json(c.res, { me: A.pub(u) }, 201, { 'set-cookie': A.sessionCookie(A.createSession(u.id), secure(c.req)) });
});
route('POST', '/api/auth/login', async c => {
  const b = await bodyJson(c.req);
  try {
    const u = A.login(b.email, b.password);
    S.audit('login', { user: u.id, ip: c.req.socket.remoteAddress });
    json(c.res, { me: A.pub(u) }, 200, { 'set-cookie': A.sessionCookie(A.createSession(u.id), secure(c.req)) });
  } catch (e) { S.audit('login-failed', { email: String(b.email || '').slice(0, 80), ip: c.req.socket.remoteAddress }); throw e; }
});
route('POST', '/api/auth/logout', c => {
  const t = A.cookieOf(c.req, 'sd_session');
  if (t) A.dropSession(t);
  json(c.res, { ok: true }, 200, { 'set-cookie': A.clearCookie });
});
route('PUT', '/api/auth/me', async c => json(c.res, { me: A.updateProfile(needUser(c).id, await bodyJson(c.req)) }));
route('GET', '/api/users', c => {
  needUser(c);
  const q = (c.url.searchParams.get('q') || '').toLowerCase();
  // Recherche par nom ou adresse exacte : on ne divulgue jamais la liste des adresses.
  json(c.res, A.allUsers().filter(u => !q || u.name.toLowerCase().includes(q) || u.email === q).slice(0, 20).map(u => ({ id: u.id, name: u.name, color: u.color })));
});
const secure = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https';

/* ---------- Liens de partage ---------- */

route('GET', '/api/share/:token', c => {
  const f = S.findLink(c.p.token);
  const valid = f && !f.link.revoked && (!f.link.expiresAt || new Date(f.link.expiresAt).getTime() > Date.now());
  if (!f || !valid) { S.audit('share-invalid', { ip: c.req.socket.remoteAddress }); throw new S.HttpError(404, 'Ce lien n\'existe pas, a expiré ou a été révoqué.'); }
  if (f.link.requireLogin && !c.user) throw new S.HttpError(401, 'Ce lien demande de se connecter.');
  json(c.res, { docId: f.docId, role: f.link.role, name: S.readMeta(f.docId).name, requireLogin: !!f.link.requireLogin });
});

/* ---------- Documents ---------- */

route('GET', '/api/docs', c => json(c.res, S.listDocs(needUser(c).id)));
route('POST', '/api/docs', async c => {
  const u = needUser(c);
  const b = await bodyJson(c.req);
  json(c.res, S.createDoc({ name: b.name, project: b.project, markdown: b.markdown, settings: b.settings, importedFrom: b.importedFrom }, u.id), 201);
});
route('GET', '/api/docs/:id', c => { const g = guard(c, 'read'); json(c.res, publicDoc(c, g.id, g.role)); });
route('PUT', '/api/docs/:id', async c => {
  const b = await bodyJson(c.req);
  if (typeof b.markdown === 'string' || b.settings) {
    const g = guard(c, 'edit');
    if (typeof b.markdown === 'string') C.writeText(g.id, b.markdown, g.actor, b.settings);
    else C.setSettings(g.id, b.settings, g.actor);
  }
  if (typeof b.name === 'string' || typeof b.project === 'string') {
    const g = guard(c, 'edit');
    const before = g.meta.name;
    S.updateMeta(g.id, { name: b.name, project: b.project });
    if (b.name && b.name !== before) S.logActivity(g.id, g.actor, 'renamed', `a renommé le document en « ${b.name} »`);
  }
  json(c.res, { updatedAt: S.readMeta(c.p.id).updatedAt });
});
route('DELETE', '/api/docs/:id', c => {
  const g = guard(c, 'delete');
  C.closeRoom(g.id);
  S.deleteDoc(g.id);
  S.audit('delete', { doc: g.id, user: g.actor });
  json(c.res, { ok: true });
});
route('POST', '/api/docs/:id/duplicate', c => {
  const g = guard(c, 'read');
  const u = needUser(c);
  const cur = current(g.id);
  const copy = S.createDoc({ name: `${g.meta.name} (copie)`, project: g.meta.project, markdown: cur.markdown, settings: cur.settings }, u.id);
  S.copyAssets(g.id, copy.id);
  json(c.res, S.getDoc(copy.id), 201);
});
route('GET', '/api/docs/:id/source', c => {
  const g = guard(c, 'download');
  const original = c.url.searchParams.get('original') === '1';
  send(c.res, original ? S.readOriginal(g.id, true) : current(g.id).markdown, 'text/markdown; charset=utf-8', `${g.meta.name}${original ? ' (original)' : ''}.md`);
});
route('GET', '/api/docs/:id/settings', c => {
  const g = guard(c, 'download');
  send(c.res, JSON.stringify({ name: g.meta.name, settings: current(g.id).settings }, null, 2), 'application/json', `${g.meta.name}.studio.json`);
});
route('GET', '/api/docs/:id/presence', c => { guard(c, 'read'); json(c.res, C.presence(c.p.id)); });

/* ---------- Membres et liens ---------- */

route('POST', '/api/docs/:id/members', async c => {
  const g = guard(c, 'share');
  const b = await bodyJson(c.req);
  const role = b.role as Role;
  if (!ROLES.includes(role) || role === 'owner') throw new S.HttpError(400, 'Rôle invalide.');
  const email = String(b.email || '').trim().toLowerCase();
  const u = A.userByEmail(email);
  if (u?.id === g.meta.owner) throw new S.HttpError(400, 'Cette personne est déjà propriétaire.');
  if (u) {
    S.patchMeta(g.id, m => { m.members = [...(m.members || []).filter(x => x.userId !== u.id), { userId: u.id, role, addedAt: new Date().toISOString(), addedBy: g.actor }]; });
    S.notify(u.id, { type: 'invite', docId: g.id, text: `${g.actorName} vous a invité sur « ${g.meta.name} » (${ROLE_LABELS[role]})`, actor: g.actor, link: `#/doc/${g.id}` });
    S.logActivity(g.id, g.actor, 'invited', `a invité ${u.name} (${ROLE_LABELS[role]})`);
  } else {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new S.HttpError(400, 'Adresse e-mail invalide.');
    S.patchMeta(g.id, m => { m.invites = [...(m.invites || []).filter(i => i.email !== email), { email, role, at: new Date().toISOString(), by: g.actor }]; });
    S.logActivity(g.id, g.actor, 'invited', `a invité ${email} (${ROLE_LABELS[role]}) : en attente de création du compte`);
  }
  S.audit('member-add', { doc: g.id, by: g.actor, email, role });
  C.refreshAccess(g.id);
  json(c.res, publicDoc(c, g.id, g.role), 201);
});
route('PATCH', '/api/docs/:id/members/:userId', async c => {
  const g = guard(c, 'share');
  const { role } = await bodyJson(c.req);
  if (!ROLES.includes(role) || role === 'owner') throw new S.HttpError(400, 'Rôle invalide.');
  S.patchMeta(g.id, m => { const x = m.members?.find(x => x.userId === c.p.userId); if (!x) throw new S.HttpError(404, 'Membre introuvable.'); x.role = role; });
  S.logActivity(g.id, g.actor, 'permission', `a changé le rôle de ${A.userById(c.p.userId)?.name || 'un membre'} : ${ROLE_LABELS[role as Role]}`);
  S.audit('member-role', { doc: g.id, by: g.actor, user: c.p.userId, role });
  C.refreshAccess(g.id);
  json(c.res, publicDoc(c, g.id, g.role));
});
route('DELETE', '/api/docs/:id/members/:userId', c => {
  const g = guard(c, 'share');
  const key = decodeURIComponent(c.p.userId);
  S.patchMeta(g.id, m => { m.members = (m.members || []).filter(x => x.userId !== key); m.invites = (m.invites || []).filter(i => i.email !== key); });
  S.logActivity(g.id, g.actor, 'permission', `a retiré l'accès de ${A.userById(key)?.name || key}`);
  S.audit('member-remove', { doc: g.id, by: g.actor, user: key });
  C.refreshAccess(g.id);
  json(c.res, publicDoc(c, g.id, g.role));
});
route('POST', '/api/docs/:id/links', async c => {
  const g = guard(c, 'share');
  const b = await bodyJson(c.req);
  if (!['viewer', 'commenter', 'editor'].includes(b.role)) throw new S.HttpError(400, 'Rôle invalide.');
  const link: S.ShareLink = {
    id: S.rid(4), token: S.rid(18), role: b.role, label: String(b.label || '').slice(0, 60) || undefined,
    expiresAt: b.expiresAt ? new Date(b.expiresAt).toISOString() : undefined, requireLogin: !!b.requireLogin,
    allowDownload: b.allowDownload !== false, createdAt: new Date().toISOString(), createdBy: g.actor,
  };
  S.patchMeta(g.id, m => { m.links = [...(m.links || []), link]; });
  S.logActivity(g.id, g.actor, 'link', `a créé un lien ${ROLE_LABELS[link.role].toLowerCase()}${link.expiresAt ? ` valable jusqu'au ${new Date(link.expiresAt).toLocaleDateString('fr-FR')}` : ''}`);
  S.audit('link-create', { doc: g.id, by: g.actor, link: link.id, role: link.role });
  json(c.res, publicDoc(c, g.id, g.role), 201);
});
route('PATCH', '/api/docs/:id/links/:lid', async c => {
  const g = guard(c, 'share');
  const b = await bodyJson(c.req);
  S.patchMeta(g.id, m => {
    const l = m.links?.find(x => x.id === c.p.lid);
    if (!l) throw new S.HttpError(404, 'Lien introuvable.');
    if (b.role && ['viewer', 'commenter', 'editor'].includes(b.role)) l.role = b.role;
    if ('expiresAt' in b) l.expiresAt = b.expiresAt ? new Date(b.expiresAt).toISOString() : undefined;
    if ('requireLogin' in b) l.requireLogin = !!b.requireLogin;
    if ('allowDownload' in b) l.allowDownload = !!b.allowDownload;
    if (b.revoked === true) l.revoked = true;
  });
  S.logActivity(g.id, g.actor, b.revoked ? 'link-revoked' : 'link', b.revoked ? 'a révoqué un lien de partage' : 'a modifié un lien de partage');
  S.audit(b.revoked ? 'link-revoke' : 'link-update', { doc: g.id, by: g.actor, link: c.p.lid });
  C.refreshAccess(g.id);
  json(c.res, publicDoc(c, g.id, g.role));
});

/* ---------- Versions et activité ---------- */

route('GET', '/api/docs/:id/versions', c => {
  guard(c, 'read');
  json(c.res, S.listVersions(c.p.id).map(v => ({ ...v, authorNames: v.authors.map(a => A.userById(a)?.name || 'Invité') })));
});
route('GET', '/api/docs/:id/versions/:n', c => { guard(c, 'read'); json(c.res, S.readVersion(c.p.id, Number(c.p.n))); });
route('POST', '/api/docs/:id/versions', async c => {
  const g = guard(c, 'edit');
  const { label } = await bodyJson(c.req);
  const cur = current(g.id);
  const r = C.liveRoom(g.id);
  const authors = r ? [...r.pendingAuthors, g.actor] : [g.actor];
  if (r) r.pendingAuthors.clear();
  const v = S.addVersion(g.id, { markdown: cur.markdown, settings: cur.settings, authors, kind: 'named', label: String(label || '').slice(0, 80) || 'Version nommée' });
  S.logActivity(g.id, g.actor, 'version', `a enregistré la version ${v!.n}${label ? ` « ${label} »` : ''}`);
  C.broadcast(g.id, { type: 'versions' });
  json(c.res, v, 201);
});
route('POST', '/api/docs/:id/versions/:n/restore', c => {
  const g = guard(c, 'restore');
  const n = Number(c.p.n);
  const v = S.readVersion(g.id, n);
  C.liveRoom(g.id)?.checkpoint('explicit');
  C.writeText(g.id, v.markdown, g.actor, v.settings);
  const r = C.liveRoom(g.id);
  if (r) r.pendingAuthors.clear();
  // La restauration crée une nouvelle version : l'historique n'est jamais réécrit.
  const nv = S.addVersion(g.id, { markdown: v.markdown, settings: v.settings, authors: [g.actor], kind: 'restore', label: `Restauration de la version ${n}`, restoredFrom: n });
  S.logActivity(g.id, g.actor, 'restored', `a restauré la version ${n}`);
  notifyMembers(g.id, g.actor, `${g.actorName} a restauré la version ${n} de « ${g.meta.name} »`, 'restore');
  C.broadcast(g.id, { type: 'versions' });
  json(c.res, nv);
});
route('GET', '/api/docs/:id/activity', c => { guard(c, 'read'); json(c.res, S.listActivity(c.p.id)); });

/* ---------- Commentaires et suggestions ---------- */

route('GET', '/api/docs/:id/comments', c => { guard(c, 'comment'); json(c.res, S.listComments(c.p.id)); });
route('POST', '/api/docs/:id/comments', async c => {
  const b = await bodyJson(c.req);
  const g = guard(c, b.kind === 'suggestion' ? 'suggest' : 'comment');
  const text = String(b.body || '').trim().slice(0, 5000);
  if (!text && b.kind !== 'suggestion') throw new S.HttpError(400, 'Commentaire vide.');
  const mentions = (Array.isArray(b.mentions) ? b.mentions : []).filter((x: string) => A.userById(x));
  const cm = S.addComment(g.id, {
    kind: b.kind === 'suggestion' ? 'suggestion' : 'comment',
    anchor: { start: b.anchor?.start, end: b.anchor?.end, quote: String(b.anchor?.quote || '').slice(0, 2000), line: Number(b.anchor?.line) || 0, slide: b.anchor?.slide, page: b.anchor?.page },
    body: text, replacement: b.kind === 'suggestion' ? String(b.replacement ?? '') : undefined,
    author: g.actor, authorName: g.actorName, assignee: b.assignee && A.userById(b.assignee) ? b.assignee : undefined, mentions,
  });
  const what = cm.kind === 'suggestion' ? 'une modification' : 'un commentaire';
  S.logActivity(g.id, g.actor, cm.kind, `a proposé ${what}${cm.anchor.quote ? ` sur « ${cm.anchor.quote.slice(0, 50)} »` : ''}`);
  for (const u of mentions) S.notify(u, { type: 'mention', docId: g.id, text: `${g.actorName} vous a mentionné dans « ${g.meta.name} »`, actor: g.actor, link: `#/doc/${g.id}?comment=${cm.id}` });
  if (cm.assignee) S.notify(cm.assignee, { type: 'assigned', docId: g.id, text: `${g.actorName} vous a assigné un commentaire dans « ${g.meta.name} »`, actor: g.actor, link: `#/doc/${g.id}?comment=${cm.id}` });
  if (g.meta.owner && !mentions.includes(g.meta.owner)) S.notify(g.meta.owner, { type: cm.kind, docId: g.id, text: `${g.actorName} a proposé ${what} dans « ${g.meta.name} »`, actor: g.actor, link: `#/doc/${g.id}?comment=${cm.id}` });
  C.broadcast(g.id, { type: 'comments' });
  json(c.res, cm, 201);
});
route('POST', '/api/docs/:id/comments/:cid/replies', async c => {
  const g = guard(c, 'comment');
  const b = await bodyJson(c.req);
  const text = String(b.body || '').trim().slice(0, 5000);
  if (!text) throw new S.HttpError(400, 'Réponse vide.');
  const cm = S.mutateComment(g.id, c.p.cid, x => { x.replies.push({ id: S.rid(4), author: g.actor, authorName: g.actorName, body: text, at: new Date().toISOString() }); x.log.push({ at: new Date().toISOString(), actor: g.actor, action: 'replied' }); });
  const people = new Set([cm.author, ...cm.replies.map(r => r.author), ...(Array.isArray(b.mentions) ? b.mentions : [])]);
  for (const u of people) S.notify(u, { type: 'reply', docId: g.id, text: `${g.actorName} a répondu dans « ${g.meta.name} »`, actor: g.actor, link: `#/doc/${g.id}?comment=${cm.id}` });
  C.broadcast(g.id, { type: 'comments' });
  json(c.res, cm);
});
route('PATCH', '/api/docs/:id/comments/:cid', async c => {
  const b = await bodyJson(c.req);
  const g = guard(c, 'comment');
  const cm0 = S.listComments(g.id).find(x => x.id === c.p.cid);
  if (!cm0) throw new S.HttpError(404, 'Commentaire introuvable.');
  // Résoudre : l'auteur du commentaire ou un éditeur. Assigner : un éditeur.
  if (b.status && !(cm0.author === g.actor || can(g.role, 'resolve'))) throw new S.HttpError(403, 'Seuls l\'auteur et les éditeurs peuvent résoudre.');
  if ('assignee' in b && !can(g.role, 'resolve')) throw new S.HttpError(403, 'Seuls les éditeurs peuvent assigner.');
  const cm = S.mutateComment(g.id, c.p.cid, x => {
    if (b.status === 'resolved' || b.status === 'open') { x.status = b.status; x.log.push({ at: new Date().toISOString(), actor: g.actor, action: b.status === 'resolved' ? 'resolved' : 'reopened' }); }
    if ('assignee' in b) { x.assignee = b.assignee && A.userById(b.assignee) ? b.assignee : undefined; x.log.push({ at: new Date().toISOString(), actor: g.actor, action: 'assigned' }); }
  });
  if (b.status) S.logActivity(g.id, g.actor, 'comment-' + b.status, b.status === 'resolved' ? 'a résolu un commentaire' : 'a rouvert un commentaire');
  if (cm.assignee && 'assignee' in b) S.notify(cm.assignee, { type: 'assigned', docId: g.id, text: `${g.actorName} vous a assigné un commentaire dans « ${g.meta.name} »`, actor: g.actor, link: `#/doc/${g.id}?comment=${cm.id}` });
  C.broadcast(g.id, { type: 'comments' });
  json(c.res, cm);
});
route('POST', '/api/docs/:id/comments/:cid/decide', async c => {
  const g = guard(c, 'decide-suggestion');
  const { decision } = await bodyJson(c.req);
  const cm = S.listComments(g.id).find(x => x.id === c.p.cid);
  if (!cm || cm.kind !== 'suggestion') throw new S.HttpError(404, 'Suggestion introuvable.');
  if (cm.status !== 'open') throw new S.HttpError(409, 'Cette suggestion a déjà été traitée.');
  if (decision === 'accept') {
    const r = C.room(g.id);
    const range = resolveAnchor(r.doc, cm.anchor);
    if (!range || r.markdown.slice(range.start, range.end) !== cm.anchor.quote)
      throw new S.HttpError(409, 'Le passage a changé depuis la suggestion : relisez-la avant de l\'appliquer.');
    r.doc.transact(() => { r.text.delete(range.start, range.end - range.start); if (cm.replacement) r.text.insert(range.start, cm.replacement); }, 'server');
    r.pendingAuthors.add(cm.author.startsWith('guest:') ? g.actor : cm.author);
    r.pendingAuthors.add(g.actor);
    r.persist();
  }
  const updated = S.mutateComment(g.id, cm.id, x => { x.status = decision === 'accept' ? 'accepted' : 'rejected'; x.decidedBy = g.actor; x.decidedAt = new Date().toISOString(); x.log.push({ at: x.decidedAt, actor: g.actor, action: x.status }); });
  S.logActivity(g.id, g.actor, 'suggestion-' + updated.status, `a ${decision === 'accept' ? 'accepté' : 'refusé'} une suggestion de ${cm.authorName}`);
  S.notify(cm.author, { type: 'decision', docId: g.id, text: `${g.actorName} a ${decision === 'accept' ? 'accepté' : 'refusé'} votre suggestion dans « ${g.meta.name} »`, actor: g.actor, link: `#/doc/${g.id}?comment=${cm.id}` });
  C.broadcast(g.id, { type: 'comments' });
  json(c.res, updated);
});

/** Ancre relative Yjs -> positions absolues dans le texte actuel. */
export function resolveAnchor(doc: Y.Doc, a: S.Comment['anchor']): { start: number; end: number } | null {
  try {
    if (!a.start || !a.end) return null;
    const s = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(a.start), doc);
    const e = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(a.end), doc);
    return s && e ? { start: s.index, end: e.index } : null;
  } catch { return null; }
}

/* ---------- Validation et publication ---------- */

route('PUT', '/api/docs/:id/workflow', async c => {
  const g = guard(c, 'workflow');
  const b = await bodyJson(c.req);
  const prev = g.meta.workflow || DEFAULT_WORKFLOW;
  if ('requiredApprovals' in b && !can(g.role, 'share')) throw new S.HttpError(403, 'Seul le propriétaire fixe le nombre de validations requises.');
  if (b.state === 'published') throw new S.HttpError(400, 'L\'état « Publié » s\'obtient en publiant le document.');
  if (b.state === 'approved') throw new S.HttpError(400, 'L\'état « Approuvé » s\'obtient par les validations des relecteurs.');
  const next = { ...prev };
  if (Array.isArray(b.reviewers)) next.reviewers = b.reviewers.filter((u: string) => A.userById(u)).map((u: string) => prev.reviewers.find(r => r.userId === u) || { userId: u, decision: 'pending' as const });
  if ('requiredApprovals' in b) next.requiredApprovals = Math.max(0, Math.min(10, Number(b.requiredApprovals) || 0));
  if (b.state && WORKFLOW_LABELS[b.state as WorkflowState]) next.state = b.state;
  if (b.state === 'review' || b.state === 'pending') {
    // Une nouvelle demande de relecture remet les décisions à zéro, sur la version courante.
    const v = C.liveRoom(g.id)?.checkpoint('explicit') || S.latestVersion(g.id);
    next.reviewers = next.reviewers.map(r => ({ userId: r.userId, decision: 'pending' as const }));
    next.approvedVersion = undefined;
    for (const r of next.reviewers) S.notify(r.userId, { type: 'review', docId: g.id, text: `${g.actorName} vous demande de relire « ${g.meta.name} » (version ${v?.n ?? '?'})`, actor: g.actor, link: `#/doc/${g.id}` });
  }
  S.patchMeta(g.id, m => { m.workflow = next; });
  if (next.state !== prev.state) S.logActivity(g.id, g.actor, 'workflow', `a passé le document à l'état « ${WORKFLOW_LABELS[next.state]} »`);
  C.broadcast(g.id, { type: 'workflow' });
  json(c.res, next);
});
route('POST', '/api/docs/:id/review', async c => {
  const g = guard(c, 'read');
  const { decision, note } = await bodyJson(c.req);
  const w = g.meta.workflow || DEFAULT_WORKFLOW;
  const r = w.reviewers.find(x => x.userId === g.actor);
  if (!r) throw new S.HttpError(403, 'Vous n\'êtes pas relecteur de ce document.');
  if (!['approved', 'changes'].includes(decision)) throw new S.HttpError(400, 'Décision invalide.');
  // Une validation porte sur une version précise : la consultation seule ne vaut jamais validation.
  const v = C.liveRoom(g.id)?.checkpoint('explicit') || S.latestVersion(g.id);
  r.decision = decision; r.at = new Date().toISOString(); r.note = String(note || '').slice(0, 1000) || undefined;
  // Approuvé quand le nombre de validations requis est atteint (tous les relecteurs si aucun nombre n'est fixé).
  const approved = w.reviewers.filter(x => x.decision === 'approved').length;
  const need = w.requiredApprovals > 0 ? w.requiredApprovals : w.reviewers.length;
  if (decision === 'changes') w.state = 'changes';
  else if (approved >= need) { w.state = 'approved'; w.approvedVersion = v?.n; }
  else w.state = 'pending';
  S.patchMeta(g.id, m => { m.workflow = w; });
  S.logActivity(g.id, g.actor, 'review', decision === 'approved' ? `a validé la version ${v?.n}` : `a demandé des corrections${note ? ` : « ${String(note).slice(0, 80)} »` : ''}`);
  notifyMembers(g.id, g.actor, `${g.actorName} a ${decision === 'approved' ? 'validé' : 'demandé des corrections sur'} « ${g.meta.name} »`, 'review', [g.meta.owner!].filter(Boolean));
  C.broadcast(g.id, { type: 'workflow' });
  json(c.res, w);
});

route('POST', '/api/docs/:id/publish', async c => {
  const g = guard(c, 'publish');
  const b = await bodyJson(c.req);
  const official = b.official !== false;
  const v = C.liveRoom(g.id)?.checkpoint('explicit', true) || S.latestVersion(g.id);
  const cur = current(g.id);
  const ver = v && v.markdown === cur.markdown ? v : S.addVersion(g.id, { markdown: cur.markdown, settings: cur.settings, authors: [g.actor], kind: 'publish' })!;
  const blockers = official ? publishBlockers(g.meta.workflow || DEFAULT_WORKFLOW, ver.n) : [];
  if (blockers.length) throw new S.HttpError(409, 'Publication officielle bloquée : ' + blockers.join(' '));
  const id = S.rid(8);
  const dir = join(S.PUBS, id);
  mkdirSync(dir, { recursive: true });
  const input = exportInput(g.id, g.actor, { markdown: ver.markdown, settings: ver.settings });
  for (const mode of ['reading', 'slides', 'print'] as Target[]) writeFileSync(join(dir, `${mode}.html`), renderHtml(input, mode).html);
  if (findChrome() && b.pdf !== false) {
    try { writeFileSync(join(dir, 'document.pdf'), (await exportPdf(input, (ver.settings.mode === 'slides' ? 'slides' : 'print'))).pdf); }
    catch (e) { console.error('publication PDF', e); }
  }
  const ref: S.PublicationRef = { id, version: ver.n, at: new Date().toISOString(), by: g.actor, visibility: b.visibility === 'members' ? 'members' : 'public', label: String(b.label || '').slice(0, 80) || undefined, official };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...ref, docId: g.id, name: g.meta.name }, null, 2));
  S.patchMeta(g.id, m => { m.publications = [...(m.publications || []), ref]; if (official) m.workflow = { ...(m.workflow || DEFAULT_WORKFLOW), state: 'published' }; });
  S.logActivity(g.id, g.actor, 'published', `a publié la version ${ver.n} (${ref.visibility === 'public' ? 'lien public' : 'membres seulement'})`);
  notifyMembers(g.id, g.actor, `${g.actorName} a publié « ${g.meta.name} » (version ${ver.n})`, 'published');
  C.broadcast(g.id, { type: 'workflow' });
  json(c.res, ref, 201);
});
route('POST', '/api/docs/:id/publications/:pid/revoke', c => {
  const g = guard(c, 'publish');
  S.patchMeta(g.id, m => { const p = m.publications?.find(x => x.id === c.p.pid); if (!p) throw new S.HttpError(404, 'Publication introuvable.'); p.revoked = true; });
  S.logActivity(g.id, g.actor, 'unpublished', 'a retiré une publication');
  S.audit('publication-revoke', { doc: g.id, by: g.actor, pub: c.p.pid });
  json(c.res, { ok: true });
});

/** Lecteur public des publications : /p/<id>, /p/<id>/slides, /p/<id>/print, /p/<id>/pdf */
function servePublication(c: Ctx, kind: string) {
  if (!/^[0-9a-f]{16}$/.test(c.p.pid)) throw new S.HttpError(404, 'Publication introuvable.');
  const dir = join(S.PUBS, c.p.pid);
  const pm = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : null;
  const ref = pm && S.docExists(pm.docId) ? S.readMeta(pm.docId).publications?.find(p => p.id === c.p.pid) : null;
  if (!pm || !ref || ref.revoked) throw new S.HttpError(404, 'Cette publication n\'existe pas ou a été retirée.');
  if (ref.visibility === 'members' && !S.accessOf(S.readMeta(pm.docId), c.user?.id || null).role) throw new S.HttpError(c.user ? 403 : 401, 'Publication réservée aux membres du document : connectez-vous.');
  if (kind === 'pdf') {
    const f = join(dir, 'document.pdf');
    if (!existsSync(f)) throw new S.HttpError(404, 'Pas de PDF pour cette publication.');
    return send(c.res, readFileSync(f), 'application/pdf', `${pm.name}.pdf`, true);
  }
  const f = join(dir, `${kind}.html`);
  if (!existsSync(f)) throw new S.HttpError(404, 'Format indisponible.');
  c.res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src data: https:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src data: https:" });
  c.res.end(readFileSync(f));
}
route('GET', '/p/:pid', c => servePublication(c, 'reading'));
route('GET', '/p/:pid/slides', c => servePublication(c, 'slides'));
route('GET', '/p/:pid/print', c => servePublication(c, 'print'));
route('GET', '/p/:pid/pdf', c => servePublication(c, 'pdf'));

/* ---------- Branches ---------- */

route('POST', '/api/docs/:id/branch', async c => {
  const g = guard(c, 'edit');
  const u = needUser(c);
  const b = await bodyJson(c.req);
  const v = C.liveRoom(g.id)?.checkpoint('explicit') || S.latestVersion(g.id);
  const cur = current(g.id);
  const base = v && v.markdown === cur.markdown ? v : S.addVersion(g.id, { markdown: cur.markdown, settings: cur.settings, authors: [g.actor], kind: 'named', label: 'Point de départ d\'une branche' })!;
  const name = String(b.name || '').trim() || `${g.meta.name} — branche`;
  const br = S.createDoc({ name, project: g.meta.project, markdown: base.markdown, settings: base.settings, branchOf: { docId: g.id, baseVersion: base.n, base: base.markdown, name: g.meta.name } }, u.id);
  S.copyAssets(g.id, br.id);
  S.logActivity(g.id, g.actor, 'branch', `a créé la branche « ${name} » à partir de la version ${base.n}`);
  json(c.res, S.getDoc(br.id), 201);
});
route('GET', '/api/docs/:id/merge', c => {
  const g = guard(c, 'read');
  const bo = g.meta.branchOf;
  if (!bo || !S.docExists(bo.docId)) throw new S.HttpError(400, 'Ce document n\'est pas une branche, ou son original a été supprimé.');
  const main = current(bo.docId).markdown;
  const r = threeWayMerge(bo.base, main, current(g.id).markdown);
  json(c.res, { ...r, main, target: bo.docId, targetName: S.readMeta(bo.docId).name, canMerge: can(S.accessOf(S.readMeta(bo.docId), c.user?.id || null).role, 'edit') });
});
route('POST', '/api/docs/:id/merge', async c => {
  const g = guard(c, 'read');
  const bo = g.meta.branchOf;
  if (!bo || !S.docExists(bo.docId)) throw new S.HttpError(400, 'Ce document n\'est pas une branche.');
  const target = S.readMeta(bo.docId);
  if (!can(S.accessOf(target, c.user?.id || null).role, 'edit')) throw new S.HttpError(403, 'Fusionner demande le droit d\'édition sur le document principal.');
  const b = await bodyJson(c.req);
  const text = typeof b.text === 'string' ? b.text : threeWayMerge(bo.base, current(bo.docId).markdown, current(g.id).markdown).text;
  if (/^<<<<<<< /m.test(text) && !b.allowConflicts) throw new S.HttpError(409, 'Des conflits restent à trancher.');
  C.liveRoom(bo.docId)?.checkpoint('explicit');
  C.writeText(bo.docId, text, g.actor);
  const r = C.liveRoom(bo.docId); if (r) r.pendingAuthors.clear();
  const v = S.addVersion(bo.docId, { markdown: text, settings: current(bo.docId).settings, authors: [g.actor], kind: 'merge', label: `Fusion de « ${g.meta.name} »` });
  // La branche repart de l'état fusionné : une seconde fusion ne réapplique pas les mêmes changements.
  S.patchMeta(g.id, m => { m.branchOf = { ...bo, base: text, baseVersion: v?.n ?? bo.baseVersion }; });
  S.logActivity(bo.docId, g.actor, 'merged', `a fusionné la branche « ${g.meta.name} »`);
  S.logActivity(g.id, g.actor, 'merged', `a fusionné cette branche dans « ${target.name} »`);
  C.broadcast(bo.docId, { type: 'versions' });
  json(c.res, { version: v?.n });
});

/* ---------- Ressources, exports ---------- */

route('GET', '/api/docs/:id/assets/:name', c => { guard(c, 'read'); serveFile(c.res, S.assetPath(c.p.id, decodeURIComponent(c.p.name))); });
route('PUT', '/api/docs/:id/assets/:name', async c => { guard(c, 'edit'); json(c.res, S.putAsset(c.p.id, decodeURIComponent(c.p.name), await body(c.req)), 201); });
route('DELETE', '/api/docs/:id/assets/:name', c => { guard(c, 'edit'); S.deleteAsset(c.p.id, decodeURIComponent(c.p.name)); json(c.res, { ok: true }); });

route('POST', '/api/docs/:id/export', async c => {
  const g = guard(c, 'download');
  const b = await bodyJson(c.req);
  const format = String(b.format || 'html');
  const mode: Target = ['reading', 'print', 'slides'].includes(b.mode) ? b.mode : 'reading';
  const input = exportInput(g.id, g.actor, can(g.role, 'edit') ? b : {});
  const base = input.name.replace(/[\\/:*?"<>|]+/g, '-');
  if (format === 'html') {
    const r = renderHtml(input, mode);
    send(c.res, r.html, 'text/html; charset=utf-8', `${base}${mode === 'slides' ? ' - diaporama' : mode === 'print' ? ' - impression' : ''}.html`);
  } else if (format === 'pdf') {
    const r = await exportPdf(input, mode);
    c.res.setHeader('x-studio-info', encodeURIComponent(JSON.stringify(r.info)));
    send(c.res, r.pdf, 'application/pdf', `${base}.pdf`);
  } else if (format === 'zip') {
    const z = await exportZip(input, b.pdf !== false && !!findChrome());
    send(c.res, z.zip, 'application/zip', z.filename);
  } else throw new S.HttpError(400, `Format inconnu : ${format}`);
});

/* ---------- Notifications, blocs, gabarits ---------- */

route('GET', '/api/notifications', c => json(c.res, S.listNotifications(needUser(c).id)));
route('POST', '/api/notifications/read', async c => { const u = needUser(c); const b = await bodyJson(c.req); S.markNotifications(u.id, b.ids || 'all'); json(c.res, { ok: true }); });

route('GET', '/api/blocks', c => json(c.res, S.listBlocks(needUser(c).id)));
route('GET', '/api/blocks/:bid', c => { const u = needUser(c); const b = S.getBlock(c.p.bid); if (!b || !(b.shared || b.owner === u.id)) throw new S.HttpError(404, 'Bloc introuvable.'); json(c.res, b); });
route('POST', '/api/blocks', async c => { const u = needUser(c); json(c.res, S.saveBlock(await bodyJson(c.req), u.id), 201); });
route('DELETE', '/api/blocks/:bid', c => { S.deleteBlock(c.p.bid, needUser(c).id); json(c.res, { ok: true }); });

route('GET', '/api/themes', c => { needUser(c); json(c.res, S.listThemes()); });
route('POST', '/api/themes', async c => { needUser(c); json(c.res, S.saveTheme(await bodyJson(c.req)), 201); });
route('DELETE', '/api/themes/:id', c => { needUser(c); S.deleteTheme(c.p.id); json(c.res, { ok: true }); });

/* Ressources du moteur pour l'aperçu */
route('GET', '/fonts/:file', c => serveFile(c.res, inside(FONTS_DIR, c.p.file), true, true));
route('GET', '/vendor/paged.js', c => serveFile(c.res, PAGEDJS_FILE, true));
route('GET', '/vendor/katex/fonts/:file', c => serveFile(c.res, inside(join(KATEX_DIR, 'fonts'), c.p.file), true, true));
let katexCss = '';
route('GET', '/vendor/katex.css', c => {
  katexCss ||= readFileSync(join(KATEX_DIR, 'katex.min.css'), 'utf8').replace(/url\(fonts\//g, 'url(/vendor/katex/fonts/');
  c.res.writeHead(200, { 'content-type': 'text/css', 'access-control-allow-origin': '*' });
  c.res.end(katexCss);
});

/* ---------- Serveur ---------- */

export function createApp() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const share = (req.headers['x-share-token'] as string) || url.searchParams.get('share');
        await r.fn({ req, res, p, url, user: A.currentUser(req), share });
        return;
      }
      if (url.pathname.startsWith('/api/')) return json(res, { error: 'Route inconnue.' }, 404);
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
  C.attachCollab(server);
  return server;
}
