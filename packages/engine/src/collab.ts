// Règles communes au serveur et à l'interface : rôles, validation, différences, fusion, blocs inclus.
import { diffChars, diffLines, diffWordsWithSpace } from 'diff';
import { merge as diff3 } from 'node-diff3';
import { parseAttrs } from './scanner.ts';
import type { DocSettings, PageSettings, ThemeTokens } from './types.ts';

/* ---------- Rôles ---------- */

export type Role = 'viewer' | 'commenter' | 'editor' | 'owner';
export const ROLES: Role[] = ['viewer', 'commenter', 'editor', 'owner'];
export const ROLE_LABELS: Record<Role, string> = { viewer: 'Lecteur', commenter: 'Commentateur', editor: 'Éditeur', owner: 'Propriétaire' };
export type Action =
  | 'read' | 'download' | 'comment' | 'suggest' | 'edit' | 'resolve' | 'decide-suggestion'
  | 'restore' | 'share' | 'publish' | 'workflow' | 'delete';

const MIN_ROLE: Record<Action, Role> = {
  read: 'viewer', download: 'viewer', comment: 'commenter', suggest: 'commenter', edit: 'editor',
  resolve: 'editor', 'decide-suggestion': 'editor', restore: 'owner', share: 'owner', publish: 'owner',
  workflow: 'editor', delete: 'owner',
};
export const rank = (r: Role | null | undefined) => (r ? ROLES.indexOf(r) : -1);
export const can = (role: Role | null | undefined, action: Action) => rank(role) >= rank(MIN_ROLE[action]);
export const maxRole = (a: Role | null, b: Role | null): Role | null => (rank(a) >= rank(b) ? a : b);

/* ---------- Validation éditoriale ---------- */

export type WorkflowState = 'draft' | 'review' | 'changes' | 'pending' | 'approved' | 'published' | 'archived';
export const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  draft: 'Brouillon', review: 'En révision', changes: 'À corriger', pending: 'En attente de validation',
  approved: 'Approuvé', published: 'Publié', archived: 'Archivé',
};
export interface Review { userId: string; decision: 'pending' | 'approved' | 'changes'; at?: string; note?: string }
export interface Workflow { state: WorkflowState; reviewers: Review[]; requiredApprovals: number; approvedVersion?: number }
export const DEFAULT_WORKFLOW: Workflow = { state: 'draft', reviewers: [], requiredApprovals: 0 };

/** Une publication officielle exige les validations demandées, données sur la version courante. */
export function publishBlockers(w: Workflow, currentVersion: number): string[] {
  const out: string[] = [];
  const approved = w.reviewers.filter(r => r.decision === 'approved').length;
  if (approved < w.requiredApprovals) out.push(`${approved} validation(s) sur ${w.requiredApprovals} requise(s).`);
  if (w.requiredApprovals > 0 && w.approvedVersion !== undefined && w.approvedVersion < currentVersion)
    out.push('Le document a changé depuis la validation : elle doit être renouvelée.');
  if (w.reviewers.some(r => r.decision === 'changes')) out.push('Un relecteur a demandé des corrections.');
  if (w.state === 'archived') out.push('Le document est archivé.');
  return out;
}

/* ---------- Différences ---------- */

export interface ChangeStats { added: number; removed: number; sectionsAdded: string[]; sectionsRemoved: string[]; summary: string }

const headings = (md: string) => md.split('\n').filter(l => /^#{1,3} /.test(l)).map(l => l.replace(/^#+ /, '').trim());
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Résumé lisible des changements entre deux versions de la source. */
export function changeStats(before: string, after: string): ChangeStats {
  let added = 0, removed = 0;
  for (const p of diffWordsWithSpace(before, after)) {
    if (p.added) added += words(p.value);
    else if (p.removed) removed += words(p.value);
  }
  const hb = new Set(headings(before)), ha = new Set(headings(after));
  const sectionsAdded = [...ha].filter(h => !hb.has(h));
  const sectionsRemoved = [...hb].filter(h => !ha.has(h));
  const parts: string[] = [];
  if (sectionsAdded.length) parts.push(`section${sectionsAdded.length > 1 ? 's' : ''} ajoutée${sectionsAdded.length > 1 ? 's' : ''} : ${sectionsAdded.slice(0, 3).join(', ')}`);
  if (sectionsRemoved.length) parts.push(`section${sectionsRemoved.length > 1 ? 's' : ''} supprimée${sectionsRemoved.length > 1 ? 's' : ''} : ${sectionsRemoved.slice(0, 3).join(', ')}`);
  if (added) parts.push(`+${added} mot${added > 1 ? 's' : ''}`);
  if (removed) parts.push(`−${removed} mot${removed > 1 ? 's' : ''}`);
  return { added, removed, sectionsAdded, sectionsRemoved, summary: parts.join(' · ') || 'aucun changement de texte' };
}

export interface DiffLine { kind: 'same' | 'added' | 'removed' | 'changed'; old?: number; new?: number; parts: { text: string; kind: 'same' | 'added' | 'removed' }[] }

/** Différence ligne à ligne, affinée au mot près dans les lignes modifiées. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const out: DiffLine[] = [];
  let o = 1, n = 1;
  const chunks = diffLines(before.endsWith('\n') ? before : before + '\n', after.endsWith('\n') ? after : after + '\n');
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const lines = c.value.replace(/\n$/, '').split('\n');
    const next = chunks[i + 1];
    if (c.removed && next?.added) {
      const nl = next.value.replace(/\n$/, '').split('\n');
      const pairs = Math.max(lines.length, nl.length);
      for (let k = 0; k < pairs; k++) {
        const a = lines[k], b = nl[k];
        if (a !== undefined && b !== undefined) {
          out.push({ kind: 'changed', old: o++, new: n++, parts: diffWordsWithSpace(a, b).map(p => ({ text: p.value, kind: p.added ? 'added' : p.removed ? 'removed' : 'same' })) });
        } else if (a !== undefined) out.push({ kind: 'removed', old: o++, parts: [{ text: a, kind: 'removed' }] });
        else out.push({ kind: 'added', new: n++, parts: [{ text: b!, kind: 'added' }] });
      }
      i++;
      continue;
    }
    for (const l of lines) {
      if (c.added) out.push({ kind: 'added', new: n++, parts: [{ text: l, kind: 'added' }] });
      else if (c.removed) out.push({ kind: 'removed', old: o++, parts: [{ text: l, kind: 'removed' }] });
      else out.push({ kind: 'same', old: o++, new: n++, parts: [{ text: l, kind: 'same' }] });
    }
  }
  return out;
}

/** Différence des réglages (thème, page…), présentée à part des changements de contenu. */
export function settingsDiff(a: unknown, b: unknown, prefix = ''): { path: string; before: unknown; after: unknown }[] {
  const out: { path: string; before: unknown; after: unknown }[] = [];
  const isO = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isO(a) && isO(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...settingsDiff(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: prefix, before: a, after: b });
  return out;
}

/* ---------- Fusion à trois voies (branches) ---------- */

export interface MergeResult { text: string; conflicts: number }

/** Fusionne une branche dans le document principal à partir de leur ancêtre commun.
 *  Les conflits sont laissés dans le texte, entre marqueurs explicites, pour être tranchés à la main. */
export function threeWayMerge(base: string, main: string, branch: string): MergeResult {
  const r = diff3(main.split('\n'), base.split('\n'), branch.split('\n'), {
    stringSeparator: '\n',
  } as any) as { conflict: boolean; result: string[] };
  const text = r.result.join('\n')
    .replace(/^<<<<<<<.*$/gm, '<<<<<<< document principal')
    .replace(/^>>>>>>>.*$/gm, '>>>>>>> branche');
  const conflicts = (text.match(/^<<<<<<< /gm) || []).length;
  return { text, conflicts };
}

/* ---------- Blocs réutilisables ---------- */

export interface BlockVersion { version: number; markdown: string; at: string; author?: string }
export interface LibBlock { id: string; name: string; description?: string; versions: BlockVersion[]; updatedAt: string }

const INCLUDE = /^ {0,3}:{3,}\s*include\s*(\{.*\})?\s*(:{3,})?\s*$/;

export interface IncludeRef { line: number; block: string; version?: number; short: boolean }

/** Repère les inclusions de blocs liés : `:::include {block="id" version=2} :::`. */
export function findIncludes(md: string): IncludeRef[] {
  const out: IncludeRef[] = [];
  let fence = false;
  md.split('\n').forEach((l, i) => {
    if (/^ {0,3}(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && INCLUDE.exec(l);
    if (!m) return;
    const a = parseAttrs(m[1]).attrs;
    if (typeof a.block === 'string') out.push({ line: i + 1, block: a.block, version: a.version ? Number(a.version) : undefined, short: !!m[2] });
  });
  return out;
}

/* ---------- Suivi des modifications (mode suggestion) ---------- */

export interface Hunk { from: number; to: number; insert: string }

/** Changements entre le texte de départ et le texte modifié, en positions du texte de départ.
 *  Découpés au mot : chaque morceau devient une suggestion que l'on accepte ou refuse séparément. */
export function suggestionHunks(base: string, edited: string): Hunk[] {
  const out: Hunk[] = [];
  let pos = 0;
  let cur: Hunk | null = null;
  let gap = '';            // espace inchangé entre deux changements, réuni seulement si un changement suit
  for (const p of diffWordsWithSpace(base, edited)) {
    if (!p.added && !p.removed) {
      if (cur && !gap && /^[ \t]$/.test(p.value)) { gap = p.value; pos += 1; continue; }
      if (cur) { out.push(cur); cur = null; }
      gap = '';
      pos += p.value.length;
      continue;
    }
    if (cur && gap) { cur.to += gap.length; cur.insert += gap; }
    gap = '';
    cur ||= { from: pos, to: pos, insert: '' };
    if (p.removed) { cur.to += p.value.length; pos += p.value.length; } else cur.insert += p.value;
  }
  if (cur) out.push(cur);
  return out;
}

/** Correspondance des positions d'un texte vers une version plus récente (modifications des autres). */
export function offsetMapper(before: string, after: string): (pos: number, assoc?: -1 | 1) => number | null {
  if (before === after) return p => p;
  const parts = diffChars(before, after);
  return (pos, assoc = 1) => {
    let a = 0, b = 0;
    for (const p of parts) {
      const n = p.value.length;
      if (p.added) { if (a === pos && assoc < 0) return b; b += n; continue; }
      if (p.removed) { if (pos >= a && pos < a + n) return null; a += n; continue; }
      if (pos >= a && pos <= a + n) return b + (pos - a);
      a += n; b += n;
    }
    return pos === a ? b : null;
  };
}

/* ---------- Préférences de notification ---------- */

export type NotifCategory = 'invite' | 'mention' | 'comment' | 'suggestion' | 'review' | 'published' | 'activity';
export type NotifChannel = 'off' | 'app' | 'email';
export const NOTIF_CATEGORIES: { key: NotifCategory; label: string; help: string }[] = [
  { key: 'invite', label: 'Invitations', help: 'On vous donne accès à un document ou à un espace.' },
  { key: 'mention', label: 'Mentions et assignations', help: 'On vous cite avec @ ou on vous confie un commentaire.' },
  { key: 'comment', label: 'Commentaires et réponses', help: 'Sur vos documents et dans vos fils de discussion.' },
  { key: 'suggestion', label: 'Suggestions', help: 'Propositions à examiner, décisions sur les vôtres.' },
  { key: 'review', label: 'Relectures et validations', help: 'Demandes de relecture, validations, corrections demandées.' },
  { key: 'published', label: 'Publications', help: 'Un document que vous suivez est publié.' },
  { key: 'activity', label: 'Autres changements', help: 'Restauration d\'une version, fusion de branche.' },
];
export const DEFAULT_NOTIF_PREFS: Record<NotifCategory, NotifChannel> = {
  invite: 'email', mention: 'email', comment: 'app', suggestion: 'app', review: 'email', published: 'app', activity: 'app',
};
/** Type d'événement -> catégorie de préférence. */
export function notifCategory(type: string): NotifCategory {
  if (type === 'invite' || type === 'space') return 'invite';
  if (type === 'mention' || type === 'assigned') return 'mention';
  if (type === 'comment' || type === 'reply' || type === 'zone') return 'comment';
  if (type === 'suggestion' || type === 'decision') return 'suggestion';
  if (type === 'review') return 'review';
  if (type === 'published') return 'published';
  return 'activity';
}

/* ---------- Identités visuelles ---------- */

export interface BrandLogo { file: string; label: string }
export interface Brand {
  id: string; name: string; description?: string; version: number; updatedAt: string;
  owner: string; space?: string;
  colors: Partial<ThemeTokens['colors']>;
  fonts: Partial<ThemeTokens['fonts']>;
  templateId?: string;
  logos: BrandLogo[];
  /** Bloc de couverture en StudioMD (:::cover … :::), inséré à la demande. */
  cover?: string;
  header?: Partial<PageSettings['header']>;
  footer?: Partial<PageSettings['footer']>;
  organization?: string;
  history: { version: number; at: string; author: string; summary: string }[];
}

/** Applique une identité aux réglages d'un document. Le texte n'est jamais modifié. */
export function applyBrand(s: Partial<DocSettings>, b: Brand): Partial<DocSettings> {
  const o = s.overrides || {};
  const clean = <T extends object>(x: T | undefined) => Object.fromEntries(Object.entries(x || {}).filter(([, v]) => v !== '' && v != null)) as Partial<T>;
  const page = { ...(s.page || {}) };
  if (b.header && Object.values(b.header).some(Boolean)) page.header = { left: '', center: '', right: '', ...page.header, ...clean(b.header) };
  if (b.footer && Object.values(b.footer).some(Boolean)) page.footer = { left: '', center: '', right: '', ...page.footer, ...clean(b.footer) };
  return {
    ...s,
    templateId: b.templateId || s.templateId,
    overrides: { ...o, colors: { ...(o.colors || {}), ...clean(b.colors) }, fonts: { ...(o.fonts || {}), ...clean(b.fonts) } },
    page,
    meta: { ...(s.meta || {}), ...(b.organization ? { organization: b.organization } : {}) },
    brand: { id: b.id, version: b.version, name: b.name },
  };
}

/** Résumé lisible de ce qui change entre deux états d'une identité. */
export function brandSummary(a: Partial<Brand> | undefined, b: Brand): string {
  if (!a) return 'création';
  const parts: string[] = [];
  if (JSON.stringify(a.colors) !== JSON.stringify(b.colors)) parts.push('couleurs');
  if (JSON.stringify(a.fonts) !== JSON.stringify(b.fonts)) parts.push('polices');
  if (JSON.stringify(a.logos) !== JSON.stringify(b.logos)) parts.push('logos');
  if ((a.cover || '') !== (b.cover || '')) parts.push('couverture');
  if (JSON.stringify([a.header, a.footer]) !== JSON.stringify([b.header, b.footer])) parts.push('en-têtes et pieds de page');
  if ((a.templateId || '') !== (b.templateId || '')) parts.push('gabarit');
  if ((a.name || '') !== b.name || (a.organization || '') !== (b.organization || '')) parts.push('nom');
  return parts.join(', ') || 'aucun changement visible';
}

/* ---------- Modèles de validation ---------- */

export interface WorkflowTemplate { id: string; name: string; reviewers: string[]; requiredApprovals: number; owner: string; space?: string; updatedAt: string }
