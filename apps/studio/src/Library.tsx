// Bibliothèque : documents, collections, import (bouton ou glisser-déposer), création.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Clock, Copy, FilePlus2, FileText, Folder, FolderInput, Layers, Pencil, Presentation, Printer, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { parse } from '@studio/engine';
import { api, type DocSummary } from './api.ts';
import { useStudio } from './store.ts';
import { fmtDate } from './ui.tsx';
import { EXAMPLES } from './examples.ts';

const MODE_ICON = { reading: BookOpen, print: Printer, slides: Presentation } as const;

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const { templates, toast } = useStudio();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = () => api.list().then(d => { setDocs(d); setError(''); }, e => setError(e.message));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDrag(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDrag(false); };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDrag(false); if (e.dataTransfer?.files.length) importFiles([...e.dataTransfer.files]); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  });

  const projects = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs || []) if (d.project) m.set(d.project, (m.get(d.project) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [docs]);
  const currentProject = filter.startsWith('p:') ? filter.slice(2) : '';

  const shown = useMemo(() => {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const nq = norm(q.trim());
    const week = Date.now() - 7 * 86400e3;
    return (docs || []).filter(d =>
      (filter === 'all' || (filter === 'recent' && new Date(d.updatedAt).getTime() > week) || (currentProject && d.project === currentProject)) &&
      (!nq || norm(d.name + ' ' + d.project).includes(nq)));
  }, [docs, filter, q, currentProject]);

  async function importFiles(files: File[]) {
    const mds = files.filter(f => /\.(md|markdown|mdx|txt)$/i.test(f.name));
    const media = files.filter(f => /^(image|video)\//.test(f.type) || /\.(woff2?|ttf|otf)$/i.test(f.name));
    const settingsFiles = files.filter(f => /\.studio\.json$/i.test(f.name));
    if (!mds.length) { toast('Aucun fichier Markdown (.md) dans la sélection.', 'error'); return; }
    let last = '';
    for (const f of mds) {
      try {
        const text = await f.text();
        const ir = parse(text);
        const base = f.name.replace(/\.[^.]+$/, '');
        const side = settingsFiles.find(s => s.name.replace(/\.studio\.json$/i, '') === base);
        const settings = side ? (JSON.parse(await side.text()).settings || {}) : {};
        const doc = await api.create({ name: ir.meta.title ? String(ir.meta.title) : base, project: currentProject, markdown: text, settings, importedFrom: f.name });
        // Médias : tous pour un import unique ; sinon, ceux que le document référence.
        const refs = new Set(ir.assets.map(a => a.split('/').pop()));
        for (const m of media) if (mds.length === 1 || refs.has(m.name)) await api.putAsset(doc.id, m.name, m);
        last = doc.id;
      } catch (e: any) { toast(`${f.name} : ${e.message}`, 'error'); }
    }
    await load();
    if (mds.length === 1 && last) onOpen(last);
    else toast(`${mds.length} documents importés.`);
  }

  const create = async (markdown?: string, name?: string, settings?: any) => {
    try { const d = await api.create({ name: name || 'Sans titre', project: currentProject, markdown, settings }); onOpen(d.id); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); await load(); if (msg) toast(msg); } catch (e: any) { toast(e.message, 'error'); } };
  const tplName = (id: string) => templates.find(t => t.id === id)?.name || id;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="currentColor" /><path d="M9 8h9l5 5v11H9z" fill="none" stroke="var(--panel)" strokeWidth="2" /><path d="M12 17h8M12 21h5" stroke="#e8590c" strokeWidth="2" /></svg>
          Document Studio
        </div>
        <div className="grow" />
        <span className="faint hide-sm" style={{ fontSize: 12 }}>{api.backend.kind === 'browser' ? 'Édition web · documents enregistrés dans ce navigateur · ' : ''}Glissez des fichiers .md n'importe où pour les importer</span>
        <a className="btn ghost sm" href="https://github.com/edwinfranck/document-studio" target="_blank" rel="noopener noreferrer">GitHub</a>
      </header>
      <div className="library">
        <nav className="lib-side" aria-label="Collections">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><Layers />Tous les documents<span className="n">{docs?.length ?? ''}</span></button>
          <button aria-pressed={filter === 'recent'} onClick={() => setFilter('recent')}><Clock />Cette semaine</button>
          <div className="subhead">Collections</div>
          {projects.length === 0 && <div className="faint" style={{ padding: '0 10px', fontSize: 12 }}>Aucune. Rangez un document via « Déplacer ».</div>}
          {projects.map(([p, n]) => <button key={p} aria-pressed={filter === 'p:' + p} onClick={() => setFilter('p:' + p)}><Folder />{p}<span className="n">{n}</span></button>)}
        </nav>
        <main className="lib-main">
          <div className="lib-toolbar">
            <h1>{filter === 'all' ? 'Documents' : filter === 'recent' ? 'Cette semaine' : currentProject}</h1>
            <div className="search"><Search /><input className="input" placeholder="Rechercher" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un document" /></div>
            <div className="grow" />
            <button className="btn" onClick={() => input.current?.click()}><Upload />Importer</button>
            <input ref={input} type="file" multiple hidden accept=".md,.markdown,.mdx,.txt,.json,image/*,video/mp4,video/webm" onChange={e => { importFiles([...(e.target.files || [])]); e.target.value = ''; }} />
            <button className="btn primary" onClick={() => create()}><FilePlus2 />Nouveau</button>
          </div>
          <div className="lib-list">
            {error && <div className="empty"><h2>Serveur injoignable</h2><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div>}
            {!error && docs === null && <div className="empty"><span className="spin" /></div>}
            {!error && docs && docs.length === 0 && (
              <div className="empty">
                <FileText className="big" />
                <h2>Aucun document</h2>
                <p>Importez un fichier Markdown, ou partez d'un exemple.</p>
                <div className="starter">
                  <button onClick={() => input.current?.click()}><Upload /><strong>Importer un .md</strong><span>Le fichier d'origine reste intact.</span></button>
                  <button onClick={() => create(EXAMPLES.guide, 'Guide StudioMD', { templateId: 'technique' })}><Sparkles /><strong>Guide StudioMD</strong><span>Tous les composants, en un document.</span></button>
                  <button onClick={() => create(EXAMPLES.deck, 'Présentation exemple', { mode: 'slides', templateId: 'cinema' })}><Presentation /><strong>Présentation</strong><span>Un diaporama prêt à adapter.</span></button>
                </div>
              </div>
            )}
            {!error && docs && docs.length > 0 && (
              <>
                <table className="doc-table">
                  <thead><tr><th>Nom</th><th className="hide-sm">Collection</th><th className="hide-sm">Gabarit</th><th>Modifié</th><th className="hide-sm" style={{ textAlign: 'right' }}>Mots</th><th /></tr></thead>
                  <tbody>
                    {shown.map(d => {
                      const Icon = MODE_ICON[d.mode as keyof typeof MODE_ICON] || FileText;
                      return (
                        <tr key={d.id} className="doc" onClick={() => onOpen(d.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(d.id)}>
                          <td><div className="dname"><span className="doc-icon"><Icon /></span>{d.name}</div></td>
                          <td className="hide-sm muted">{d.project || '—'}</td>
                          <td className="hide-sm muted">{tplName(d.templateId)}</td>
                          <td className="muted">{fmtDate(d.updatedAt)}</td>
                          <td className="hide-sm muted" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.words.toLocaleString('fr-FR')}</td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="row-actions">
                              <button className="btn sm ghost icon" title="Renommer" onClick={() => { const n = prompt('Nouveau nom', d.name); if (n) act(() => api.update(d.id, { name: n })); }}><Pencil /></button>
                              <button className="btn sm ghost icon" title="Déplacer dans une collection" onClick={() => { const p = prompt('Collection (vide pour aucune)', d.project); if (p !== null) act(() => api.update(d.id, { project: p })); }}><FolderInput /></button>
                              <button className="btn sm ghost icon" title="Dupliquer" onClick={() => act(() => api.duplicate(d.id), 'Copie créée.')}><Copy /></button>
                              <button className="btn sm ghost icon danger" title="Supprimer" onClick={() => { if (confirm(`Supprimer « ${d.name} » ? Il est déplacé dans la corbeille.`)) act(() => api.remove(d.id), 'Document supprimé.'); }}><Trash2 /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shown.length === 0 && <div className="empty"><p>Aucun document ne correspond.</p></div>}
                <div className="row" style={{ marginTop: 20, gap: 8 }}>
                  <button className="btn sm" onClick={() => create(EXAMPLES.guide, 'Guide StudioMD', { templateId: 'technique' })}><Sparkles />Ouvrir le guide StudioMD</button>
                  <button className="btn sm" onClick={() => create(EXAMPLES.deck, 'Présentation exemple', { mode: 'slides', templateId: 'cinema' })}><Presentation />Présentation exemple</button>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
      {drag && <div className="dropzone">Déposez vos fichiers .md (et leurs images) pour les importer</div>}
    </div>
  );
}
