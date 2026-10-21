// Catalogue des polices embarquées (fonts/fonts.json, généré par scripts/collect-fonts.mjs).
import manifest from '../fonts/fonts.json';

export interface FontFace { file: string; style: string; weight: string; unicodeRange: string }
export const FONT_MANIFEST = manifest as Record<string, FontFace[]>;

export const FONT_FAMILIES: { family: string; kind: 'sans' | 'serif' | 'mono' | 'display' }[] = [
  { family: 'Inter', kind: 'sans' }, { family: 'IBM Plex Sans', kind: 'sans' }, { family: 'DM Sans', kind: 'sans' },
  { family: 'Lexend', kind: 'sans' }, { family: 'Space Grotesk', kind: 'sans' },
  { family: 'Source Serif 4', kind: 'serif' }, { family: 'Newsreader', kind: 'serif' }, { family: 'Fraunces', kind: 'serif' },
  { family: 'Anton', kind: 'display' },
  { family: 'JetBrains Mono', kind: 'mono' }, { family: 'IBM Plex Mono', kind: 'mono' },
];

/** @font-face pour les familles demandées ; `url` donne l'adresse (ou les données) de chaque fichier. */
export function fontFaceCss(families: string[], url: (file: string) => string, extra: Record<string, FontFace[]> = {}): string {
  const all = { ...FONT_MANIFEST, ...extra };
  return families.flatMap(f => (all[f] || []).map(face =>
    `@font-face{font-family:"${f}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url("${url(face.file)}") format("woff2");unicode-range:${face.unicodeRange}}`,
  )).join('\n');
}
