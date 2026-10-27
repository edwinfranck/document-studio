// Fonctions d'équipe sur un vrai serveur : préférences et e-mails, espaces, identités visuelles,
// plugins, modèles de validation, statistiques de publication, commentaires sur une zone de page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { CollabClient, Http, until } from './helpers.ts';

const HOME = mkdtempSync(join(tmpdir(), 'studio-team-'));
const MAIL = join(HOME, 'outbox');
process.env.STUDIO_HOME = HOME;
process.env.STUDIO_MAIL_DIR = MAIL;
process.env.STUDIO_PUBLIC_URL = 'https://studio.exemple.org';
const { createApp, flushDigests } = await import('../src/app.ts');

let base = '';
let wsBase = '';
const server = createApp();
beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/collab`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const mails = () => (existsSync(MAIL) ? readdirSync(MAIL).sort().map(f => JSON.parse(readFileSync(join(MAIL, f), 'utf8'))) : []);
const mailsTo = (to: string) => mails().filter(m => m.to === to);
let edwin: Http, awa: Http, koffi: Http;
let awaId = '', koffiId = '';
let docId = '';

describe('comptes et préférences de notification', () => {
  it('le premier compte est administrateur ; les préférences ont des valeurs par défaut', async () => {
    edwin = new Http(base); awa = new Http(base); koffi = new Http(base);
    expect((await edwin.post('/api/auth/register', { name: 'Edwin', email: 'edwin@test.dev', password: 'motdepasse1' })).data.me.admin).toBe(true);
    awaId = (await awa.post('/api/auth/register', { name: 'Awa', email: 'awa@test.dev', password: 'motdepasse2' })).data.me.id;
    koffiId = (await koffi.post('/api/auth/register', { name: 'Koffi', email: 'koffi@test.dev', password: 'motdepasse3' })).data.me.id;
    const st = (await awa.get('/api/auth/state')).data;
    expect(st.me.admin).toBeUndefined();
    expect(st.mail).toBe(true);
    expect(st.prefs.notify.mention).toBe('email');
    expect(st.prefs.notify.comment).toBe('app');
  });
  it('une mention part par e-mail ; une catégorie désactivée ne notifie plus du tout', async () => {
    docId = (await edwin.post('/api/docs', { name: 'Rapport', markdown: '# Rapport\n\nLe budget reste à définir.\n' })).data.id;
    await edwin.post(`/api/docs/${docId}/members`, { email: 'awa@test.dev', role: 'editor' });
    expect(mailsTo('awa@test.dev').some(m => /invité/.test(m.subject))).toBe(true);
    await edwin.post(`/api/docs/${docId}/comments`, { body: '@Awa tu valides ?', mentions: [awaId], anchor: { quote: '', line: 1 } });
    const m = mailsTo('awa@test.dev').find(x => /mentionné/.test(x.subject));
    expect(m?.link).toMatch(/^https:\/\/studio\.exemple\.org\/#\/doc\//);
    await awa.put('/api/auth/me', { prefs: { notify: { mention: 'off' } } });
    const before = (await awa.get('/api/notifications')).data.length;
    await edwin.post(`/api/docs/${docId}/comments`, { body: '@Awa encore', mentions: [awaId], anchor: { quote: '', line: 1 } });
    expect((await awa.get('/api/notifications')).data.length).toBe(before);
  });
  it('le résumé quotidien regroupe les messages en un seul', async () => {
    await awa.put('/api/auth/me', { prefs: { notify: { mention: 'email' }, digest: 'daily' } });
    const n0 = mailsTo('awa@test.dev').length;
    await edwin.post(`/api/docs/${docId}/comments`, { body: '@Awa un', mentions: [awaId], anchor: { quote: '', line: 1 } });
    await edwin.post(`/api/docs/${docId}/comments`, { body: '@Awa deux', mentions: [awaId], anchor: { quote: '', line: 1 } });
    expect(mailsTo('awa@test.dev').length).toBe(n0);
    await flushDigests(true);
    const all = mailsTo('awa@test.dev');
    expect(all.length).toBe(n0 + 1);
    expect(all[all.length - 1].subject).toMatch(/2 notifications/);
  });
  it('une adresse sans compte reçoit l\'invitation par e-mail', async () => {
    await edwin.post(`/api/docs/${docId}/members`, { email: 'nouvelle@test.dev', role: 'commenter' });
    expect(mailsTo('nouvelle@test.dev')[0].subject).toMatch(/vous invite sur « Rapport »/);
  });
});

describe('espaces d\'équipe', () => {
  let sid = '';
  it('les membres d\'un espace accèdent à ses documents, avec le rôle fixé par le document', async () => {
    sid = (await edwin.post('/api/spaces', { name: 'Pédagogie' })).data.id;
    await edwin.post(`/api/spaces/${sid}/members`, { email: 'koffi@test.dev', role: 'member' });
    expect((await koffi.get(`/api/docs/${docId}`)).status).toBe(403);
    expect((await edwin.put(`/api/docs/${docId}/space`, { space: sid, role: 'commenter' })).status).toBe(200);
    const d = await koffi.get(`/api/docs/${docId}`);
    expect(d.data.role).toBe('commenter');
    expect(d.data.space.name).toBe('Pédagogie');
    expect((await koffi.get('/api/docs')).data.map((x: any) => x.id)).toContain(docId);
    expect((await koffi.put(`/api/docs/${docId}`, { markdown: 'pirate' })).status).toBe(403);
    // le temps réel suit le même rôle
    const c = new CollabClient(`${wsBase}?doc=${docId}`, koffi.cookie);
    await c.connect();
    await until(() => !!c.info);
    expect(c.info.role).toBe('commenter');
    // retiré de l'espace : l'accès et la connexion sont coupés
    await edwin.del(`/api/spaces/${sid}/members/${koffiId}`);
    await until(() => c.closedCode === 4403);
    expect((await koffi.get(`/api/docs/${docId}`)).status).toBe(403);
  });
  it('seul un administrateur gère l\'espace ; on ne range un document que dans un espace dont on est membre', async () => {
    await edwin.post(`/api/spaces/${sid}/members`, { email: 'koffi@test.dev', role: 'member' });
    expect((await koffi.post(`/api/spaces/${sid}/members`, { email: 'awa@test.dev', role: 'admin' })).status).toBe(403);
    const other = (await koffi.post('/api/spaces', { name: 'Perso Koffi' })).data.id;
    expect((await edwin.put(`/api/docs/${docId}/space`, { space: other })).status).toBe(403);
    expect((await edwin.patch(`/api/spaces/${sid}/members/${(await edwin.get('/api/auth/state')).data.me.id}`, { role: 'member' })).status).toBe(400);
  });
  it('une invitation d\'espace devient une adhésion à la création du compte', async () => {
    await edwin.post(`/api/spaces/${sid}/members`, { email: 'fatou@test.dev', role: 'member' });
    expect(mailsTo('fatou@test.dev')[0].subject).toMatch(/l'espace « Pédagogie »/);
    const fatou = new Http(base);
    await fatou.post('/api/auth/register', { name: 'Fatou', email: 'fatou@test.dev', password: 'motdepasse4' });
    expect((await fatou.get('/api/spaces')).data.map((s: any) => s.name)).toEqual(['Pédagogie']);
    expect((await fatou.get(`/api/docs/${docId}`)).data.role).toBe('commenter');
  });
});

describe('identités visuelles', () => {
  let bid = '';
  it('créer, déposer un logo, appliquer : réglages, logo copié, couverture insérée, version notée', async () => {
    const b = await edwin.post('/api/brands', { name: 'KERNEL', colors: { primary: '#c8f031', bogus: 'red;}' }, fonts: { heading: 'DM Sans' }, organization: 'Epitech Africa', footer: { right: '{page}' }, cover: ':::cover\n![Logo](./assets/logo.png)\n# Titre\n:::' });
    bid = b.data.id;
    expect(b.data.version).toBe(1);
    expect(b.data.colors).toEqual({ primary: '#c8f031' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await fetch(`${base}/api/brands/${bid}/assets/logo.png`, { method: 'PUT', body: png, headers: { cookie: edwin.cookie } });
    expect(up.status).toBe(201);
    expect((await up.json()).version).toBe(2);
    const r = await edwin.post(`/api/docs/${docId}/brand`, { brand: bid, cover: true });
    expect(r.status).toBe(200);
    expect(r.data.settings.overrides.colors.primary).toBe('#c8f031');
    expect(r.data.settings.brand).toEqual({ id: bid, version: 2, name: 'KERNEL' });
    expect(r.data.assets.map((a: any) => a.name)).toContain(`${bid}-logo.png`);
    const md = (await edwin.get(`/api/docs/${docId}`)).data.markdown;
    expect(md.startsWith(`:::cover\n![Logo](./assets/${bid}-logo.png)`)).toBe(true);
    expect(md).toContain('Le budget reste à définir.');
  });
  it('une identité n\'est modifiée que par son auteur ; l\'historique garde chaque version', async () => {
    expect((await awa.post('/api/brands', { id: bid, name: 'Piratée' })).status).toBe(403);
    const v = await edwin.post('/api/brands', { id: bid, colors: { primary: '#000000' } });
    expect(v.data.version).toBe(3);
    expect(v.data.history.map((h: any) => h.summary)).toEqual(['création', 'logos', 'couleurs']);
    // le document ne change pas tout seul : il garde la version appliquée
    expect((await edwin.get(`/api/docs/${docId}`)).data.settings.brand.version).toBe(2);
  });
});

describe('plugins de composants', () => {
  const plugin = { id: 'jauge', name: 'jauge', label: 'Jauge', content: 'none', attrs: { valeur: { type: 'number', description: 'Pourcentage' } }, template: '<div class="jauge"><span style="width:{{valeur}}%"></span></div>', css: '.jauge{height:8px}' };
  it('seul l\'administrateur installe ; le plugin sert aux exports du serveur', async () => {
    expect((await awa.post('/api/plugins', plugin)).status).toBe(403);
    expect((await edwin.post('/api/plugins', { ...plugin, name: 'callout' })).status).toBe(400);
    expect((await edwin.post('/api/plugins', plugin)).status).toBe(201);
    expect((await awa.get('/api/plugins')).data.map((p: any) => p.id)).toEqual(['jauge']);
    await edwin.put(`/api/docs/${docId}`, { markdown: '# Plugin\n\n:::jauge {valeur=72}\n:::\n' });
    const html = await edwin.post(`/api/docs/${docId}/export`, { format: 'html', mode: 'reading' });
    expect(html.data).toContain('<div class="jauge"><span style="width:72%"></span></div>');
    expect((await edwin.del('/api/plugins/jauge')).data).toEqual([]);
  });
});

describe('modèles de validation', () => {
  it('enregistrer un modèle et le retrouver ; relecteurs inconnus écartés', async () => {
    const t = await edwin.post('/api/workflow-templates', { name: 'Comité pédagogique', reviewers: [awaId, koffiId, 'inconnu'], requiredApprovals: 5 });
    expect(t.data.reviewers).toEqual([awaId, koffiId]);
    expect(t.data.requiredApprovals).toBe(2);
    expect((await edwin.get('/api/workflow-templates')).data.map((x: any) => x.name)).toEqual(['Comité pédagogique']);
    expect((await awa.get('/api/workflow-templates')).data).toEqual([]);
    expect((await awa.del(`/api/workflow-templates/${t.data.id}`)).status).toBe(403);
  });
});

describe('publications et commentaires sur une zone de page', () => {
  it('les consultations sont comptées sans donnée personnelle', async () => {
    const p = (await edwin.post(`/api/docs/${docId}/publish`, { official: false, visibility: 'public', pdf: false })).data;
    const anon = new Http(base);
    await anon.get(`/p/${p.id}`); await anon.get(`/p/${p.id}`); await anon.get(`/p/${p.id}/slides`);
    const st = (await edwin.get(`/api/docs/${docId}/publications/${p.id}/stats`)).data;
    expect(st.total).toBe(3);
    expect(st.formats).toEqual({ reading: 2, slides: 1 });
    expect(Object.values(st.days)).toEqual([{ views: 3, visitors: 1 }]);
    expect(JSON.stringify(st)).not.toContain('127.0.0.1');
    expect((await edwin.get(`/api/docs/${docId}`)).data.publications.find((x: any) => x.id === p.id).views).toBe(3);
  });
  it('un commentaire peut viser une zone d\'une page imprimée', async () => {
    const c = await awa.post(`/api/docs/${docId}/comments`, { body: 'Logo trop petit', anchor: { quote: '', line: 3, page: 2, rect: { x: 0.1, y: 0.2, w: 0.3, h: 2 }, excerpt: 'Plugin' } });
    expect(c.data.anchor).toMatchObject({ page: 2, rect: { x: 0.1, y: 0.2, w: 0.3, h: 1 }, excerpt: 'Plugin' });
  });
});
