// Source -> IR : front matter, découpage StudioMD, markdown (CommonMark + GFM + maths),
// validation des composants, identifiants et numéros de titres, inventaire des ressources.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import YAML from 'yaml';
import type { Root, RootContent, Heading as MdHeading } from 'mdast';
import type { Block, ComponentNode, Diagnostic, DocMeta, DocumentIR, Heading } from './types.ts';
import { scan, type Segment } from './scanner.ts';
import { BY_NAME, isVerbatim } from './registry.ts';
import type { LibBlock as LibraryBlock } from './collab.ts';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Texte brut d'un nœud mdast. */
export function textOf(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string' && node.type !== 'html') return node.value;
  if (node.type === 'image') return node.alt || '';
  if (Array.isArray(node.children)) return node.children.map(textOf).join('');
  return '';
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function splitFrontmatter(src: string, diags: Diagnostic[]): { meta: DocMeta; body: string; lines: number } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return { meta: {}, body: src, lines: 0 };
  const lines = m[0].split('\n').length - (m[0].endsWith('\n') ? 1 : 0);
  let meta: DocMeta = {};
  try {
    const v = YAML.parse(m[1]);
    if (v && typeof v === 'object' && !Array.isArray(v)) meta = v;
    else diags.push({ severity: 'warning', message: 'Le front matter doit être une liste de clés « clé: valeur ».', line: 1, code: 'bad-frontmatter' });
  } catch (e: any) {
    const line = (e.linePos?.[0]?.line ?? 0) + 1;
    diags.push({ severity: 'error', message: `Front matter illisible : ${String(e.message).split('\n')[0]}`, line, code: 'bad-frontmatter' });
  }
  for (const k of Object.keys(meta)) if (meta[k] instanceof Date) meta[k] = (meta[k] as Date).toISOString().slice(0, 10);
  return { meta, body: src.slice(m[0].length), lines };
}

/** Décale les positions d'un arbre mdast analysé isolément. */
function shift(node: any, by: number) {
  if (node.position) { node.position.start.line += by; node.position.end.line += by; }
  if (node.children) for (const c of node.children) shift(c, by);
}

function parseMarkdown(text: string, line: number): RootContent[] {
  const tree = processor.parse(text) as Root;
  processor.runSync(tree);
  for (const c of tree.children) shift(c, line - 1);
  return tree.children;
}

function validate(node: ComponentNode, parentName: string | null, diags: Diagnostic[]) {
  const entry = BY_NAME.get(node.given.toLowerCase());
  if (!entry) {
    const near = [...BY_NAME.keys()].find(k => lev(k, node.given.toLowerCase()) <= 2);
    diags.push({
      severity: 'warning', line: node.line, code: 'unknown-component',
      message: `Composant inconnu « ${node.given} »${near ? ` (vouliez-vous « ${near} » ?)` : ''} : son contenu est affiché dans un cadre neutre.`,
    });
    return;
  }
  const { spec } = entry;
  if (spec.parent && parentName !== spec.parent)
    diags.push({ severity: 'warning', line: node.line, code: 'misplaced-component', message: `« ${node.given} » doit être placé dans un bloc « ${spec.parent} ».` });
  for (const [k, v] of Object.entries(node.attrs)) {
    const a = spec.attrs[k];
    if (!a) { diags.push({ severity: 'info', line: node.line, code: 'unknown-attribute', message: `« ${node.given} » n'a pas d'attribut « ${k} » : ignoré.` }); continue; }
    if (a.type === 'enum' && a.values && !a.values.includes(String(v)))
      diags.push({ severity: 'warning', line: node.line, code: 'bad-attribute', message: `« ${k} » vaut « ${v} » ; valeurs possibles : ${a.values.join(', ')}.` });
    if (a.type === 'number' && isNaN(Number(v)))
      diags.push({ severity: 'warning', line: node.line, code: 'bad-attribute', message: `« ${k} » attend un nombre, pas « ${v} ».` });
  }
  for (const [k, a] of Object.entries(spec.attrs))
    if (a.required && node.attrs[k] === undefined)
      diags.push({ severity: 'error', line: node.line, code: 'missing-attribute', message: `« ${node.given} » : l'attribut « ${k} » est obligatoire.` });
  if (spec.content === 'none' && node.children.length)
    diags.push({ severity: 'info', line: node.line, code: 'unexpected-content', message: `« ${node.given} » n'attend pas de contenu : le texte qu'il contient est affiché à la suite.` });
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function build(segs: Segment[], parentName: string | null, diags: Diagnostic[], opts: ParseOptions = {}, depth = 0): Block[] {
  const out: Block[] = [];
  for (const s of segs) {
    if (s.kind === 'md') { out.push(...parseMarkdown(s.text, s.line)); continue; }
    const entry = BY_NAME.get(s.given.toLowerCase());
    const node: ComponentNode = {
      type: 'component', name: entry ? entry.spec.name : s.given.toLowerCase(), given: s.given,
      attrs: { ...(entry?.implied || {}), ...s.attrs }, classes: s.classes, id: s.id,
      children: [], known: !!entry, line: s.line, endLine: s.endLine,
    };
    if (entry?.spec.content === 'data') {
      try {
        node.data = YAML.parse(s.body);
      } catch (e: any) {
        diags.push({ severity: 'error', line: s.line + 1 + (e.linePos?.[0]?.line ?? 1) - 1, code: 'bad-data', message: `Données de « ${s.given} » illisibles : ${String(e.message).split('\n')[0]}` });
        node.raw = s.body;
      }
    } else if (entry?.spec.content === 'raw') {
      node.raw = s.body;
    } else if (node.name === 'include') {
      node.children = includeBlock(node, diags, opts, depth);
    } else {
      node.children = build(s.children, node.name, diags, opts, depth);
    }
    validate(node, parentName, diags);
    out.push(node);
  }
  return out;
}

/** Contenu d'un bloc inclus : analysé à part, toutes ses lignes ramenées à celle de l'inclusion. */
function includeBlock(node: ComponentNode, diags: Diagnostic[], opts: ParseOptions, depth: number): Block[] {
  const id = typeof node.attrs.block === 'string' ? node.attrs.block : '';
  const b = id ? opts.blocks?.(id) : undefined;
  const want = node.attrs.version ? Number(node.attrs.version) : undefined;
  const v = b ? (want ? b.versions.find(x => x.version === want) : b.versions[b.versions.length - 1]) : undefined;
  if (!id) return [];
  if (!v || depth > 3) {
    diags.push({ severity: 'warning', line: node.line, code: 'missing-block', message: depth > 3 ? `Bloc « ${id} » : inclusions imbriquées trop profondes.` : `Bloc « ${id} »${want ? ` (version ${want})` : ''} introuvable dans la bibliothèque.` });
    node.data = { missing: true };
    return [];
  }
  node.data = { name: b!.name, version: v.version, latest: b!.versions[b!.versions.length - 1].version };
  const inner: Diagnostic[] = [];
  const kids = build(scan(v.markdown, 0, isVerbatim, inner), null, inner, opts, depth + 1);
  const pin = (n: any) => { if (n.position) { n.position.start.line = node.line; n.position.end.line = node.line; } if (n.line) { n.line = node.line; n.endLine = node.line; } (n.children || []).forEach(pin); };
  kids.forEach(pin);
  if (inner.some(d => d.severity !== 'info')) diags.push({ severity: 'warning', line: node.line, code: 'block-problems', message: `Le bloc « ${b!.name} » contient ${inner.length} problème(s) : corrigez-le dans la bibliothèque.` });
  return kids;
}

function walk(blocks: Block[], fn: (n: any) => void) {
  for (const b of blocks) { fn(b); if ((b as any).children) walk((b as any).children, fn); }
}

export interface ParseOptions { numbering?: boolean; numberingDepth?: number; blocks?: (id: string) => LibraryBlock | undefined }

export function parse(source: string, opts: ParseOptions = {}): DocumentIR {
  const diags: Diagnostic[] = [];
  const src = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const fm = splitFrontmatter(src, diags);
  const segs = scan(fm.body, fm.lines, isVerbatim, diags);
  const blocks = build(segs, null, diags, opts);

  // Titres : identifiants uniques, numérotation, plan.
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  const counters = [0, 0, 0, 0, 0, 0];
  const depthMax = opts.numberingDepth ?? 3;
  let lastDepth = 0;
  let appendixCount = 0;
  const assets: string[] = [];
  const visit = (list: Block[], appendixTop: boolean) => {
    for (const b of list) {
      const n: any = b;
      if (n.type === 'component' && n.name === 'appendix') { visit(n.children, true); continue; }
      if (n.type === 'heading') {
        const h = n as MdHeading;
        const text = textOf(h).trim();
        // Un identifiant ne commence jamais par un chiffre : « #1-contexte » est un sélecteur CSS invalide
        // (Paged.js s'en sert pour les numéros de page du sommaire, et la pagination échouerait).
        let id = slugify(text);
        if (/^\d/.test(id)) id = 's-' + id;
        const k = used.get(id) || 0;
        used.set(id, k + 1);
        if (k) id = `${id}-${k + 1}`;
        let number: string | undefined;
        if (appendixTop) {
          number = 'Annexe ' + String.fromCharCode(65 + appendixCount++);
        } else if (opts.numbering && h.depth <= depthMax) {
          counters[h.depth - 1]++;
          for (let i = h.depth; i < 6; i++) counters[i] = 0;
          const first = counters.findIndex(c => c > 0);
          number = counters.slice(first < 0 ? 0 : first, h.depth).join('.');
        }
        if (lastDepth && h.depth > lastDepth + 1)
          diags.push({ severity: 'info', line: h.position?.start.line ?? 0, code: 'heading-skip', message: `Titre de niveau ${h.depth} après un niveau ${lastDepth} : un niveau est sauté.` });
        lastDepth = h.depth;
        h.data = { ...(h.data || {}), id, number } as any;
        headings.push({ id, depth: h.depth, text, line: h.position?.start.line ?? 0, number });
      }
      if (n.children) visit(n.children, false);
    }
  };
  visit(blocks, false);

  walk(blocks, (n: any) => {
    if (n.type === 'image' && n.url) assets.push(n.url);
    if (n.type === 'component' && typeof n.attrs?.src === 'string') assets.push(n.attrs.src);
    if (n.type === 'component' && typeof n.attrs?.poster === 'string') assets.push(n.attrs.poster);
    if (n.type === 'component' && typeof n.attrs?.image === 'string') assets.push(n.attrs.image);
    if (n.type === 'html' && !/^\s*<!--[\s\S]*-->\s*$/.test(n.value) && !/^\s*<br\s*\/?>\s*$/i.test(n.value))
      diags.push({ severity: 'warning', line: n.position?.start.line ?? 0, code: 'raw-html', message: 'HTML brut non interprété (sécurité) : il est affiché comme du texte. Utilisez un composant StudioMD.' });
  });

  // Titre déduit : premier titre de niveau 1 s'il n'y a pas de « title » dans le front matter.
  const meta: DocMeta = { ...fm.meta };
  let titleBlocks = 0;
  const first = blocks[0] as any;
  if (!meta.title && first?.type === 'heading' && first.depth === 1) {
    meta.title = textOf(first).trim();
    titleBlocks = 1;
    const next = blocks[1] as any;
    if (!meta.subtitle && next && (next.type === 'blockquote' || next.type === 'paragraph')) {
      const t = textOf(next).trim();
      if (t.length <= 240) { meta.subtitle = t; titleBlocks = 2; }
    }
  }
  if (titleBlocks) headings.shift();   // le titre déduit n'entre pas dans le sommaire
  if (meta.title !== undefined) meta.title = String(meta.title);

  return { meta, blocks, headings, assets: [...new Set(assets)], diagnostics: sortDiags(diags), frontmatterLines: fm.lines, titleBlocks } as DocumentIR;
}

export const sortDiags = (d: Diagnostic[]) => d.sort((a, b) => a.line - b.line);
