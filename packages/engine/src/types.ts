// Modèle documentaire intermédiaire (IR) et paramètres de rendu.
// Le contenu (IR) ne porte aucune propriété visuelle : le thème et les réglages de sortie
// arrivent séparément au moment du rendu.

import type { Root, RootContent } from 'mdast';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  line: number;          // 1-indexé, dans la source complète (front matter inclus)
  endLine?: number;
  code: string;          // ex. 'unknown-component', 'unclosed-component'
}

export type Attrs = Record<string, string | true>;

/** Nœud de composant StudioMD, inséré dans l'arbre mdast. */
export interface ComponentNode {
  type: 'component';
  name: string;           // nom canonique (alias résolus)
  given: string;          // nom tel qu'écrit dans la source
  attrs: Attrs;
  classes: string[];
  id?: string;
  children: Block[];
  data?: unknown;         // contenu « données » (ex. stats) déjà analysé
  raw?: string;           // contenu brut pour les composants « raw »
  known: boolean;
  line: number;
  endLine: number;
}

export type Block = RootContent | ComponentNode;

export interface Heading {
  id: string;
  depth: number;
  text: string;
  line: number;
  number?: string;        // « 2.3 » quand la numérotation est active
}

export interface DocMeta {
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  organization?: string;
  lang?: string;
  version?: string;
  [k: string]: unknown;
}

export interface DocumentIR {
  meta: DocMeta;
  blocks: Block[];
  headings: Heading[];
  assets: string[];              // chemins d'images référencés, tels qu'écrits
  diagnostics: Diagnostic[];
  frontmatterLines: number;      // lignes occupées par le front matter
  titleBlocks: number;           // blocs de tête repris par l'en-tête (titre déduit du premier H1)
}

export type Target = 'reading' | 'print' | 'slides';

/* ---------- Thème ---------- */

export interface ThemeTokens {
  fonts: { heading: string; body: string; mono: string };
  type: {
    baseSize: number;          // px, page de lecture
    printSize: number;         // pt, document imprimé
    slideSize: number;         // px, sur la toile de diapositive (1920 de large)
    scale: number;             // rapport entre deux niveaux de titre
    lineHeight: number;
    headingLineHeight: number;
    headingWeight: number;
    bodyWeight: number;
    headingTracking: number;   // em
    bodyTracking: number;      // em
    headingCase: 'none' | 'uppercase';
    measure: number;           // largeur de lecture, en ch
    align: 'left' | 'justify';
    hyphenate: boolean;
    paragraphSpacing: number;  // em
    headingSpaceBefore: number;// em
  };
  colors: {
    primary: string; secondary: string; accent: string;
    text: string; muted: string; bg: string; surface: string; border: string; link: string;
    info: string; success: string; warning: string; danger: string;
    codeBg: string; codeText: string;
    slideBg: string; slideText: string; slideAccent: string;
  };
  layout: {
    radius: number;            // px
    shadow: boolean;
    tableStyle: 'lines' | 'zebra' | 'grid' | 'minimal';
    headingStyle: 'plain' | 'rule' | 'bar' | 'numbered-margin' | 'underline';
    numbering: boolean;        // numérotation des sections
    numberingDepth: number;
    listMarker: 'disc' | 'dash' | 'square';
    quoteStyle: 'rule' | 'large' | 'plain';
    imageAlign: 'center' | 'left' | 'full';
    cover: 'none' | 'minimal' | 'band' | 'full' | 'split';
    toc: boolean;
    density: number;           // multiplicateur des espacements verticaux
  };
}

export interface PageSettings {
  size: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'custom';
  width: number;   // mm, pour 'custom'
  height: number;  // mm, pour 'custom'
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number }; // mm
  header: { left: string; center: string; right: string };
  footer: { left: string; center: string; right: string };
  headerOnFirst: boolean;
  repeatTableHeaders: boolean;
  breakBeforeH1: boolean;
  columns: 1 | 2;
}

export interface SlideSettings {
  aspect: '16:9' | '4:3' | '16:10' | 'custom';
  width: number;  // px, pour 'custom'
  height: number;
  split: 'h1' | 'h2' | 'h3' | 'manual';  // niveau de titre qui ouvre une slide
  ruleSplits: boolean;                   // une ligne --- coupe aussi
  transition: 'none' | 'fade' | 'slide' | 'zoom';
  numbers: boolean;
  progress: boolean;
  cover: boolean;
  closing: string;                       // texte de la slide de conclusion ('' = aucune)
}

export interface ReadingSettings {
  toc: 'side' | 'top' | 'none';
  progress: boolean;
  search: boolean;
  colorScheme: 'template' | 'inverse' | 'auto';
}

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  kind: 'document' | 'slides' | 'both';
  builtin?: boolean;
  basedOn?: string;
  tokens: ThemeTokens;
  page: Partial<PageSettings>;
  slides: Partial<SlideSettings>;
  css?: string;               // règles propres au gabarit (gabarits intégrés : de confiance)
}

/** Réglages enregistrés avec un document. */
export interface DocSettings {
  mode: Target;
  templateId: string;
  overrides: DeepPartial<ThemeTokens>;
  page: Partial<PageSettings>;
  slides: Partial<SlideSettings>;
  reading: Partial<ReadingSettings>;
  meta: DocMeta;              // surcharges des métadonnées (le front matter reste prioritaire)
  customCss: string;
  /** Polices importées : fichier (ressource du document) et nom de famille. */
  fonts?: { family: string; file: string; weight?: string; style?: string }[];
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Résolution des ressources : URL d'aperçu ou données intégrées pour l'export autonome. */
export interface RenderEnv {
  /** Transforme un chemin d'image écrit dans la source en URL utilisable. null = introuvable. */
  resolveAsset: (src: string) => string | null;
  /** CSS @font-face pour les familles demandées. */
  fontCss: (families: string[]) => string;
  /** Script Paged.js : URL (aperçu) ou contenu (export). */
  pagedjs: { src?: string; inline?: string };
  /** Contexte : aperçu dans l'application ou fichier exporté. */
  context: 'preview' | 'export';
  /** CSS de KaTeX (polices comprises) pour les formules. */
  katexCss?: string;
}
