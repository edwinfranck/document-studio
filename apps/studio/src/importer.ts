// Import d'une archive ZIP : avec le serveur, l'archive est envoyée puis analysée et construite par lui ;
// dans l'édition web, tout se fait dans la page avec le même moteur (document continu ou documents séparés).
import { analyzeArchive, archiveResolver, flatAssetName, mergeArchive, readArchive, rewriteRefs, textOfFile, type ArchiveFile, type ArchiveReport } from '@studio/engine';
import { api, cancelImport, commitImport, uploadArchive, type ImportPlan, type ImportResult } from './api.ts';

export interface ImportSession { id?: string; report: ArchiveReport; files?: Map<string, ArchiveFile> }

const readFile = (file: File, onProgress: (n: number, t: number) => void, signal: AbortSignal) => new Promise<Uint8Array>((ok, ko) => {
  const r = new FileReader();
  r.onprogress = e => onProgress(e.loaded, e.total || file.size);
  r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer));
  r.onerror = () => ko(new Error('Lecture du fichier impossible.'));
  signal.addEventListener('abort', () => { r.abort(); ko(new DOMException('Import annulé.', 'AbortError')); });
  r.readAsArrayBuffer(file);
});

export async function analyze(file: File, onProgress: (n: number, t: number) => void, signal: AbortSignal): Promise<ImportSession> {
  if (api.backend.kind === 'server') return uploadArchive(file, onProgress, signal);
  const bytes = await readFile(file, onProgress, signal);
  await new Promise(r => setTimeout(r, 0));
  const a = readArchive(bytes);
  return { report: analyzeArchive(file.name, a), files: new Map(a.files.filter(f => f.status === 'ok').map(f => [f.path, f])) };
}

export function cancel(s: ImportSession | null) { if (s?.id) void cancelImport(s.id); }

export async function build(s: ImportSession, plan: ImportPlan): Promise<ImportResult> {
  if (s.id) return commitImport(s.id, plan);
  // Édition web : les documents sont créés dans le navigateur ; en cas d'échec, ceux déjà créés sont retirés.
  const files = s.files!;
  const title = (p: string) => plan.titles?.[p] || s.report.pages.find(x => x.path === p)?.title || p;
  const textOf = (p: string) => {
    const fixes = (plan.fixes || []).filter(f => f.path === p);
    const md = textOfFile(files.get(p)!);
    return fixes.length ? rewriteRefs(md, h => fixes.find(f => f.from === h)?.to) : md;
  };
  const blob = (p: string) => new Blob([files.get(p)!.data!.slice()]);
  const created: string[] = [];
  try {
    if (plan.mode === 'merge') {
      const m = mergeArchive(plan.order.map(p => ({ path: p, title: title(p), markdown: textOf(p) })), new Set(files.keys()), plan.name);
      const d = await api.create({ name: plan.name, markdown: m.markdown, settings: { ...(plan.templateId ? { templateId: plan.templateId } : {}), page: { breakBeforeH1: true } }, importedFrom: s.report.name });
      created.push(d.id);
      for (const a of m.assets) await api.putAsset(d.id, a.name, blob(a.path));
      return { kind: 'doc', id: d.id };
    }
    if (plan.mode === 'separate') {
      const find = archiveResolver(files.keys());
      for (const p of plan.order) {
        const used = new Map<string, string>();
        const md = rewriteRefs(textOf(p), h => {
          const t = !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(h) && find(p, h)?.path;
          if (!t || files.get(t)!.kind === 'markdown') return undefined;
          used.set(flatAssetName(t), t);
          return `./assets/${flatAssetName(t)}`;
        });
        const d = await api.create({ name: title(p), project: plan.name, markdown: md, settings: plan.templateId ? { templateId: plan.templateId } : {}, importedFrom: `${s.report.name} › ${p}` });
        created.push(d.id);
        for (const [n, t] of used) await api.putAsset(d.id, n, blob(t));
      }
      return { kind: 'docs', ids: created, project: plan.name };
    }
    throw new Error('Le projet multi-pages demande le serveur Document Studio ou l\'application de bureau.');
  } catch (e) {
    for (const id of created) await api.remove(id).catch(() => {});
    throw e;
  }
}
