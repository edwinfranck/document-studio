// Environnement de rendu de l'aperçu : mêmes règles que l'export, ressources servies par le serveur local.
import { archiveResolver, fontFaceCss, siteLinkResolver, type RenderEnv } from '@studio/engine';
import { api, collab, type Asset, type SiteRef } from './api.ts';

let katex = '';
export async function loadKatex() {
  try { katex = await (await fetch('/vendor/katex.css')).text(); } catch { katex = ''; }
}

/** Retrouve une ressource : chemin exact dans assets/, puis par nom de fichier (comme l'export). */
export function findAsset(src: string, assets: Asset[]): Asset | undefined {
  const clean = decodeURIComponent(src.split(/[?#]/)[0]).replace(/^\.\//, '');
  const base = clean.split('/').pop()!;
  return assets.find(a => a.name === clean.replace(/^assets\//, '')) || assets.find(a => a.name === base);
}

export function previewEnv(docId: string, assets: Asset[]): RenderEnv {
  const origin = location.origin;
  return {
    context: 'preview',
    resolveAsset(src) {
      if (/^(https?:|data:|blob:)/i.test(src)) return src;
      const a = findAsset(src, assets);
      return a ? api.previewAssetUrl(docId, a.name) : null;
    },
    fontCss: families => fontFaceCss(families, f => `${origin}/fonts/${f}`),
    pagedjs: { src: `${origin}/vendor/paged.js` },
    katexCss: katex.replace(/url\(\/vendor/g, `url(${origin}/vendor`),
  };
}

/** Page d'un projet : ses propres fichiers d'abord, puis ceux du projet à leur chemin d'origine ; liens entre pages. */
export function sitePageEnv(docId: string, assets: Asset[], site: Pick<SiteRef, 'id' | 'pages'> & { files: (string | { path: string })[] }, path: string, pageHref: (id: string, anchor: string) => string): RenderEnv {
  const base = previewEnv(docId, assets);
  const files = new Set(site.files.map(f => (typeof f === 'string' ? f : f.path)));
  const find = archiveResolver(files);
  return {
    ...base,
    resolveAsset(src) {
      const own = base.resolveAsset(src);
      if (own) return own;
      const t = find(path, src);
      return t ? collab.siteFileUrl(site.id, t.path) : null;
    },
    resolveLink: siteLinkResolver(site.pages, files, path, { page: pageHref, file: p => collab.siteFileUrl(site.id, p) }),
  };
}
