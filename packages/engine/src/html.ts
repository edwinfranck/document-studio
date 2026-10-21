// Utilitaires HTML : échappement, URL sûres, coloration syntaxique, typographie française.

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import csharp from 'highlight.js/lib/languages/csharp';
import kotlin from 'highlight.js/lib/languages/kotlin';
import makefile from 'highlight.js/lib/languages/makefile';
import nginx from 'highlight.js/lib/languages/nginx';

const LANGS: Record<string, any> = {
  javascript, typescript, python, bash, shell, json, css, xml, sql, yaml, markdown, c, cpp, java, go,
  rust, php, diff, dockerfile, ini, csharp, kotlin, makefile, nginx,
};
for (const [k, v] of Object.entries(LANGS)) hljs.registerLanguage(k, v);
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['toml', 'env'], { languageName: 'ini' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });

export const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', bash: 'Shell', shell: 'Console',
  json: 'JSON', css: 'CSS', xml: 'HTML', sql: 'SQL', yaml: 'YAML', markdown: 'Markdown', c: 'C', cpp: 'C++',
  java: 'Java', go: 'Go', rust: 'Rust', php: 'PHP', diff: 'Diff', dockerfile: 'Dockerfile', ini: 'INI',
  csharp: 'C#', kotlin: 'Kotlin', makefile: 'Makefile', nginx: 'nginx',
};

export function highlight(code: string, lang?: string | null): { html: string; language?: string } {
  if (lang) {
    const l = hljs.getLanguage(lang);
    if (l) {
      const name = Object.keys(LANGS).find(k => hljs.getLanguage(k) === l);
      return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, language: name };
    }
  }
  return { html: esc(code) };
}

export const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

/** URL de lien sûre : schémas autorisés, ancres et chemins relatifs. Sinon null. */
export function safeHref(url: string | null | undefined): string | null {
  if (url == null) return null;
  const u = String(url).trim();
  if (!u) return null;
  if (SAFE_SCHEME.test(u) || u.startsWith('#') || u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return u;
  // pas de schéma : chemin relatif (« page.md », « img/a.png »)
  const colon = u.indexOf(':');
  const slash = u.search(/[/?#]/);
  if (colon < 0 || (slash >= 0 && slash < colon)) return u;
  return null;
}

/** URL de média : comme safeHref, plus les images intégrées data:image/*. */
export function safeSrc(url: string | null | undefined): string | null {
  if (url && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/i.test(url.trim())) return url.trim();
  if (url && /^data:(video|font)\//i.test(url.trim())) return url.trim();
  if (url && /^blob:/i.test(url.trim())) return url.trim();
  return safeHref(url);
}

/** Espaces insécables de la typographie française, posées seulement là où un espace existe déjà. */
export function frenchSpacing(s: string): string {
  return s
    .replace(/ ([;!?])/g, ' $1')
    .replace(/ :/g, ' :')
    .replace(/« /g, '« ')
    .replace(/ »/g, ' »');
}

export const attr = (name: string, v: unknown) => (v === undefined || v === null || v === false ? '' : v === true ? ` ${name}` : ` ${name}="${esc(v)}"`);

/** Couleur CSS sûre pour un attribut (pas d'injection). */
export function safeColor(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^(rgb|hsl)a?\(\s*[\d.%\s,/-]+\)$/i.test(s)) return s;
  return null;
}

export const safeLength = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return /^\d+(\.\d+)?(px|%|em|rem|mm|cm|vw)?$/.test(s) ? (/^\d+(\.\d+)?$/.test(s) ? s + 'px' : s) : null;
};
