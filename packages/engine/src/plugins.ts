// Plugins de composants : un composant StudioMD déclaré par un fichier JSON, sans code exécutable.
// Le plugin fournit une syntaxe (nom, attributs typés), un gabarit HTML par cible et du CSS.
// Le gabarit est nettoyé à l'installation ; chaque valeur insérée est échappée selon son type.
//
//   {{titre}}              valeur de l'attribut « titre », échappée
//   {{content}}            contenu Markdown du bloc, déjà rendu
//   {{#titre}}…{{/titre}}  partie affichée seulement si « titre » est renseigné
//   {{^titre}}…{{/titre}}  partie affichée seulement s'il ne l'est pas

import type { Target } from './types.ts';
import { BY_NAME, COMPONENTS, type AttrSpec, type ComponentSpec } from './registry.ts';
import { esc, safeColor, safeHref, safeSrc } from './html.ts';

export interface ComponentPlugin {
  /** Identifiant du plugin (minuscules, chiffres, tirets). */
  id: string;
  /** Nom du composant tel qu'on l'écrit après « ::: ». */
  name: string;
  label: string;
  description?: string;
  version?: string;
  author?: string;
  content: 'markdown' | 'none';
  attrs?: Record<string, AttrSpec>;
  /** Gabarit HTML commun aux trois sorties, remplacé au besoin par cible. */
  template: string;
  targets?: Partial<Record<Target, string>>;
  css?: string;
  example?: string;
}

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const ATTR_TYPES = ['string', 'number', 'boolean', 'enum', 'color', 'url'];
let installed: { plugin: ComponentPlugin; spec: ComponentSpec }[] = [];
/** Noms (et alias) des composants intégrés, figés avant toute installation. */
const BUILTIN = new Set(BY_NAME.keys());

/** Retire du gabarit tout ce qui pourrait exécuter du code ou charger une ressource tierce. */
export function cleanTemplate(html: string): string {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|frameset|form|svg|math|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|frame|frameset|link|meta|base|form|svg|math|template)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|frame|frameset|link|meta|base|form|svg|math|template)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(srcdoc|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|poster)\s*=\s*(["']?)\s*(javascript|vbscript|data):[^"'\s>]*\2/gi, '$1=$2#$2');
}

/** Vérifie un plugin. Retourne la liste des problèmes (vide si le plugin est valable). */
export function checkPlugin(p: unknown): string[] {
  const out: string[] = [];
  const x = p as ComponentPlugin;
  if (!x || typeof x !== 'object') return ['Le plugin doit être un objet JSON.'];
  if (!ID.test(String(x.id || ''))) out.push('« id » : minuscules, chiffres et tirets, 2 à 41 caractères.');
  if (!ID.test(String(x.name || ''))) out.push('« name » : minuscules, chiffres et tirets, 2 à 41 caractères.');
  if (!String(x.label || '').trim()) out.push('« label » est obligatoire.');
  if (x.content !== 'markdown' && x.content !== 'none') out.push('« content » vaut « markdown » ou « none ».');
  if (typeof x.template !== 'string' || !x.template.trim()) out.push('« template » est obligatoire.');
  for (const [k, a] of Object.entries(x.attrs || {})) {
    if (!/^[a-z][\w-]{0,30}$/i.test(k) || k === 'content') out.push(`Attribut « ${k} » : nom invalide.`);
    if (!a || !ATTR_TYPES.includes(a.type)) out.push(`Attribut « ${k} » : type parmi ${ATTR_TYPES.join(', ')}.`);
    if (a?.type === 'enum' && (!Array.isArray(a.values) || !a.values.length)) out.push(`Attribut « ${k} » : « values » obligatoire pour un enum.`);
  }
  if (BUILTIN.has(String(x.name))) out.push(`« ${x.name} » est déjà un composant intégré.`);
  return out;
}

/** Installe la liste de plugins (remplace la précédente). Les plugins invalides sont écartés et signalés. */
export function registerPlugins(list: unknown[]): { installed: ComponentPlugin[]; errors: { id: string; problems: string[] }[] } {
  for (const i of installed) {
    BY_NAME.delete(i.spec.name);
    const k = COMPONENTS.indexOf(i.spec);
    if (k >= 0) COMPONENTS.splice(k, 1);
  }
  installed = [];
  const errors: { id: string; problems: string[] }[] = [];
  for (const raw of list || []) {
    const problems = checkPlugin(raw);
    const p = raw as ComponentPlugin;
    if (!problems.length && installed.some(i => i.plugin.name === p.name)) problems.push(`Deux plugins déclarent « ${p.name} ».`);
    if (problems.length) { errors.push({ id: String(p?.id || '?'), problems }); continue; }
    const plugin: ComponentPlugin = {
      ...p, attrs: p.attrs || {}, template: cleanTemplate(p.template), css: p.css || '',
      targets: Object.fromEntries(Object.entries(p.targets || {}).filter(([k, v]) => ['reading', 'print', 'slides'].includes(k) && typeof v === 'string').map(([k, v]) => [k, cleanTemplate(v as string)])),
    };
    const spec: ComponentSpec = {
      name: plugin.name, category: 'Extensions', label: plugin.label, description: plugin.description || plugin.label,
      content: plugin.content, attrs: plugin.attrs!, plugin: plugin.id,
      targets: { reading: 'Gabarit du plugin.', print: plugin.targets?.print ? 'Gabarit propre à l\'impression.' : 'Gabarit du plugin.', slides: plugin.targets?.slides ? 'Gabarit propre au diaporama.' : 'Gabarit du plugin.' },
      example: plugin.example || `:::${plugin.name}${Object.entries(plugin.attrs!).filter(([, a]) => a.required).map(([k]) => ` {${k}=""}`).join('')}\n${plugin.content === 'markdown' ? 'Contenu\n' : ''}:::`,
    };
    COMPONENTS.push(spec);
    BY_NAME.set(spec.name, { spec, implied: {} });
    installed.push({ plugin, spec });
  }
  return { installed: installed.map(i => i.plugin), errors };
}

export const installedPlugins = () => installed.map(i => i.plugin);
export const pluginFor = (name: string) => installed.find(i => i.plugin.name === name)?.plugin;

/** Valeur d'attribut prête à insérer, selon son type déclaré. */
function value(a: AttrSpec | undefined, v: string | true | undefined): string {
  const raw = v === true ? 'true' : v ?? a?.default ?? '';
  if (!a || raw === '') return esc(raw);
  switch (a.type) {
    case 'number': return isFinite(Number(raw)) ? String(Number(raw)) : esc(a.default ?? '');
    case 'boolean': return raw === 'true' || raw === '' ? 'true' : 'false';
    case 'enum': return esc(a.values?.includes(raw) ? raw : a.default ?? a.values?.[0] ?? '');
    case 'color': return esc(safeColor(raw) ?? a.default ?? '');
    case 'url': return esc(safeHref(raw) ?? safeSrc(raw) ?? '#');
    default: return esc(raw);
  }
}

/** Rendu d'un composant de plugin. `content` est le HTML déjà rendu des enfants. */
export function renderPlugin(p: ComponentPlugin, target: Target, attrs: Record<string, string | true>, content: string, lineAttr: string): string {
  const tpl = p.targets?.[target] ?? p.template;
  const set = (k: string) => attrs[k] !== undefined && attrs[k] !== '' && attrs[k] !== 'false';
  let html = tpl.replace(/\{\{([#^])([\w-]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_, kind, k, inner) => ((kind === '#') === (k === 'content' ? !!content.trim() : set(k)) ? inner : ''));
  html = html.replace(/\{\{([\w-]+)\}\}/g, (_, k) => (k === 'content' ? '\u0000CONTENT\u0000' : value(p.attrs?.[k], attrs[k])));
  html = html.split('\u0000CONTENT\u0000').join(content);
  return `<div class="sd-plugin sd-plugin-${esc(p.name)}" data-plugin="${esc(p.id)}"${lineAttr}>${html}</div>`;
}

/** CSS des plugins utilisés par le document. */
export function pluginCss(names: Set<string>, sanitize: (css: string) => string): string {
  return installed.filter(i => names.has(i.plugin.name) && i.plugin.css).map(i => `/* plugin ${i.plugin.id} */\n${sanitize(i.plugin.css!)}`).join('\n');
}
