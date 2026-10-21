import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_TEMPLATES, contrast, parse, render, type DocSettings, type Target } from '../src/index.ts';
import { nodeEnv } from '../src/node.ts';

const FIX = join(__dirname, '../../../tests/fixtures');
const read = (f: string) => readFileSync(join(FIX, f), 'utf8');
const env = () => nodeEnv({ baseDir: FIX, sandboxDir: FIX });
const run = (src: string, s: Partial<DocSettings> = {}) => render(src, s, env());
const codes = (src: string) => parse(src).diagnostics.map(d => d.code);
const bodyText = (html: string) => (html.match(/<article class="sd-body">([\s\S]*?)<\/article>/)?.[1] || '')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('grammaire StudioMD', () => {
  it('imbrique les composants par pile, sans compter les deux-points', () => {
    const ir = parse(read('07-studiomd-imbrique.md'));
    const cols: any = ir.blocks.find((b: any) => b.name === 'columns');
    expect(cols.children.filter((c: any) => c.name === 'column')).toHaveLength(2);
    expect(cols.children[0].children.some((c: any) => c.name === 'callout')).toBe(true);
    expect(ir.diagnostics.filter(d => d.severity !== 'info')).toEqual([]);
  });

  it('lit les attributs : guillemets, échappements, drapeaux, classes et id', () => {
    const ir = parse(':::card {title="Il a dit \\"oui\\"" tone=accent .large #intro open}\nx\n:::');
    const c: any = ir.blocks[0];
    expect(c.attrs).toEqual({ title: 'Il a dit "oui"', tone: 'accent', open: true });
    expect(c.classes).toEqual(['large']);
    expect(c.id).toBe('intro');
  });

  it('accepte la forme courte et la forme ouvrante/fermante', () => {
    const a: any = parse(':::pagebreak :::').blocks[0];
    const b: any = parse(':::pagebreak\n:::').blocks[0];
    expect(a.name).toBe('pagebreak');
    expect(b.name).toBe('pagebreak');
  });

  it('ignore les ::: à l\'intérieur des blocs de code', () => {
    const ir = parse('```md\n:::callout\nnon\n:::\n```');
    expect(ir.blocks[0].type).toBe('code');
    expect(ir.diagnostics).toEqual([]);
  });

  it('\\::: produit le texte littéral', () => {
    const html = run('\\:::callout').html;
    expect(bodyText(html)).toContain(':::callout');
  });

  it('résout les alias (warning -> callout type=warning)', () => {
    const c: any = parse(':::warning\nx\n:::').blocks[0];
    expect(c.name).toBe('callout');
    expect(c.attrs.type).toBe('warning');
  });

  it('lit les données YAML des chiffres clés', () => {
    const c: any = parse(':::stats\n- label: A\n  value: 3\n:::').blocks[0];
    expect(c.data).toEqual([{ label: 'A', value: 3 }]);
  });
});

describe('le markdown ordinaire reste intact', () => {
  it('rend un fichier sans aucune extension', () => {
    const r = run(read('01-simple.md'));
    expect(r.diagnostics).toEqual([]);
    expect(r.html).toContain('<strong>3 novembre</strong>');
    expect(r.html).toMatch(/<ol[^>]*>/);
    expect(r.ir.meta.title).toBe('Compte rendu — réunion d\'équipe');
  });

  it('GFM : tableaux alignés, tâches, barré, notes', () => {
    const r = run('| a | b |\n|:--|--:|\n| 1 | 2 |\n\n- [x] fait\n- [ ] à faire\n\n~~non~~ et note[^n]\n\n[^n]: texte');
    expect(r.html).toContain('style="text-align:right"');
    expect(r.html).toContain('sd-task done');
    expect(r.html).toContain('<del>non</del>');
    expect(r.html).toContain('id="fn-n"');
  });
});

describe('diagnostics : rien ne disparaît en silence', () => {
  it('signale chaque défaut du document mal formé', () => {
    const c = codes(read('09-mal-forme.md'));
    for (const k of ['bad-frontmatter', 'unknown-component', 'bad-attribute', 'missing-attribute', 'bad-data', 'stray-close', 'unclosed-fence', 'heading-skip'])
      expect(c, k).toContain(k);
  });

  it('garde le contenu d\'un composant inconnu et propose la correction', () => {
    const r = run(':::calout\nTexte précieux\n:::');
    expect(r.html).toContain('Texte précieux');
    expect(r.html).toContain('Composant inconnu');
    expect(r.diagnostics[0].message).toContain('callout');
  });

  it('ferme un composant ouvert en fin de document et le signale en erreur', () => {
    const r = parse(':::card\ncontenu');
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', code: 'unclosed-component', line: 1 });
    expect((r.blocks[0] as any).children).toHaveLength(1);
  });

  it('donne des numéros de ligne absolus, front matter compris', () => {
    const r = parse('---\ntitle: x\n---\n\n:::inconnu\n:::');
    expect(r.diagnostics[0].line).toBe(5);
  });

  it('signale les images manquantes', () => {
    const r = run(read('05-images-locales.md'));
    expect(r.diagnostics.some(d => d.code === 'missing-asset' && d.message.includes('absente.jpg'))).toBe(true);
  });
});

describe('sécurité', () => {
  const r = run(read('10-securite.md'));
  const h = r.html.replace(/<script>[\s\S]*?<\/script>/g, '');   // retire nos propres scripts
  it('n\'exécute aucun script du document', () => {
    expect(h).not.toMatch(/<script/i);
    expect(h).not.toMatch(/<iframe/i);
    expect(h).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);   // aucun gestionnaire d'événement dans une balise
    expect(h).not.toMatch(/href="javascript:/i);
    expect(h).not.toMatch(/href="data:/i);
    expect(h).not.toMatch(/<style>body\{display:none/);
  });
  it('n\'injecte rien par les attributs', () => {
    expect(h).not.toContain('evil.example/x');
    expect(h).not.toMatch(/type="info" onmouseover/);
  });
  it('n\'intègre pas de fichier hors du dossier du document', () => {
    expect(r.diagnostics.some(d => d.message.includes('etc/passwd'))).toBe(true);
    expect(h).not.toContain('root:x:0');
  });
  it('neutralise le CSS personnalisé', () => {
    const c = run('# x', { customCss: '@import url(https://evil.example/a.css); body{background:url(https://evil.example/p.png)} </style><script>alert(1)</script>' }).html;
    expect(c).not.toContain('evil.example');
    expect(c.replace(/<script>[\s\S]*?<\/script>/g, '')).not.toContain('<script>alert');
  });
});

describe('séparation contenu / présentation', () => {
  const src = read('07-studiomd-imbrique.md');
  it('le changement de gabarit ne modifie pas le texte', () => {
    const texts = BUILTIN_TEMPLATES.filter(t => t.kind !== 'slides').map(t => {
      const r = run(src, { templateId: t.id, overrides: { layout: { numbering: false } } as any });
      return bodyText(r.html).replace(/Copier/g, '');
    });
    for (const t of texts) expect(t).toBe(texts[0]);
  });
  it('les surcharges de l\'utilisateur l\'emportent sur le gabarit', () => {
    const r = run('# x', { templateId: 'editorial', overrides: { colors: { accent: '#123456' }, fonts: { body: 'Inter' } } });
    expect(r.html).toContain('--sd-c-accent:#123456');
    expect(r.html).toContain('--sd-font-body:"Inter"');
  });
  it('chaque gabarit a un contraste texte/fond conforme (≥ 4,5)', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(contrast(t.tokens.colors.text, t.tokens.colors.bg), t.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.tokens.colors.slideText, t.tokens.colors.slideBg), t.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('les trois sorties', () => {
  const files = readdirSync(FIX).filter(f => f.endsWith('.md'));
  for (const f of files) for (const mode of ['reading', 'print', 'slides'] as Target[]) {
    it(`${f} -> ${mode}`, () => {
      const r = run(read(f), { mode });
      expect(r.html.startsWith('<!doctype html>')).toBe(true);
      expect(r.html).toContain('</html>');
      if (mode === 'print') expect(r.html).toContain('@page{size:210mm 297mm');
      if (mode === 'slides') expect(r.slideCount).toBeGreaterThan(0);
    });
  }

  it('découpe les diapositives sur les titres, les --- et les blocs slide', () => {
    const r = run(read('08-presentation.md'), { mode: 'slides' });
    // couverture, section, 2 slides, ---, statement, section, 2 slides, slide explicite
    expect(r.slideCount).toBe(9);
    expect(r.html).toContain('sd-layout-statement');
    expect(r.html).toContain('sd-layout-center sd-bg-dark');
    expect(r.html).toMatch(/<aside class="sd-notes">[\s\S]*Insister sur le jury/);
  });

  it('le composant interactif devient statique à l\'impression', () => {
    const src = ':::tabs\n:::tab {title="A"}\nun\n:::\n:::tab {title="B"}\ndeux\n:::\n:::\n\n:::details {title="Plus"}\ncaché\n:::';
    const reading = run(src).html;
    const print = run(src, { mode: 'print' }).html;
    expect(reading).toContain('role="tablist"');
    expect(reading).toContain('<details');
    expect(print).not.toContain('role="tablist"');
    expect(print).not.toContain('<details');
    expect(print).toContain('deux');
  });

  it('les en-têtes et pieds de page deviennent des boîtes de marge CSS', () => {
    const r = run('---\ntitle: Rapport "Q3"\n---\ntexte', { mode: 'print', page: { footer: { left: '{title}', center: '', right: 'Page {page} sur {pages}' } } });
    expect(r.html).toContain('@bottom-left{content:"Rapport \\"Q3\\""}');
    expect(r.html).toContain('@bottom-right{content:"Page " counter(page) " sur " counter(pages)}');
  });

  it('numérote les sections quand le gabarit le demande', () => {
    const r = run('---\ntitle: T\n---\n# A\n## A1\n## A2\n# B', { templateId: 'technique', mode: 'print' });
    expect(r.ir.headings.map(h => h.number)).toEqual(['1', '1.1', '1.2', '2']);
  });

  it('typographie française : espaces insécables là où un espace existe', () => {
    const r = run('Vrai ? Oui : « garanti » ! http://x.org?a=1');
    expect(r.html).toContain('Vrai ?');
    expect(r.html).toContain('Oui :');
    expect(r.html).toContain('« garanti »');
    expect(r.html).toContain('x.org?a=1');
  });

  it('un document de 5 000 lignes se rend en moins d\'une seconde', () => {
    const big = Array.from({ length: 500 }, (_, i) => `## Section ${i}\n\nParagraphe ${i} avec du **gras** et un [lien](#x).\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`).join('\n');
    const t0 = performance.now();
    run(big, { mode: 'print' });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
