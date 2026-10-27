// Point d'entrée du moteur documentaire (navigateur et Node).
export * from './types.ts';
export { parse, slugify, textOf } from './parse.ts';
export { parseAttrs } from './scanner.ts';
export { COMPONENTS, BY_NAME, type ComponentSpec, type AttrSpec } from './registry.ts';
export { render, sanitizeCss, SLIDE_SIZES, type RenderResult } from './targets.ts';
export {
  BUILTIN_TEMPLATES, DEFAULT_TOKENS, DEFAULT_PAGE, DEFAULT_SLIDES, DEFAULT_READING, DEFAULT_SETTINGS,
  resolveTheme, merge, contrast, contrastReport, tokensCss, parseColor, mix, isDark, alternatePalette,
} from './themes.ts';
export { esc, safeHref, safeSrc } from './html.ts';
export { fontFaceCss, FONT_FAMILIES, FONT_MANIFEST, type FontFace } from './fonts.ts';
export * from './collab.ts';
