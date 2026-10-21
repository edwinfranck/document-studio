// Gabarits intégrés, fusion des surcharges et génération des variables CSS.
// Un gabarit = des variables de design + quelques règles CSS propres. Le contenu n'y figure jamais.

import type { DeepPartial, DocSettings, PageSettings, ReadingSettings, SlideSettings, Template, ThemeTokens } from './types.ts';

export const DEFAULT_TOKENS: ThemeTokens = {
  fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  type: {
    baseSize: 18, printSize: 10.5, slideSize: 34, scale: 1.25, lineHeight: 1.6, headingLineHeight: 1.15,
    headingWeight: 700, bodyWeight: 400, headingTracking: -0.01, bodyTracking: 0, headingCase: 'none',
    measure: 70, align: 'left', hyphenate: false, paragraphSpacing: 1, headingSpaceBefore: 1.8,
  },
  colors: {
    primary: '#1f3a5f', secondary: '#4a6a8a', accent: '#d9480f',
    text: '#1c1d20', muted: '#5f636b', bg: '#ffffff', surface: '#f4f5f7', border: '#dfe1e5', link: '#1f5fbf',
    info: '#1f6feb', success: '#1a7f37', warning: '#b35900', danger: '#c62828',
    codeBg: '#f6f7f9', codeText: '#1c1d20',
    slideBg: '#ffffff', slideText: '#1c1d20', slideAccent: '#d9480f',
  },
  layout: {
    radius: 6, shadow: false, tableStyle: 'lines', headingStyle: 'plain', numbering: false, numberingDepth: 3,
    listMarker: 'disc', quoteStyle: 'rule', imageAlign: 'center', cover: 'minimal', toc: true, density: 1,
  },
};

export const DEFAULT_PAGE: PageSettings = {
  size: 'A4', width: 210, height: 297, orientation: 'portrait',
  margins: { top: 22, right: 20, bottom: 24, left: 20 },
  header: { left: '{title}', center: '', right: '{section}' },
  footer: { left: '{author}', center: '', right: '{page} / {pages}' },
  headerOnFirst: false, repeatTableHeaders: true, breakBeforeH1: false, columns: 1,
};

export const DEFAULT_SLIDES: SlideSettings = {
  aspect: '16:9', width: 1920, height: 1080, split: 'h2', ruleSplits: true, transition: 'fade',
  numbers: true, progress: true, cover: true, closing: '',
};

export const DEFAULT_READING: ReadingSettings = { toc: 'side', progress: true, search: true, colorScheme: 'template' };

type T = DeepPartial<ThemeTokens>;
const tpl = (id: string, name: string, category: string, kind: Template['kind'], description: string, tokens: T, extra: Partial<Template> = {}): Template =>
  ({ id, name, category, kind, description, builtin: true, tokens: merge(DEFAULT_TOKENS, tokens), page: extra.page || {}, slides: extra.slides || {}, css: extra.css || '' });

export const BUILTIN_TEMPLATES: Template[] = [
  tpl('editorial', 'Éditorial', 'Article éditorial', 'document',
    'Serif de lecture, titres en Fraunces, papier chaud. Pour les articles, synthèses et notes de fond.',
    {
      fonts: { heading: 'Fraunces', body: 'Newsreader', mono: 'JetBrains Mono' },
      type: { baseSize: 20, printSize: 11, slideSize: 36, scale: 1.3, lineHeight: 1.65, headingWeight: 600, headingTracking: -0.015, measure: 66, hyphenate: true },
      colors: { primary: '#2b2118', secondary: '#7a5c3e', accent: '#b23a1e', text: '#231f1a', muted: '#6d655c', bg: '#fbf8f2', surface: '#f2ece1', border: '#e2d9ca', link: '#9c3417', codeBg: '#f2ece1', codeText: '#2b2118', slideBg: '#fbf8f2', slideText: '#231f1a', slideAccent: '#b23a1e' },
      layout: { radius: 2, quoteStyle: 'large', headingStyle: 'plain', cover: 'minimal', listMarker: 'dash' },
    },
    { css: `.sd-body > p:first-of-type::first-letter{font-family:var(--sd-font-heading);float:left;font-size:3.4em;line-height:.85;padding:.06em .08em 0 0;color:var(--sd-c-accent);font-weight:600}
.sd-body h2{font-style:italic;font-weight:500}` }),

  tpl('technique', 'Documentation technique', 'Documentation technique', 'document',
    'IBM Plex, sections numérotées, code mis en avant. Pour la documentation, les procédures et les notes d\'architecture.',
    {
      fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
      type: { baseSize: 16, printSize: 10, slideSize: 30, scale: 1.22, lineHeight: 1.6, headingWeight: 600, headingTracking: 0, measure: 80 },
      colors: { primary: '#0f4c81', secondary: '#3d6e99', accent: '#0f62fe', text: '#161616', muted: '#525252', bg: '#ffffff', surface: '#f4f4f4', border: '#e0e0e0', link: '#0f62fe', codeBg: '#161616', codeText: '#f4f4f4', slideBg: '#ffffff', slideText: '#161616', slideAccent: '#0f62fe' },
      layout: { radius: 0, tableStyle: 'grid', headingStyle: 'rule', numbering: true, numberingDepth: 3, cover: 'band', listMarker: 'square' },
    },
    { css: `.sd-body h1,.sd-body h2{font-weight:600}
.sd-body code:not(pre code){background:var(--sd-c-surface);border:1px solid var(--sd-c-border);padding:.08em .32em;border-radius:0}` }),

  tpl('corporate', 'Rapport corporate', 'Rapport professionnel', 'both',
    'Inter, bleu nuit et sarcelle, tableaux zébrés, couverture à bande. Pour les rapports d\'activité et bilans.',
    {
      fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      type: { baseSize: 17, printSize: 10, slideSize: 32, scale: 1.25, lineHeight: 1.6, headingWeight: 700, headingTracking: -0.02, measure: 72 },
      colors: { primary: '#14213d', secondary: '#2a9d8f', accent: '#2a9d8f', text: '#1b1f2a', muted: '#5b6272', bg: '#ffffff', surface: '#f2f5f8', border: '#dde3ea', link: '#1d6f8f', codeBg: '#f2f5f8', codeText: '#14213d', slideBg: '#ffffff', slideText: '#14213d', slideAccent: '#2a9d8f' },
      layout: { radius: 4, tableStyle: 'zebra', headingStyle: 'bar', cover: 'band', numbering: false },
    }),

  tpl('direction', 'Rapport de direction', 'Rapport de direction', 'document',
    'Source Serif et Inter, sobriété premium, chiffres clés en avant, couverture pleine page. Pour les notes de synthèse au comité.',
    {
      fonts: { heading: 'Inter', body: 'Source Serif 4', mono: 'JetBrains Mono' },
      type: { baseSize: 19, printSize: 10.5, slideSize: 34, scale: 1.28, lineHeight: 1.6, headingWeight: 650, headingTracking: -0.02, measure: 68 },
      colors: { primary: '#0b1d2e', secondary: '#8c6d3f', accent: '#8c6d3f', text: '#141a21', muted: '#5a6470', bg: '#ffffff', surface: '#f5f3ef', border: '#e4dfd6', link: '#7a5a2a', codeBg: '#f5f3ef', codeText: '#0b1d2e', slideBg: '#0b1d2e', slideText: '#f5f3ef', slideAccent: '#c8a46a' },
      layout: { radius: 0, tableStyle: 'lines', headingStyle: 'plain', cover: 'full', numbering: true, numberingDepth: 2 },
    },
    { css: `.sd-stat-value{font-family:var(--sd-font-body);font-weight:600}` }),

  tpl('pedagogique', 'Support pédagogique', 'Support pédagogique', 'both',
    'Lexend, couleurs franches, encadrés très visibles. Pour les cours, fiches et guides pas à pas.',
    {
      fonts: { heading: 'Lexend', body: 'Lexend', mono: 'JetBrains Mono' },
      type: { baseSize: 18, printSize: 10.5, slideSize: 34, scale: 1.24, lineHeight: 1.7, headingWeight: 600, bodyWeight: 300, headingTracking: -0.01, measure: 68 },
      colors: { primary: '#3b2f8f', secondary: '#0e9384', accent: '#f79009', text: '#1d1b2f', muted: '#5d5a72', bg: '#ffffff', surface: '#f4f3fb', border: '#e2e0f0', link: '#4a3bc4', codeBg: '#1d1b2f', codeText: '#f4f3fb', slideBg: '#ffffff', slideText: '#1d1b2f', slideAccent: '#f79009' },
      layout: { radius: 12, tableStyle: 'zebra', headingStyle: 'plain', cover: 'band', listMarker: 'disc', density: 1.1 },
    },
    { css: `.sd-callout{border-width:2px}
.sd-body h2 .sd-ht{background:linear-gradient(transparent 62%, color-mix(in srgb,var(--sd-c-accent) 30%,transparent) 0)}` }),

  tpl('suisse', 'Suisse', 'Typographique et suisse', 'both',
    'Grille stricte, Inter serré, rouge unique, titres massifs alignés à gauche. Pour les propositions et dossiers de projet.',
    {
      fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      type: { baseSize: 17, printSize: 10, slideSize: 34, scale: 1.42, lineHeight: 1.5, headingWeight: 800, headingTracking: -0.035, headingLineHeight: 1.02, measure: 64 },
      colors: { primary: '#111111', secondary: '#111111', accent: '#e30613', text: '#111111', muted: '#6b6b6b', bg: '#ffffff', surface: '#f1f1f1', border: '#111111', link: '#e30613', codeBg: '#f1f1f1', codeText: '#111111', slideBg: '#ffffff', slideText: '#111111', slideAccent: '#e30613' },
      layout: { radius: 0, tableStyle: 'minimal', headingStyle: 'underline', cover: 'split', numbering: true, numberingDepth: 2, listMarker: 'dash' },
    },
    { css: `.sd-body h1,.sd-body h2{text-transform:none}
.sd-num{color:var(--sd-c-accent)}` }),

  tpl('academique', 'Académique', 'Académique', 'document',
    'Source Serif justifié avec césure, petites capitales, sections numérotées, notes. Pour les mémoires et rapports d\'étude.',
    {
      fonts: { heading: 'Source Serif 4', body: 'Source Serif 4', mono: 'JetBrains Mono' },
      type: { baseSize: 19, printSize: 11, slideSize: 34, scale: 1.2, lineHeight: 1.55, headingWeight: 600, headingTracking: 0, measure: 72, align: 'justify', hyphenate: true, paragraphSpacing: 0.6 },
      colors: { primary: '#1a1a1a', secondary: '#4d4d4d', accent: '#7a1f1f', text: '#1a1a1a', muted: '#555555', bg: '#ffffff', surface: '#f6f6f4', border: '#d6d6d0', link: '#7a1f1f', codeBg: '#f6f6f4', codeText: '#1a1a1a', slideBg: '#ffffff', slideText: '#1a1a1a', slideAccent: '#7a1f1f' },
      layout: { radius: 0, tableStyle: 'lines', headingStyle: 'plain', numbering: true, numberingDepth: 3, cover: 'minimal', quoteStyle: 'plain' },
    },
    { css: `.sd-body h3{font-style:italic;font-weight:400}
.sd-body h4{font-variant:small-caps;letter-spacing:.04em;font-weight:400}
.sd-body p+p{text-indent:1.4em;margin-top:0}` }),

  tpl('brutaliste', 'Brutaliste', 'Brutaliste', 'both',
    'Space Grotesk, aplats, bordures épaisses, jaune signal. Pour les supports qui doivent marquer.',
    {
      fonts: { heading: 'Space Grotesk', body: 'Space Grotesk', mono: 'JetBrains Mono' },
      type: { baseSize: 18, printSize: 10.5, slideSize: 36, scale: 1.36, lineHeight: 1.5, headingWeight: 700, headingTracking: -0.03, headingLineHeight: 1, measure: 66, headingCase: 'uppercase' },
      colors: { primary: '#000000', secondary: '#000000', accent: '#ffe600', text: '#000000', muted: '#3d3d3d', bg: '#ffffff', surface: '#ffe600', border: '#000000', link: '#0000ee', codeBg: '#000000', codeText: '#ffe600', slideBg: '#ffe600', slideText: '#000000', slideAccent: '#000000' },
      layout: { radius: 0, tableStyle: 'grid', headingStyle: 'plain', cover: 'full', listMarker: 'square' },
    },
    { css: `.sd-callout,.sd-card,.sd-code,.sd-stat{border:3px solid #000!important;box-shadow:6px 6px 0 #000}
.sd-table th{background:#000;color:#ffe600}
.sd-stats{border-top:0;gap:.8em}.sd-stat-hint{display:inline-block;padding:0 .3em;background:#ffe600;color:#000}.sd-stat,.sd-stat+.sd-stat{padding:.7em .9em}` }),

  tpl('kernel', 'KERNEL', 'Corporate premium', 'both',
    'Charte KERNEL : DM Sans, encre et papier, ember en accent, lime rare, zéro arrondi.',
    {
      fonts: { heading: 'DM Sans', body: 'DM Sans', mono: 'IBM Plex Mono' },
      type: { baseSize: 17, printSize: 10, slideSize: 34, scale: 1.3, lineHeight: 1.55, headingWeight: 700, headingTracking: -0.025, headingLineHeight: 1.05, measure: 70 },
      colors: { primary: '#1D1D1B', secondary: '#2A2A28', accent: '#EA5930', text: '#1D1D1B', muted: '#6e6e69', bg: '#F4F4F0', surface: '#ffffff', border: 'rgba(29,29,27,.16)' as any, link: '#c2441f', success: '#5f7a00', codeBg: '#1D1D1B', codeText: '#F4F4F0', slideBg: '#1D1D1B', slideText: '#F4F4F0', slideAccent: '#B9CE10' },
      layout: { radius: 0, tableStyle: 'lines', headingStyle: 'plain', cover: 'full', listMarker: 'square' },
    },
    { css: `.sd-body h1 .sd-ht::after,.sd-body h2 .sd-ht::after{content:"";display:inline-block;width:.46em;height:.1em;background:var(--sd-c-accent);margin-left:.12em}` }),

  tpl('minimal-slides', 'Diapositives minimales', 'Présentation minimaliste', 'slides',
    'Blanc, une police, beaucoup d\'air. Pour présenter sans distraire.',
    {
      fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      type: { baseSize: 18, printSize: 10.5, slideSize: 38, scale: 1.4, headingWeight: 700, headingTracking: -0.03, headingLineHeight: 1.05 },
      colors: { primary: '#111827', secondary: '#374151', accent: '#2563eb', text: '#111827', muted: '#6b7280', bg: '#ffffff', surface: '#f3f4f6', border: '#e5e7eb', link: '#2563eb', slideBg: '#ffffff', slideText: '#111827', slideAccent: '#2563eb' },
      layout: { radius: 8, tableStyle: 'minimal', cover: 'minimal' },
    }, { slides: { transition: 'fade' } }),

  tpl('cinema', 'Cinématique', 'Présentation sombre et cinématique', 'slides',
    'Fond noir, Fraunces en très grand, ambre. Pour les keynotes et les présentations stratégiques.',
    {
      fonts: { heading: 'Fraunces', body: 'Inter', mono: 'JetBrains Mono' },
      type: { baseSize: 18, printSize: 10.5, slideSize: 36, scale: 1.45, headingWeight: 500, headingTracking: -0.02, headingLineHeight: 1.02 },
      colors: { primary: '#f5efe6', secondary: '#c9b8a0', accent: '#f0a33a', text: '#ece6dc', muted: '#9a9389', bg: '#0c0b0a', surface: '#1a1816', border: '#2e2b27', link: '#f0a33a', info: '#6ea8fe', success: '#5cc58a', warning: '#f0a33a', danger: '#ff6b6b', codeBg: '#1a1816', codeText: '#ece6dc', slideBg: '#0c0b0a', slideText: '#ece6dc', slideAccent: '#f0a33a' },
      layout: { radius: 4, tableStyle: 'minimal', cover: 'full' },
    }, { slides: { transition: 'zoom' }, css: `.sd-slide.sd-layout-cover h1,.sd-slide.sd-layout-section h1,.sd-slide.sd-layout-section h2{font-style:italic}` }),

  tpl('formation', 'Formation', 'Présentation de formation', 'slides',
    'Lexend, repères visuels forts, numéros de partie. Pour les ateliers et sessions de formation.',
    {
      fonts: { heading: 'Lexend', body: 'Lexend', mono: 'JetBrains Mono' },
      type: { baseSize: 18, printSize: 10.5, slideSize: 34, scale: 1.32, headingWeight: 600, bodyWeight: 300 },
      colors: { primary: '#0e9384', secondary: '#3b2f8f', accent: '#0e9384', text: '#1d1b2f', muted: '#5d5a72', bg: '#ffffff', surface: '#ecfdf8', border: '#cdeee6', link: '#0e7c6f', slideBg: '#ffffff', slideText: '#1d1b2f', slideAccent: '#0e9384' },
      layout: { radius: 14, tableStyle: 'zebra', cover: 'band' },
    }, { slides: { transition: 'slide' } }),
];

export function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function merge<A>(base: A, over: any): A {
  if (!isObj(over)) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

export interface ResolvedTheme {
  template: Template;
  tokens: ThemeTokens;
  page: PageSettings;
  slides: SlideSettings;
  reading: ReadingSettings;
  css: string;
}

export const DEFAULT_SETTINGS: DocSettings = {
  mode: 'reading', templateId: 'corporate', overrides: {}, page: {}, slides: {}, reading: {}, meta: {}, customCss: '',
};

export function resolveTheme(settings: Partial<DocSettings>, templates: Template[] = BUILTIN_TEMPLATES): ResolvedTheme {
  const s = merge(DEFAULT_SETTINGS, settings);
  const template = templates.find(t => t.id === s.templateId) || BUILTIN_TEMPLATES.find(t => t.id === s.templateId) || BUILTIN_TEMPLATES[2];
  const tokens = merge(merge(DEFAULT_TOKENS, template.tokens), s.overrides);
  return {
    template, tokens,
    page: merge(merge(DEFAULT_PAGE, template.page), s.page),
    slides: merge(merge(DEFAULT_SLIDES, template.slides), s.slides),
    reading: merge(DEFAULT_READING, s.reading),
    css: template.css || '',
  };
}

/** Variables CSS de design pour une cible. */
export function tokensCss(t: ThemeTokens, target: 'reading' | 'print' | 'slides'): string {
  const ty = t.type;
  const base = target === 'print' ? `${ty.printSize}pt` : target === 'slides' ? `${ty.slideSize}px` : `${ty.baseSize}px`;
  const hs = [5, 4, 3, 2, 1, 0.5].map(p => Math.pow(ty.scale, p));
  hs[5] = 1;
  const slideH = target === 'slides' ? [2.1, 1.55, 1.25, 1.1, 1, 1] : hs; // titres de diapositive moins écrasants
  const fam = (f: string, fallback: string) => `"${f.replace(/"/g, '')}", ${fallback}`;
  let c = t.colors;
  if (target === 'slides' && isDark(c.slideBg) !== isDark(c.bg)) {
    // Diapositives sombres d'un gabarit clair (ou l'inverse) : palette dérivée, lisible sur leur fond.
    c = { ...c, ...alternatePalette(c), bg: c.slideBg, text: c.slideText };
    for (const k of ['primary', 'secondary'] as const) if ((contrast(t.colors[k], c.slideBg) ?? 21) < 3) c[k] = c.slideText;
  }
  if (target === 'slides' && (contrast(c.primary, c.slideBg) ?? 21) < 3) c = { ...c, primary: c.slideText };
  const v: Record<string, string | number> = {
    'font-heading': fam(t.fonts.heading, 'system-ui, sans-serif'),
    'font-body': fam(t.fonts.body, 'system-ui, sans-serif'),
    'font-mono': fam(t.fonts.mono, 'ui-monospace, monospace'),
    'size-base': base,
    'lh': ty.lineHeight, 'lh-heading': ty.headingLineHeight,
    'w-heading': ty.headingWeight, 'w-body': ty.bodyWeight,
    'track-heading': `${ty.headingTracking}em`, 'track-body': `${ty.bodyTracking}em`,
    'case-heading': ty.headingCase,
    'measure': `${ty.measure}ch`, 'align': ty.align, 'hyphens': ty.hyphenate ? 'auto' : 'manual',
    'para': `${ty.paragraphSpacing}em`, 'h-before': `${ty.headingSpaceBefore}em`,
    'radius': `${t.layout.radius}px`, 'density': t.layout.density,
    'shadow': t.layout.shadow ? '0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)' : 'none',
    'list-marker': t.layout.listMarker === 'dash' ? '"–"' : t.layout.listMarker === 'square' ? '"■"' : '"•"',
  };
  (target === 'slides' ? slideH : hs).forEach((h, i) => { v[`h${i + 1}`] = `${(+h).toFixed(3)}em`; });
  for (const [k, val] of Object.entries(c)) v[`c-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`] = val;
  return `:root{${Object.entries(v).map(([k, val]) => `--sd-${k}:${val}`).join(';')}}`;
}

/** Classes de corps qui pilotent les variantes structurelles (style des tableaux, titres…). */
export function themeClasses(t: ThemeTokens): string {
  const l = t.layout;
  return [`sd-tables-${l.tableStyle}`, `sd-headings-${l.headingStyle}`, `sd-quotes-${l.quoteStyle}`, `sd-images-${l.imageAlign}`, `sd-cover-${l.cover}`, l.numbering ? 'sd-numbered' : ''].filter(Boolean).join(' ');
}

/* ---------- Contraste (WCAG 2.1) ---------- */

export function parseColor(s: string): [number, number, number, number] | null {
  const h = s.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(h);
  if (m) {
    let x = m[1];
    if (x.length === 3 || x.length === 4) x = x.split('').map(ch => ch + ch).join('');
    const n = parseInt(x.slice(0, 6), 16);
    const a = x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(h);
  if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
  return null;
}

const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function contrast(fg: string, bg: string): number | null {
  const b = parseColor(bg);
  let f = parseColor(fg);
  if (!f || !b) return null;
  if (f[3] < 1) f = [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1];
  const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

export function contrastReport(t: ThemeTokens) {
  const c = t.colors;
  const pairs: [string, string, string, number][] = [
    ['Texte / fond', c.text, c.bg, 4.5],
    ['Texte secondaire / fond', c.muted, c.bg, 4.5],
    ['Liens / fond', c.link, c.bg, 4.5],
    ['Accent / fond', c.accent, c.bg, 3],
    ['Code', c.codeText, c.codeBg, 4.5],
    ['Diapositive', c.slideText, c.slideBg, 4.5],
  ];
  return pairs.map(([label, fg, bg, min]) => {
    const r = contrast(fg, bg);
    return { label, fg, bg, ratio: r, min, ok: r !== null && r >= min };
  });
}

/* ---------- Mode clair / sombre de la page de lecture ---------- */

const hex = (rgb: number[]) => '#' + rgb.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return a;
  return hex([0, 1, 2].map(i => x[i] * (1 - t) + y[i] * t));
}
export const isDark = (c: string) => { const p = parseColor(c); return !!p && lum(p) < 0.2; };

/** Rapproche une couleur du blanc (ou du noir) jusqu'au contraste demandé sur le fond. */
function ensure(c: string, bg: string, min: number): string {
  const toward = isDark(bg) ? '#ffffff' : '#000000';
  let out = c;
  for (let t = 0; t <= 1 && (contrast(out, bg) ?? 0) < min; t += 0.08) out = mix(c, toward, t);
  return out;
}

/** Palette inverse dérivée du gabarit (sombre pour un gabarit clair, et l'inverse). */
export function alternatePalette(c: ThemeTokens['colors']): Partial<ThemeTokens['colors']> {
  const dark = !isDark(c.bg);
  const bg = dark ? mix('#111214', c.primary, 0.06) : '#ffffff';
  const surface = dark ? mix(bg, '#ffffff', 0.05) : mix('#ffffff', c.primary, 0.04);
  const out: Partial<ThemeTokens['colors']> = {
    bg, surface,
    border: dark ? mix(bg, '#ffffff', 0.13) : mix('#ffffff', '#000000', 0.12),
    text: dark ? '#e7e8ea' : '#17181b',
    muted: dark ? '#a1a5ad' : '#5c6068',
    codeBg: dark ? mix(bg, '#ffffff', 0.04) : mix('#ffffff', c.primary, 0.05),
    codeText: dark ? '#e7e8ea' : '#17181b',
  };
  for (const k of ['primary', 'secondary', 'accent', 'link', 'info', 'success', 'warning', 'danger'] as const)
    out[k] = ensure(c[k], bg, k === 'accent' ? 3 : 4.5);
  // Une couleur de titre qu'il faudrait délaver pour la lire devient la couleur du texte.
  for (const k of ['primary', 'secondary'] as const) if ((contrast(c[k], bg) ?? 21) < 3) out[k] = out.text;
  return out;
}

export function schemeCss(t: ThemeTokens): string {
  const alt = alternatePalette(t.colors);
  const vars = Object.entries(alt).map(([k, v]) => `--sd-c-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';');
  const altScheme = isDark(alt.bg!) ? 'dark' : 'light';
  // data-scheme : « template » (palette du gabarit), « inverse » (palette dérivée), « auto » (suit le système).
  return `:root{color-scheme:${altScheme === 'dark' ? 'light' : 'dark'}}:root[data-scheme=inverse]{${vars};color-scheme:${altScheme}}@media (prefers-color-scheme:${altScheme}){:root[data-scheme=auto]{${vars};color-scheme:${altScheme}}}`;
}
