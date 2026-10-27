// État de l'application : document ouvert, réglages, sauvegarde automatique, annuler/rétablir.
import { create } from 'zustand';
import { BUILTIN_TEMPLATES, DEFAULT_SETTINGS, type Diagnostic, type DocSettings, type Template } from '@studio/engine';
import { api, type Doc } from './api.ts';
import type { Provider } from './collabClient.ts';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export interface Toast { id: number; text: string; kind: 'info' | 'error' }
export interface RuntimeIssue { line: number; message: string; severity: 'warning' | 'error' }

interface State {
  doc: Doc | null;
  markdown: string;
  settings: DocSettings;
  save: SaveState;
  saveError: string;
  templates: Template[];
  userTemplates: Template[];
  diagnostics: Diagnostic[];
  runtime: RuntimeIssue[];          // débordements mesurés dans l'aperçu
  selectedLine: number | null;      // bloc sélectionné dans l'aperçu
  toasts: Toast[];
  /** Connexion temps réel : présente, le texte et les réglages passent par Yjs (pas de sauvegarde par requête). */
  provider: Provider | null;
  me: import('./api.ts').Me | null;
  currentSlide: number;
  // annuler / rétablir : le texte vit dans CodeMirror, les réglages ici.
  undoLog: ('text' | 'settings')[];
  redoLog: ('text' | 'settings')[];
  settingsPast: DocSettings[];
  settingsFuture: DocSettings[];
  open(doc: Doc): void;
  close(): void;
  setMarkdown(md: string): void;
  setSettings(fn: (s: DocSettings) => DocSettings, coalesce?: string): void;
  rename(name: string): void;
  setProject(project: string): void;
  loadTemplates(): Promise<void>;
  toast(text: string, kind?: Toast['kind']): void;
}

const withDefaults = (s: Partial<DocSettings>): DocSettings => ({ ...DEFAULT_SETTINGS, ...s });

let timer: ReturnType<typeof setTimeout> | undefined;
let lastCoalesce = '';
let lastCoalesceAt = 0;
let toastId = 0;

async function flush() {
  const { doc, markdown, settings, provider } = useStudio.getState();
  if (!doc || provider) return;
  useStudio.setState({ save: 'saving' });
  try {
    const r = await api.update(doc.id, { markdown, settings });
    if (useStudio.getState().doc?.id !== doc.id) return;
    // Modifié pendant l'envoi : une nouvelle sauvegarde est déjà programmée.
    useStudio.setState(s => ({ doc: s.doc && { ...s.doc, updatedAt: r.updatedAt }, save: s.markdown === markdown && s.settings === settings ? 'saved' : 'dirty' }));
  } catch (e: any) {
    useStudio.setState({ save: 'error', saveError: e.message });
  }
}
function schedule() {
  const p = useStudio.getState().provider;
  if (p) {
    // Lecteurs et commentateurs : changer de vue reste local, rien n'est écrit dans le document partagé.
    if (p.role === 'editor' || p.role === 'owner') p.meta.set('settings', useStudio.getState().settings);
    return;
  }
  useStudio.setState({ save: 'dirty' });
  clearTimeout(timer);
  timer = setTimeout(flush, 700);
}
export const saveNow = () => { clearTimeout(timer); return flush(); };

export const useStudio = create<State>((set, get) => {
  window.addEventListener('beforeunload', e => { if (get().save === 'dirty' || get().save === 'saving') { flush(); e.preventDefault(); } });

  return {
    doc: null, markdown: '', settings: withDefaults({}), save: 'saved', saveError: '',
    templates: BUILTIN_TEMPLATES, userTemplates: [], diagnostics: [], runtime: [], selectedLine: null, toasts: [], provider: null, me: null, currentSlide: 0,
    undoLog: [], redoLog: [], settingsPast: [], settingsFuture: [],
    open: doc => set({ doc, markdown: doc.markdown, settings: withDefaults(doc.settings), save: 'saved', undoLog: [], redoLog: [], settingsPast: [], settingsFuture: [], runtime: [], selectedLine: null }),
    close: () => { clearTimeout(timer); if (get().save === 'dirty') flush(); set({ doc: null, provider: null }); },
    setMarkdown: md => { if (md !== get().markdown) { set({ markdown: md }); if (!get().provider) schedule(); } },
    setSettings: (fn, coalesce) => {
      const prev = get().settings;
      const next = fn(prev);
      if (next === prev) return;
      // Les réglages continus (curseurs, couleurs) ne créent qu'une étape d'annulation par geste.
      const now = Date.now();
      const merge = coalesce && coalesce === lastCoalesce && now - lastCoalesceAt < 1200;
      lastCoalesce = coalesce || ''; lastCoalesceAt = now;
      set(s => merge
        ? { settings: next, settingsFuture: [] }
        : { settings: next, settingsPast: [...s.settingsPast.slice(-200), prev], settingsFuture: [], undoLog: [...s.undoLog, 'settings'], redoLog: [] });
      schedule();
    },
    rename: name => {
      const doc = get().doc;
      if (!doc || !name.trim() || name === doc.name) return;
      set({ doc: { ...doc, name } });
      api.update(doc.id, { name }).catch(e => get().toast(e.message, 'error'));
    },
    setProject: project => {
      const doc = get().doc;
      if (!doc) return;
      set({ doc: { ...doc, project } });
      api.update(doc.id, { project }).catch(e => get().toast(e.message, 'error'));
    },
    loadTemplates: async () => {
      try {
        const mine = await api.themes();
        set({ userTemplates: mine, templates: [...BUILTIN_TEMPLATES, ...mine] });
      } catch (e: any) { get().toast(e.message, 'error'); }
    },
    toast: (text, kind = 'info') => {
      const id = ++toastId;
      set(s => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), kind === 'error' ? 6000 : 3200);
    },
  };
});

/** Annule la dernière action, qu'elle porte sur le texte (via l'éditeur) ou sur les réglages. */
export function undoAction(editorUndo: () => boolean) {
  const s = useStudio.getState();
  const kind = s.undoLog[s.undoLog.length - 1];
  if (!kind) return;
  if (kind === 'text') { editorUndo(); }
  else {
    const prev = s.settingsPast[s.settingsPast.length - 1];
    if (!prev) return;
    useStudio.setState({ settings: prev, settingsPast: s.settingsPast.slice(0, -1), settingsFuture: [s.settings, ...s.settingsFuture] });
    schedule();
  }
  useStudio.setState(st => ({ undoLog: st.undoLog.slice(0, -1), redoLog: [...st.redoLog, kind] }));
}

export function redoAction(editorRedo: () => boolean) {
  const s = useStudio.getState();
  const kind = s.redoLog[s.redoLog.length - 1];
  if (!kind) return;
  if (kind === 'text') editorRedo();
  else {
    const next = s.settingsFuture[0];
    if (!next) return;
    useStudio.setState({ settings: next, settingsFuture: s.settingsFuture.slice(1), settingsPast: [...s.settingsPast, s.settings] });
    schedule();
  }
  useStudio.setState(st => ({ redoLog: st.redoLog.slice(0, -1), undoLog: [...st.undoLog, kind] }));
}

/** Enregistré par l'éditeur : chaque nouvelle étape d'annulation de CodeMirror entre dans le journal commun. */
export function recordTextStep() {
  useStudio.setState(st => ({ undoLog: [...st.undoLog, 'text'], redoLog: [] }));
}
