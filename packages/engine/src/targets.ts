// Assemblage des trois sorties : page de lecture, document paginé (Paged.js), diaporama.
// Chacune produit un HTML complet et autonome à partir du même IR et du même thème.

import type { Block, ComponentNode, DocMeta, DocSettings, DocumentIR, RenderEnv, Target, Template } from './types.ts';
import { blocks, component, footnotesHtml, newCtx, tocHtml, type Ctx } from './render.ts';
import { esc, frenchSpacing } from './html.ts';
import { parse, sortDiags, textOf } from './parse.ts';
import { isDark, resolveTheme, schemeCss, themeClasses, tokensCss, type ResolvedTheme } from './themes.ts';
import * as A from './assets.gen.ts';
import type { LibBlock as LibraryBlock } from './collab.ts';
import { pluginCss } from './plugins.ts';

export interface RenderResult {
  html: string;
  ir: DocumentIR;
  theme: ResolvedTheme;
  diagnostics: DocumentIR['diagnostics'];
  slideCount?: number;
}

const PAGE_SIZES: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };

export function render(source: string, settings: Partial<DocSettings>, env: RenderEnv, templates?: Template[], blocks?: (id: string) => LibraryBlock | undefined): RenderResult {
  const theme = resolveTheme(settings, templates);
  const ir = parse(source, { numbering: theme.tokens.layout.numbering, numberingDepth: theme.tokens.layout.numberingDepth, blocks });
  const meta: DocMeta = { ...(settings.meta || {}), ...stripEmpty(ir.meta) };
  if (!meta.title) meta.title = 'Sans titre';
  const target: Target = settings.mode || 'reading';
  const ctx = newCtx(target, env, ir.headings, String(meta.lang || 'fr'));
  let html: string;
  let slideCount: number | undefined;
  if (target === 'slides') {
    const r = slidesDoc(ir, meta, theme, ctx, settings);
    html = r.html; slideCount = r.count;
  } else if (target === 'print') html = printDoc(ir, meta, theme, ctx, settings);
  else html = readingDoc(ir, meta, theme, ctx, settings);
  const diagnostics = sortDiags([...ir.diagnostics, ...dedupe(ctx.diags)]);
  return { html, ir, theme, diagnostics, slideCount };
}

const stripEmpty = (m: DocMeta) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== '' && v != null));
const dedupe = <T extends { line: number; message: string }>(d: T[]) => {
  const seen = new Set<string>();
  return d.filter(x => { const k = x.line + x.message; if (seen.has(k)) return false; seen.add(k); return true; });
};

/* ---------- Commun ---------- */

function headHtml(meta: DocMeta, theme: ResolvedTheme, target: 'reading' | 'print' | 'slides', env: RenderEnv, settings: Partial<DocSettings>, ctx: Ctx, extraCss = ''): string {
  const t = theme.tokens;
  const families = [...new Set([t.fonts.heading, t.fonts.body, t.fonts.mono])];
  const targetCss = target === 'reading' ? A.reading_css : target === 'print' ? A.print_css : A.slides_css;
  const custom = sanitizeCss(settings.customCss || '');
  const local = (settings.fonts || []).filter(f => families.includes(f.family)).map(f => {
    const url = env.resolveAsset(f.file);
    return url ? `@font-face{font-family:"${f.family.replace(/["\\<>]/g, '')}";font-style:${f.style === 'italic' ? 'italic' : 'normal'};font-weight:${/^\d{3}( \d{3})?$/.test(f.weight || '') ? f.weight : '100 900'};font-display:block;src:url("${url.replace(/"/g, '%22')}")}` : '';
  }).join('');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Document Studio">
<title>${esc(meta.title)}</title>
${meta.author ? `<meta name="author" content="${esc(meta.author)}">` : ''}
${meta.subtitle ? `<meta name="description" content="${esc(meta.subtitle)}">` : ''}
<style>${env.fontCss(families)}${local}</style>
${ctx.math && env.katexCss ? `<style>${env.katexCss}</style>` : ''}
<style>${tokensCss(t, target)}
${target === 'reading' ? schemeCss(t) : ''}
${A.content_css}
${A.code_css}
${targetCss}
${extraCss}</style>
${theme.css ? `<style data-template="${esc(theme.template.id)}">${theme.css}</style>` : ''}
${ctx.plugins.size ? `<style data-plugins>${pluginCss(ctx.plugins, sanitizeCss)}</style>` : ''}
${custom ? `<style data-custom>${custom}</style>` : ''}`;
}

/** CSS personnalisé : interdit les imports, ressources distantes et sorties de balise. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/<\/?\s*style/gi, '')
    .replace(/@import[^;]*;?/gi, '/* @import retiré */')
    .replace(/url\(\s*(['"]?)(?!data:|#)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript:/gi, '');
}

function bridge(env: RenderEnv, target: Target): string {
  return env.context === 'preview' ? `<script>window.__SD_TARGET=${JSON.stringify(target)};${A.bridge_js}</script>` : '';
}

const metaLine = (meta: DocMeta, ctx: Ctx) => [meta.author, meta.organization, meta.date, meta.version ? `v${meta.version}` : '']
  .filter(Boolean).map(v => `<span>${txt(String(v), ctx)}</span>`).join('');

const txt = (s: string, ctx: Ctx) => (ctx.french ? frenchSpacing(esc(s)) : esc(s));

function findCover(list: Block[]): ComponentNode | undefined {
  return list.find((b: any) => b.type === 'component' && b.name === 'cover') as ComponentNode | undefined;
}

function hasToc(list: Block[]): boolean {
  let found = false;
  const walk = (l: any[]) => l.forEach(b => { if (b.type === 'component' && b.name === 'toc') found = true; if (b.children) walk(b.children); });
  walk(list);
  return found;
}

/* ---------- Lecture ---------- */

function readingDoc(ir: DocumentIR, meta: DocMeta, theme: ResolvedTheme, ctx: Ctx, settings: Partial<DocSettings>): string {
  const r = theme.reading;
  const body = blocks(ir.blocks.slice(ir.titleBlocks), ctx) + footnotesHtml(ctx);
  const cover = findCover(ir.blocks);
  const head = cover
    ? `<header class="sd-doc-head sd-doc-head-custom">${blocks(cover.children, ctx)}</header>`
    : `<header class="sd-doc-head">${meta.organization ? `<div class="sd-eyebrow">${txt(String(meta.organization), ctx)}</div>` : ''}<h1 class="sd-title">${txt(String(meta.title), ctx)}</h1>${meta.subtitle ? `<p class="sd-subtitle">${txt(String(meta.subtitle), ctx)}</p>` : ''}${metaLine(meta, ctx) ? `<div class="sd-meta">${metaLine(meta, ctx)}</div>` : ''}</header>`;
  const toc = r.toc !== 'none' && ir.headings.length >= 2 ? tocHtml(ir.headings, 3, ctx, 'sd-toc') : '';
  const words = textOf({ children: ir.blocks }).split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 230));
  const cls = `sd sd-reading ${themeClasses(theme.tokens)} sd-toc-${toc ? r.toc : 'none'}`;
  return `<!doctype html>
<html lang="${esc(meta.lang || 'fr')}" data-scheme="${esc(r.colorScheme)}" data-alt="${isDark(theme.tokens.colors.bg) ? 'light' : 'dark'}">
<head>${headHtml(meta, theme, 'reading', ctx.env, settings, ctx)}</head>
<body class="${cls}">
<a class="sd-skip" href="#sd-content">Aller au contenu</a>
<div class="sd-topbar" role="banner">
  ${r.progress ? '<div class="sd-progress" aria-hidden="true"><span></span></div>' : ''}
  <div class="sd-topbar-title">${txt(String(meta.title), ctx)}</div>
  <div class="sd-topbar-tools">
    ${toc ? '<button class="sd-btn sd-toc-toggle" type="button" aria-label="Sommaire" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>' : ''}
    ${r.search ? '<button class="sd-btn sd-search-toggle" type="button" aria-label="Rechercher (Ctrl+K)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>' : ''}
    <button class="sd-btn sd-width-toggle" type="button" aria-label="Largeur de lecture"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg></button>
    <button class="sd-btn sd-scheme-toggle" type="button" aria-label="Mode clair ou sombre"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button>
  </div>
  ${r.search ? '<div class="sd-search" hidden><input type="search" placeholder="Rechercher dans le document" aria-label="Rechercher dans le document"><span class="sd-search-count"></span><button class="sd-btn sd-search-prev" type="button" aria-label="Résultat précédent">↑</button><button class="sd-btn sd-search-next" type="button" aria-label="Résultat suivant">↓</button></div>' : ''}
</div>
<div class="sd-layout">
  ${toc ? `<aside class="sd-toc-wrap">${toc}</aside>` : ''}
  <main class="sd-main" id="sd-content">
    ${head}
    <article class="sd-body">${body}</article>
    <footer class="sd-doc-foot"><span>${txt(String(meta.title), ctx)}</span><span>${words.toLocaleString('fr-FR')} mots · ${minutes} min de lecture</span></footer>
  </main>
</div>
${bridge(ctx.env, 'reading')}
<script>${A.reading_js}</script>
</body>
</html>`;
}

/* ---------- Impression ---------- */

function marginContent(tpl: string, meta: DocMeta): string {
  if (!tpl) return '""';
  const parts: string[] = [];
  const re = /\{(page|pages|section|title|subtitle|author|date|organization|version)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const lit = (s: string) => s && parts.push(`"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
  while ((m = re.exec(tpl))) {
    lit(tpl.slice(last, m.index));
    if (m[1] === 'page') parts.push('counter(page)');
    else if (m[1] === 'pages') parts.push('counter(pages)');
    else if (m[1] === 'section') parts.push('string(sd-section)');
    else lit(String(meta[m[1]] ?? ''));
    last = re.lastIndex;
  }
  lit(tpl.slice(last));
  return parts.join(' ') || '""';
}

function printDoc(ir: DocumentIR, meta: DocMeta, theme: ResolvedTheme, ctx: Ctx, settings: Partial<DocSettings>): string {
  const p = theme.page;
  const t = theme.tokens;
  let [w, h] = p.size === 'custom' ? [p.width, p.height] : PAGE_SIZES[p.size] || PAGE_SIZES.A4;
  if (p.orientation === 'landscape') [w, h] = [h, w];
  const box = (pos: string, tpl: string) => `@${pos}{content:${marginContent(tpl, meta)}}`;
  const pageCss = `@page{size:${w}mm ${h}mm;margin:${p.margins.top}mm ${p.margins.right}mm ${p.margins.bottom}mm ${p.margins.left}mm;
${box('top-left', p.header.left)}${box('top-center', p.header.center)}${box('top-right', p.header.right)}
${box('bottom-left', p.footer.left)}${box('bottom-center', p.footer.center)}${box('bottom-right', p.footer.right)}}
@page sd-cover{margin:0;@top-left{content:none}@top-center{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-center{content:none}@bottom-right{content:none}}
${p.headerOnFirst ? '' : '@page:first{@top-left{content:none}@top-center{content:none}@top-right{content:none}}'}
:root{--sd-page-w:${w}mm;--sd-page-h:${h}mm;--sd-margin-l:${p.margins.left}mm;--sd-margin-r:${p.margins.right}mm;--sd-margin-t:${p.margins.top}mm;--sd-margin-b:${p.margins.bottom}mm}
${p.breakBeforeH1 ? '.sd-body h1{break-before:page}' : ''}
${p.columns === 2 ? '.sd-body{column-count:2;column-gap:8mm}' : ''}`;

  const body = blocks(ir.blocks.slice(ir.titleBlocks), ctx) + footnotesHtml(ctx);
  const coverNode = findCover(ir.blocks);
  const coverKind = t.layout.cover;
  let cover = '';
  if (coverNode || coverKind !== 'none') {
    const inner = coverNode
      ? `<div class="sd-cover-custom">${blocks(coverNode.children, ctx)}</div>`
      : `<div class="sd-cover-top">${meta.organization ? `<div class="sd-eyebrow">${txt(String(meta.organization), ctx)}</div>` : ''}</div>
<div class="sd-cover-main"><h1 class="sd-title">${txt(String(meta.title), ctx)}</h1>${meta.subtitle ? `<p class="sd-subtitle">${txt(String(meta.subtitle), ctx)}</p>` : ''}</div>
<div class="sd-cover-foot">${metaLine(meta, ctx)}</div>`;
    const bg = coverNode && typeof coverNode.attrs.bg === 'string' ? ` sd-bg-${esc(coverNode.attrs.bg)}` : '';
    // Sans auteur, organisation, date ni version, la couverture n'a rien à montrer en pied de page.
    const bare = !coverNode && !metaLine(meta, ctx) && !meta.organization ? ' sd-cover-nometa' : '';
    cover = `<section class="sd-cover sd-cover-${coverNode ? 'custom' : coverKind}${bg}${bare}">${inner}</section>`;
  } else {
    cover = `<header class="sd-doc-head">${meta.organization ? `<div class="sd-eyebrow">${txt(String(meta.organization), ctx)}</div>` : ''}<h1 class="sd-title">${txt(String(meta.title), ctx)}</h1>${meta.subtitle ? `<p class="sd-subtitle">${txt(String(meta.subtitle), ctx)}</p>` : ''}<div class="sd-meta">${metaLine(meta, ctx)}</div></header>`;
  }
  const toc = t.layout.toc && !hasToc(ir.blocks) && ir.headings.filter(x => x.depth <= 2).length >= 3
    ? `<section class="sd-toc-page">${tocHtml(ir.headings, 2, ctx, 'sd-toc-print')}</section>` : '';

  const paged = ctx.env.pagedjs.inline
    ? `<script>${ctx.env.pagedjs.inline.replace(/<\/script/gi, '<\\/script')}</script>`
    : `<script src="${esc(ctx.env.pagedjs.src || '')}"></script>`;
  return `<!doctype html>
<html lang="${esc(meta.lang || 'fr')}">
<head>${headHtml(meta, theme, 'print', ctx.env, settings, ctx, pageCss)}
<script>window.PagedConfig={auto:false};</script>
${paged}
</head>
<body class="sd sd-print ${themeClasses(t)}${p.repeatTableHeaders ? ' sd-repeat-thead' : ''}">
${cover}
${toc}
<article class="sd-body">${body}</article>
${bridge(ctx.env, 'print')}
<script>${A.print_js}</script>
</body>
</html>`;
}

/* ---------- Diaporama ---------- */

export const SLIDE_SIZES: Record<string, [number, number]> = { '16:9': [1920, 1080], '4:3': [1440, 1080], '16:10': [1728, 1080] };

interface SlideDraft { blocks: Block[]; layout?: string; bg?: string; image?: string; notes: Block[]; line: number; classes: string[] }

function splitSlides(list: Block[], level: number, rules: boolean, manual: boolean): SlideDraft[] {
  const slides: SlideDraft[] = [];
  let cur: SlideDraft | null = null;
  const start = (line: number) => { cur = { blocks: [], notes: [], line, classes: [] }; slides.push(cur); return cur; };
  const lineOf = (b: any) => b.position?.start?.line ?? b.line ?? 0;
  for (const b of list as any[]) {
    if (b.type === 'component' && b.name === 'cover') continue;
    if (b.type === 'component' && b.name === 'slide') {
      const s = start(b.line);
      s.layout = typeof b.attrs.layout === 'string' ? b.attrs.layout : undefined;
      s.bg = typeof b.attrs.bg === 'string' ? b.attrs.bg : undefined;
      s.image = typeof b.attrs.image === 'string' ? b.attrs.image : undefined;
      s.classes = b.classes;
      for (const c of b.children) (c.type === 'component' && c.name === 'notes' ? s.notes : s.blocks).push(c);
      cur = null;
      continue;
    }
    if (b.type === 'component' && b.name === 'pagebreak') { cur = null; continue; }
    if (rules && b.type === 'thematicBreak') { cur = null; continue; }
    if (!manual && b.type === 'heading' && b.depth <= level) { start(lineOf(b)).blocks.push(b); continue; }
    if (b.type === 'component' && b.name === 'notes') { (cur || start(lineOf(b))).notes.push(b); continue; }
    (cur || start(lineOf(b))).blocks.push(b);
  }
  return slides.filter(s => s.blocks.length || s.notes.length);
}

function autoLayout(s: SlideDraft): string {
  if (s.layout) return s.layout;
  const bl = s.blocks as any[];
  const head = bl[0]?.type === 'heading' ? bl[0] : null;
  const rest = head ? bl.slice(1) : bl;
  if (head && rest.length === 0) return 'section';
  if (head?.depth === 1 && rest.length <= 1 && rest.every(r => r.type === 'paragraph' && textOf(r).length < 160)) return 'section';
  if (!head && rest.length === 1 && rest[0].type === 'paragraph' && textOf(rest[0]).length < 180 && !rest[0].children.some((c: any) => c.type === 'image')) return 'statement';
  if (!head && rest.length === 1 && rest[0].type === 'component' && rest[0].name === 'pullquote') return 'statement';
  const onlyImages = rest.length > 0 && rest.every(r => (r.type === 'paragraph' && r.children.every((c: any) => c.type === 'image' || (c.type === 'text' && !c.value.trim()))) || (r.type === 'component' && r.name === 'image'));
  if (onlyImages) return 'image';
  return 'default';
}

function slidesDoc(ir: DocumentIR, meta: DocMeta, theme: ResolvedTheme, ctx: Ctx, settings: Partial<DocSettings>): { html: string; count: number } {
  const s = theme.slides;
  const [W, H] = s.aspect === 'custom' ? [s.width, s.height] : SLIDE_SIZES[s.aspect] || SLIDE_SIZES['16:9'];
  const level = s.split === 'manual' ? 0 : Number(s.split.slice(1));
  const drafts = splitSlides(ir.blocks.slice(ir.titleBlocks), level, s.ruleSplits, s.split === 'manual');
  const coverNode = findCover(ir.blocks);
  const out: string[] = [];
  const footTitle = txt(String(meta.title), ctx);
  const slideHtml = (inner: string, layout: string, idx: number, extra: { bg?: string; image?: string; notes?: string; line?: number; classes?: string[] } = {}) => {
    const bgCls = extra.bg && ['light', 'dark', 'primary', 'accent', 'surface'].includes(extra.bg) ? ` sd-bg-${extra.bg}` : '';
    const custom = extra.bg && /^#[0-9a-f]{3,8}$/i.test(extra.bg) ? `--sd-custom-bg:${extra.bg};` : '';
    const img = extra.image ? ctx.env.resolveAsset(extra.image) : null;
    if (extra.image && !img) ctx.diags.push({ severity: 'warning', line: extra.line || 0, code: 'missing-asset', message: `Image de fond introuvable : ${extra.image}` });
    const style = (custom ? custom : '') + (img ? `--sd-slide-image:url("${img.replace(/"/g, '%22')}");` : '');
    return `<section class="sd-slide sd-layout-${esc(layout)}${bgCls}${custom ? ' sd-bg-custom' : ''}${img ? ' sd-has-image' : ''}${(extra.classes || []).map(c => ' ' + esc(c)).join('')}" data-index="${idx}"${extra.line && ctx.lineAttrs ? ` data-line="${extra.line}"` : ''}${style ? ` style="${style}"` : ''}>
<div class="sd-slide-inner">${inner}</div>
${s.numbers && layout !== 'cover' ? `<footer class="sd-slide-foot"><span class="sd-slide-foot-title">${footTitle}</span><span class="sd-slide-num">${idx + 1}</span></footer>` : ''}
${extra.notes ? `<aside class="sd-notes">${extra.notes}</aside>` : ''}
</section>`;
  };
  if (s.cover) {
    const inner = coverNode ? blocks(coverNode.children, ctx)
      : `${meta.organization ? `<div class="sd-eyebrow">${txt(String(meta.organization), ctx)}</div>` : ''}<h1 class="sd-title">${txt(String(meta.title), ctx)}</h1>${meta.subtitle ? `<p class="sd-subtitle">${txt(String(meta.subtitle), ctx)}</p>` : ''}<div class="sd-meta">${metaLine(meta, ctx)}</div>`;
    out.push(slideHtml(inner, 'cover', 0, { bg: coverNode && typeof coverNode.attrs.bg === 'string' ? coverNode.attrs.bg : undefined }));
  }
  for (const d of drafts) {
    const layout = autoLayout(d);
    let inner = blocks(d.blocks, ctx);
    if (layout === 'split') {
      // split : premier bloc (ou titre + premier bloc) à gauche, le reste à droite
      const bl = d.blocks as any[];
      const cut = bl[0]?.type === 'heading' ? 2 : 1;
      inner = `<div class="sd-split-a">${blocks(bl.slice(0, cut), ctx)}</div><div class="sd-split-b">${blocks(bl.slice(cut), ctx)}</div>`;
    }
    const notes = d.notes.length ? d.notes.map((n: any) => blocks(n.children || [n], ctx)).join('') : '';
    out.push(slideHtml(inner, layout, out.length, { bg: d.bg, image: d.image, notes, line: d.line, classes: d.classes }));
  }
  if (s.closing) out.push(slideHtml(`<h1 class="sd-title">${txt(s.closing, ctx)}</h1>${metaLine(meta, ctx) ? `<div class="sd-meta">${metaLine(meta, ctx)}</div>` : ''}`, 'closing', out.length));
  const fn = footnotesHtml(ctx);
  if (fn) out.push(slideHtml(fn, 'default', out.length));
  if (!out.length) out.push(slideHtml('<p class="sd-empty">Document vide.</p>', 'statement', 0));

  const sizeCss = `:root{--sd-slide-w:${W}px;--sd-slide-h:${H}px}
@page{size:${W}px ${H}px;margin:0}`;
  return {
    count: out.length,
    html: `<!doctype html>
<html lang="${esc(meta.lang || 'fr')}">
<head>${headHtml(meta, theme, 'slides', ctx.env, settings, ctx, sizeCss)}</head>
<body class="sd sd-slides ${themeClasses(theme.tokens)} sd-transition-${esc(s.transition)}">
<div class="sd-stage"><div class="sd-deck" style="width:${W}px;height:${H}px">
${out.join('\n')}
</div></div>
${s.progress ? '<div class="sd-deck-progress" aria-hidden="true"><span></span></div>' : ''}
<div class="sd-deck-hint" aria-hidden="true">← → naviguer · F plein écran · P présentateur · O vue d'ensemble</div>
${bridge(ctx.env, 'slides')}
<script>${A.slides_js}</script>
</body>
</html>`,
  };
}
