import { describe, expect, it } from 'vitest';
import { can, changeStats, findIncludes, lineDiff, parse, publishBlockers, render, settingsDiff, threeWayMerge, type LibBlock } from '../src/index.ts';
import { nodeEnv } from '../src/node.ts';

describe('rôles', () => {
  it('chaque rôle a exactement ses droits', () => {
    expect(can('viewer', 'read')).toBe(true);
    expect(can('viewer', 'comment')).toBe(false);
    expect(can('commenter', 'suggest')).toBe(true);
    expect(can('commenter', 'edit')).toBe(false);
    expect(can('editor', 'edit')).toBe(true);
    expect(can('editor', 'restore')).toBe(false);
    expect(can('owner', 'share')).toBe(true);
    expect(can(null, 'read')).toBe(false);
  });
});

describe('différences', () => {
  it('résume ajouts, suppressions et sections', () => {
    const s = changeStats('# A\n\nLe budget reste à définir.\n', '# A\n\nLe budget est de 12 000 €.\n\n## Annexe\n');
    expect(s.sectionsAdded).toEqual(['Annexe']);
    expect(s.added).toBeGreaterThan(0);
    expect(s.removed).toBeGreaterThan(0);
    expect(s.summary).toMatch(/section ajoutée : Annexe/);
  });
  it('affine les lignes modifiées au mot près', () => {
    const d = lineDiff('La date est le 15 novembre.\nFin.', 'La date est le 22 novembre.\nFin.');
    expect(d[0].kind).toBe('changed');
    expect(d[0].parts.filter(p => p.kind === 'removed').map(p => p.text).join('')).toContain('15');
    expect(d[0].parts.filter(p => p.kind === 'added').map(p => p.text).join('')).toContain('22');
    expect(d[1].kind).toBe('same');
  });
  it('sépare les changements de mise en forme', () => {
    expect(settingsDiff({ templateId: 'a', overrides: { colors: { accent: '#000' } } }, { templateId: 'a', overrides: { colors: { accent: '#fff' } } }))
      .toEqual([{ path: 'overrides.colors.accent', before: '#000', after: '#fff' }]);
  });
});

describe('fusion à trois voies', () => {
  it('garde les changements des deux côtés', () => {
    const r = threeWayMerge('a\nb\nc', 'a\nb\nC', 'A\nb\nc');
    expect(r).toEqual({ text: 'A\nb\nC', conflicts: 0 });
  });
  it('signale un conflit entre marqueurs explicites', () => {
    const r = threeWayMerge('a', 'b', 'c');
    expect(r.conflicts).toBe(1);
    expect(r.text).toMatch(/<<<<<<< document principal/);
  });
});

describe('validation', () => {
  it('bloque une publication officielle sans validations, ou après une modification', () => {
    expect(publishBlockers({ state: 'review', reviewers: [{ userId: 'u', decision: 'pending' }], requiredApprovals: 1 }, 3)).toHaveLength(1);
    expect(publishBlockers({ state: 'approved', reviewers: [{ userId: 'u', decision: 'approved' }], requiredApprovals: 1, approvedVersion: 3 }, 3)).toEqual([]);
    expect(publishBlockers({ state: 'approved', reviewers: [{ userId: 'u', decision: 'approved' }], requiredApprovals: 1, approvedVersion: 3 }, 4)[0]).toMatch(/changé/);
  });
});

describe('blocs inclus', () => {
  const block: LibBlock = { id: 'coord', name: 'Coordonnées', updatedAt: '', versions: [{ version: 1, markdown: '**Tél.** 01', at: '' }, { version: 2, markdown: '**Tél.** 02', at: '' }] };
  const get = (id: string) => (id === 'coord' ? block : undefined);
  it('rend la version épinglée et garde les numéros de ligne du document', () => {
    const r = render('# T\n\n:::include {block="coord" version=1} :::\n\nSuite\n\n:::inconnu\n:::', {}, nodeEnv(), undefined, get);
    expect(r.html).toContain('<strong>Tél.</strong> 01');
    expect(r.html).not.toContain('Tél.</strong> 02');
    expect(r.diagnostics.find(d => d.code === 'unknown-component')?.line).toBe(7);
  });
  it('signale un bloc introuvable sans masquer le reste', () => {
    const ir = parse(':::include {block="absent"} :::\n\nTexte', { blocks: get });
    expect(ir.diagnostics[0].code).toBe('missing-block');
  });
  it('repère les inclusions et leur version', () => {
    expect(findIncludes('x\n:::include {block="coord" version=2} :::\n```\n:::include {block="non"} :::\n```')).toEqual([{ line: 2, block: 'coord', version: 2, short: true }]);
  });
});
