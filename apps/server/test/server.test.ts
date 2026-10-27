import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { BUILTIN_TEMPLATES } from '@studio/engine';

const HOME = mkdtempSync(join(tmpdir(), 'studio-test-'));
process.env.STUDIO_HOME = HOME;
const FIX = join(__dirname, '../../../tests/fixtures');
const S = await import('../src/store.ts');
const E = await import('../src/export.ts');
const B = await import('../src/browser.ts');
const hasChrome = !!B.findChrome();
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
afterAll(() => B.closeBrowser());

describe('stockage local', () => {
  it('crée, lit, modifie et supprime un document en fichiers ordinaires', () => {
    const d = S.createDoc({ name: 'Rapport été', markdown: '# Été\n', importedFrom: 'rapport.md' }, 'u1');
    expect(d.id).toMatch(/^rapport-ete-[0-9a-f]{6}$/);
    expect(readFileSync(join(HOME, 'documents', d.id, 'document.md'), 'utf8')).toBe('# Été\n');
    S.updateMeta(d.id, { settings: { templateId: 'editorial' }, name: 'Rapport été 2026' });
    const again = S.getDoc(d.id);
    expect(again.settings.templateId).toBe('editorial');
    expect(again.name).toBe('Rapport été 2026');
    expect(again.owner).toBe('u1');
    // l'original importé n'est jamais modifié
    S.writeMarkdownFile(d.id, '# Été 2026\n');
    expect(S.readOriginal(d.id, true)).toBe('# Été\n');
    S.deleteDoc(d.id);
    expect(() => S.getDoc(d.id)).toThrow(/introuvable/);
    expect(readdirSync(join(HOME, 'trash')).some(f => f.startsWith(d.id))).toBe(true);
  });

  it('une version par changement réel, avec résumé', () => {
    const d = S.createDoc({ name: 'Versions', markdown: '# A\n\nun deux' }, 'u1');
    expect(S.addVersion(d.id, { markdown: '# A\n\nun deux', settings: {}, authors: ['u1'], kind: 'auto' })).toBeNull();
    const v = S.addVersion(d.id, { markdown: '# A\n\nun deux trois\n\n## B\n', settings: {}, authors: ['u2'], kind: 'auto' })!;
    expect(v.n).toBe(2);
    expect(v.summary).toMatch(/section ajoutée : B/);
    expect(S.listVersions(d.id).map(x => x.n)).toEqual([2, 1]);
  });

  it('refuse les noms de fichiers et identifiants dangereux', () => {
    const d = S.createDoc({ name: 'Sûreté' }, 'u1');
    expect(S.safeAssetName('../../etc/passwd.png')).toBe('passwd.png');
    expect(S.safeAssetName('Photo été 1.JPG')).toBe('Photo-ete-1.JPG');
    expect(() => S.safeAssetName('sans-extension')).toThrow();
    expect(() => S.getDoc('../documents')).toThrow(/invalide/);
    const a = S.putAsset(d.id, '../x.png', Buffer.from('png'));
    expect(a.name).toBe('x.png');
    expect(existsSync(join(HOME, 'documents', d.id, 'assets', 'x.png'))).toBe(true);
  });

  it('enregistre un gabarit personnalisé sans toucher aux gabarits intégrés', () => {
    const base = BUILTIN_TEMPLATES[0];
    const t = S.saveTheme({ ...base, id: base.id, name: 'Ma variante' });
    expect(t.id).not.toBe(base.id);
    expect(t.builtin).toBe(false);
    expect(S.listThemes().map(x => x.name)).toContain('Ma variante');
    expect(BUILTIN_TEMPLATES[0].name).toBe(base.name);
  });
});

describe.skipIf(!hasChrome)('exports réels', () => {
  const input = (f: string, settings: any = {}) => ({ markdown: readFileSync(join(FIX, f), 'utf8'), settings, dir: FIX, name: f.replace('.md', '') });

  it('produit un PDF paginé, ouvrable, au texte sélectionnable', async () => {
    const r = await E.exportPdf(input('02-rapport-long.md', { templateId: 'corporate' }), 'print');
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.info.pages).toBeGreaterThan(15);
    expect(r.info.overflows).toEqual([]);
    if (hasPdftotext) {
      const f = join(HOME, 'r.pdf'); writeFileSync(f, r.pdf);
      const text = execFileSync('pdftotext', ['-layout', f, '-']).toString();
      expect(text).toContain('Rapport annuel');
      expect(text).toContain('Sommaire');
      expect(text).toMatch(/Contexte\s*\.*\s*3/);         // numéro de page dans le sommaire
      expect(text).toMatch(/\d+ \/ \d+/);                  // pied de page « n / total »
      const fonts = execFileSync('pdffonts', [f]).toString();
      expect(fonts).toMatch(/Inter/);                      // police intégrée
    }
  }, 60_000);

  it('répète l\'en-tête d\'un tableau coupé sur plusieurs pages', async () => {
    const r = await E.exportPdf(input('03-tableaux-larges.md'), 'print');
    if (!hasPdftotext) return;
    const f = join(HOME, 't.pdf'); writeFileSync(f, r.pdf);
    const pages = execFileSync('pdftotext', ['-layout', f, '-']).toString().split('\f').filter(p => /Lot \d+|lot \d+/.test(p));
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p).toMatch(/N°\s+Action\s+Responsable\s+Statut/);
  }, 60_000);

  it('produit un diaporama PDF, une diapositive par page', async () => {
    const r = await E.exportPdf(input('08-presentation.md', { templateId: 'cinema' }), 'slides');
    expect(r.info.count).toBe(9);
    if (hasPdftotext) {
      const f = join(HOME, 's.pdf'); writeFileSync(f, r.pdf);
      const info = execFileSync('pdfinfo', [f]).toString();
      expect(info).toMatch(/Pages:\s+9/);
      expect(info).toMatch(/Page size:\s+1440 x 810 pts/);  // 1920 × 1080 px
    }
  }, 60_000);

  it('exporte un HTML autonome, sans aucune ressource distante obligatoire', () => {
    const r = E.renderHtml(input('07-studiomd-imbrique.md'), 'reading');
    const html = r.html;
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
  });

  it('exporte un paquet ZIP complet', async () => {
    const z = await E.exportZip(input('07-studiomd-imbrique.md'), false);
    const files = Object.keys(unzipSync(new Uint8Array(z.zip)));
    expect(files).toEqual(expect.arrayContaining(['07-studiomd-imbrique/document.md', '07-studiomd-imbrique/studio.json', '07-studiomd-imbrique/07-studiomd-imbrique.html', '07-studiomd-imbrique/assets/atelier.png']));
  });
});

/* Non-régression visuelle : première page de chaque gabarit comparée à une référence.
   Mettre à jour les références : STUDIO_UPDATE_SNAPSHOTS=1 pnpm test */
describe.skipIf(!hasChrome)('non-régression visuelle des gabarits', () => {
  const dir = join(__dirname, 'snapshots');
  const update = !!process.env.STUDIO_UPDATE_SNAPSHOTS;
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(join(FIX, '07-studiomd-imbrique.md'), 'utf8');
  for (const t of BUILTIN_TEMPLATES) {
    const mode = t.kind === 'slides' ? 'slides' : 'reading';
    it(`${t.id} (${mode})`, async () => {
      const r = E.renderHtml({ markdown: src, settings: { templateId: t.id, reading: { colorScheme: 'template' } }, dir: FIX, name: 'x' }, mode);
      const png = await B.screenshot(r.html, mode, { width: 1100, height: 1300, slide: mode === 'slides' ? 2 : undefined });
      const file = join(dir, `${t.id}.png`);
      if (update || !existsSync(file)) { writeFileSync(file, png); return; }
      const a = PNG.sync.read(readFileSync(file));
      const b = PNG.sync.read(png);
      expect([b.width, b.height]).toEqual([a.width, a.height]);
      const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.15 });
      // tolérance : 0,5 % des pixels (anticrénelage, rendu des polices)
      expect(diff / (a.width * a.height)).toBeLessThan(0.005);
    }, 60_000);
  }
});
