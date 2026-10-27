// Espace de travail : source et structure | aperçu | propriétés et collaboration.
// Trois dispositions : ordinateur (trois panneaux), tablette (panneaux superposés), mobile (une vue à la fois).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import {
  Activity as ActivityIcon, AlertCircle, AlertTriangle, ArrowLeft, BookOpen, Check, ChevronDown, CloudOff, Columns2, Copy, Download, Eye, FileCode2, FileDown, FileText, FileUp, Files,
  GitBranch, History, Image as ImageIcon, Info, ListTree, Loader2, LogOut, Maximize2, MessageSquare, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Presentation, Printer, Redo2, Settings2, Share2, Trash2, Undo2, Upload, X,
} from 'lucide-react';
import { DEFAULT_SETTINGS, render, resolveTheme, SLIDE_SIZES, type ComponentNode, type Diagnostic, type DocSettings, type Target } from '@studio/engine';
import { api, collab, download, shareState, type Block, type Comment, type Role } from './api.ts';
import { findAsset, previewEnv } from './env.ts';
import { createEditor, editorRedo, editorUndo, goToLine, insertAt, replaceAll, rewriteOpener, setComments, setLint, type CommentRange } from './editor.ts';
import { recordTextStep, redoAction, saveNow, undoAction, useStudio } from './store.ts';
import { Provider } from './collabClient.ts';
import { Preview } from './Preview.tsx';
import { Inspector } from './Inspector.tsx';
import { TemplateGallery } from './TemplateGallery.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { ActivityPanel, canDo, CommentsPanel, HistoryPanel, NotificationsBell, Presence, SyncState, WorkflowControl, type Selection } from './CollabPanels.tsx';
import { BlocksSection, BranchBanner, BranchButton, CompareTemplates } from './Extras.tsx';
import { Menu, Modal, Resizer, Segmented, fmtDate, fmtSize, usePersisted } from './ui.tsx';

const PAGE_W: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };

/** Document vierge : vide, ou seulement le titre « # … » d'un nouveau document. */
const isBlank = (md: string) => /^\s*(#[^\n]*)?\s*$/.test(md);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export type Layout = 'desktop' | 'tablet' | 'mobile';
/** Disposition selon la largeur réelle (points de rupture choisis sur le contenu : trois panneaux utiles dès 1180 px). */
export function useLayout(): Layout {
  const get = (): Layout => (innerWidth < 760 ? 'mobile' : innerWidth < 1180 ? 'tablet' : 'desktop');
  const [l, setL] = useState<Layout>(get);
  useEffect(() => { const f = () => setL(get()); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  return l;
}

type RightTab = 'props' | 'comments' | 'history' | 'activity';
type MobileView = 'preview' | 'source' | 'comments' | 'history' | 'props';

export function Workspace({ onBack }: { onBack: () => void }) {
  const st = useStudio();
  const { doc, markdown, settings, templates, save, saveError, toast, provider, me } = st;
  const layout = useLayout();
  const collabOn = api.backend.collab;
  const role: Role = (doc?.role as Role) || 'owner';
  const readOnly = collabOn && !canDo.edit(role);
  const viewRef = useRef<EditorView | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const editorHost = useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = usePersisted('sd-left-w', 440);
  const [rightW, setRightW] = usePersisted('sd-right-w', 340);
  const [leftOpenPref, setLeftOpen] = usePersisted('sd-left-open', true);
  const [rightOpenPref, setRightOpen] = usePersisted('sd-right-open', true);
  // Sur tablette, les panneaux se superposent à l'aperçu : fermés par défaut.
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);
  const leftOpen = layout === 'desktop' ? leftOpenPref : layout === 'tablet' ? drawer === 'left' : false;
  const rightOpen = layout === 'desktop' ? rightOpenPref : layout === 'tablet' ? drawer === 'right' : false;
  const focusPrev = useRef<[boolean, boolean] | null>(null);
  const focus = layout === 'desktop' && !leftOpenPref && !rightOpenPref;
  const toggleFocus = () => {
    if (focus) { const [l, r] = focusPrev.current || [true, true]; setLeftOpen(l); setRightOpen(r); focusPrev.current = null; }
    else { focusPrev.current = [leftOpenPref, rightOpenPref]; setLeftOpen(false); setRightOpen(false); }
  };
  const [leftTab, setLeftTab] = usePersisted<'source' | 'outline' | 'files'>('sd-left-tab', 'source');
  const [rightTab, setRightTab] = usePersisted<RightTab>('sd-right-tab', 'props');
  const [mobileView, setMobileView] = useState<MobileView>('preview');
  const [problemsOpen, setProblemsOpen] = usePersisted('sd-problems', true);
  const [dialog, setDialog] = useState<null | 'gallery' | 'share' | 'history' | 'preview' | 'branch' | 'compare'>(null);
  const [scrollReq, setScrollReq] = useState<{ line: number; n: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(!collabOn);
  const [comments, setCommentsList] = useState<Comment[]>([]);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const mode = settings.mode;

  const showSource = layout === 'mobile' ? mobileView === 'source' : leftOpen && leftTab === 'source';
  const sourceMounted = layout === 'mobile' ? mobileView === 'source' : leftOpen;

  /* ----- Connexion temps réel ----- */
  const loadComments = useCallback(() => {
    const d = useStudio.getState().doc;
    if (d && collabOn && canDo.comment(d.role as Role)) collab.comments(d.id).then(setCommentsList, () => {});
  }, [collabOn]);
  const loadBlocks = useCallback(() => { if (collabOn && useStudio.getState().me) collab.blocks().then(setBlocks, () => {}); }, [collabOn]);
  const refreshDoc = useCallback(() => {
    const d = useStudio.getState().doc;
    if (d) api.get(d.id).then(n => useStudio.setState(s => ({ doc: s.doc && { ...s.doc, ...n, markdown: s.doc.markdown, settings: s.doc.settings } })), () => {});
  }, []);

  useEffect(() => {
    if (!collabOn || !doc) return;
    const p = new Provider(doc.id, shareState.token, shareState.guestName);
    useStudio.setState({ provider: p });
    let alive = true;
    p.whenReady().then(() => {
      if (!alive) return;
      const text = p.text.toString();
      const s = p.meta.get('settings') as Partial<DocSettings> | undefined;
      useStudio.setState(x => ({ markdown: text || x.markdown, settings: s ? { ...DEFAULT_SETTINGS, ...s } : x.settings }));
      setReady(true);
    });
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      if (e.transaction.local) return;
      const s = p.meta.get('settings') as Partial<DocSettings> | undefined;
      if (s) useStudio.setState(x => ({ settings: { ...DEFAULT_SETTINGS, ...s, mode: x.settings.mode } }));
    };
    p.meta.observe(onMeta);
    const offEv = p.onEvent(e => {
      if (e.type === 'comments') loadComments();
      if (e.type === 'workflow' || e.type === 'versions') refreshDoc();
    });
    const offSt = p.subscribe(() => { if (p.status === 'denied') toast('Votre accès à ce document a été retiré.', 'error'); });
    loadComments(); loadBlocks();
    return () => { alive = false; p.meta.unobserve(onMeta); offEv(); offSt(); p.destroy(); useStudio.setState({ provider: null }); };
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- Rendu ----- */
  // La frappe est regroupée ; la pagination, plus coûteuse, attend un peu plus.
  const md = useDebounced(markdown, mode === 'print' ? 500 : 180);
  const s = useDebounced(settings, 120);
  const assets = doc?.assets || [];
  const result = useMemo(() => {
    if (!doc) return null;
    try { return render(md, s, previewEnv(doc.id, assets), templates, bid => blocks.find(b => b.id === bid) as any); }
    catch (e: any) { console.error(e); return null; }
  }, [md, s, assets, templates, doc?.id, blocks]); // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostics: Diagnostic[] = useMemo(() => {
    const d = result?.diagnostics || [];
    return [...d, ...st.runtime.map(r => ({ ...r, code: 'layout' } as Diagnostic))];
  }, [result, st.runtime]);

  /* ----- Éditeur ----- */
  useEffect(() => {
    if (!editorHost.current || !doc || !ready || !sourceMounted) return;
    const p = useStudio.getState().provider;
    const um = p ? new Y.UndoManager(p.text) : null;
    undoRef.current = um;
    const view = createEditor(editorHost.current, p ? p.text.toString() : useStudio.getState().markdown, {
      onChange: v => useStudio.getState().setMarkdown(v),
      onTextStep: recordTextStep,
      onCursor: line => { setScrollReq({ line, n: Date.now() }); p?.setCursorLine(line); },
      onPasteFiles: (files, pos) => uploadFiles(files, pos),
    }, { collab: p && um ? { text: p.text, awareness: p.awareness, undo: um } : undefined, readOnly });
    viewRef.current = view;
    const onClick = (e: MouseEvent) => {
      const id = (e.target as HTMLElement).closest?.('[data-comment]')?.getAttribute('data-comment');
      if (id) { setActiveComment(id); openPanel('comments'); }
    };
    editorHost.current.addEventListener('click', onClick);
    const host = editorHost.current;
    return () => { host.removeEventListener('click', onClick); view.destroy(); viewRef.current = null; um?.destroy(); undoRef.current = null; };
  }, [doc?.id, ready, sourceMounted, layout, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Passages commentés et suggestions, recalculés quand le texte bouge.
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !provider) return;
    const ranges: CommentRange[] = [];
    for (const c of comments) {
      if (c.status !== 'open' || !c.anchor.start) continue;
      const r = provider.resolve(c.anchor);
      if (r) ranges.push({ id: c.id, from: r.from, to: r.to, kind: c.kind, replacement: c.replacement, active: c.id === activeComment });
    }
    v.dispatch({ effects: setComments.of(ranges) });
  }, [comments, markdown, activeComment, provider, ready, showSource]);

  // Document vierge : la source s'ouvre, texte sélectionné, prête à recevoir un collage.
  useEffect(() => {
    if (!doc || !ready || readOnly || !isBlank(useStudio.getState().markdown)) return;
    if (layout === 'mobile') setMobileView('source'); else { setLeftOpen(true); setLeftTab('source'); if (layout === 'tablet') setDrawer('left'); }
    setTimeout(() => { const v = viewRef.current; if (v) { v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); v.focus(); } }, 80);
  }, [doc?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+V hors de l'éditeur : le texte va dans la source (il remplace un document encore vierge).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (readOnly || t.closest?.('.cm-editor, input, textarea, [contenteditable], .backdrop')) return;
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text.trim()) return;
      e.preventDefault();
      openSource();
      setTimeout(() => {
        const v = viewRef.current;
        if (!v) return;
        if (isBlank(v.state.doc.toString())) replaceAll(v, text.replace(/\r\n?/g, '\n'));
        else insertAt(v, v.state.selection.main.head, text);
        v.focus();
      }, 80);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (viewRef.current && result) setLint(viewRef.current, result.diagnostics); }, [result, showSource]);

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

  /* ----- Navigation entre panneaux ----- */
  function openSource() {
    if (layout === 'mobile') setMobileView('source');
    else { setLeftTab('source'); if (layout === 'tablet') setDrawer('left'); else setLeftOpen(true); }
  }
  function openPanel(tab: RightTab) {
    if (layout === 'mobile') setMobileView(tab === 'activity' ? 'history' : tab);
    else { setRightTab(tab); if (layout === 'tablet') setDrawer('right'); else setRightOpen(true); }
  }
  const jump = (line: number) => {
    if (!line) return;
    openSource();
    setTimeout(() => viewRef.current && goToLine(viewRef.current, line), 60);
    setScrollReq({ line, n: Date.now() });
  };

  /** Sélection courante dans la source ; à défaut, le bloc choisi dans l'aperçu (toute sa ligne). */
  const getSelection = (): Selection | null => {
    const v = viewRef.current;
    if (v) {
      const r = v.state.selection.main;
      const line = v.state.doc.lineAt(r.from).number;
      if (!r.empty) return { from: r.from, to: r.to, text: v.state.sliceDoc(r.from, r.to), line };
      if (v.hasFocus) return { from: r.from, to: r.from, text: '', line };
    }
    const sl = useStudio.getState().selectedLine;
    if (sl && provider) {
      const lines = provider.text.toString().split('\n');
      const from = lines.slice(0, sl - 1).reduce((n, l) => n + l.length + 1, 0);
      return { from, to: from + (lines[sl - 1] || '').length, text: lines[sl - 1] || '', line: sl };
    }
    return null;
  };

  /* ----- Exports ----- */
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

  const textUndo = () => (undoRef.current ? (undoRef.current.undo(), true) : editorUndo(viewRef.current));
  const textRedo = () => (undoRef.current ? (undoRef.current.redo(), true) : editorRedo(viewRef.current));

  const toggleFocusRef = useRef(toggleFocus);
  toggleFocusRef.current = toggleFocus;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  // Raccourcis globaux
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().then(() => toast(useStudio.getState().provider ? 'Les modifications sont enregistrées au fil de l\'eau.' : 'Enregistré.')); }
      if (mod && e.key === '\\') { e.preventDefault(); toggleFocusRef.current(); }
      if (e.key === 'Escape' && focusRef.current && !document.querySelector('.backdrop, .fullpreview, .listbox')) toggleFocusRef.current();
      const inEditor = !!(e.target as HTMLElement).closest?.('.cm-editor');
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (mod && !inEditor && !inField && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoAction(textRedo) : undoAction(textUndo); }
      if (mod && !inEditor && !inField && e.key.toLowerCase() === 'y') { e.preventDefault(); redoAction(textRedo); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return null;
  if (!ready) return <div className="empty" style={{ height: '100%' }}><span className="spin" /><p>Connexion au document…</p></div>;

  const resolved = resolveTheme(s, templates);
  const pageMm = (() => {
    const p = resolved.page;
    const [w, h] = p.size === 'custom' ? [p.width, p.height] : PAGE_W[p.size] || PAGE_W.A4;
    return p.orientation === 'landscape' ? h : w;
  })();
  const slideSize: [number, number] = resolved.slides.aspect === 'custom' ? [resolved.slides.width, resolved.slides.height] : SLIDE_SIZES[resolved.slides.aspect];
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;
  const openComments = comments.filter(c => c.status === 'open').length;

  /* ----- Morceaux réutilisés par les trois dispositions ----- */
  const modeSwitch = (
    <Segmented value={mode} onChange={v => st.setSettings(x => ({ ...x, mode: v }))} options={[
      ['reading', <><BookOpen /><span className="lbl">Lecture</span></>, 'Page HTML de lecture'],
      ['print', <><Printer /><span className="lbl">Impression</span></>, 'Document paginé / PDF'],
      ['slides', <><Presentation /><span className="lbl">Diaporama</span></>, 'Présentation HTML'],
    ]} />
  );
  const exportMenu = (
    <Menu trigger={toggle => <button className="btn primary" onClick={toggle}><Download /><span className="lbl">Exporter</span><ChevronDown /></button>}>
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
  );
  const docMenu = (
    <Menu trigger={toggle => <button className="btn ghost icon" onClick={toggle} aria-label="Paramètres du document"><MoreHorizontal /></button>}>
      {close => <DocMenu close={close} openHistory={() => setDialog('history')} onDeleted={onBack} onBranch={() => setDialog('branch')} onCompare={() => setDialog('compare')} />}
    </Menu>
  );
  const status = provider ? <SyncState provider={provider} /> : <SaveIndicator state={save} error={saveError} />;
  const roleBadge = collabOn && role !== 'owner' && role !== 'editor' ? <span className="badge">{role === 'viewer' ? 'Lecture seule' : 'Commentaire'}</span> : null;

  const sourcePane = (
    <>
      <div className="pane-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={leftTab === 'source' || layout === 'mobile'} onClick={() => setLeftTab('source')}><FileText />Source</button>
          {layout !== 'mobile' && <button role="tab" aria-selected={leftTab === 'outline'} onClick={() => setLeftTab('outline')}><ListTree />Plan</button>}
          {layout !== 'mobile' && <button role="tab" aria-selected={leftTab === 'files'} onClick={() => setLeftTab('files')}><ImageIcon />Fichiers<span className="count">{assets.length || ''}</span></button>}
        </div>
        <div className="grow" />
        {readOnly && <span className="badge">lecture seule</span>}
        {layout === 'tablet' && <button className="btn ghost icon" onClick={() => setDrawer(null)} aria-label="Fermer"><X /></button>}
      </div>
      <div className="editor" ref={editorHost} style={{ display: showSource ? undefined : 'none' }} />
      {layout !== 'mobile' && leftTab === 'outline' && result && <Outline ir={result.ir} onJump={jump} />}
      {layout !== 'mobile' && leftTab === 'files' && <FilesPanel referenced={result?.ir.assets || []} onUpload={f => uploadFiles(f)} onInsert={name => { setLeftTab('source'); setTimeout(() => viewRef.current && insertAt(viewRef.current, viewRef.current.state.selection.main.head, `![${name.replace(/\.[^.]+$/, '')}](./assets/${name})`), 30); }} />}
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
    </>
  );

  const inspector = (
    <Inspector
      selected={readOnly ? null : selected}
      onOpenGallery={() => setDialog('gallery')}
      onExport={f => exportAs(f)}
      onCompare={() => setDialog('compare')}
      blocksNode={collabOn && me && !readOnly ? (
        <BlocksSection blocks={blocks} reload={loadBlocks}
          getSelectionText={() => { const v = viewRef.current; return v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : ''; }}
          onInsert={text => { openSource(); setTimeout(() => { const v = viewRef.current; if (v) insertAt(v, v.state.selection.main.head, text); }, 60); }}
          onReplaceLine={(line, text) => { openSource(); setTimeout(() => { const v = viewRef.current; if (!v) return; const l = v.state.doc.line(line); v.dispatch({ changes: { from: l.from, to: l.to, insert: text } }); }, 60); }} />
      ) : undefined}
      onInsert={text => { openSource(); setTimeout(() => { const v = viewRef.current; if (v) insertAt(v, v.state.selection.main.head, text); }, 60); }}
      onEditComponent={(c, attrs) => { if (viewRef.current) rewriteOpener(viewRef.current, c.line, c.given, attrs, c.classes, c.id); }}
    />
  );

  const commentsPanel = provider && canDo.comment(role) ? (
    <CommentsPanel docId={doc.id} provider={provider} role={role} members={doc.members || []} comments={comments} reload={loadComments}
      getSelection={getSelection} activeId={activeComment} setActiveId={setActiveComment}
      onJump={c => { const r = c.anchor.start ? provider.resolve(c.anchor) : null; if (r) { const line = provider.text.toString().slice(0, r.from).split('\n').length; if (layout !== 'mobile') jump(line); else setScrollReq({ line, n: Date.now() }); } }} />
  ) : <div className="side-panel"><div className="empty-small">{collabOn ? 'Les commentaires sont réservés aux commentateurs et éditeurs.' : 'Les commentaires demandent le serveur Document Studio.'}</div></div>;
  const historyPanel = collabOn ? <HistoryPanel docId={doc.id} role={role} onRestored={() => {}} /> : <div className="side-panel"><button className="btn" onClick={() => setDialog('history')}><History />Ouvrir l'historique</button></div>;

  const tabsRight: [RightTab, ReactNode, string][] = [
    ...(readOnly ? [] : [['props', <Settings2 />, 'Propriétés'] as [RightTab, ReactNode, string]]),
    ...(collabOn ? [['comments', <><MessageSquare />{openComments > 0 && <span className="count">{openComments}</span>}</>, 'Commentaires'] as [RightTab, ReactNode, string]] : []),
    ['history', <History />, 'Historique'],
    ...(collabOn ? [['activity', <ActivityIcon />, 'Activité'] as [RightTab, ReactNode, string]] : []),
  ];
  const tab = tabsRight.some(t => t[0] === rightTab) ? rightTab : tabsRight[0][0];
  const rightPane = (
    <>
      <div className="pane-head">
        <div className="tabs" role="tablist">
          {tabsRight.map(([k, icon, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setRightTab(k)} title={label}>{icon}<span className="lbl">{label}</span></button>)}
        </div>
        <div className="grow" />
        {layout === 'tablet' && <button className="btn ghost icon" onClick={() => setDrawer(null)} aria-label="Fermer"><X /></button>}
      </div>
      {tab === 'props' && inspector}
      {tab === 'comments' && commentsPanel}
      {tab === 'history' && historyPanel}
      {tab === 'activity' && <ActivityPanel docId={doc.id} />}
    </>
  );

  const preview = result ? (
    <Preview html={result.html} mode={mode} pageWidthMm={pageMm} slideSize={slideSize} scrollRequest={scrollReq} compact={layout === 'mobile'}
      onSelect={line => { useStudio.setState({ selectedLine: line }); if (viewRef.current && showSource) goToLine(viewRef.current, line, false); }} />
  ) : <div className="empty"><AlertCircle className="big" /><h2>Rendu impossible</h2><p>Le détail est dans la console du navigateur.</p></div>;

  const dialogs = (
    <>
      {dialog === 'gallery' && <TemplateGallery onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} onExport={(f, m) => { setDialog(null); exportAs(f, m); }} />}
      {dialog === 'history' && <HistoryDialog onClose={() => setDialog(null)} onRestore={md2 => { if (viewRef.current) replaceAll(viewRef.current, md2); setDialog(null); toast('Version restaurée. Ctrl+Z pour revenir en arrière.'); }} />}
      {dialog === 'preview' && result && <FullPreview html={result.html} onClose={() => setDialog(null)} />}
      {dialog === 'branch' && <BranchButton docId={doc.id} onClose={() => setDialog(null)} />}
      {dialog === 'compare' && <CompareTemplates blocks={blocks} onClose={() => setDialog(null)} />}
    </>
  );

  /* ----- Mobile : une vue à la fois, navigation en bas ----- */
  if (layout === 'mobile') {
    return (
      <div className="app app-mobile">
        <header className="topbar">
          <button className="btn ghost icon" onClick={onBack} aria-label="Retour"><ArrowLeft /></button>
          <div className="grow mobile-title"><div className="docname-static">{doc.name}</div>{status}</div>
          {provider && <Presence provider={provider} onJump={jump} />}
          <NotificationsBell />
          <Menu trigger={toggle => <button className="btn ghost icon" onClick={toggle} aria-label="Actions"><MoreHorizontal /></button>}>
            {close => (
              <>
                <div className="menu-title">Affichage</div>
                {(['reading', 'print', 'slides'] as Target[]).map(m => <button key={m} onClick={() => { close(); st.setSettings(x => ({ ...x, mode: m })); setMobileView('preview'); }}>{m === 'reading' ? <BookOpen /> : m === 'print' ? <Printer /> : <Presentation />}<span>{{ reading: 'Lecture', print: 'Impression', slides: 'Diaporama' }[m]}{mode === m ? ' ✓' : ''}</span></button>)}
                <hr />
                <button onClick={() => { close(); setDialog('share'); }}><Share2 /><span>Partager</span></button>
                <button onClick={() => { close(); exportAs('pdf'); }}><FileDown /><span>Exporter en PDF</span></button>
                <button onClick={() => { close(); exportAs('html', mode === 'slides' ? 'slides' : 'reading'); }}><FileCode2 /><span>Exporter en HTML</span></button>
                {mode === 'slides' && <button onClick={() => { close(); present(); }}><Presentation /><span>Présenter</span></button>}
                {!readOnly && <button onClick={() => { close(); setDialog('gallery'); }}><Columns2 /><span>Gabarit : {resolved.template.name}</span></button>}
                {canDo.edit(role) && <button onClick={() => { close(); undoAction(textUndo); }} disabled={!st.undoLog.length}><Undo2 /><span>Annuler</span></button>}
              </>
            )}
          </Menu>
        </header>
        {collabOn && doc.workflow && <div className="mobile-strip"><WorkflowControl docId={doc.id} workflow={doc.workflow} role={role} members={doc.members || []} onChange={w => useStudio.setState(x => ({ doc: x.doc && { ...x.doc, workflow: w } }))} />{roleBadge}</div>}
        <BranchBanner doc={doc} onMerged={refreshDoc} />
        <main className="mobile-main">
          {mobileView === 'preview' && <section className="pane pane-center">{preview}</section>}
          {mobileView === 'source' && <section className="pane">{sourcePane}</section>}
          {mobileView === 'comments' && <section className="pane">{commentsPanel}</section>}
          {mobileView === 'history' && <section className="pane">{historyPanel}{collabOn && <ActivityPanel docId={doc.id} />}</section>}
          {mobileView === 'props' && <section className="pane">{readOnly ? <div className="empty-small">Lecture seule.</div> : inspector}</section>}
        </main>
        <nav className="bottom-nav" aria-label="Vues du document">
          {([['preview', <Eye />, 'Document'], ['source', <FileText />, 'Source'], ...(collabOn && canDo.comment(role) ? [['comments', <MessageSquare />, 'Avis']] : []), ['history', <History />, 'Historique'], ...(readOnly ? [] : [['props', <Settings2 />, 'Réglages']])] as [MobileView, ReactNode, string][]).map(([k, icon, label]) => (
            <button key={k} aria-pressed={mobileView === k} onClick={() => setMobileView(k)}>{icon}<span>{label}</span>{k === 'comments' && openComments > 0 && <span className="nav-count">{openComments}</span>}</button>
          ))}
        </nav>
        {busy && <div className="busy mobile-busy"><span className="spin" />{busy}</div>}
        {dialogs}
      </div>
    );
  }

  /* ----- Ordinateur et tablette ----- */
  return (
    <div className={'app app-' + layout}>
      <header className="topbar">
        <button className="btn ghost icon" onClick={onBack} title="Bibliothèque" aria-label="Retour à la bibliothèque"><ArrowLeft /></button>
        <button className="btn ghost icon" onClick={() => (layout === 'tablet' ? setDrawer(d => (d === 'left' ? null : 'left')) : setLeftOpen(o => !o))} title={leftOpen ? 'Masquer la source' : 'Afficher la source'} aria-label="Afficher ou masquer la source">{leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
        <input className="docname" defaultValue={doc.name} key={doc.name} aria-label="Nom du document" size={Math.max(8, Math.min(28, doc.name.length))} readOnly={readOnly}
          onBlur={e => !readOnly && st.rename(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        {status}
        {roleBadge}
        {canDo.edit(role) && <>
          <div className="sep hide-tablet" />
          <button className="btn ghost icon hide-tablet" onClick={() => undoAction(textUndo)} disabled={!st.undoLog.length} title="Annuler (Ctrl+Z)" aria-label="Annuler"><Undo2 /></button>
          <button className="btn ghost icon hide-tablet" onClick={() => redoAction(textRedo)} disabled={!st.redoLog.length} title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir"><Redo2 /></button>
        </>}
        <div className="grow" />
        {modeSwitch}
        {!readOnly && <button className="btn" onClick={() => setDialog('gallery')} title="Changer de gabarit"><LayoutIcon /><span className="lbl">{resolved.template.name}</span><ChevronDown /></button>}
        <div className="grow" />
        {busy && <span className="savestate"><Loader2 className="spin-icon" /><span className="lbl">{busy}</span></span>}
        {provider && <Presence provider={provider} onJump={jump} />}
        {collabOn && doc.workflow && <WorkflowControl docId={doc.id} workflow={doc.workflow} role={role} members={doc.members || []} onChange={w => useStudio.setState(x => ({ doc: x.doc && { ...x.doc, workflow: w } }))} />}
        <button className="btn hide-tablet" onClick={() => (mode === 'slides' ? present() : setDialog('preview'))} title={mode === 'slides' ? 'Présenter dans un nouvel onglet' : 'Aperçu plein écran'}>{mode === 'slides' ? <><Presentation />Présenter</> : <><Eye />Aperçu</>}</button>
        {exportMenu}
        <button className="btn" onClick={() => setDialog('share')}><Share2 /><span className="lbl">Partager</span></button>
        <NotificationsBell />
        <div className="sep" />
        <button className="btn ghost icon" onClick={() => (layout === 'tablet' ? setDrawer(d => (d === 'right' ? null : 'right')) : setRightOpen(o => !o))} aria-pressed={!rightOpen} title={rightOpen ? 'Masquer le panneau' : 'Propriétés, commentaires, historique'} aria-label="Afficher ou masquer le panneau de droite">{rightOpen ? <PanelRightClose /> : <PanelRightOpen />}{collabOn && openComments > 0 && !rightOpen && <span className="bell-count">{openComments}</span>}</button>
        {layout === 'desktop' && <button className="btn ghost icon" onClick={toggleFocus} aria-pressed={focus} title={focus ? 'Quitter le plein écran (Échap)' : 'Plein écran : masquer les panneaux (Ctrl+\\)'} aria-label="Plein écran">{focus ? <Minimize2 /> : <Maximize2 />}</button>}
        {docMenu}
      </header>
      <BranchBanner doc={doc} onMerged={refreshDoc} />
      <div className={'work work-' + layout}>
        {leftOpen && (
          <>
            <section className="pane pane-left" style={layout === 'desktop' ? { width: leftW } : undefined}>{sourcePane}</section>
            {layout === 'desktop' && <Resizer onDrag={dx => setLeftW(w => Math.min(900, Math.max(280, w + dx)))} />}
          </>
        )}
        <section className="pane pane-center">{preview}</section>
        {rightOpen && (
          <>
            {layout === 'desktop' && <Resizer onDrag={dx => setRightW(w => Math.min(560, Math.max(280, w - dx)))} />}
            <aside className="pane pane-right" style={layout === 'desktop' ? { width: rightW } : undefined}>{rightPane}</aside>
          </>
        )}
        {layout === 'tablet' && drawer && <div className="scrim" onClick={() => setDrawer(null)} />}
      </div>
      {dialogs}
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

function DocMenu({ close, openHistory, onDeleted, onBranch, onCompare }: { close: () => void; openHistory: () => void; onDeleted: () => void; onBranch: () => void; onCompare: () => void }) {
  const { doc, toast, setSettings, me } = useStudio();
  const role = (doc?.role || 'owner') as Role;
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
      {!api.backend.collab && <button onClick={() => { close(); openHistory(); }}><History /><span>Historique des versions</span></button>}
      {api.backend.collab && canDo.edit(role) && <button onClick={() => { close(); onBranch(); }}><GitBranch /><span>Créer une branche<span className="sub">Préparer une refonte sans toucher au document</span></span></button>}
      <button onClick={() => { close(); onCompare(); }}><Columns2 /><span>Comparer deux gabarits</span></button>
      <hr />
      <button onClick={() => { close(); api.source(doc.id, false).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><FileText /><span>Télécharger la source</span></button>
      <button disabled={!doc.hasOriginal} onClick={() => { close(); api.source(doc.id, true).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><FileText /><span>Télécharger le fichier importé<span className="sub">{doc.hasOriginal ? 'Tel qu\'il était à l\'import, jamais modifié' : 'Document créé dans l\'application'}</span></span></button>
      <button onClick={() => { close(); api.settingsFile(doc.id).then(f => download(f.blob, f.name), e => toast(e.message, 'error')); }}><Download /><span>Exporter les réglages (.json)</span></button>
      {canDo.edit(role) && <button onClick={() => input.current?.click()}><Upload /><span>Importer des réglages</span></button>}
      <input ref={input} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importSettings(f); e.target.value = ''; }} />
      <hr />
      {(!api.backend.collab || me) && <button onClick={async () => { close(); try { const c = await api.duplicate(doc.id); location.hash = `#/doc/${c.id}`; toast('Copie créée.'); } catch (e: any) { toast(e.message, 'error'); } }}><Copy /><span>Dupliquer</span></button>}
      <button onClick={() => { setUi(ui === 'dark' ? 'light' : 'dark'); document.documentElement.dataset.ui = ui === 'dark' ? 'light' : 'dark'; close(); }}><Eye /><span>Interface {ui === 'dark' ? 'claire' : 'sombre'}</span></button>
      {me && <button onClick={() => { close(); collab.logout().then(() => { location.hash = '#/'; location.reload(); }); }}><LogOut /><span>Se déconnecter ({me.name})</span></button>}
      {canDo.owner(role) && <><hr />
      <button onClick={async () => {
        close();
        if (!confirm(`Supprimer « ${doc.name} » ? Il est déplacé dans la corbeille du dossier DocumentStudio.`)) return;
        try { await api.remove(doc.id); onDeleted(); toast('Document supprimé.'); } catch (e: any) { toast(e.message, 'error'); }
      }}><Trash2 style={{ color: 'var(--danger)' }} /><span style={{ color: 'var(--danger)' }}>Supprimer le document</span></button></>}
    </>
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
