import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  analyzeArchive, mergeArchive, readArchive, relativePath, render, resolveArchivePath, safeArchivePath, searchDoc, siteContext, siteLinkResolver, textOfFile,
} from '../src/index.ts';
import { nodeEnv } from '../src/node.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));

const DOC = zip({
  'projet/README.md': '# Guide KERNEL\n\nBienvenue. Voir [l\'installation](guide/installation.md) et [la FAQ](faq.md).\n',
  'projet/guide/installation.md': '---\ntitle: Installer\n---\n# Installation\n\n![Architecture](../images/archi.png)\n\nSuite : [configuration](./configuration.md#reseau).\n\n```md\n[faux lien](nulle-part.md)\n```\n',
  'projet/guide/configuration.md': '# Configuration\n\n## Réseau\n\nVoir [le schéma](../images/Schema.PNG) et [le PDF](../docs/charte.pdf).\n',
  'projet/images/archi.png': PNG,
  'projet/images/schema.png': PNG,
  'projet/autres/schema.png': PNG,   // homonyme : « Schema.PNG » ne peut pas être choisi par son seul nom
  'projet/docs/charte.pdf': strToU8('%PDF-1.4'),
  'projet/outils/install.sh': 'rm -rf /',
  'projet/__MACOSX/._README.md': 'x',
  'projet/vide.md': '',
});

describe('lecture de l\'archive', () => {
  it('chemins sûrs : jamais de sortie du dossier', () => {
    expect(safeArchivePath('a/./b/../c.md')).toBeNull();
    expect(safeArchivePath('../../etc/passwd')).toBeNull();
    expect(safeArchivePath('/etc/passwd')).toBeNull();
    expect(safeArchivePath('C:\\Windows\\x.md')).toBeNull();
    expect(safeArchivePath('docs\\guide\\a.md')).toBe('docs/guide/a.md');
    expect(resolveArchivePath('guide/a.md', '../../x.md')).toBeNull();
    expect(resolveArchivePath('guide/a.md', '../images/b%20c.png')).toBe('images/b c.png');
    expect(relativePath('guide/a.html', 'images/b.png')).toBe('../images/b.png');
    expect(relativePath('a.html', 'guide/b.html')).toBe('guide/b.html');
  });
  it('dossier englobant retiré ; scripts et fichiers système refusés mais listés', () => {
    const a = readArchive(DOC);
    expect(a.root).toBe('projet');
    const rejected = a.files.filter(f => f.status === 'rejected').map(f => [f.path, f.reason]);
    expect(rejected.map(r => r[0]).sort()).toEqual(['__MACOSX/._README.md', 'outils/install.sh'].sort());
    expect(String(rejected.find(r => r[0] === 'outils/install.sh')![1])).toMatch(/non autorisé/);
  });
  it('archive corrompue, limites de taille et de nombre', () => {
    expect(() => readArchive(strToU8('pas un zip du tout, vraiment pas'))).toThrow(/ZIP/);
    const broken = DOC.slice(0, DOC.length - 40);
    expect(() => readArchive(broken)).toThrow(/corrompue/);
    const many = zip(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}.md`, '# x'])));
    const r = readArchive(many, { maxFiles: 4, maxTotalBytes: 1e6, maxFileBytes: 1e6, maxDepth: 5 });
    expect(r.files.filter(f => f.status === 'rejected').length).toBe(2);
    const deep = readArchive(zip({ 'a/b/c/d.md': '# d' }), { maxFiles: 9, maxTotalBytes: 1e6, maxFileBytes: 1e6, maxDepth: 1 });
    expect(deep.files[0].status).toBe('rejected');
  });
});

describe('analyse', () => {
  const report = analyzeArchive('projet.zip', readArchive(DOC));
  it('pages, dossiers, ressources, entrée, type', () => {
    expect(report.stats).toMatchObject({ pages: 4, images: 3, rejected: 2 });
    expect(report.entry).toBe('README.md');
    expect(report.kind).toBe('documentation');
    expect(report.suggestedMode).toBe('site');
    expect(report.order).toEqual(['README.md', 'vide.md', 'guide/configuration.md', 'guide/installation.md']);
    expect(report.pages.find(p => p.path === 'guide/installation.md')!.title).toBe('Installer');
    expect(report.folders).toEqual(expect.arrayContaining(['guide', 'images', 'docs']));
    // un nom unique suffit : « archi.png » écrit sans son dossier est retrouvé, la source n'est pas réécrite
    const byName = analyzeArchive('n.zip', readArchive(zip({ 'a.md': '![x](archi.png)', 'img/archi.png': PNG })));
    expect(byName.stats.brokenLinks).toBe(0);
    expect(byName.problems[0].message).toMatch(/trouvé par son nom : img\/archi\.png/);
  });
  it('liens : internes résolus, code ignoré, cassés signalés avec une proposition', () => {
    const inst = report.pages.find(p => p.path === 'guide/installation.md')!;
    expect(inst.links.map(l => [l.kind, l.target, l.broken])).toEqual([['resource', 'images/archi.png', false], ['page', 'guide/configuration.md', false]]);
    const faq = report.problems.find(p => p.path === 'README.md' && /faq\.md/.test(p.message));
    expect(faq?.level).toBe('warning');
    const schema = report.problems.find(p => /Schema\.PNG/.test(p.message))!;
    expect(schema.fix).toEqual({ from: '../images/Schema.PNG', to: '../images/schema.png' });
    expect(report.problems.some(p => p.path === 'vide.md' && /vide/.test(p.message))).toBe(true);
    expect(report.resources.find(r => r.path === 'images/archi.png')!.usedBy).toEqual(['guide/installation.md']);
  });
  it('une seule page ; des chapitres sans liens ; aucune page', () => {
    expect(analyzeArchive('a.zip', readArchive(zip({ 'note.md': '# Note' }))).kind).toBe('single');
    const ch = analyzeArchive('b.zip', readArchive(zip({ '01-intro.md': '# Intro', '02-suite.md': '# Suite', '10-fin.md': '# Fin' })));
    expect(ch.kind).toBe('chapters');
    expect(ch.order).toEqual(['01-intro.md', '02-suite.md', '10-fin.md']);
    expect(analyzeArchive('c.zip', readArchive(zip({ 'a.png': PNG }))).problems[0].level).toBe('error');
  });
  it('un sommaire (SUMMARY.md) donne l\'ordre', () => {
    const r = analyzeArchive('s.zip', readArchive(zip({ 'SUMMARY.md': '- [B](b.md)\n- [A](a.md)', 'a.md': '# A', 'b.md': '# B' })));
    expect(r.order).toEqual(['b.md', 'a.md', 'SUMMARY.md']);
  });
});

describe('document continu', () => {
  it('chapitres dans l\'ordre choisi, liens entre pages changés en ancres, images ramenées', () => {
    const a = readArchive(DOC);
    const files = new Map(a.files.filter(f => f.status === 'ok').map(f => [f.path, f]));
    const pick = ['guide/configuration.md', 'guide/installation.md'].map(p => ({ path: p, title: p, markdown: textOfFile(files.get(p)!) }));
    const m = mergeArchive(pick, new Set(files.keys()), 'Guide');
    expect(m.markdown.startsWith('---\ntitle: "Guide"\n---')).toBe(true);
    expect(m.markdown.indexOf('# Configuration')).toBeLessThan(m.markdown.indexOf('# Installation'));
    expect(m.markdown).toContain('[configuration](#reseau)');
    expect(m.markdown).toContain('![Architecture](./assets/images-archi.png)');
    expect(m.markdown).toContain('[faux lien](nulle-part.md)');   // dans un bloc de code : intact
    expect(m.assets).toEqual(expect.arrayContaining([{ path: 'images/archi.png', name: 'images-archi.png' }, { path: 'docs/charte.pdf', name: 'docs-charte.pdf' }]));
    expect(render(m.markdown, { mode: 'reading' }, nodeEnv()).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  });
});

describe('page de projet', () => {
  const pages = [{ id: 'p1', path: 'README.md', title: 'Accueil' }, { id: 'p2', path: 'guide/README.md', title: 'Guide' }, { id: 'p3', path: 'guide/installation.md', title: 'Installation' }];
  it('navigation, fil d\'Ariane, pages voisines, liens internes et recherche', () => {
    const md = '# Installation\n\n## Prérequis\n\nVoir [l\'accueil](../README.md) et [absente](./zzz.md).\n\n## Étapes\n\nTexte.\n';
    const ctx = siteContext({ name: 'Doc', pages, entry: 'p1' }, 'p3', id => `${id}.html`, { inline: [searchDoc('p3', 'guide/installation.md', 'Installation', md)] });
    expect(ctx.crumbs).toEqual([{ title: 'Doc', id: 'p1' }, { title: 'Guide', id: 'p2' }, { title: 'Installation', id: 'p3' }]);
    expect(ctx.prev?.id).toBe('p2');
    expect(ctx.next).toBeUndefined();
    const env = { ...nodeEnv(), resolveLink: siteLinkResolver(pages, new Set(), 'guide/installation.md', { page: (id, a) => `${id}.html${a ? '#' + a : ''}`, file: p => p }) };
    const r = render(md, { mode: 'reading' }, env, undefined, undefined, ctx);
    expect(r.html).toContain('<a href="p1.html">l&#39;accueil</a>');
    expect(r.html).toContain('class="sd-dead-link"');
    expect(r.html).toContain('aria-current="page">Installation</a>');
    expect(r.html).toContain('Sur cette page');
    expect(r.html).toContain('window.__SD_SEARCH=');
    expect(r.diagnostics.map(d => d.code)).toContain('broken-page-link');
  });
});
