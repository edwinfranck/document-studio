// Import de projets ZIP sur un vrai serveur : analyse, trois modes, projet multi-pages, droits, exports, publication.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { Http } from './helpers.ts';

const HOME = mkdtempSync(join(tmpdir(), 'studio-import-'));
process.env.STUDIO_HOME = HOME;
const { createApp } = await import('../src/app.ts');

let base = '';
const server = createApp();
beforeAll(async () => { await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(() => new Promise<void>(r => server.close(() => r())));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ZIP = zipSync({
  'doc/README.md': strToU8('# Guide\n\nCommencer par [l\'installation](guide/installation.md).\n'),
  'doc/guide/installation.md': strToU8('# Installation\n\n![Schéma](../images/schema.png)\n\nPuis [la configuration](configuration.md#reseau) et [la charte](../docs/charte.pdf).\n'),
  'doc/guide/configuration.md': strToU8('# Configuration\n\n## Réseau\n\nVoir [le schéma](../images/Schema.png).\n'),
  'doc/images/schema.png': new Uint8Array(PNG),
  'doc/autres/schema.png': new Uint8Array(PNG),
  'doc/docs/charte.pdf': strToU8('%PDF-1.4 essai'),
  'doc/outils/deploy.sh': strToU8('#!/bin/sh\nrm -rf /'),
  '../../evasion.md': strToU8('# Évasion'),
});

const upload = async (h: Http, zip: Uint8Array, name = 'doc.zip') => {
  const r = await fetch(`${base}/api/imports?name=${encodeURIComponent(name)}`, { method: 'POST', body: Buffer.from(zip), headers: { cookie: h.cookie } });
  return { status: r.status, data: await r.json() };
};

let edwin: Http, awa: Http, anon: Http;
let siteId = '';

describe('analyse avant import', () => {
  it('rapport : pages, ressources, entrée, refus listés, rien créé', async () => {
    edwin = new Http(base); awa = new Http(base); anon = new Http(base);
    await edwin.post('/api/auth/register', { name: 'Edwin', email: 'edwin@test.dev', password: 'motdepasse1' });
    await awa.post('/api/auth/register', { name: 'Awa', email: 'awa@test.dev', password: 'motdepasse2' });
    const r = await upload(edwin, ZIP);
    expect(r.status).toBe(201);
    const rep = r.data.report;
    expect(rep.stats).toMatchObject({ pages: 3, images: 2 });
    expect(rep.entry).toBe('README.md');
    expect(rep.suggestedMode).toBe('site');
    const rejected = rep.files.filter((f: any) => f.status === 'rejected').map((f: any) => f.path);
    expect(rejected).toEqual(expect.arrayContaining(['outils/deploy.sh', '../../evasion.md']));
    expect(rep.problems.find((p: any) => /Schema\.png/.test(p.message)).fix.to).toBe('../images/schema.png');
    expect((await edwin.get('/api/docs')).data).toEqual([]);
    expect(readdirSync(join(HOME, 'sites')).filter(f => !f.startsWith('.'))).toEqual([]);
  });
  it('archive corrompue ou sans compte : refus explicite', async () => {
    expect((await upload(edwin, strToU8('ceci n\'est pas un zip, pas du tout'))).data.error).toMatch(/ZIP/);
    expect((await upload(anon, ZIP)).status).toBe(401);
    const r = await upload(edwin, ZIP);
    expect((await awa.post(`/api/imports/${r.data.id}/commit`, { mode: 'site', order: ['README.md'] })).status).toBe(404);
  });
});

describe('projet multi-pages', () => {
  it('construit le projet : pages = documents, ressources à leur place, correction appliquée, sources intactes', async () => {
    const r = await upload(edwin, ZIP);
    const c = await edwin.post(`/api/imports/${r.data.id}/commit`, {
      mode: 'site', name: 'Guide KERNEL', order: r.data.report.order, templateId: 'technique',
      fixes: [{ path: 'guide/configuration.md', from: '../images/Schema.png', to: '../images/schema.png' }],
    });
    expect(c.status).toBe(201);
    expect(c.data.kind).toBe('site');
    siteId = c.data.id;
    const s = (await edwin.get(`/api/sites/${siteId}`)).data;
    expect(s.pages.map((p: any) => p.path)).toEqual(['README.md', 'guide/configuration.md', 'guide/installation.md']);
    expect(s.settings.templateId).toBe('technique');
    expect(s.files.map((f: any) => f.path)).toEqual(['autres/schema.png', 'docs/charte.pdf', 'images/schema.png']);
    expect(s.source.rejected.map((x: any) => x.path)).toEqual(expect.arrayContaining(['outils/deploy.sh']));
    const conf = s.pages.find((p: any) => p.path === 'guide/configuration.md');
    expect((await edwin.get(`/api/docs/${conf.id}`)).data.markdown).toContain('(../images/schema.png)');
    expect((await edwin.get(`/api/docs/${conf.id}/source?original=1`)).data).toContain('(../images/Schema.png)');
    expect(existsSync(join(HOME, 'sites', siteId, 'original.zip'))).toBe(true);
    // les pages ne remplissent pas la bibliothèque : elles vivent dans le projet
    expect((await edwin.get('/api/docs')).data).toEqual([]);
    expect((await edwin.get('/api/sites')).data.map((x: any) => x.name)).toEqual(['Guide KERNEL']);
    const img = await fetch(`${base}/api/sites/${siteId}/files/images/schema.png`, { headers: { cookie: edwin.cookie } });
    expect(img.status).toBe(200);
    expect((await fetch(`${base}/api/sites/${siteId}/files/..%2F..%2Fusers.json`, { headers: { cookie: edwin.cookie } })).status).toBe(400);
  });
  it('les droits du projet valent pour chaque page ; un lien de projet ouvre ses pages', async () => {
    const s = (await edwin.get(`/api/sites/${siteId}`)).data;
    const page = s.pages[0].id;
    expect((await awa.get(`/api/docs/${page}`)).status).toBe(403);
    await edwin.post(`/api/sites/${siteId}/members`, { email: 'awa@test.dev', role: 'commenter' });
    expect((await awa.get(`/api/docs/${page}`)).data.role).toBe('commenter');
    expect((await awa.put(`/api/docs/${page}`, { markdown: 'pirate' })).status).toBe(403);
    expect((await awa.patch(`/api/sites/${siteId}`, { name: 'x' })).status).toBe(403);
    const l = (await edwin.post(`/api/sites/${siteId}/links`, { role: 'viewer' })).data.links[0];
    expect((await anon.get(`/api/share/${l.token}`)).data.siteId).toBe(siteId);
    anon.headers['x-share-token'] = l.token;
    expect((await anon.get(`/api/docs/${page}`)).data.role).toBe('viewer');
    expect((await anon.get(`/api/sites/${siteId}`)).data.role).toBe('viewer');
    await edwin.patch(`/api/sites/${siteId}/links/${l.id}`, { revoked: true });
    expect((await anon.get(`/api/docs/${page}`)).status).toBe(401);
  });
  it('images de l\'aperçu : clé signée, limitée au projet, révoquée avec l\'accès', async () => {
    await edwin.post(`/api/sites/${siteId}/members`, { email: 'awa@test.dev', role: 'viewer' });
    const key = (await awa.get(`/api/sites/${siteId}`)).data.assetKey;
    const url = `${base}/api/sites/${siteId}/files/images/schema.png`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(`${url}?k=${encodeURIComponent(key)}`)).status).toBe(200);
    const page = (await awa.get(`/api/sites/${siteId}`)).data.pages[0].id;
    expect((await fetch(`${base}/api/docs/${page}/assets/x.png?k=${encodeURIComponent(key)}`)).status).toBe(401);
    expect((await fetch(`${url}?k=${encodeURIComponent(key.slice(0, -2) + 'xx')}`)).status).toBe(401);
    const awaId = (await awa.get('/api/auth/state')).data.me.id;
    await edwin.del(`/api/sites/${siteId}/members/${awaId}`);
    expect((await fetch(`${url}?k=${encodeURIComponent(key)}`)).status).toBe(403);
  });
  it('réorganiser, ajouter une page, historique du projet', async () => {
    const s = (await edwin.get(`/api/sites/${siteId}`)).data;
    const reversed = [...s.pages].reverse().map((p: any) => ({ id: p.id, title: p.title }));
    expect((await edwin.patch(`/api/sites/${siteId}`, { pages: reversed })).data.pages[0].id).toBe(reversed[0].id);
    expect((await edwin.patch(`/api/sites/${siteId}`, { pages: reversed.slice(1) })).status).toBe(400);
    const add = await edwin.post(`/api/sites/${siteId}/pages`, { title: 'FAQ', folder: 'guide' });
    expect(add.data.site.pages.some((p: any) => p.path === 'guide/faq.md')).toBe(true);
    await edwin.put(`/api/docs/${add.data.page}`, { markdown: '# FAQ\n\nQuestions fréquentes.\n' });
    const act = (await edwin.get(`/api/sites/${siteId}/activity`)).data;
    expect(act.some((a: any) => a.type === 'imported')).toBe(true);
    expect(act.some((a: any) => a.type === 'page-added')).toBe(true);
    const search = (await edwin.get(`/api/sites/${siteId}/search`)).data;
    expect(search.find((d: any) => d.title === 'FAQ').text).toContain('Questions fréquentes');
  });
  it('export en site statique : une page HTML par page, liens et images relatifs, recherche partagée', async () => {
    const r = await fetch(`${base}/api/sites/${siteId}/export`, { method: 'POST', headers: { cookie: edwin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ format: 'site' }) });
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toEqual(expect.arrayContaining(['guide-kernel/README.html', 'guide-kernel/guide/installation.html', 'guide-kernel/images/schema.png', 'guide-kernel/_static/search-index.js', 'guide-kernel/index.html']));
    expect(names.some(n => n.startsWith('guide-kernel/_static/fonts/'))).toBe(true);
    const inst = strFromU8(files['guide-kernel/guide/installation.html']);
    expect(inst).toContain('src="../images/schema.png"');
    expect(inst).toContain('href="configuration.html#reseau"');
    expect(inst).toContain('href="../docs/charte.pdf"');
    expect(inst).toContain('data-index="../_static/search-index.js"');
    expect(inst).not.toContain('data:font');
  });
  it('PDF unique et PDF par page', async () => {
    const one = await fetch(`${base}/api/sites/${siteId}/export`, { method: 'POST', headers: { cookie: edwin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ format: 'pdf' }) });
    expect(one.status).toBe(200);
    expect(Buffer.from(await one.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(JSON.parse(decodeURIComponent(one.headers.get('x-studio-info')!)).pages).toBeGreaterThanOrEqual(4);
    const many = await fetch(`${base}/api/sites/${siteId}/export`, { method: 'POST', headers: { cookie: edwin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ format: 'pdf-pages' }) });
    const z = unzipSync(new Uint8Array(await many.arrayBuffer()));
    expect(Object.keys(z).length).toBe(4);
  }, 120_000);
  it('publication : site servi sous /p/<id>/, réservé aux membres si demandé', async () => {
    const p = (await edwin.post(`/api/sites/${siteId}/publish`, { visibility: 'public' })).data;
    const home = await fetch(`${base}/p/${p.id}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('sd-site-nav');
    expect((await fetch(`${base}/p/${p.id}/images/schema.png`)).status).toBe(200);
    expect((await fetch(`${base}/p/${p.id}/..%2F..%2Fusers.json`)).status).toBe(404);
    const priv = (await edwin.post(`/api/sites/${siteId}/publish`, { visibility: 'members' })).data;
    expect((await fetch(`${base}/p/${priv.id}/`)).status).toBe(401);
  });
});

describe('document continu et import individuel', () => {
  it('fusion : un document, chapitres dans l\'ordre choisi, fichier exclu', async () => {
    const r = await upload(edwin, ZIP);
    const c = await edwin.post(`/api/imports/${r.data.id}/commit`, { mode: 'merge', name: 'Guide complet', order: ['guide/installation.md', 'README.md'] });
    const d = (await edwin.get(`/api/docs/${c.data.id}`)).data;
    expect(d.markdown.indexOf('# Installation')).toBeLessThan(d.markdown.indexOf('# Guide'));
    expect(d.markdown).not.toContain('# Configuration');
    expect(d.assets.map((a: any) => a.name)).toEqual(expect.arrayContaining(['images-schema.png']));
    expect(d.settings.page.breakBeforeH1).toBe(true);
  });
  it('individuel : un document par page, rangés dans une collection', async () => {
    const r = await upload(edwin, ZIP);
    const c = await edwin.post(`/api/imports/${r.data.id}/commit`, { mode: 'separate', name: 'Pages', order: r.data.report.order });
    expect(c.data.ids.length).toBe(3);
    const docs = (await edwin.get('/api/docs')).data.filter((d: any) => d.project === 'Pages');
    expect(docs.length).toBe(3);
    const inst = (await edwin.get(`/api/docs/${c.data.ids.find((id: string) => /installation/.test(id))}`)).data;
    expect(inst.markdown).toContain('./assets/images-schema.png');
    expect(inst.assets.map((a: any) => a.name)).toContain('images-schema.png');
  });
});
