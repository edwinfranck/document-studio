// Exports : HTML autonome, PDF, paquet ZIP, à partir d'un document stocké ou d'un fichier.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { render, BUILTIN_TEMPLATES, slugify, type DocSettings, type Target, type Template } from '@studio/engine';
import { nodeEnv } from '@studio/engine/node';
import { htmlToPdf } from './browser.ts';

/** Image référencée « img/photo.jpg » : cherchée telle quelle, puis par son nom dans assets/. */
export function envFor(dir: string, embed = true) {
  return nodeEnv({
    baseDir: dir, sandboxDir: dir, embed,
    extraAssets: src => {
      const f = join(dir, 'assets', basename(decodeURIComponent(src.split(/[?#]/)[0])));
      if (!existsSync(join(dir, src)) && existsSync(f)) return nodeEnv({ baseDir: join(dir, 'assets'), sandboxDir: dir, embed }).resolveAsset(basename(f));
      return null;
    },
  });
}

export interface ExportInput { markdown: string; settings: Partial<DocSettings>; dir: string; name: string; themes?: Template[] }

export function renderHtml(i: ExportInput, mode: Target) {
  const templates = [...BUILTIN_TEMPLATES, ...(i.themes || [])];
  return render(i.markdown, { ...i.settings, mode }, envFor(i.dir), templates);
}

export async function exportPdf(i: ExportInput, mode: Target) {
  // Le PDF d'un document de lecture passe par la version paginée ; celui d'un diaporama, par les diapositives.
  const target: Target = mode === 'slides' ? 'slides' : 'print';
  const r = renderHtml(i, target);
  const { pdf, info } = await htmlToPdf(r.html, target);
  return { pdf, info, diagnostics: r.diagnostics };
}

export async function exportZip(i: ExportInput, withPdf: boolean) {
  const slug = slugify(i.name).slice(0, 60) || 'document';
  const files: Record<string, Uint8Array> = {
    [`${slug}/document.md`]: strToU8(i.markdown),
    [`${slug}/studio.json`]: strToU8(JSON.stringify({ name: i.name, settings: i.settings }, null, 2)),
    [`${slug}/${slug}.html`]: strToU8(renderHtml(i, 'reading').html),
    [`${slug}/${slug}-diaporama.html`]: strToU8(renderHtml(i, 'slides').html),
    [`${slug}/${slug}-impression.html`]: strToU8(renderHtml(i, 'print').html),
  };
  const assets = join(i.dir, 'assets');
  if (existsSync(assets)) for (const f of readdirSync(assets)) files[`${slug}/assets/${f}`] = readFileSync(join(assets, f));
  if (withPdf) files[`${slug}/${slug}.pdf`] = (await exportPdf(i, i.settings.mode || 'print')).pdf;
  files[`${slug}/LISEZMOI.txt`] = strToU8(
    `${i.name}\n\n${slug}.html             page de lecture autonome (hors ligne)\n${slug}-diaporama.html   présentation : flèches, F plein écran, P vue présentateur\n${slug}-impression.html  version paginée, imprimable depuis le navigateur\n${withPdf ? `${slug}.pdf              PDF\n` : ''}document.md            source Markdown\nstudio.json            réglages de mise en forme (à réimporter dans Document Studio)\nassets/                images et médias\n`);
  return { zip: Buffer.from(zipSync(files, { level: 6 })), filename: `${slug}.zip` };
}
