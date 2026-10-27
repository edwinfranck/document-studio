// Accès aux données. Deux implémentations derrière la même interface :
//  - « server » : le serveur local (fichiers sur disque, PDF par Chrome) ;
//  - « browser » : tout dans le navigateur (IndexedDB), pour l'édition web hébergée.
// Le choix se fait au démarrage : serveur joignable -> server, sinon browser.
import type { DocSettings, Template } from '@studio/engine';

export interface DocSummary { id: string; name: string; project: string; mode: string; templateId: string; createdAt: string; updatedAt: string; words: number; size: number }
export interface Asset { name: string; size: number }
export interface Doc extends Partial<Collab> { id: string; name: string; project: string; settings: Partial<DocSettings>; markdown: string; assets: Asset[]; hasOriginal: boolean; createdAt: string; updatedAt: string; importedFrom?: string }
export type Role = 'viewer' | 'commenter' | 'editor' | 'owner';
export interface Me { id: string; name: string; email: string; color: string }
export interface Member { userId: string; role: Role; user: Me | null }
export interface ShareLink { id: string; token: string; role: Exclude<Role, 'owner'>; label?: string; expiresAt?: string; revoked?: boolean; requireLogin?: boolean; allowDownload: boolean; createdAt: string }
export interface Publication { id: string; version: number; at: string; by: string; visibility: 'public' | 'members'; revoked?: boolean; label?: string; official: boolean; stale?: boolean }
export interface Workflow { state: 'draft' | 'review' | 'changes' | 'pending' | 'approved' | 'published' | 'archived'; reviewers: { userId: string; decision: 'pending' | 'approved' | 'changes'; at?: string; note?: string }[]; requiredApprovals: number; approvedVersion?: number }
export interface VersionInfo { n: number; at: string; authors: string[]; authorNames: string[]; kind: string; label?: string; summary: string; added: number; removed: number; restoredFrom?: number }
export interface Version extends VersionInfo { markdown: string; settings: Partial<DocSettings> }
export interface Comment {
  id: string; kind: 'comment' | 'suggestion'; anchor: { start?: unknown; end?: unknown; quote: string; line: number; slide?: number };
  body: string; replacement?: string; author: string; authorName: string; at: string;
  replies: { id: string; author: string; authorName: string; body: string; at: string }[];
  assignee?: string; mentions: string[]; status: 'open' | 'resolved' | 'accepted' | 'rejected'; decidedBy?: string; decidedAt?: string;
}
export interface Activity { at: string; actor: string; actorName: string; type: string; text: string }
export interface Notification { id: string; at: string; type: string; docId?: string; text: string; read: boolean; link?: string }
export interface Block { id: string; name: string; description?: string; owner: string; shared: boolean; updatedAt: string; versions: { version: number; markdown: string; at: string }[] }
export interface Collab {
  role: Role; members: Member[]; links?: ShareLink[]; invites?: { email: string; role: Role }[]; publications: Publication[];
  workflow: Workflow; version: number; branchOf?: { docId: string; baseVersion: number; name: string }; owner?: string;
}

export interface ExportRequest { format: string; mode: string; settings?: Partial<DocSettings>; markdown?: string; pdf?: boolean }
export interface ExportResult { blob: Blob; name: string; info: any; printed?: boolean }

export interface Backend {
  kind: 'server' | 'browser';
  /** Comptes, partage, temps réel, commentaires, validation : seulement avec le serveur. */
  collab: boolean;
  home: string;
  pdf: 'chrome' | 'print-dialog';
  list(): Promise<DocSummary[]>;
  get(id: string): Promise<Doc>;
  create(d: { name?: string; project?: string; markdown?: string; settings?: Partial<DocSettings>; importedFrom?: string }): Promise<Doc>;
  update(id: string, patch: { markdown?: string; settings?: Partial<DocSettings>; name?: string; project?: string }): Promise<{ updatedAt: string }>;
  remove(id: string): Promise<unknown>;
  duplicate(id: string): Promise<Doc>;
  history(id: string): Promise<{ id: string; at: string; size: number }[]>;
  snapshot(id: string, snap: string): Promise<{ markdown: string }>;
  putAsset(id: string, name: string, data: Blob): Promise<Asset>;
  deleteAsset(id: string, name: string): Promise<unknown>;
  /** URL d'une ressource pour l'interface (vignettes). */
  assetUrl(id: string, name: string): string;
  /** URL d'une ressource utilisable dans l'aperçu isolé (iframe d'origine nulle). */
  previewAssetUrl(id: string, name: string): string | null;
  themes(): Promise<Template[]>;
  saveTheme(t: Template): Promise<Template>;
  deleteTheme(id: string): Promise<unknown>;
  exportFile(id: string, body: ExportRequest): Promise<ExportResult>;
  source(id: string, original: boolean): Promise<{ blob: Blob; name: string }>;
  settingsFile(id: string): Promise<{ blob: Blob; name: string }>;
}

/** Jeton du lien de partage par lequel on est entré (envoyé à chaque requête). */
export const shareState = { token: '' as string, guestName: '' as string };

async function call<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (shareState.token) (init.headers as any)['x-share-token'] = shareState.token;
  if (shareState.guestName) (init.headers as any)['x-guest-name'] = encodeURIComponent(shareState.guestName);
  if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body as BodyInit;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as any)['content-type'] = 'application/json'; }
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new Error('Serveur local injoignable : est-il lancé (pnpm dev) ?'); }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* corps non JSON */ }
    throw new Error(msg);
  }
  return (raw ? res : res.json()) as Promise<T>;
}

const fileFrom = async (res: Response) => {
  const cd = res.headers.get('content-disposition') || '';
  return { blob: await res.blob(), name: decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(cd) || [])[1] || 'export') };
};

function serverBackend(home: string): Backend {
  return {
    kind: 'server', home, pdf: 'chrome', collab: true,
    list: () => call('GET', '/api/docs'),
    get: id => call('GET', `/api/docs/${id}`),
    create: d => call('POST', '/api/docs', d),
    update: (id, patch) => call('PUT', `/api/docs/${id}`, patch),
    remove: id => call('DELETE', `/api/docs/${id}`),
    duplicate: id => call('POST', `/api/docs/${id}/duplicate`),
    history: id => call('GET', `/api/docs/${id}/history`),
    snapshot: (id, snap) => call('GET', `/api/docs/${id}/history/${snap}`),
    putAsset: (id, name, data) => call('PUT', `/api/docs/${id}/assets/${encodeURIComponent(name)}`, data),
    deleteAsset: (id, name) => call('DELETE', `/api/docs/${id}/assets/${encodeURIComponent(name)}`),
    assetUrl: (id, name) => `/api/docs/${id}/assets/${encodeURIComponent(name)}`,
    previewAssetUrl: (id, name) => `${location.origin}/api/docs/${id}/assets/${encodeURIComponent(name)}`,
    themes: () => call('GET', '/api/themes'),
    saveTheme: t => call('POST', '/api/themes', t),
    deleteTheme: id => call('DELETE', `/api/themes/${id}`),
    async exportFile(id, body) {
      const res = await call<Response>('POST', `/api/docs/${id}/export`, body, true);
      const info = res.headers.get('x-studio-info');
      return { ...(await fileFrom(res)), info: info ? JSON.parse(decodeURIComponent(info)) : null };
    },
    source: async (id, original) => fileFrom(await call<Response>('GET', `/api/docs/${id}/source${original ? '?original=1' : ''}`, undefined, true)),
    settingsFile: async id => fileFrom(await call<Response>('GET', `/api/docs/${id}/settings`, undefined, true)),
  };
}

/** Fonctions collaboratives (serveur uniquement). */
export const collab = {
  state: () => call<{ hasUsers: boolean; me: Me | null }>('GET', '/api/auth/state'),
  register: (b: { name: string; email: string; password: string }) => call<{ me: Me }>('POST', '/api/auth/register', b),
  login: (b: { email: string; password: string }) => call<{ me: Me }>('POST', '/api/auth/login', b),
  logout: () => call('POST', '/api/auth/logout'),
  updateMe: (b: { name?: string; color?: string }) => call<{ me: Me }>('PUT', '/api/auth/me', b),
  users: (q: string) => call<Me[]>('GET', `/api/users?q=${encodeURIComponent(q)}`),
  share: (token: string) => call<{ docId: string; role: Role; name: string; requireLogin: boolean }>('GET', `/api/share/${token}`),
  addMember: (id: string, email: string, role: Role) => call<Doc>('POST', `/api/docs/${id}/members`, { email, role }),
  setMember: (id: string, userId: string, role: Role) => call<Doc>('PATCH', `/api/docs/${id}/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (id: string, userId: string) => call<Doc>('DELETE', `/api/docs/${id}/members/${encodeURIComponent(userId)}`),
  addLink: (id: string, b: { role: string; expiresAt?: string; requireLogin?: boolean; allowDownload?: boolean; label?: string }) => call<Doc>('POST', `/api/docs/${id}/links`, b),
  patchLink: (id: string, lid: string, b: Record<string, unknown>) => call<Doc>('PATCH', `/api/docs/${id}/links/${lid}`, b),
  versions: (id: string) => call<VersionInfo[]>('GET', `/api/docs/${id}/versions`),
  version: (id: string, n: number) => call<Version>('GET', `/api/docs/${id}/versions/${n}`),
  nameVersion: (id: string, label: string) => call<Version>('POST', `/api/docs/${id}/versions`, { label }),
  restore: (id: string, n: number) => call<Version>('POST', `/api/docs/${id}/versions/${n}/restore`),
  activity: (id: string) => call<Activity[]>('GET', `/api/docs/${id}/activity`),
  comments: (id: string) => call<Comment[]>('GET', `/api/docs/${id}/comments`),
  addComment: (id: string, b: Record<string, unknown>) => call<Comment>('POST', `/api/docs/${id}/comments`, b),
  reply: (id: string, cid: string, body: string, mentions: string[]) => call<Comment>('POST', `/api/docs/${id}/comments/${cid}/replies`, { body, mentions }),
  patchComment: (id: string, cid: string, b: Record<string, unknown>) => call<Comment>('PATCH', `/api/docs/${id}/comments/${cid}`, b),
  decide: (id: string, cid: string, decision: 'accept' | 'reject') => call<Comment>('POST', `/api/docs/${id}/comments/${cid}/decide`, { decision }),
  workflow: (id: string, b: Record<string, unknown>) => call<Workflow>('PUT', `/api/docs/${id}/workflow`, b),
  review: (id: string, decision: 'approved' | 'changes', note?: string) => call<Workflow>('POST', `/api/docs/${id}/review`, { decision, note }),
  publish: (id: string, b: { official: boolean; visibility: 'public' | 'members'; label?: string }) => call<Publication>('POST', `/api/docs/${id}/publish`, b),
  unpublish: (id: string, pid: string) => call('POST', `/api/docs/${id}/publications/${pid}/revoke`),
  branch: (id: string, name: string) => call<Doc>('POST', `/api/docs/${id}/branch`, { name }),
  mergePreview: (id: string) => call<{ text: string; conflicts: number; main: string; target: string; targetName: string; canMerge: boolean }>('GET', `/api/docs/${id}/merge`),
  merge: (id: string, text: string) => call<{ version: number }>('POST', `/api/docs/${id}/merge`, { text }),
  notifications: () => call<Notification[]>('GET', '/api/notifications'),
  readNotifications: (ids: string[] | 'all') => call('POST', '/api/notifications/read', { ids }),
  blocks: () => call<Block[]>('GET', '/api/blocks'),
  saveBlock: (b: { id?: string; name: string; markdown: string; description?: string; shared?: boolean }) => call<Block>('POST', '/api/blocks', b),
  deleteBlock: (id: string) => call('DELETE', `/api/blocks/${id}`),
};

let current: Backend | null = null;

/** Détecte le serveur local ; à défaut (site statique), bascule sur le stockage du navigateur. */
export async function initBackend(): Promise<Backend> {
  if (current) return current;
  try {
    const res = await fetch('/api/health', { headers: { accept: 'application/json' } });
    const j = res.ok && (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
    if (j?.ok) return (current = serverBackend(j.home));
  } catch { /* pas de serveur */ }
  const { browserBackend } = await import('./browserBackend.ts');
  return (current = browserBackend());
}

const be = () => { if (!current) throw new Error('Stockage non initialisé.'); return current; };

/** Point d'accès unique de l'interface, quel que soit le stockage. */
export const api: Omit<Backend, 'kind' | 'home' | 'pdf' | 'collab'> & { readonly backend: Backend } = {
  get backend() { return be(); },
  list: () => be().list(),
  get: id => be().get(id),
  create: d => be().create(d),
  update: (id, p) => be().update(id, p),
  remove: id => be().remove(id),
  duplicate: id => be().duplicate(id),
  history: id => be().history(id),
  snapshot: (id, s) => be().snapshot(id, s),
  putAsset: (id, n, d) => be().putAsset(id, n, d),
  deleteAsset: (id, n) => be().deleteAsset(id, n),
  assetUrl: (id, n) => be().assetUrl(id, n),
  previewAssetUrl: (id, n) => be().previewAssetUrl(id, n),
  themes: () => be().themes(),
  saveTheme: t => be().saveTheme(t),
  deleteTheme: id => be().deleteTheme(id),
  exportFile: (id, b) => be().exportFile(id, b),
  source: (id, o) => be().source(id, o),
  settingsFile: id => be().settingsFile(id),
};

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
