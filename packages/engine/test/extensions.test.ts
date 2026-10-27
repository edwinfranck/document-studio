import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBrand, BY_NAME, COMPONENTS, notifCategory, offsetMapper, parse, registerPlugins, render, suggestionHunks, type Brand,
} from '../src/index.ts';
import { nodeEnv } from '../src/node.ts';

const env = nodeEnv();
const KPI = {
  id: 'kpi', name: 'jauge', label: 'Indicateur', content: 'markdown',
  attrs: { valeur: { type: 'string', required: true, description: 'Chiffre' }, ton: { type: 'enum', values: ['neutre', 'alerte'], default: 'neutre', description: 'Couleur' }, lien: { type: 'url', description: 'Lien' } },
  template: '<div class="kpi kpi-{{ton}}"><strong>{{valeur}}</strong>{{#content}}<div class="kpi-txt">{{content}}</div>{{/content}}{{#lien}}<a href="{{lien}}">source</a>{{/lien}}</div>',
  targets: { print: '<p class="kpi-print">{{valeur}} · {{content}}</p>' },
  css: '.kpi{border:1px solid red} @import url(https://x.test/a.css); .kpi-alerte{background:url(https://x.test/i.png)}',
};

afterEach(() => { registerPlugins([]); });

describe('plugins de composants', () => {
  it('un plugin installé devient un composant connu, validé et rendu', () => {
    const r = registerPlugins([KPI]);
    expect(r.errors).toEqual([]);
    expect(BY_NAME.get('jauge')?.spec.category).toBe('Extensions');
    const src = '# T\n\n:::jauge {valeur="42 %" ton="alerte"}\nTaux de **réussite**\n:::\n';
    const ir = parse(src);
    expect(ir.diagnostics.filter(d => d.code === 'unknown-component')).toEqual([]);
    const html = render(src, { mode: 'reading' }, env).html;
    expect(html).toContain('<div class="kpi kpi-alerte"><strong>42 %</strong><div class="kpi-txt"><p>Taux de <strong>réussite</strong></p></div></div>');
    expect(html).toContain('data-plugins');
    expect(html).not.toContain('x.test/a.css');
    expect(html).not.toContain('x.test/i.png');
  });
  it('gabarit propre à l\'impression, attribut obligatoire et valeur hors liste signalés', () => {
    registerPlugins([KPI]);
    expect(render(':::jauge {valeur="7"}\nnote\n:::\n', { mode: 'print' }, env).html).toContain('class="kpi-print"');
    const d = parse(':::jauge {ton="rouge"}\n:::\n').diagnostics.map(x => x.code);
    expect(d).toContain('missing-attribute');
    expect(d).toContain('bad-attribute');
  });
  it('les valeurs sont échappées et les gabarits nettoyés', () => {
    registerPlugins([{ ...KPI, template: '<div onclick="alert(1)"><script>alert(2)</script><iframe src="x"></iframe><a href="javascript:alert(3)">x</a>{{valeur}}{{#lien}}<a href="{{lien}}">l</a>{{/lien}}</div>' }]);
    const html = render(':::jauge {valeur="<img src=x onerror=alert(4)>" lien="javascript:alert(5)"}\n:::\n', { mode: 'reading' }, env).html;
    const at = html.indexOf('sd-plugin-jauge');
    const block = html.slice(at, html.indexOf('</article>', at));
    expect(block).not.toMatch(/onclick|<script|<iframe|javascript:|<img|alert\(2\)/);
    expect(block).toContain('&lt;img');
  });
  it('refuse un nom intégré, un plugin mal formé, un doublon ; désinstalle proprement', () => {
    const r = registerPlugins([{ ...KPI, id: 'x1', name: 'callout' }, { id: 'Bad', name: 'ok-name' }, KPI, { ...KPI, id: 'kpi2' }]);
    expect(r.installed.map(p => p.id)).toEqual(['kpi']);
    expect(r.errors.map(e => e.id)).toEqual(['x1', 'Bad', 'kpi2']);
    const before = COMPONENTS.length;
    registerPlugins([]);
    expect(COMPONENTS.length).toBe(before - 1);
    expect(BY_NAME.has('jauge')).toBe(false);
    expect(BY_NAME.get('callout')?.spec.plugin).toBeUndefined();
  });
});

describe('suivi des modifications', () => {
  const apply = (base: string, hunks: { from: number; to: number; insert: string }[]) =>
    hunks.slice().reverse().reduce((t, h) => t.slice(0, h.from) + h.insert + t.slice(h.to), base);
  it('chaque changement devient une suggestion, en positions du texte de départ', () => {
    const base = 'Le budget prévisionnel reste à définir.\n\nLa livraison est prévue le 15 novembre.\n';
    const edited = 'Le budget prévisionnel est fixé à 40 000 €.\n\nLa livraison est prévue le 15 novembre.\nContact : Awa.\n';
    const h = suggestionHunks(base, edited);
    // « à » est commun aux deux phrases : deux suggestions de part et d'autre, plus l'ajout final
    expect(h.map(x => [base.slice(x.from, x.to), x.insert])).toEqual([['reste ', 'est fixé '], ['définir', '40 000 €'], ['', 'Contact : Awa.\n']]);
    expect(apply(base, h)).toBe(edited);
  });
  it('aucune modification : aucune suggestion', () => { expect(suggestionHunks('a b c', 'a b c')).toEqual([]); });
  it('les positions suivent les modifications faites par d\'autres entre-temps', () => {
    const before = 'Bonjour le monde.';
    const after = 'Titre\n\nBonjour le monde.';
    const map = offsetMapper(before, after);
    expect(after.slice(map(11)!, map(16)!)).toBe('monde');
    expect(offsetMapper('abcdef', 'abXef')(3)).toBeNull();
  });
});

describe('identités et préférences', () => {
  it('appliquer une identité change la présentation, jamais le texte, et note sa version', () => {
    const b: Brand = { id: 'kernel', name: 'KERNEL', version: 3, updatedAt: '', owner: 'u', colors: { primary: '#c8f031', accent: '' }, fonts: { heading: 'DM Sans' }, logos: [], footer: { right: '{page} / {pages}' }, organization: 'Epitech Africa', history: [] };
    const s = applyBrand({ templateId: 'editorial', overrides: { colors: { text: '#111111' } } }, b);
    expect(s.overrides!.colors).toEqual({ text: '#111111', primary: '#c8f031' });
    expect(s.page!.footer).toEqual({ left: '', center: '', right: '{page} / {pages}' });
    expect(s.meta!.organization).toBe('Epitech Africa');
    expect(s.brand).toEqual({ id: 'kernel', version: 3, name: 'KERNEL' });
    expect(s.templateId).toBe('editorial');
  });
  it('chaque événement relève d\'une catégorie de préférence', () => {
    expect(notifCategory('reply')).toBe('comment');
    expect(notifCategory('assigned')).toBe('mention');
    expect(notifCategory('restore')).toBe('activity');
  });
});
