// Espace de travail : source et structure | aperçu | propriétés.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  AlertCircle, AlertTriangle, ArrowLeft, BookOpen, Check, ChevronDown, CloudOff, Copy, Download, Eye, FileCode2, FileDown, FileText, FileUp, Files,
  History, Image as ImageIcon, Info, ListTree, Loader2, Maximize2, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Presentation, Printer, Redo2, Share2, Trash2, Undo2, Upload, X,
} from 'lucide-react';
import { render, resolveTheme, SLIDE_SIZES, type ComponentNode, type Diagnostic, type DocSettings, type Target } from '@studio/engine';
import { api, download } from './api.ts';
import { findAsset, previewEnv } from './env.ts';
import { createEditor, editorRedo, editorUndo, goToLine, insertAt, replaceAll, rewriteOpener, setLint } from './editor.ts';
import { recordTextStep, redoAction, saveNow, undoAction, useStudio } from './store.ts';
import { Preview } from './Preview.tsx';
import { Inspector } from './Inspector.tsx';
import { TemplateGallery } from './TemplateGallery.tsx';
import { Menu, Modal, Resizer, Segmented, fmtDate, fmtSize, usePersisted } from './ui.tsx';

const PAGE_W: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Workspace({ onBack }: { onBack: () => void }) {
  const st = useStudio();
  const { doc, markdown, settings, templates, save, saveError, toast } = st;
  const viewRef = useRef<EditorView | null>(null);
  const editorHost = useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = usePersisted('sd-left-w', 440);
  const [rightW, setRightW] = usePersisted('sd-right-w', 320);
  const [leftOpen, setLeftOpen] = usePersisted('sd-left-open', true);
  const [rightOpen, setRightOpen] = usePersisted('sd-right-open', true);
  const focusPrev = useRef<[boolean, boolean] | null>(null);
  const focus = !leftOpen && !rightOpen;
  const toggleFocus = () => {
    if (focus) { const [l, r] = focusPrev.current || [true, true]; setLeftOpen(l); setRightOpen(r); focusPrev.current = null; }
    else { focusPrev.current = [leftOpen, rightOpen]; setLeftOpen(false); setRightOpen(false); }
  };
  const [leftTab, setLeftTab] = usePersisted<'source' | 'outline' | 'files'>('sd-left-tab', 'source');
  const [problemsOpen, setProblemsOpen] = usePersisted('sd-problems', true);
  const [dialog, setDialog] = useState<null | 'gallery' | 'share' | 'history' | 'preview'>(null);
  const [scrollReq, setScrollReq] = useState<{ line: number; n: number } | null>(null);
  const [busy, setBusy] = useState('');
  const mode = settings.mode;

  // Rendu : la frappe est regroupée ; la pagination, plus coûteuse, attend un peu plus.
  const md = useDebounced(markdown, mode === 'print' ? 500 : 180);
  const s = useDebounced(settings, 120);
  const assets = doc?.assets || [];
  const result = useMemo(() => {
    if (!doc) return null;
    try { return render(md, s, previewEnv(doc.id, assets), templates); }
    catch (e: any) { console.error(e); return null; }
  }, [md, s, assets, templates, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostics: Diagnostic[] = useMemo(() => {
    const d = result?.diagnostics || [];
    return [...d, ...st.runtime.map(r => ({ ...r, code: 'layout' } as Diagnostic))];
  }, [result, st.runtime]);

  // Éditeur : créé une fois par document.
  useEffect(() => {
    if (!editorHost.current || !doc) return;
    const view = createEditor(editorHost.current, useStudio.getState().markdown, {
      onChange: v => useStudio.getState().setMarkdown(v),
      onTextStep: recordTextStep,
      onCursor: line => setScrollReq({ line, n: Date.now() }),
      onPasteFiles: (files, pos) => uploadFiles(files, pos),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [doc?.id, leftOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (viewRef.current && result) setLint(viewRef.current, result.diagnostics); }, [result]);

  const uploadFiles = useCallback(async (files: File[], pos?: number) => {
    const d = useStudio.getState().doc;
    if (!d) return;
    for (const f of files) {
      try {
        const name = f.name && f.name !== 'image.png' ? f.name : `image-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        const a = await api.putAsset(d.id, name, f);
        useStudio.setState(x => ({ doc: x.doc && { ...x.doc, assets: [...x.doc.assets.filter(y => y.name !== a.name), a] } }));
        if (pos !== undefined && viewRef.current) {
          const alt = a.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
          insertAt(viewRef.current, pos, f.type.startsWith('video/') ? `:::video {src="./assets/${a.name}" caption=""}\n:::` : `![${alt}](./assets/${a.name})`);
        }
      } catch (e: any) { toast(`${f.name} : ${e.message}`, 'error'); }
    }
  }, [toast]);

  const selected = useMemo(() => (st.selectedLine && result ? findComponent(result.ir.blocks, st.selectedLine) : null), [st.selectedLine, result]);

  const exportAs = async (format: string, target?: Target) => {
    if (!doc) return;
    setBusy(format === 'pdf' ? 'Génération du PDF…' : format === 'zip' ? 'Préparation du paquet…' : 'Export…');
    try {
      await saveNow();
      const r = await api.exportFile(doc.id, { format, mode: target || mode, settings, markdown });
      if (r.printed) { toast('Dans la boîte d\'impression, choisissez « Enregistrer au format PDF ».'); return; }
      download(r.blob, r.name);
      const extra = r.info?.overflows?.length ? ` · ${r.info.overflows.length} débordement(s) signalé(s)` : '';
      toast(`${r.name} téléchargé${r.info?.pages ? ` (${r.info.pages} pages)` : r.info?.count ? ` (${r.info.count} diapositives)` : ''}${extra}.`);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };

  const present = async () => {
    if (!doc) return;
    setBusy('Préparation de la présentation…');
    try {
      await saveNow();
      const r = await api.exportFile(doc.id, { format: 'html', mode: 'slides', settings, markdown });
      const w = window.open(URL.createObjectURL(r.blob), '_blank');
      if (!w) toast('Fenêtre bloquée par le navigateur : autorisez les fenêtres pour ce site.', 'error');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };

  const toggleFocusRef = useRef(toggleFocus);
  toggleFocusRef.current = toggleFocus;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  // Raccourcis globaux
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().then(() => toast('Enregistré.')); }
      if (mod && e.key === '\\') { e.preventDefault(); toggleFocusRef.current(); }
      if (e.key === 'Escape' && focusRef.current && !document.querySelector('.backdrop, .fullpreview, .listbox')) toggleFocusRef.current();
      const inEditor = !!(e.target as HTMLElement).closest?.('.cm-editor');
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (mod && !inEditor && !inField && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoAction(() => editorRedo(viewRef.current)) : undoAction(() => editorUndo(viewRef.current)); }
      if (mod && !inEditor && !inField && e.key.toLowerCase() === 'y') { e.preventDefault(); redoAction(() => editorRedo(viewRef.current)); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [toast]);

  if (!doc) return null;
  const resolved = resolveTheme(s, templates);
  const pageMm = (() => {
    const p = resolved.page;
    const [w, h] = p.size === 'custom' ? [p.width, p.height] : PAGE_W[p.size] || PAGE_W.A4;
    return p.orientation === 'landscape' ? h : w;
  })();
  const slideSize: [number, number] = resolved.slides.aspect === 'custom' ? [resolved.slides.width, resolved.slides.height] : SLIDE_SIZES[resolved.slides.aspect];
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;
  const jump = (line: number) => { if (!line) return; if (!leftOpen) setLeftOpen(true); setLeftTab('source'); setTimeout(() => viewRef.current && goToLine(viewRef.current, line), 30); setScrollReq({ line, n: Date.now() }); };

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost icon" onClick={onBack} title="Bibliothèque" aria-label="Retour à la bibliothèque"><ArrowLeft /></button>
        <button className="btn ghost icon" onClick={() => setLeftOpen(o => !o)} title={leftOpen ? 'Masquer la source' : 'Afficher la source'} aria-label="Afficher ou masquer la source">{leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
        <input className="docname" defaultValue={doc.name} key={doc.name} aria-label="Nom du document" size={Math.max(8, doc.name.length)}
          onBlur={e => st.rename(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <SaveIndicator state={save} error={saveError} />
        <div className="sep" />
        <button className="btn ghost icon" onClick={() => undoAction(() => editorUndo(viewRef.current))} disabled={!st.undoLog.length} title="Annuler (Ctrl+Z)" aria-label="Annuler"><Undo2 /></button>
        <button className="btn ghost icon" onClick={() => redoAction(() => editorRedo(viewRef.current))} disabled={!st.redoLog.length} title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir"><Redo2 /></button>
        <div className="grow" />
        <Segmented value={mode} onChange={v => st.setSettings(x => ({ ...x, mode: v }))} options={[
          ['reading', <><BookOpen />Lecture</>, 'Page HTML de lecture'],
          ['print', <><Printer />Impression</>, 'Document paginé / PDF'],
          ['slides', <><Presentation />Diaporama</>, 'Présentation HTML'],
        ]} />
        <button className="btn" onClick={() => setDialog('gallery')} title="Changer de gabarit"><LayoutIcon />{resolved.template.name}<ChevronDown /></button>
        <div className="grow" />
        {busy && <span className="savestate"><Loader2 className="spin-icon" />{busy}</span>}
        <button className="btn" onClick={() => (mode === 'slides' ? present() : setDialog('preview'))} title={mode === 'slides' ? 'Présenter dans un nouvel onglet' : 'Aperçu plein écran'}>{mode === 'slides' ? <><Presentation />Présenter</> : <><Eye />Aperçu</>}</button>
        <Menu trigger={(toggle) => <button className="btn primary" onClick={toggle}><Download />Exporter<ChevronDown /></button>}>
          {close => (
            <>
              <div className="menu-title">Ce document</div>
              <button onClick={() => { close(); exportAs('pdf'); }}><FileDown /><span>PDF<span className="sub">{api.backend.pdf === 'print-dialog' ? 'Par la boîte d\'impression : « Enregistrer au format PDF »' : mode === 'slides' ? 'Une diapositive par page' : 'Paginé, polices intégrées, texte sélectionnable'}</span></span></button>
              <button onClick={() => { close(); exportAs('html', 'reading'); }}><FileCode2 /><span>Page de lecture HTML<span className="sub">Un fichier autonome, lisible hors ligne</span></span></button>
              <button onClick={() => { close(); exportAs('html', 'slides'); }}><Presentation /><span>Diaporama HTML<span className="sub">Plein écran, vue présentateur (P)</span></span></button>
              <button onClick={() => { close(); exportAs('zip'); }}><Files /><span>Paquet complet .zip<span className="sub">HTML, PDF, source, médias et réglages</span></span></button>
              <hr />
              <button onClick={() => { close(); api.source(doc.id, false).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><FileText /><span>Source Markdown</span></button>
            </>
          )}
        </Menu>
        <button className="btn" onClick={() => setDialog('share')}><Share2 />Partager</button>
        <div className="sep" />
        <button className="btn ghost icon" onClick={() => setRightOpen(o => !o)} aria-pressed={!rightOpen} title={rightOpen ? 'Masquer les propriétés' : 'Afficher les propriétés'} aria-label="Afficher ou masquer les propriétés">{rightOpen ? <PanelRightClose /> : <PanelRightOpen />}</button>
        <button className="btn ghost icon" onClick={toggleFocus} aria-pressed={focus} title={focus ? 'Quitter le plein écran (Échap)' : 'Plein écran : masquer les panneaux (Ctrl+\\)'} aria-label="Plein écran">{focus ? <Minimize2 /> : <Maximize2 />}</button>
        <Menu trigger={toggle => <button className="btn ghost icon" onClick={toggle} aria-label="Paramètres du document"><MoreHorizontal /></button>}>
          {close => <DocMenu close={close} openHistory={() => setDialog('history')} onDeleted={onBack} />}
        </Menu>
      </header>

      <div className="work">
        {leftOpen && (
          <>
            <section className="pane pane-left" style={{ width: leftW }}>
              <div className="pane-head">
                <div className="tabs" role="tablist">
                  <button role="tab" aria-selected={leftTab === 'source'} onClick={() => setLeftTab('source')}><FileText />Source</button>
                  <button role="tab" aria-selected={leftTab === 'outline'} onClick={() => setLeftTab('outline')}><ListTree />Plan</button>
                  <button role="tab" aria-selected={leftTab === 'files'} onClick={() => setLeftTab('files')}><ImageIcon />Fichiers<span className="count">{assets.length || ''}</span></button>
                </div>
              </div>
              <div className="editor" ref={editorHost} style={{ display: leftTab === 'source' ? undefined : 'none' }} />
              {leftTab === 'outline' && result && <Outline ir={result.ir} onJump={jump} />}
              {leftTab === 'files' && <FilesPanel referenced={result?.ir.assets || []} onUpload={f => uploadFiles(f)} onInsert={name => { setLeftTab('source'); setTimeout(() => viewRef.current && insertAt(viewRef.current, viewRef.current.state.selection.main.head, `![${name.replace(/\.[^.]+$/, '')}](./assets/${name})`), 30); }} />}
              <div className="problems">
                <div className="problems-head" onClick={() => setProblemsOpen(o => !o)}>
                  {errors ? <AlertCircle className="sev-error" /> : warnings ? <AlertTriangle className="sev-warning" /> : <Check className="sev-info" style={{ color: 'var(--success)' }} />}
                  Problèmes
                  {errors > 0 && <span className="badge error">{errors}</span>}
                  {warnings > 0 && <span className="badge warning">{warnings}</span>}
                  {!errors && !warnings && <span className="faint" style={{ fontWeight: 400 }}>aucun</span>}
                  <div className="grow" /><ChevronDown size={14} style={{ transform: problemsOpen ? '' : 'rotate(-90deg)' }} />
                </div>
                {problemsOpen && diagnostics.length > 0 && (
                  <ul>
                    {diagnostics.map((d, i) => (
                      <li key={i} onClick={() => jump(d.line)} title={d.code}>
                        {d.severity === 'error' ? <AlertCircle className="sev-error" /> : d.severity === 'warning' ? <AlertTriangle className="sev-warning" /> : <Info className="sev-info" />}
                        <span className="ln">{d.line ? `L${d.line}` : '—'}</span><span className="grow">{d.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <Resizer onDrag={dx => setLeftW(w => Math.min(900, Math.max(280, w + dx)))} />
          </>
        )}
        <section className="pane pane-center">
          {result && (
            <Preview html={result.html} mode={mode} pageWidthMm={pageMm} slideSize={slideSize} scrollRequest={scrollReq}
              onSelect={line => { useStudio.setState({ selectedLine: line }); if (viewRef.current && leftOpen) goToLine(viewRef.current, line, false); }} />
          )}
          {!result && <div className="empty"><AlertCircle className="big" /><h2>Rendu impossible</h2><p>Le détail est dans la console du navigateur.</p></div>}
        </section>
        {rightOpen && <>
        <Resizer onDrag={dx => setRightW(w => Math.min(560, Math.max(260, w - dx)))} />
        <aside className="pane pane-right" style={{ width: rightW }}>
          <Inspector
            selected={selected}
            onOpenGallery={() => setDialog('gallery')}
            onExport={f => exportAs(f)}
            onInsert={text => { if (!leftOpen) setLeftOpen(true); setLeftTab('source'); setTimeout(() => { const v = viewRef.current; if (v) insertAt(v, v.state.selection.main.head, text); }, 30); }}
            onEditComponent={(c, attrs) => { if (viewRef.current) rewriteOpener(viewRef.current, c.line, c.given, attrs, c.classes, c.id); }}
          />
        </aside>
        </>}
      </div>

      {dialog === 'gallery' && <TemplateGallery onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} onExport={(f, m) => { setDialog(null); exportAs(f, m); }} />}
      {dialog === 'history' && <HistoryDialog onClose={() => setDialog(null)} onRestore={md2 => { if (viewRef.current) replaceAll(viewRef.current, md2); setDialog(null); toast('Version restaurée. Ctrl+Z pour revenir en arrière.'); }} />}
      {dialog === 'preview' && result && <FullPreview html={result.html} onClose={() => setDialog(null)} />}
    </div>
  );
}

function LayoutIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>;
}

function SaveIndicator({ state, error }: { state: string; error: string }) {
  if (state === 'saving') return <span className="savestate"><Loader2 className="spin-icon" />Enregistrement…</span>;
  if (state === 'dirty') return <span className="savestate"><span className="dot" />Modifié</span>;
  if (state === 'error') return <span className="savestate error" title={error}><CloudOff />Non enregistré : {error}</span>;
  return <span className="savestate"><Check />Enregistré</span>;
}

function findComponent(blocks: any[], line: number): ComponentNode | null {
  let best: ComponentNode | null = null;
  const walk = (l: any[]) => l.forEach(b => {
    if (b.type === 'component') {
      if (b.line === line) best = b;
      else if (!best && b.line < line && b.endLine >= line) { /* le bloc cliqué est dans ce composant */ }
      walk(b.children || []);
    }
  });
  walk(blocks);
  return best;
}

function Outline({ ir, onJump }: { ir: any; onJump: (l: number) => void }) {
  const items: { line: number; depth: number; text: string; number?: string; kind?: string }[] = [];
  const walk = (l: any[], depth: number) => l.forEach(b => {
    if (b.type === 'heading') items.push({ line: b.position.start.line, depth: b.depth, text: textOfNode(b), number: b.data?.number });
    else if (b.type === 'component') { if (depth === 0 && !['column', 'tab'].includes(b.name)) items.push({ line: b.line, depth: 6, text: b.attrs.title || b.attrs.caption || '', kind: b.given }); walk(b.children || [], depth + 1); }
  });
  walk(ir.blocks, 0);
  if (!items.length) return <div className="list"><div className="drop-hint">Aucun titre. Écrivez « ## Titre » pour structurer le document.</div></div>;
  return (
    <div className="list outline">
      {items.map((it, i) => (
        <a key={i} className={'d' + it.depth} onClick={() => onJump(it.line)}>
          {it.number && <span className="num">{it.number}</span>}
          <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.text || <span className="faint">sans titre</span>}</span>
          {it.kind && <span className="kind">:::{it.kind}</span>}
        </a>
      ))}
    </div>
  );
}
const textOfNode = (n: any): string => (typeof n.value === 'string' ? n.value : (n.children || []).map(textOfNode).join(''));

function FilesPanel({ referenced, onUpload, onInsert }: { referenced: string[]; onUpload: (f: File[]) => void; onInsert: (name: string) => void }) {
  const { doc, toast } = useStudio();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!doc) return null;
  const used = new Set(referenced.map(r => findAsset(r, doc.assets)?.name).filter(Boolean));
  const missing = referenced.filter(r => !/^(https?:|data:)/.test(r) && !findAsset(r, doc.assets));
  const remove = async (name: string) => {
    if (!confirm(`Supprimer « ${name} » ?`)) return;
    try { await api.deleteAsset(doc.id, name); useStudio.setState(s => ({ doc: s.doc && { ...s.doc, assets: s.doc.assets.filter(a => a.name !== name) } })); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div className="list" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onUpload([...e.dataTransfer.files]); }}>
      <div className={'drop-hint' + (over ? ' over' : '')}>
        <button className="btn sm" onClick={() => input.current?.click()}><Upload />Ajouter des fichiers</button>
        <div style={{ marginTop: 6 }}>ou glissez-les ici · images, vidéos, polices</div>
        <input ref={input} type="file" multiple hidden accept="image/*,video/mp4,video/webm,.woff2,.woff,.ttf,.otf" onChange={e => { onUpload([...(e.target.files || [])]); e.target.value = ''; }} />
      </div>
      {missing.length > 0 && (
        <div className="note warn" style={{ margin: '0 6px 8px' }}>
          <strong>Introuvables :</strong> {missing.join(', ')}. Ajoutez un fichier du même nom : il sera retrouvé automatiquement.
        </div>
      )}
      {doc.assets.map(a => {
        const img = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(a.name);
        return (
          <div key={a.name} className="asset">
            <div className="thumb" style={img ? { backgroundImage: `url("${api.assetUrl(doc.id, a.name)}")` } : undefined}>{!img && <FileUp />}</div>
            <div className="meta">
              <div>{a.name}</div>
              <div className="used faint">{fmtSize(a.size)} · {used.has(a.name) ? 'utilisé' : 'non utilisé'}</div>
            </div>
            {img && <button className="btn sm ghost" onClick={() => onInsert(a.name)}>Insérer</button>}
            <button className="btn sm ghost icon danger" onClick={() => remove(a.name)} aria-label={`Supprimer ${a.name}`}><Trash2 /></button>
          </div>
        );
      })}
    </div>
  );
}

function DocMenu({ close, openHistory, onDeleted }: { close: () => void; openHistory: () => void; onDeleted: () => void }) {
  const { doc, toast, setSettings } = useStudio();
  const input = useRef<HTMLInputElement>(null);
  const [ui, setUi] = usePersisted<'light' | 'dark'>('sd-ui', 'light');
  if (!doc) return null;
  const importSettings = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const next: Partial<DocSettings> = j.settings || j;
      if (typeof next !== 'object' || !('templateId' in next || 'overrides' in next || 'mode' in next)) throw new Error('Fichier de réglages non reconnu.');
      setSettings(s => ({ ...s, ...next }));
      toast('Réglages importés.');
    } catch (e: any) { toast(e.message, 'error'); }
    close();
  };
  return (
    <>
      <button onClick={() => { close(); openHistory(); }}><History /><span>Historique des versions</span></button>
      <hr />
      <button onClick={() => { close(); api.source(doc.id, false).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><FileText /><span>Télécharger la source</span></button>
      <button disabled={!doc.hasOriginal} onClick={() => { close(); api.source(doc.id, true).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><FileText /><span>Télécharger le fichier importé<span className="sub">{doc.hasOriginal ? 'Tel qu\'il était à l\'import, jamais modifié' : 'Document créé dans l\'application'}</span></span></button>
      <button onClick={() => { close(); api.settingsFile(doc.id).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><Download /><span>Exporter les réglages (.json)</span></button>
      <button onClick={() => input.current?.click()}><Upload /><span>Importer des réglages</span></button>
      <input ref={input} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importSettings(f); e.target.value = ''; }} />
      <hr />
      <button onClick={async () => { close(); try { const c = await api.duplicate(doc.id); location.hash = `#/doc/${c.id}`; toast('Copie créée.'); } catch (e: any) { toast(e.message, 'error'); } }}><Copy /><span>Dupliquer</span></button>
      <button onClick={() => { setUi(ui === 'dark' ? 'light' : 'dark'); document.documentElement.dataset.ui = ui === 'dark' ? 'light' : 'dark'; close(); }}><Eye /><span>Interface {ui === 'dark' ? 'claire' : 'sombre'}</span></button>
      <hr />
      <button onClick={async () => {
        close();
        if (!confirm(`Supprimer « ${doc.name} » ? Il est déplacé dans la corbeille du dossier DocumentStudio.`)) return;
        try { await api.remove(doc.id); onDeleted(); toast('Document supprimé.'); } catch (e: any) { toast(e.message, 'error'); }
      }}><Trash2 style={{ color: 'var(--danger)' }} /><span style={{ color: 'var(--danger)' }}>Supprimer le document</span></button>
    </>
  );
}

function ShareDialog({ onClose, onExport }: { onClose: () => void; onExport: (f: string, m?: Target) => void }) {
  return (
    <Modal title="Partager" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div>
          <div className="subhead" style={{ marginTop: 0 }}>Fichiers</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => onExport('pdf', 'print')}><FileDown />PDF</button>
            <button className="btn" onClick={() => onExport('html', 'reading')}><FileCode2 />Page HTML</button>
            <button className="btn" onClick={() => onExport('html', 'slides')}><Presentation />Diaporama HTML</button>
            <button className="btn" onClick={() => onExport('zip')}><Files />Paquet .zip</button>
          </div>
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>Les fichiers HTML intègrent polices, images et scripts : ils s'ouvrent hors ligne, sans l'application, par mail ou depuis un dossier partagé. Les images distantes (http) restent des liens.</p>
        </div>
        {api.backend.kind === 'browser' && (
          <div className="note warn">
            <strong>Édition web :</strong> vos documents sont enregistrés dans ce navigateur, sur cet appareil, et nulle part ailleurs. Pour les garder ou les transmettre, exportez-les (le paquet .zip contient tout).
          </div>
        )}
        <div className="note">
          <strong>Publication en ligne : non configurée.</strong> Aucun service de publication n'est branché sur cette installation : aucun lien public ou privé ne peut être créé pour l'instant. L'architecture prévue (API, droits vérifiés côté serveur, révocation) est décrite dans <code>docs/architecture.md</code>.
        </div>
      </div>
    </Modal>
  );
}

function HistoryDialog({ onClose, onRestore }: { onClose: () => void; onRestore: (md: string) => void }) {
  const { doc } = useStudio();
  const [list, setList] = useState<{ id: string; at: string; size: number }[] | null>(null);
  const [sel, setSel] = useState<{ id: string; md: string } | null>(null);
  useEffect(() => { if (doc) api.history(doc.id).then(setList, () => setList([])); }, [doc]);
  return (
    <Modal title="Historique des versions" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Fermer</button><button className="btn primary" disabled={!sel} onClick={() => sel && onRestore(sel.md)}>Restaurer cette version</button></>}>
      {list === null ? <div className="row"><span className="spin" />Chargement…</div> : list.length === 0 ? (
        <p className="muted">Aucune version antérieure. Une version est conservée au plus toutes les deux minutes pendant l'édition (60 au maximum).</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, minHeight: 320 }}>
          <div className="col" style={{ gap: 2, overflow: 'auto', maxHeight: 420 }}>
            {list.map(h => (
              <button key={h.id} className="btn ghost" style={{ justifyContent: 'space-between' }} aria-pressed={sel?.id === h.id}
                onClick={async () => doc && setSel({ id: h.id, md: (await api.snapshot(doc.id, h.id)).markdown })}>
                <span>{fmtDate(h.at)}</span><span className="faint">{fmtSize(h.size)}</span>
              </button>
            ))}
          </div>
          <pre className="mono" style={{ margin: 0, padding: 10, background: 'var(--sunken)', borderRadius: 6, fontSize: 11.5, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 420 }}>{sel ? sel.md : 'Choisissez une version à gauche.'}</pre>
        </div>
      )}
    </Modal>
  );
}

function FullPreview({ html, onClose }: { html: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fullpreview">
      <button className="btn close" onClick={onClose}><X />Fermer (Échap)</button>
      <iframe sandbox="allow-scripts" srcDoc={html} title="Aperçu plein écran" />
    </div>
  );
}
