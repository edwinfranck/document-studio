// Environnement de rendu de l'aperçu : mêmes règles que l'export, ressources servies par le serveur local.
import { fontFaceCss, type RenderEnv } from '@studio/engine';
import { api, type Asset } from './api.ts';

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
