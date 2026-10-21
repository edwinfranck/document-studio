// Accès aux données. Deux implémentations derrière la même interface :
//  - « server » : le serveur local (fichiers sur disque, PDF par Chrome) ;
//  - « browser » : tout dans le navigateur (IndexedDB), pour l'édition web hébergée.
// Le choix se fait au démarrage : serveur joignable -> server, sinon browser.
import type { DocSettings, Template } from '@studio/engine';

export interface DocSummary { id: string; name: string; project: string; mode: string; templateId: string; createdAt: string; updatedAt: string; words: number; size: number }
export interface Asset { name: string; size: number }
export interface Doc { id: string; name: string; project: string; settings: Partial<DocSettings>; markdown: string; assets: Asset[]; hasOriginal: boolean; createdAt: string; updatedAt: string; importedFrom?: string }
export interface ExportRequest { format: string; mode: string; settings?: Partial<DocSettings>; markdown?: string; pdf?: boolean }
export interface ExportResult { blob: Blob; name: string; info: any; printed?: boolean }

export interface Backend {
  kind: 'server' | 'browser';
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

async function call<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const init: RequestInit = { method, headers: {} };
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
    kind: 'server', home, pdf: 'chrome',
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
export const api: Omit<Backend, 'kind' | 'home' | 'pdf'> & { readonly backend: Backend } = {
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
