// Stockage local : un dossier par document, des fichiers ordinaires lisibles sans l'application.
//
//   <home>/documents/<id>/document.md     source courante
//                         original.md     source importée, jamais modifiée
//                         studio.json     nom, projet, réglages de design, dates
//                         assets/         images et médias
//                         history/        instantanés horodatés de la source
//   <home>/themes/<id>.json               gabarits personnalisés
//   <home>/trash/                         documents supprimés (récupérables à la main)

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { slugify, type DocSettings, type Template } from '@studio/engine';

export const HOME = process.env.STUDIO_HOME || join(homedir(), 'DocumentStudio');
const DOCS = join(HOME, 'documents');
const THEMES = join(HOME, 'themes');
const TRASH = join(HOME, 'trash');
for (const d of [DOCS, THEMES, TRASH]) mkdirSync(d, { recursive: true });

const HISTORY_EVERY_MS = 2 * 60_000;
const HISTORY_KEEP = 60;

export interface DocMetaFile {
  name: string;
  project: string;
  settings: Partial<DocSettings>;
  createdAt: string;
  updatedAt: string;
  importedFrom?: string;
}

export interface DocSummary {
  id: string; name: string; project: string; mode: string; templateId: string;
  createdAt: string; updatedAt: string; words: number; size: number;
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const dirOf = (id: string) => {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant de document invalide.');
  const d = join(DOCS, id);
  if (!existsSync(join(d, 'studio.json'))) throw new HttpError(404, 'Document introuvable.');
  return d;
};
export const docDir = dirOf;

/** Nom de fichier sûr pour une ressource (pas de chemin, pas de caractères spéciaux). */
export function safeAssetName(name: string): string {
  const base = basename(String(name)).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clean = base.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120);
  if (!clean || !/\.[a-z0-9]{2,5}$/i.test(clean)) throw new HttpError(400, 'Nom de fichier invalide (extension requise).');
  return clean;
}

const readMeta = (dir: string): DocMetaFile => JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
const writeMeta = (dir: string, m: DocMetaFile) => writeFileSync(join(dir, 'studio.json'), JSON.stringify(m, null, 2));
/** Écriture atomique : on écrit à côté puis on renomme, pour ne jamais laisser un fichier tronqué. */
const writeAtomic = (file: string, data: string | Buffer) => { const tmp = file + '.tmp'; writeFileSync(tmp, data); renameSync(tmp, file); };
const words = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

export function listDocs(): DocSummary[] {
  const out: DocSummary[] = [];
  for (const id of readdirSync(DOCS)) {
    const dir = join(DOCS, id);
    if (!existsSync(join(dir, 'studio.json'))) continue;
    try {
      const m = readMeta(dir);
      const md = readFileSync(join(dir, 'document.md'), 'utf8');
      out.push({ id, name: m.name, project: m.project || '', mode: m.settings.mode || 'reading', templateId: m.settings.templateId || 'corporate', createdAt: m.createdAt, updatedAt: m.updatedAt, words: words(md), size: md.length });
    } catch { /* dossier corrompu : ignoré dans la liste, laissé intact sur disque */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listAssets(dir: string) {
  const a = join(dir, 'assets');
  if (!existsSync(a)) return [];
  return readdirSync(a).filter(f => !f.endsWith('.tmp')).map(f => ({ name: f, size: statSync(join(a, f)).size }));
}

export function getDoc(id: string) {
  const dir = dirOf(id);
  const m = readMeta(dir);
  return {
    id, ...m,
    markdown: readFileSync(join(dir, 'document.md'), 'utf8'),
    assets: listAssets(dir),
    hasOriginal: existsSync(join(dir, 'original.md')),
  };
}

export function createDoc(input: { name?: string; project?: string; markdown?: string; settings?: Partial<DocSettings>; importedFrom?: string }) {
  const name = (input.name || '').trim() || 'Sans titre';
  const id = `${slugify(name).slice(0, 48)}-${randomBytes(3).toString('hex')}`;
  const dir = join(DOCS, id);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const md = input.markdown ?? `# ${name}\n\n`;
  writeFileSync(join(dir, 'document.md'), md);
  if (input.importedFrom) writeFileSync(join(dir, 'original.md'), md);
  const now = new Date().toISOString();
  writeMeta(dir, { name, project: input.project || '', settings: input.settings || {}, createdAt: now, updatedAt: now, importedFrom: input.importedFrom });
  return getDoc(id);
}

export function updateDoc(id: string, patch: { markdown?: string; settings?: Partial<DocSettings>; name?: string; project?: string }) {
  const dir = dirOf(id);
  const m = readMeta(dir);
  if (typeof patch.markdown === 'string') {
    const file = join(dir, 'document.md');
    const before = readFileSync(file, 'utf8');
    if (before !== patch.markdown) {
      snapshot(dir, before);
      writeAtomic(file, patch.markdown);
    }
  }
  if (patch.settings) m.settings = patch.settings;
  if (typeof patch.name === 'string' && patch.name.trim()) m.name = patch.name.trim().slice(0, 200);
  if (typeof patch.project === 'string') m.project = patch.project.trim().slice(0, 120);
  m.updatedAt = new Date().toISOString();
  writeMeta(dir, m);
  return { updatedAt: m.updatedAt };
}

/** Instantané de la version précédente, au plus un toutes les deux minutes. */
function snapshot(dir: string, content: string) {
  const h = join(dir, 'history');
  mkdirSync(h, { recursive: true });
  const files = readdirSync(h).filter(f => f.endsWith('.md')).sort();
  const last = files[files.length - 1];
  if (last && Date.now() - statSync(join(h, last)).mtimeMs < HISTORY_EVERY_MS) return;
  writeFileSync(join(h, new Date().toISOString().replace(/[:.]/g, '-') + '.md'), content);
  for (const old of files.slice(0, Math.max(0, files.length + 1 - HISTORY_KEEP))) rmSync(join(h, old));
}

export function listHistory(id: string) {
  const h = join(dirOf(id), 'history');
  if (!existsSync(h)) return [];
  return readdirSync(h).filter(f => f.endsWith('.md')).sort().reverse().map(f => ({ id: f.replace(/\.md$/, ''), size: statSync(join(h, f)).size, at: statSync(join(h, f)).mtime.toISOString() }));
}

export function readHistory(id: string, snap: string) {
  if (!/^[\dT-]+Z$/.test(snap)) throw new HttpError(400, 'Instantané invalide.');
  const f = join(dirOf(id), 'history', snap + '.md');
  if (!existsSync(f)) throw new HttpError(404, 'Instantané introuvable.');
  return readFileSync(f, 'utf8');
}

export function duplicateDoc(id: string) {
  const src = getDoc(id);
  const copy = createDoc({ name: `${src.name} (copie)`, project: src.project, markdown: src.markdown, settings: src.settings });
  cpSync(join(dirOf(id), 'assets'), join(dirOf(copy.id), 'assets'), { recursive: true });
  return getDoc(copy.id);
}

export function deleteDoc(id: string) {
  const dir = dirOf(id);
  renameSync(dir, join(TRASH, `${id}-${Date.now()}`));
}

export function readOriginal(id: string, original: boolean) {
  const dir = dirOf(id);
  const f = join(dir, original && existsSync(join(dir, 'original.md')) ? 'original.md' : 'document.md');
  return readFileSync(f, 'utf8');
}

export function assetPath(id: string, name: string) {
  return join(dirOf(id), 'assets', safeAssetName(name));
}

export function putAsset(id: string, name: string, data: Buffer) {
  const clean = safeAssetName(name);
  const dir = join(dirOf(id), 'assets');
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, clean), data);
  return { name: clean, size: data.length };
}

export function deleteAsset(id: string, name: string) {
  const f = assetPath(id, name);
  if (existsSync(f)) rmSync(f);
}

/* ---------- Gabarits personnalisés ---------- */

export function listThemes(): Template[] {
  return readdirSync(THEMES).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return [JSON.parse(readFileSync(join(THEMES, f), 'utf8'))]; } catch { return []; }
  });
}

export function saveTheme(t: Template): Template {
  if (!t || typeof t !== 'object' || !t.tokens) throw new HttpError(400, 'Gabarit invalide : « tokens » manquant.');
  const id = t.id && ID.test(t.id) && !t.builtin ? t.id : `${slugify(t.name || 'gabarit').slice(0, 40)}-${randomBytes(3).toString('hex')}`;
  const clean: Template = { ...t, id, builtin: false, name: String(t.name || 'Gabarit').slice(0, 80) };
  writeFileSync(join(THEMES, id + '.json'), JSON.stringify(clean, null, 2));
  return clean;
}

export function deleteTheme(id: string) {
  if (!ID.test(id)) throw new HttpError(400, 'Identifiant invalide.');
  const f = join(THEMES, id + '.json');
  if (existsSync(f)) rmSync(f);
}
