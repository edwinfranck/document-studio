// IR -> fragment HTML. Un seul moteur pour les trois cibles ; chaque composant décide
// de son comportement selon la cible (interactif en lecture, statique à l'impression).

import katex from 'katex';
import type { Block, ComponentNode, Diagnostic, Heading, RenderEnv, Target } from './types.ts';
import { attr, esc, frenchSpacing, highlight, LANGUAGE_LABELS, safeColor, safeHref, safeLength, safeSrc } from './html.ts';
import { parseAttrs } from './scanner.ts';
import { textOf } from './parse.ts';

export interface Ctx {
  target: Target;
  env: RenderEnv;
  diags: Diagnostic[];
  headings: Heading[];
  french: boolean;
  footnotes: Map<string, { n: number; html?: string }>;
  footnoteDefs: Map<string, any>;
  math: boolean;            // le document contient des formules
  lineAttrs: boolean;       // data-line pour la synchronisation source/aperçu
  tabsSeq: number;
}

export const ICONS: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  note: '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  tip: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
  success: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  warning: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
  danger: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z"/><path d="M12 8v4M12 16h.01"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3-3a2 2 0 0 0-3 0L6 21"/>',
};
export const icon = (name: string, cls = 'sd-icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const CALLOUT_LABELS: Record<string, string> = { info: 'Information', note: 'Note', tip: 'Conseil', success: 'Réussite', warning: 'Attention', danger: 'Danger' };

export function newCtx(target: Target, env: RenderEnv, headings: Heading[], lang: string): Ctx {
  return {
    target, env, diags: [], headings, french: /^fr/i.test(lang || 'fr'), footnotes: new Map(), footnoteDefs: new Map(),
    math: false, lineAttrs: env.context === 'preview', tabsSeq: 0,
  };
}

const lineOf = (n: any): number => n.position?.start?.line ?? n.line ?? 0;
const dl = (ctx: Ctx, n: any) => (ctx.lineAttrs && lineOf(n) ? ` data-line="${lineOf(n)}"` : '');

/* ---------- Inline ---------- */

function inline(nodes: any[] | undefined, ctx: Ctx): string {
  return (nodes || []).map(n => inlineNode(n, ctx)).join('');
}

function text(s: string, ctx: Ctx) {
  const e = esc(s);
  return ctx.french ? frenchSpacing(e) : e;
}

function inlineNode(n: any, ctx: Ctx): string {
  switch (n.type) {
    case 'text': return text(n.value, ctx);
    case 'emphasis': return `<em>${inline(n.children, ctx)}</em>`;
    case 'strong': return `<strong>${inline(n.children, ctx)}</strong>`;
    case 'delete': return `<del>${inline(n.children, ctx)}</del>`;
    case 'inlineCode': return `<code>${esc(n.value)}</code>`;
    case 'break': return '<br>';
    case 'inlineMath': return mathHtml(n.value, false, ctx, n);
    case 'link': {
      const href = safeHref(n.url);
      if (!href) {
        ctx.diags.push({ severity: 'warning', line: lineOf(n), code: 'unsafe-link', message: `Lien neutralisé (schéma non autorisé) : ${String(n.url).slice(0, 60)}` });
        return `<span class="sd-dead-link">${inline(n.children, ctx)}</span>`;
      }
      const external = /^https?:/i.test(href);
      return `<a href="${esc(href)}"${attr('title', n.title)}${external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${inline(n.children, ctx)}</a>`;
    }
    case 'image': return imageTag(n.url, n.alt, n.title, ctx, n);
    case 'footnoteReference': {
      const id = String(n.identifier);
      let f = ctx.footnotes.get(id);
      if (!f) { f = { n: ctx.footnotes.size + 1 }; ctx.footnotes.set(id, f); }
      return `<sup class="sd-fnref"><a href="#fn-${esc(slug(id))}" id="fnref-${esc(slug(id))}">${f.n}</a></sup>`;
    }
    case 'html': return rawHtml(n, ctx);
    default:
      return n.children ? inline(n.children, ctx) : text(textOf(n), ctx);
  }
}

const slug = (s: string) => s.replace(/[^\w-]/g, '_');

function rawHtml(n: any, _ctx: Ctx): string {
  const v = String(n.value);
  if (/^\s*<!--[\s\S]*-->\s*$/.test(v)) return '';
  if (/^\s*<br\s*\/?>\s*$/i.test(v)) return '<br>';
  return `<code class="sd-raw-html" title="HTML brut non interprété">${esc(v)}</code>`;
}

function mathHtml(src: string, display: boolean, ctx: Ctx, n: any): string {
  ctx.math = true;
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: true, output: 'htmlAndMathml', trust: false, strict: 'ignore' });
  } catch (e: any) {
    ctx.diags.push({ severity: 'warning', line: lineOf(n), code: 'bad-math', message: `Formule illisible : ${String(e.message).replace(/^KaTeX parse error: /, '')}` });
    return `<code class="sd-math-error">${esc(src)}</code>`;
  }
}

function imageTag(url: string, alt: string | null | undefined, title: string | null | undefined, ctx: Ctx, n: any, style = ''): string {
  const safe = safeSrc(url);
  const resolved = safe ? ctx.env.resolveAsset(safe) : null;
  if (!resolved) {
    ctx.diags.push({ severity: 'warning', line: lineOf(n), code: 'missing-asset', message: safe ? `Image introuvable : ${url}` : `Image refusée (schéma non autorisé) : ${String(url).slice(0, 60)}` });
    return `<span class="sd-missing" role="img" aria-label="${esc(alt || 'image manquante')}">${icon('image')}<span>${esc(url || '(sans chemin)')}</span></span>`;
  }
  if (!alt) ctx.diags.push({ severity: 'info', line: lineOf(n), code: 'missing-alt', message: `Image sans texte alternatif : ${url}` });
  return `<img src="${esc(resolved)}" alt="${esc(alt || '')}"${attr('title', title)}${style ? ` style="${style}"` : ''}${ctx.target === 'reading' ? ' loading="lazy"' : ''}>`;
}

/* ---------- Blocs ---------- */

export function blocks(list: Block[], ctx: Ctx): string {
  return list.map(b => block(b, ctx)).join('\n');
}

function block(n: any, ctx: Ctx): string {
  switch (n.type) {
    case 'heading': return heading(n, ctx);
    case 'paragraph': {
      // un paragraphe qui ne contient qu'une image devient une figure
      const only = n.children.length === 1 && n.children[0].type === 'image' ? n.children[0] : null;
      if (only) return `<figure class="sd-figure"${dl(ctx, n)}>${imageTag(only.url, only.alt, only.title, ctx, only)}${only.title ? `<figcaption>${text(only.title, ctx)}</figcaption>` : ''}</figure>`;
      return `<p${dl(ctx, n)}>${inline(n.children, ctx)}</p>`;
    }
    case 'blockquote': return `<blockquote${dl(ctx, n)}>${blocks(n.children, ctx)}</blockquote>`;
    case 'list': {
      const tag = n.ordered ? 'ol' : 'ul';
      const task = n.children.some((li: any) => typeof li.checked === 'boolean');
      return `<${tag}${n.ordered && n.start != null && n.start !== 1 ? ` start="${Number(n.start)}"` : ''}${task ? ' class="sd-tasks"' : ''}${dl(ctx, n)}>${n.children.map((li: any) => listItem(li, n.spread, ctx)).join('')}</${tag}>`;
    }
    case 'code': return codeBlock(n, ctx);
    case 'math': return `<div class="sd-math"${dl(ctx, n)}>${mathHtml(n.value, true, ctx, n)}</div>`;
    case 'thematicBreak': return `<hr${dl(ctx, n)}>`;
    case 'table': return table(n, ctx, {});
    case 'html': {
      const h = rawHtml(n, ctx);
      return h ? `<p${dl(ctx, n)}>${h}</p>` : '';
    }
    case 'footnoteDefinition': ctx.footnoteDefs.set(String(n.identifier), n); return '';
    case 'definition': return '';
    case 'component': return component(n as ComponentNode, ctx);
    default:
      return n.children ? blocks(n.children, ctx) : `<p>${text(textOf(n), ctx)}</p>`;
  }
}

function heading(n: any, ctx: Ctx): string {
  const d = n.data || {};
  const num = d.number ? `<span class="sd-num">${esc(d.number)}</span> ` : '';
  const anchor = ctx.target === 'reading' && d.id ? `<a class="sd-anchor" href="#${esc(d.id)}" aria-label="Lien vers cette section">#</a>` : '';
  return `<h${n.depth}${attr('id', d.id)}${dl(ctx, n)}>${num}<span class="sd-ht">${inline(n.children, ctx)}</span>${anchor}</h${n.depth}>`;
}

function listItem(li: any, spread: boolean, ctx: Ctx): string {
  const tight = !spread && !li.spread;
  const inner = li.children.map((c: any) => (tight && c.type === 'paragraph' ? inline(c.children, ctx) : block(c, ctx))).join('');
  if (typeof li.checked === 'boolean')
    return `<li class="sd-task${li.checked ? ' done' : ''}"><span class="sd-check" aria-hidden="true"></span><span class="sd-task-text">${inner}</span></li>`;
  return `<li>${inner}</li>`;
}

function codeBlock(n: any, ctx: Ctx): string {
  const meta = parseAttrs(n.meta ? `{${n.meta}}` : '');
  const title = typeof meta.attrs.title === 'string' ? meta.attrs.title : '';
  const lang = (n.lang || '').toLowerCase();
  const { html, language } = highlight(n.value, lang || null);
  const label = language ? LANGUAGE_LABELS[language] || language : lang;
  const head = title || label
    ? `<figcaption class="sd-code-head"><span class="sd-code-title">${esc(title || label)}</span>${title && label ? `<span class="sd-code-lang">${esc(label)}</span>` : ''}${ctx.target === 'reading' ? `<button class="sd-copy" type="button" aria-label="Copier le code">${icon('copy')}<span>Copier</span></button>` : ''}</figcaption>`
    : (ctx.target === 'reading' ? `<button class="sd-copy sd-copy-float" type="button" aria-label="Copier le code">${icon('copy')}</button>` : '');
  const lines = n.value.split('\n').length;
  const numbered = meta.attrs.lines === true || meta.attrs.numbers === true;
  const body = numbered ? splitLines(html).map(l => `<span class="sd-ln">${l}</span>`).join('\n') : html;
  return `<figure class="sd-code${numbered ? ' sd-numbered' : ''}${lines > 40 ? ' sd-long' : ''}"${attr('data-lang', language || lang || undefined)}${dl(ctx, n)}>${head}<pre><code class="hljs${language ? ' language-' + language : ''}">${body}</code></pre></figure>`;
}

/** Coupe un HTML coloré en lignes en refermant puis rouvrant les <span> ouverts à chaque saut. */
function splitLines(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let cur = '';
  for (const tok of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!tok) continue;
    if (tok === '\n') { out.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
    else if (tok.startsWith('<span')) { open.push(tok); cur += tok; }
    else if (tok === '</span>') { open.pop(); cur += tok; }
    else cur += tok;
  }
  out.push(cur);
  return out;
}

function table(n: any, ctx: Ctx, o: { caption?: string; style?: string; compact?: boolean; wide?: boolean }): string {
  const align = (i: number) => (n.align?.[i] ? ` style="text-align:${n.align[i]}"` : '');
  const [head, ...rows] = n.children;
  const cols = head?.children.length || 0;
  const cell = (c: any, i: number, tag: string) => `<${tag}${align(i)}>${inline(c.children, ctx)}</${tag}>`;
  const cls = ['sd-table', o.style ? `sd-table-${o.style}` : '', o.compact || cols >= 7 ? 'sd-compact' : '', o.wide ? 'sd-wide' : ''].filter(Boolean).join(' ');
  return `<div class="sd-table-wrap${o.wide ? ' sd-wide' : ''}"${dl(ctx, n)}><table class="${cls}" data-cols="${cols}">${o.caption ? `<caption>${text(o.caption, ctx)}</caption>` : ''}<thead><tr>${head.children.map((c: any, i: number) => cell(c, i, 'th')).join('')}</tr></thead><tbody>${rows.map((r: any) => `<tr>${r.children.map((c: any, i: number) => cell(c, i, 'td')).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function footnotesHtml(ctx: Ctx): string {
  if (!ctx.footnotes.size) return '';
  const items = [...ctx.footnotes.entries()].sort((a, b) => a[1].n - b[1].n).map(([id, f]) => {
    const def = ctx.footnoteDefs.get(id);
    const body = def ? blocks(def.children, ctx).replace(/<\/p>\s*$/, ` <a class="sd-fnback" href="#fnref-${esc(slug(id))}" aria-label="Retour au texte">↩</a></p>`) : '<p><em>Note sans définition.</em></p>';
    return `<li id="fn-${esc(slug(id))}">${body}</li>`;
  }).join('');
  for (const id of ctx.footnoteDefs.keys()) if (!ctx.footnotes.has(id)) ctx.diags.push({ severity: 'info', line: lineOf(ctx.footnoteDefs.get(id)), code: 'unused-footnote', message: `Note « ${id} » définie mais jamais appelée.` });
  return `<section class="sd-footnotes" aria-label="Notes"><h2 class="sd-footnotes-title">Notes</h2><ol>${items}</ol></section>`;
}

/* ---------- Composants ---------- */

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

function bgStyle(v: unknown): { cls: string; style: string } {
  const s = str(v);
  if (!s) return { cls: '', style: '' };
  if (['surface', 'primary', 'secondary', 'accent', 'dark', 'light', 'muted'].includes(s)) return { cls: ` sd-bg-${s}`, style: '' };
  const c = safeColor(s);
  return c ? { cls: ' sd-bg-custom', style: ` style="--sd-custom-bg:${c}"` } : { cls: '', style: '' };
}

function idCls(n: ComponentNode, base: string) {
  return `${attr('id', n.id)} class="${base}${n.classes.map(c => ' ' + esc(c)).join('')}"`;
}

export function component(n: ComponentNode, ctx: Ctx): string {
  const kids = () => blocks(n.children, ctx);
  const t = ctx.target;
  const a = n.attrs;
  const L = dl(ctx, n);
  if (!n.known) {
    return `<div class="sd-unknown"${L}><div class="sd-unknown-label">Composant inconnu : ${esc(n.given)}</div>${n.raw !== undefined ? `<pre>${esc(n.raw)}</pre>` : kids()}</div>`;
  }
  switch (n.name) {
    case 'callout': {
      const type = ['info', 'note', 'tip', 'success', 'warning', 'danger'].includes(str(a.type)) ? str(a.type) : 'info';
      const title = str(a.title);
      return `<aside${idCls(n, `sd-callout sd-callout-${type}`)} role="note"${L}><div class="sd-callout-head">${icon(type)}<span>${text(title || CALLOUT_LABELS[type], ctx)}</span></div><div class="sd-callout-body">${kids()}</div></aside>`;
    }
    case 'details': {
      const title = text(str(a.title, 'Détails'), ctx);
      if (t === 'reading') return `<details${idCls(n, 'sd-details')}${a.open ? ' open' : ''}${L}><summary>${title}</summary><div class="sd-details-body">${kids()}</div></details>`;
      return `<div${idCls(n, 'sd-details sd-static')}${L}><div class="sd-details-title">${title}</div><div class="sd-details-body">${kids()}</div></div>`;
    }
    case 'tabs': {
      const tabs = n.children.filter((c: any) => c.type === 'component' && c.name === 'tab') as ComponentNode[];
      const other = n.children.filter((c: any) => !(c.type === 'component' && c.name === 'tab'));
      if (other.some((c: any) => c.type !== 'html'))
        ctx.diags.push({ severity: 'info', line: n.line, code: 'tabs-content', message: 'Contenu hors onglet dans « tabs » : affiché sous les onglets.' });
      const seq = ++ctx.tabsSeq;
      if (t === 'reading') {
        const btns = tabs.map((tb, i) => `<button role="tab" type="button" id="sd-tab-${seq}-${i}" aria-controls="sd-panel-${seq}-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${text(str(tb.attrs.title, `Onglet ${i + 1}`), ctx)}</button>`).join('');
        const panels = tabs.map((tb, i) => `<div role="tabpanel" id="sd-panel-${seq}-${i}" aria-labelledby="sd-tab-${seq}-${i}"${i ? ' hidden' : ''}${dl(ctx, tb)}>${blocks(tb.children, ctx)}</div>`).join('');
        return `<div${idCls(n, 'sd-tabs')}${L}><div class="sd-tablist" role="tablist">${btns}</div>${panels}${blocks(other, ctx)}</div>`;
      }
      return `<div${idCls(n, 'sd-tabs sd-static')}${L}>${tabs.map(tb => `<div class="sd-tab-static"${dl(ctx, tb)}><div class="sd-tab-title">${text(str(tb.attrs.title), ctx)}</div>${blocks(tb.children, ctx)}</div>`).join('')}${blocks(other, ctx)}</div>`;
    }
    case 'tab': return `<div${idCls(n, 'sd-tab-static')}${L}><div class="sd-tab-title">${text(str(a.title), ctx)}</div>${kids()}</div>`;
    case 'pullquote': {
      const who = [str(a.author), str(a.source)].filter(Boolean);
      return `<figure${idCls(n, 'sd-pullquote')}${L}><blockquote>${kids()}</blockquote>${who.length ? `<figcaption>${who.map((w, i) => (i ? `<span class="sd-pq-source">${text(w, ctx)}</span>` : `<span class="sd-pq-author">${text(w, ctx)}</span>`)).join('')}</figcaption>` : ''}</figure>`;
    }
    case 'image': {
      const align = ['center', 'left', 'right', 'full'].includes(str(a.align)) ? str(a.align) : 'center';
      const w = safeLength(a.width);
      const caption = str(a.caption);
      const img = imageTag(str(a.src), str(a.alt) || caption, null, ctx, n, w && align !== 'full' ? `width:${w}` : '');
      const extra = n.children.length ? `<div class="sd-figure-extra">${kids()}</div>` : '';
      return `<figure${idCls(n, `sd-figure sd-align-${align}`)}${L}>${img}${caption ? `<figcaption>${text(caption, ctx)}</figcaption>` : ''}${extra}</figure>`;
    }
    case 'gallery': {
      const cols = Math.min(6, Math.max(1, Number(a.cols) || 3));
      const imgs: any[] = [];
      const rest: Block[] = [];
      for (const c of n.children as any[]) {
        const inner = c.type === 'paragraph' ? c.children.filter((x: any) => x.type === 'image') : [];
        if (inner.length && c.children.every((x: any) => x.type === 'image' || (x.type === 'text' && !x.value.trim()) || x.type === 'break')) imgs.push(...inner);
        else rest.push(c);
      }
      const items = imgs.map(im => `<figure class="sd-gallery-item">${imageTag(im.url, im.alt, im.title, ctx, im)}${im.alt ? `<figcaption>${text(im.alt, ctx)}</figcaption>` : ''}</figure>`).join('');
      return `<div${idCls(n, 'sd-gallery')} style="--sd-cols:${cols}"${L}>${items}</div>${blocks(rest, ctx)}`;
    }
    case 'video': {
      const src = safeSrc(str(a.src));
      const url = src ? ctx.env.resolveAsset(src) : null;
      const poster = a.poster ? ctx.env.resolveAsset(safeSrc(str(a.poster)) || '') : null;
      const caption = str(a.caption);
      if (!url) ctx.diags.push({ severity: 'warning', line: n.line, code: 'missing-asset', message: `Vidéo introuvable : ${str(a.src)}` });
      if (t === 'print') {
        const visual = poster ? `<img src="${esc(poster)}" alt="">` : `<div class="sd-video-frame">${icon('play')}</div>`;
        return `<figure${idCls(n, 'sd-figure sd-video sd-static')}${L}>${visual}<figcaption>${icon('play')} Vidéo${caption ? ` : ${text(caption, ctx)}` : ''}${src && /^https?:/.test(src) ? ` <a href="${esc(src)}">${esc(src)}</a>` : ''}</figcaption></figure>`;
      }
      return `<figure${idCls(n, 'sd-figure sd-video')}${L}>${url ? `<video controls preload="metadata" src="${esc(url)}"${poster ? ` poster="${esc(poster)}"` : ''}></video>` : `<div class="sd-video-frame sd-missing">${icon('play')}<span>${esc(str(a.src))}</span></div>`}${caption ? `<figcaption>${text(caption, ctx)}</figcaption>` : ''}</figure>`;
    }
    case 'columns': {
      const cols = n.children.filter((c: any) => c.type === 'component' && c.name === 'column') as ComponentNode[];
      const count = Number(a.count) || cols.length || 2;
      if (a.count && cols.length && Number(a.count) !== cols.length)
        ctx.diags.push({ severity: 'info', line: n.line, code: 'columns-count', message: `count=${a.count} mais ${cols.length} colonne(s) écrite(s).` });
      const ratio = str(a.ratio).split(':').map(Number).filter(x => x > 0);
      const tpl = ratio.length === count ? ratio.map(r => `${r}fr`).join(' ') : `repeat(${count}, minmax(0, 1fr))`;
      const gap = ['small', 'medium', 'large'].includes(str(a.gap)) ? str(a.gap) : 'medium';
      const inner = cols.length ? n.children.map((c: any) => (c.type === 'component' && c.name === 'column' ? `<div class="sd-column"${dl(ctx, c)}>${blocks(c.children, ctx)}</div>` : block(c, ctx))).join('') : kids();
      return `<div${idCls(n, `sd-columns sd-gap-${gap}`)} style="--sd-cols-tpl:${tpl}"${L}>${inner}</div>`;
    }
    case 'column': return `<div${idCls(n, 'sd-column')}${L}>${kids()}</div>`;
    case 'grid': {
      const cols = Math.min(6, Math.max(1, Number(a.cols) || 3));
      return `<div${idCls(n, 'sd-grid')} style="--sd-cols:${cols}"${L}>${n.children.map((c: any) => `<div class="sd-grid-cell">${block(c, ctx)}</div>`).join('')}</div>`;
    }
    case 'card': {
      const tone = ['primary', 'accent', 'muted'].includes(str(a.tone)) ? ` sd-tone-${str(a.tone)}` : '';
      return `<div${idCls(n, `sd-card${tone}`)}${L}>${a.title ? `<div class="sd-card-title">${text(str(a.title), ctx)}</div>` : ''}${kids()}</div>`;
    }
    case 'stats': {
      const items = Array.isArray(n.data) ? (n.data as any[]) : [];
      if (!Array.isArray(n.data) && n.raw === undefined)
        ctx.diags.push({ severity: 'warning', line: n.line, code: 'bad-data', message: '« stats » attend une liste : « - label: … / value: … ».' });
      if (n.raw !== undefined) return `<div class="sd-unknown"${L}><div class="sd-unknown-label">Données illisibles</div><pre>${esc(n.raw)}</pre></div>`;
      const cells = items.map((it, i) => {
        if (!it || typeof it !== 'object') return `<div class="sd-stat"><div class="sd-stat-value">${text(String(it), ctx)}</div></div>`;
        if (it.value === undefined) ctx.diags.push({ severity: 'warning', line: n.line + 1 + i, code: 'bad-data', message: `Chiffre ${i + 1} sans « value ».` });
        return `<div class="sd-stat"><div class="sd-stat-value">${text(String(it.value ?? '—'), ctx)}</div><div class="sd-stat-label">${text(String(it.label ?? ''), ctx)}</div>${it.hint ? `<div class="sd-stat-hint">${text(String(it.hint), ctx)}</div>` : ''}</div>`;
      }).join('');
      return `<div${idCls(n, 'sd-stats')} style="--sd-cols:${Math.max(1, Math.min(items.length, 4))}"${L}>${cells}</div>`;
    }
    case 'section': {
      const bg = bgStyle(a.bg || 'surface');
      return `<section${idCls(n, `sd-section${bg.cls}${a.full ? ' sd-full' : ''}`)}${bg.style}${L}><div class="sd-section-inner">${kids()}</div></section>`;
    }
    case 'aside': return `<aside${idCls(n, 'sd-aside')}${L}>${a.title ? `<div class="sd-aside-title">${text(str(a.title), ctx)}</div>` : ''}${kids()}</aside>`;
    case 'spacer': {
      const size = ['small', 'medium', 'large', 'xlarge'].includes(str(a.size)) ? str(a.size) : 'medium';
      return `<div class="sd-spacer sd-spacer-${size}" aria-hidden="true"${L}></div>${kids()}`;
    }
    case 'slide': {
      if (t === 'slides') return kids();  // découpé par slides.ts
      return `<section${idCls(n, 'sd-slide-section')}${L}>${kids()}</section>`;
    }
    case 'notes': return t === 'slides' ? `<aside class="sd-notes">${kids()}</aside>` : '';
    case 'cover': return t === 'slides' ? kids() : '';   // placé par la cible
    case 'toc': return tocHtml(ctx.headings, Number(a.depth) || 2, ctx, 'sd-toc-inline') + kids();
    case 'pagebreak': return `<div class="sd-pagebreak" aria-hidden="true"${L}></div>${kids()}`;
    case 'appendix': return `${t === 'print' ? '<div class="sd-pagebreak" aria-hidden="true"></div>' : ''}<section${idCls(n, 'sd-appendix')}${L}>${kids()}</section>`;
    case 'references': {
      const title = str(a.title, 'Références');
      return `<section${idCls(n, 'sd-references')}${L}>${title ? `<h2 class="sd-references-title">${text(title, ctx)}</h2>` : ''}${kids()}</section>`;
    }
    case 'table': {
      const tbl = n.children.find((c: any) => c.type === 'table');
      if (!tbl) {
        ctx.diags.push({ severity: 'warning', line: n.line, code: 'table-empty', message: '« table » ne contient pas de tableau markdown.' });
        return kids();
      }
      const style = ['lines', 'zebra', 'grid', 'minimal'].includes(str(a.style)) ? str(a.style) : undefined;
      return n.children.map((c: any) => (c === tbl ? table(c, ctx, { caption: str(a.caption) || undefined, style, compact: !!a.compact, wide: !!a.wide }) : block(c, ctx))).join('');
    }
  }
  return kids();
}

export function tocHtml(headings: Heading[], depth: number, ctx: Ctx, cls: string): string {
  const list = headings.filter(h => h.depth <= depth);
  if (!list.length) return '';
  const min = Math.min(...list.map(h => h.depth));
  const items = list.map(h => `<li class="sd-toc-l${h.depth - min + 1}"><a href="#${esc(h.id)}">${h.number ? `<span class="sd-toc-num">${esc(h.number)}</span>` : ''}<span class="sd-toc-text">${text(h.text, ctx)}</span>${ctx.target === 'print' ? '<span class="sd-toc-dots"></span>' : ''}</a></li>`).join('');
  return `<nav class="${cls}" aria-label="Sommaire"><div class="sd-toc-title">Sommaire</div><ol>${items}</ol></nav>`;
}
