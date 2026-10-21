// Analyse de blocs StudioMD. Découpe la source en segments markdown et en composants
// imbriqués (pile), sans jamais toucher au contenu des blocs de code.
// La grammaire complète est dans docs/studiomd.md.

import type { Attrs, Diagnostic } from './types.ts';

export interface MdSegment { kind: 'md'; text: string; line: number }
export interface CompSegment {
  kind: 'comp';
  given: string;
  attrs: Attrs;
  classes: string[];
  id?: string;
  line: number;
  endLine: number;
  children: Segment[];
  body: string;        // texte brut entre ouverture et fermeture
  closed: boolean;
}
export type Segment = MdSegment | CompSegment;

const OPEN = /^ {0,3}:{3,}\s*([A-Za-z][\w-]*)\s*(\{.*\})?\s*(:{3,})?\s*$/;
const CLOSE = /^ {0,3}:{3,}\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export interface AttrResult { attrs: Attrs; classes: string[]; id?: string; errors: string[] }

/** `{type="info" title='À retenir' count=2 .large #intro open}` */
export function parseAttrs(src: string | undefined): AttrResult {
  const r: AttrResult = { attrs: {}, classes: [], errors: [] };
  if (!src) return r;
  const s = src.trim().replace(/^\{/, '').replace(/\}$/, '');
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  while (i < s.length) {
    ws();
    if (i >= s.length) break;
    const c = s[i];
    if (c === '.' || c === '#') {
      const m = /^[.#]([\w-]+)/.exec(s.slice(i));
      if (!m) { r.errors.push(`« ${c} » sans nom`); i++; continue; }
      if (c === '.') r.classes.push(m[1]); else r.id = m[1];
      i += m[0].length;
      continue;
    }
    const km = /^([A-Za-z_][\w-]*)/.exec(s.slice(i));
    if (!km) { r.errors.push(`caractère inattendu « ${c} »`); i++; continue; }
    const key = km[1];
    i += key.length;
    ws();
    if (s[i] !== '=') { r.attrs[key] = true; continue; }
    i++; ws();
    const q = s[i];
    if (q === '"' || q === "'") {
      i++;
      let v = '';
      let closed = false;
      while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) { v += s[i + 1]; i += 2; continue; }
        if (s[i] === q) { closed = true; i++; break; }
        v += s[i++];
      }
      if (!closed) r.errors.push(`guillemet non fermé pour « ${key} »`);
      r.attrs[key] = v;
    } else {
      const vm = /^[^\s}]+/.exec(s.slice(i));
      r.attrs[key] = vm ? vm[0] : '';
      i += vm ? vm[0].length : 0;
    }
  }
  return r;
}

/**
 * @param src     source sans front matter
 * @param offset  nombre de lignes retirées avant `src` (pour des numéros de ligne absolus)
 * @param verbatim noms de composants dont le contenu n'est pas analysé (données, brut)
 */
export function scan(src: string, offset: number, verbatim: (name: string) => boolean, diags: Diagnostic[]): Segment[] {
  const lines = src.split('\n');
  const root: Segment[] = [];
  const stack: { seg: CompSegment; out: Segment[]; bodyStart: number }[] = [];
  let buf: string[] = [];
  let bufLine = offset + 1;
  let fence: { ch: string; len: number } | null = null;
  let rawUntilClose = false;

  const out = () => (stack.length ? stack[stack.length - 1].out : root);
  const flush = (nextLine: number) => {
    if (buf.some(l => l.trim())) out().push({ kind: 'md', text: buf.join('\n'), line: bufLine });
    buf = [];
    bufLine = nextLine;
  };
  const close = (idx: number, closed: boolean) => {
    const top = stack.pop()!;
    top.seg.endLine = offset + idx + 1;
    top.seg.closed = closed;
    top.seg.body = lines.slice(top.bodyStart, idx).join('\n');
    out().push(top.seg);
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const abs = offset + idx + 1;

    if (rawUntilClose) {
      if (CLOSE.test(line)) { rawUntilClose = false; close(idx, true); bufLine = abs + 1; }
      continue;
    }
    if (fence) {
      buf.push(line);
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && line.trim() === m[1]) fence = null;
      continue;
    }
    const fm = FENCE.exec(line);
    if (fm) { fence = { ch: fm[1][0], len: fm[1].length }; buf.push(line); continue; }

    const om = OPEN.exec(line);
    if (om) {
      flush(abs + 1);
      const a = parseAttrs(om[2]);
      for (const e of a.errors) diags.push({ severity: 'warning', message: `Attributs de « ${om[1]} » : ${e}`, line: abs, code: 'bad-attribute' });
      const seg: CompSegment = { kind: 'comp', given: om[1], attrs: a.attrs, classes: a.classes, id: a.id, line: abs, endLine: abs, children: [], body: '', closed: true };
      if (om[3]) { out().push(seg); continue; }              // forme courte : :::pagebreak :::
      stack.push({ seg, out: seg.children, bodyStart: idx + 1 });
      if (verbatim(om[1].toLowerCase())) rawUntilClose = true;
      continue;
    }
    if (CLOSE.test(line)) {
      flush(abs + 1);
      if (stack.length) close(idx, true);
      else {
        diags.push({ severity: 'warning', message: 'Fermeture « ::: » sans composant ouvert : la ligne est affichée telle quelle.', line: abs, code: 'stray-close' });
        out().push({ kind: 'md', text: '\\' + line.trim(), line: abs });
      }
      continue;
    }
    if (/^ {0,3}\\:{3,}/.test(line)) { buf.push(line); continue; }   // échappement \:::
    buf.push(line);
  }
  if (fence) diags.push({ severity: 'warning', message: 'Bloc de code non fermé : il court jusqu\'à la fin du document.', line: bufLine, code: 'unclosed-fence' });
  flush(offset + lines.length + 1);
  while (stack.length) {
    const top = stack[stack.length - 1].seg;
    diags.push({ severity: 'error', message: `Composant « ${top.given} » jamais fermé : ajoutez une ligne « ::: ». Il a été fermé en fin de document.`, line: top.line, code: 'unclosed-component' });
    close(lines.length, false);
  }
  return root;
}
