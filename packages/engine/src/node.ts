// Environnement de rendu côté Node : ressources lues sur disque, polices et images intégrées.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { RenderEnv } from './types.ts';
import { fontFaceCss } from './fonts.ts';

export const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS_DIR = join(ENGINE_DIR, 'fonts');
/** Dossier d'une dépendance du moteur, où que le gestionnaire de paquets l'ait rangée (dépôt, pnpm deploy, application). */
function pkgDir(name: string): string {
  const paths = createRequire(join(ENGINE_DIR, 'package.json')).resolve.paths(name) || [];
  for (const p of paths) if (existsSync(join(p, name, 'package.json'))) return join(p, name);
  return join(ENGINE_DIR, 'node_modules', name);
}
export const PAGEDJS_FILE = join(pkgDir('pagedjs'), 'dist/paged.polyfill.min.js');
export const KATEX_DIR = join(pkgDir('katex'), 'dist');

export const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf',
};

const cache = new Map<string, string>();
const dataUri = (file: string) => {
  let v = cache.get(file);
  if (!v) { v = `data:${MIME[extname(file).toLowerCase()] || 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`; cache.set(file, v); }
  return v;
};

let katexCss: string | null = null;
export function katexEmbeddedCss(): string {
  if (katexCss === null) {
    katexCss = readFileSync(join(KATEX_DIR, 'katex.min.css'), 'utf8')
      .replace(/src:\s*url\(fonts\/([^)]+\.woff2)\)\s*format\("woff2"\)[^;}]*/g, (_, f) => `src:url(${dataUri(join(KATEX_DIR, 'fonts', f))}) format("woff2")`);
  }
  return katexCss;
}

export interface NodeEnvOptions {
  /** Dossier du document : base des chemins d'images relatifs. */
  baseDir?: string;
  /** Intègre images et polices (fichier autonome). Sinon, URL file://. */
  embed?: boolean;
  /** Autorise les images distantes (http/https). Par défaut : oui, signalées comme dépendance réseau. */
  allowRemote?: boolean;
  /** Ressources résolues en dehors du disque (ex. médias en mémoire). */
  extraAssets?: (src: string) => string | null;
  /** Les fichiers référencés ne peuvent pas sortir de ce dossier (protection contre ../../etc). */
  sandboxDir?: string;
}

export function nodeEnv(o: NodeEnvOptions = {}): RenderEnv & { remote: string[] } {
  const remote: string[] = [];
  const embed = o.embed !== false;
  return {
    context: 'export',
    remote,
    resolveAsset(src) {
      if (!src) return null;
      if (/^data:|^blob:/i.test(src)) return src;
      if (/^https?:/i.test(src)) { remote.push(src); return o.allowRemote === false ? null : src; }
      const extra = o.extraAssets?.(src);
      if (extra) return extra;
      const clean = decodeURIComponent(src.split(/[?#]/)[0]);
      const file = isAbsolute(clean) ? clean : resolve(o.baseDir || process.cwd(), clean);
      const jail = o.sandboxDir ? resolve(o.sandboxDir) : null;
      if (jail && !(file === jail || file.startsWith(jail + sep))) return null;
      if (!existsSync(file) || !statSync(file).isFile()) return null;
      return embed ? dataUri(file) : 'file://' + file;
    },
    fontCss: families => fontFaceCss(families, f => (embed ? dataUri(join(FONTS_DIR, f)) : 'file://' + join(FONTS_DIR, f))),
    pagedjs: { inline: readFileSync(PAGEDJS_FILE, 'utf8') },
    katexCss: katexEmbeddedCss(),
  };
}
