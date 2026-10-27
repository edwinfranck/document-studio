// Éditeur source : CodeMirror 6, Markdown + StudioMD (décorations, complétion, diagnostics).
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, type ViewUpdate, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import { autocompletion, closeBrackets, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { StateEffect, StateField } from '@codemirror/state';
import { WidgetType } from '@codemirror/view';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { BY_NAME, COMPONENTS, suggestionHunks, type Diagnostic } from '@studio/engine';

const style = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.12em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.06em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.heading, color: 'var(--text)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: '#c2410c' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-3)' },
  { tag: t.list, color: 'var(--accent)' },
  { tag: t.keyword, color: '#2b59c3' },
  { tag: [t.string, t.special(t.string)], color: '#1c7c3c' },
  { tag: [t.number, t.bool], color: '#b25e09' },
  { tag: t.comment, color: 'var(--text-3)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: '#8a3ffc' },
]);

/* Lignes de composants : ouverture et fermeture repérées sans dépendre de l'analyseur. */
const DIRECTIVE = /^ {0,3}(:{3,})\s*([A-Za-z][\w-]*)?/;
const directiveLines = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view: EditorView) {
    const b = new RangeSetBuilder<Decoration>();
    let fence = false;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        if (/^ {0,3}(```|~~~)/.test(line.text)) fence = !fence;
        const m = !fence && DIRECTIVE.exec(line.text);
        if (m) {
          b.add(line.from, line.from, Decoration.line({ class: 'cm-directive-line' }));
          b.add(line.from, line.from + m[0].length, Decoration.mark({ class: 'cm-directive' }));
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: v => v.decorations });

/* Complétion : noms de composants après « ::: », attributs dans les accolades, valeurs énumérées. */
function complete(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  let m = /^ {0,3}:{3,}\s*([\w-]*)$/.exec(before);
  if (m) {
    return {
      from: ctx.pos - m[1].length,
      options: COMPONENTS.map(c => ({
        label: c.name, detail: c.label, info: c.description, type: 'class',
        apply: (view: EditorView, _c: any, from: number, to: number) => {
          // Un composant complet : ouverture, corps, fermeture.
          const indent = /^ */.exec(line.text)![0];
          const body = c.example.split('\n');
          const head = body[0].replace(/^:::\s*/, '');
          const rest = body.slice(1).join('\n' + indent);
          const insert = head + (rest ? '\n' + indent + rest : '');
          view.dispatch({ changes: { from, to: Math.max(to, line.to), insert }, selection: { anchor: from + head.length } });
        },
      })),
      validFor: /^[\w-]*$/,
    };
  }
  m = /^ {0,3}:{3,}\s*([\w-]+)\s*\{([^}]*)$/.exec(before);
  if (m) {
    const spec = BY_NAME.get(m[1].toLowerCase())?.spec;
    if (!spec) return null;
    const v = /(\w+)="?([\w-]*)$/.exec(m[2]);
    if (v && m[2].endsWith(v[0]) && /=/.test(v[0])) {
      const a = spec.attrs[v[1]];
      if (a?.values) return { from: ctx.pos - v[2].length, options: a.values.map(x => ({ label: x, type: 'enum' })), validFor: /^[\w-]*$/ };
      return null;
    }
    const w = /(\w*)$/.exec(m[2])![1];
    return {
      from: ctx.pos - w.length,
      options: Object.entries(spec.attrs).map(([k, a]) => ({
        label: k, detail: a.required ? 'obligatoire' : a.type, info: a.description, type: 'property',
        apply: a.type === 'boolean' ? k : `${k}=""`,
      })),
      validFor: /^\w*$/,
    };
  }
  return null;
}

export interface EditorHooks {
  onChange(md: string): void;
  onCursor(line: number): void;
  onTextStep(): void;
  onPasteFiles(files: File[], pos: number): void;
}

export interface CollabBinding { text: Y.Text; awareness: Awareness; undo: Y.UndoManager }

export function createEditor(parent: HTMLElement, doc: string, hooks: EditorHooks, opts: { collab?: CollabBinding; readOnly?: boolean; extra?: Extension } = {}): EditorView {
  let depth = 0;
  let cursorTimer: ReturnType<typeof setTimeout>;
  const c = opts.collab;
  if (c) c.undo.on('stack-item-added', (e: any) => { if (e.type === 'undo') hooks.onTextStep(); });
  const ext: Extension[] = [
    lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), dropCursor(),
    // En collaboration, l'annulation ne porte que sur ses propres modifications (Y.UndoManager).
    c ? [yCollab(c.text, c.awareness, { undoManager: c.undo }), keymap.of(yUndoManagerKeymap)] : history(),
    EditorState.readOnly.of(!!opts.readOnly), EditorView.editable.of(!opts.readOnly),
    commentField,
    opts.extra || [],
    indentOnInput(), bracketMatching(), closeBrackets(), highlightSelectionMatches(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(style), directiveLines, lintGutter(),
    autocompletion({ override: [complete], icons: false }),
    search({ top: true }),
    keymap.of([indentWithTab, ...searchKeymap, ...(c ? [] : historyKeymap), ...defaultKeymap]),
    EditorView.lineWrapping,
    placeholder('Collez ou écrivez votre Markdown ici…'),
    EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'fr', 'aria-label': 'Source Markdown' }),
    EditorView.updateListener.of(u => {
      if (u.docChanged) {
        hooks.onChange(u.state.doc.toString());
        if (!c) {
          const d = undoDepth(u.state);
          const fromHistory = u.transactions.some(tr => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
          if (d > depth && !fromHistory) hooks.onTextStep();
          depth = d;
        }
      }
      if (u.selectionSet && u.view.hasFocus) {
        clearTimeout(cursorTimer);
        cursorTimer = setTimeout(() => hooks.onCursor(u.state.doc.lineAt(u.state.selection.main.head).number), 180);
      }
    }),
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        e.preventDefault();
        hooks.onPasteFiles(files, view.state.selection.main.head);
        return true;
      },
      drop(e, view) {
        const files = [...(e.dataTransfer?.files || [])].filter(f => /^(image|video)\//.test(f.type));
        if (!files.length) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        hooks.onPasteFiles(files, pos);
        return true;
      },
    }),
  ];
  return new EditorView({ parent, state: EditorState.create({ doc, extensions: ext }) });
}

/** Remplace tout le texte (restauration d'une version) en une seule étape annulable. */
export function replaceAll(view: EditorView, text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: isolateHistory.of('full') });
}

export function insertAt(view: EditorView, pos: number, text: string) {
  const line = view.state.doc.lineAt(pos);
  // Un bloc s'insère sur sa propre ligne, entouré de lignes vides.
  const block = text.includes('\n') || text.startsWith(':::') || text.startsWith('![');
  if (block) {
    const at = line.text.trim() ? line.to : line.from;
    const pre = line.text.trim() ? '\n\n' : '';
    view.dispatch({ changes: { from: at, insert: pre + text + '\n' }, selection: { anchor: at + pre.length + text.length } });
  } else view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
  view.focus();
}

export function goToLine(view: EditorView, line: number, focus = true) {
  const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  if (focus) view.focus();
}

export function setLint(view: EditorView, diags: Diagnostic[]) {
  const doc = view.state.doc;
  const out: CmDiagnostic[] = diags.filter(d => d.line >= 1 && d.line <= doc.lines).map(d => {
    const l = doc.line(d.line);
    return { from: l.from, to: Math.max(l.from, l.to), severity: d.severity, message: d.message };
  });
  view.dispatch(setDiagnostics(view.state, out));
}

export const editorUndo = (v: EditorView | null) => (v ? undo(v) : false);
export const editorRedo = (v: EditorView | null) => (v ? redo(v) : false);

/** Réécrit la ligne d'ouverture d'un composant avec de nouveaux attributs. */
export function rewriteOpener(view: EditorView, line: number, name: string, attrs: Record<string, string | true>, classes: string[] = [], id?: string) {
  const l = view.state.doc.line(line);
  const m = /^( {0,3}:{3,})\s*([A-Za-z][\w-]*)\s*(\{.*\})?\s*(:{3,})?\s*$/.exec(l.text);
  if (!m) return false;
  const parts = Object.entries(attrs).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => (v === true ? k : `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`));
  if (id) parts.push('#' + id);
  for (const c of classes) parts.push('.' + c);
  const text = `${m[1]}${name}${parts.length ? ` {${parts.join(' ')}}` : ''}${m[4] ? ' ' + m[4] : ''}`;
  view.dispatch({ changes: { from: l.from, to: l.to, insert: text } });
  return true;
}

/* ---------- Passages commentés et suggestions ---------- */

export interface CommentRange { id: string; from: number; to: number; kind: 'comment' | 'suggestion'; replacement?: string; active: boolean }
export const setComments = StateEffect.define<CommentRange[]>();

class SuggestionWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(o: SuggestionWidget) { return o.text === this.text; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-suggest-ins';
    s.textContent = this.text;
    return s;
  }
}

const commentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setComments)) {
      const len = tr.state.doc.length;
      const ranges = e.value.filter(r => r.from >= 0 && r.to <= len && r.from <= r.to).sort((a, b) => a.from - b.from || a.to - b.to);
      const b = new RangeSetBuilder<Decoration>();
      for (const r of ranges) {
        const cls = r.kind === 'suggestion' ? 'cm-suggest-del' : 'cm-comment';
        if (r.to > r.from) b.add(r.from, r.to, Decoration.mark({ class: cls + (r.active ? ' active' : ''), attributes: { 'data-comment': r.id } }));
        if (r.kind === 'suggestion' && r.replacement) b.add(r.to, r.to, Decoration.widget({ widget: new SuggestionWidget(r.replacement), side: 1 }));
      }
      deco = b.finish();
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

/* ---------- Mode suggestion : modifications suivies ---------- */

class DeletedWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(o: DeletedWidget) { return o.text === this.text; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-track-del';
    s.textContent = this.text;
    return s;
  }
  ignoreEvent() { return false; }
}

/** Affiche, par rapport au texte de départ, ce qui est ajouté (souligné) et supprimé (barré). */
export function trackChanges(base: string, onCount: (n: number) => void): Extension {
  const build = (text: string) => {
    const hunks = suggestionHunks(base, text);
    onCount(hunks.length);
    const b = new RangeSetBuilder<Decoration>();
    let delta = 0;
    for (const h of hunks) {
      const at = h.from + delta;
      if (h.to > h.from) b.add(at, at, Decoration.widget({ widget: new DeletedWidget(base.slice(h.from, h.to)), side: -1 }));
      if (h.insert) b.add(at, at + h.insert.length, Decoration.mark({ class: 'cm-track-ins' }));
      delta += h.insert.length - (h.to - h.from);
    }
    return b.finish();
  };
  let timer: ReturnType<typeof setTimeout>;
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view.state.doc.toString()); }
    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      this.decorations = this.decorations.map(u.changes);
      clearTimeout(timer);
      // le calcul des différences attend une courte pause dans la frappe
      timer = setTimeout(() => { this.decorations = build(u.view.state.doc.toString()); u.view.dispatch({}); }, 250);
    }
    destroy() { clearTimeout(timer); }
  }, { decorations: v => v.decorations });
}
