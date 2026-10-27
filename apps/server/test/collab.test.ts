// Collaboration de bout en bout sur un vrai serveur : comptes, droits, liens, édition simultanée,
// versions, commentaires ancrés, suggestions, validation, publications, branches, blocs, notifications.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { CollabClient, Http, until, wait } from './helpers.ts';

const HOME = mkdtempSync(join(tmpdir(), 'studio-collab-'));
process.env.STUDIO_HOME = HOME;
const { createApp } = await import('../src/app.ts');
const S = await import('../src/store.ts');

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

const owner = () => new Http(base);
let edwin: Http, awa: Http, koffi: Http, anon: Http;
let docId = '';
const ws = (h: Http, id = docId, extra = '') => new CollabClient(`${wsBase}?doc=${id}${extra}`, h.cookie);

describe('comptes', () => {
  it('le premier compte récupère les documents existants', async () => {
    // un document créé avant les comptes (ancienne version de l'application)
    S.createDoc({ name: 'Ancien', markdown: '# Ancien\n' }, undefined as any);
    edwin = owner();
    const r = await edwin.post('/api/auth/register', { name: 'Edwin', email: 'edwin@test.dev', password: 'motdepasse1' });
    expect(r.status).toBe(201);
    expect((await edwin.get('/api/docs')).data.map((d: any) => d.name)).toContain('Ancien');
  });
  it('refuse un mauvais mot de passe et un doublon', async () => {
    const x = new Http(base);
    expect((await x.post('/api/auth/login', { email: 'edwin@test.dev', password: 'faux-faux' })).status).toBe(401);
    expect((await x.post('/api/auth/register', { name: 'X', email: 'edwin@test.dev', password: 'motdepasse1' })).status).toBe(409);
    expect((await x.get('/api/docs')).status).toBe(401);
  });
  it('crée les autres comptes', async () => {
    awa = new Http(base); koffi = new Http(base); anon = new Http(base);
    expect((await awa.post('/api/auth/register', { name: 'Awa', email: 'awa@test.dev', password: 'motdepasse2' })).status).toBe(201);
    expect((await koffi.post('/api/auth/register', { name: 'Koffi', email: 'koffi@test.dev', password: 'motdepasse3' })).status).toBe(201);
    const d = await edwin.post('/api/docs', { name: 'Rapport', markdown: '# Rapport\n\nLe budget prévisionnel reste à définir.\n\nLa livraison est prévue le 15 novembre.\n' });
    docId = d.data.id;
  });
});

describe('droits vérifiés côté serveur', () => {
  it('un non-membre n\'a accès à rien', async () => {
    expect((await awa.get(`/api/docs/${docId}`)).status).toBe(403);
    expect((await anon.get(`/api/docs/${docId}`)).status).toBe(401);
    await expect(ws(awa).connect()).rejects.toThrow(/403/);
  });
  it('lecteur : lit, ne commente pas, n\'écrit pas', async () => {
    expect((await edwin.post(`/api/docs/${docId}/members`, { email: 'awa@test.dev', role: 'viewer' })).status).toBe(201);
    expect((await awa.get(`/api/docs/${docId}`)).data.role).toBe('viewer');
    expect((await awa.put(`/api/docs/${docId}`, { markdown: 'piraté' })).status).toBe(403);
    expect((await awa.post(`/api/docs/${docId}/comments`, { body: 'x', anchor: { quote: '', line: 1 } })).status).toBe(403);
    // même un client modifié ne peut pas écrire par la connexion temps réel
    const c = ws(awa); await c.connect();
    expect(c.info.role).toBe('viewer');
    c.text.insert(0, 'PIRATE ');
    await wait(300);
    expect((await edwin.get(`/api/docs/${docId}`)).data.markdown).not.toContain('PIRATE');
    c.close();
  });
  it('commentateur puis éditeur ; le changement de rôle s\'applique aux connexions ouvertes', async () => {
    const me = (await awa.get('/api/auth/state')).data.me;
    await edwin.patch(`/api/docs/${docId}/members/${me.id}`, { role: 'commenter' });
    expect((await awa.post(`/api/docs/${docId}/comments`, { body: 'Question', anchor: { quote: '', line: 1 } })).status).toBe(201);
    const c = ws(awa); await c.connect();
    expect(c.info.role).toBe('commenter');
    await edwin.patch(`/api/docs/${docId}/members/${me.id}`, { role: 'editor' });
    await until(() => c.info.role === 'editor');
    c.close();
  });
  it('les refus sont consignés dans le journal de sécurité', () => {
    const audit = readFileSync(join(HOME, 'audit.jsonl'), 'utf8');
    expect(audit).toMatch(/"event":"denied"/);
    expect(audit).toMatch(/"event":"ws-denied"/);
  });
});

describe('liens de partage', () => {
  let token = '', lid = '';
  it('un lien lecteur ouvre le document sans compte', async () => {
    const r = await edwin.post(`/api/docs/${docId}/links`, { role: 'viewer', allowDownload: false });
    const l = r.data.links.at(-1); token = l.token; lid = l.id;
    expect((await anon.get(`/api/share/${token}`)).data.docId).toBe(docId);
    anon.headers['x-share-token'] = token;
    expect((await anon.get(`/api/docs/${docId}`)).data.role).toBe('viewer');
    expect((await anon.get(`/api/docs/${docId}`)).data.links).toBeUndefined();
  });
  it('respecte l\'interdiction de téléchargement', async () => {
    expect((await anon.get(`/api/docs/${docId}/source`)).status).toBe(403);
  });
  it('révocation immédiate, y compris des connexions ouvertes', async () => {
    const c = ws(anon, docId, `&share=${token}`); await c.connect();
    await edwin.patch(`/api/docs/${docId}/links/${lid}`, { revoked: true });
    await until(() => c.closedCode === 4403);
    expect((await anon.get(`/api/docs/${docId}`)).status).toBe(401);
    expect((await anon.get(`/api/share/${token}`)).status).toBe(404);
  });
  it('lien expiré et lien qui exige une connexion', async () => {
    const exp = (await edwin.post(`/api/docs/${docId}/links`, { role: 'viewer', expiresAt: '2020-01-01' })).data.links.at(-1);
    expect((await anon.get(`/api/share/${exp.token}`)).status).toBe(404);
    const priv = (await edwin.post(`/api/docs/${docId}/links`, { role: 'commenter', requireLogin: true })).data.links.at(-1);
    const a = new Http(base); a.headers['x-share-token'] = priv.token;
    expect((await a.get(`/api/docs/${docId}`)).status).toBe(401);
    koffi.headers['x-share-token'] = priv.token;
    expect((await koffi.get(`/api/docs/${docId}`)).data.role).toBe('commenter');
    delete koffi.headers['x-share-token'];
  });
});

describe('édition simultanée', () => {
  it('deux personnes écrivent en même temps sans rien perdre', async () => {
    const a = ws(edwin), b = ws(awa);
    await a.connect(); await b.connect();
    const at = a.text.toString().indexOf('La livraison');
    a.text.insert(at, 'Les objectifs du trimestre sont désormais documentés.\n\n');
    b.text.insert(b.text.length, '\nAnnexe : calendrier détaillé.\n');
    await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('Annexe') && a.text.toString().includes('objectifs'));
    // même mot modifié des deux côtés : les deux insertions sont conservées
    const p = a.text.toString().indexOf('15 novembre');
    a.text.insert(p, 'non pas le ');
    b.text.insert(p + 2, '');
    await until(() => a.text.toString() === b.text.toString());
    await wait(600);
    const disk = readFileSync(join(HOME, 'documents', docId, 'document.md'), 'utf8');
    expect(disk).toBe(a.text.toString());
    a.close(); b.close();
  });
  it('les présences sont partagées', async () => {
    const a = ws(edwin), b = ws(awa);
    await a.connect(); await b.connect();
    a.awareness.setLocalStateField('user', { name: 'Edwin', color: '#2b59c3' });
    const enc = (await import('lib0/encoding'));
    const aw = await import('y-protocols/awareness');
    const e = enc.createEncoder(); enc.writeVarUint(e, 1);
    enc.writeVarUint8Array(e, aw.encodeAwarenessUpdate(a.awareness, [a.doc.clientID]));
    a.ws.send(enc.toUint8Array(e));
    await until(() => [...b.awareness.getStates().values()].some((s: any) => s.user?.name === 'Edwin'));
    expect((await edwin.get(`/api/docs/${docId}/presence`)).data.length).toBe(2);
    a.close(); b.close();
  });
  it('des modifications faites hors ligne se fusionnent à la reconnexion', async () => {
    const a = ws(edwin); await a.connect();
    a.close();
    await wait(100);
    a.text.insert(0, '<!-- écrit hors ligne -->\n');            // la connexion est fermée : en attente
    const b = ws(awa); await b.connect();
    b.text.insert(b.text.length, 'Ajout en ligne.\n');
    await wait(200);
    await a.connect();                                          // échange des états manquants
    await until(() => b.text.toString().includes('hors ligne') && a.text.toString().includes('Ajout en ligne'));
    a.close(); b.close();
  });
  it('un fichier modifié hors de l\'application est intégré, pas écrasé', async () => {
    await wait(300);
    const f = join(HOME, 'documents', docId, 'document.md');
    writeFileSync(f, readFileSync(f, 'utf8') + '\nModifié à la main.\n');
    const a = ws(edwin); await a.connect();
    expect(a.text.toString()).toContain('Modifié à la main.');
    a.close();
  });
});

describe('versions et historique', () => {
  it('chaque version a des auteurs, une date et un résumé', async () => {
    await wait(300);
    const vs = (await edwin.get(`/api/docs/${docId}/versions`)).data;
    expect(vs.length).toBeGreaterThan(1);
    expect(vs[0]).toHaveProperty('at');
    expect(vs.some((v: any) => v.authorNames.includes('Awa'))).toBe(true);
    expect(vs.some((v: any) => /mot/.test(v.summary))).toBe(true);
  });
  it('une version nommée, puis une restauration qui ne détruit rien', async () => {
    const named = (await edwin.post(`/api/docs/${docId}/versions`, { label: 'Avant relecture' })).data;
    await edwin.put(`/api/docs/${docId}`, { markdown: '# Rapport\n\nTout réécrit.\n' });
    expect((await awa.post(`/api/docs/${docId}/versions/${named.n}/restore`)).status).toBe(403);  // éditeur, pas propriétaire
    const r = (await edwin.post(`/api/docs/${docId}/versions/${named.n}/restore`)).data;
    expect(r.kind).toBe('restore');
    expect(r.n).toBeGreaterThan(named.n);
    expect((await edwin.get(`/api/docs/${docId}`)).data.markdown).toBe(named.markdown ?? (await edwin.get(`/api/docs/${docId}/versions/${named.n}`)).data.markdown);
    const all = (await edwin.get(`/api/docs/${docId}/versions`)).data.map((v: any) => v.n);
    for (let i = 1; i <= r.n; i++) expect(all).toContain(i);
  });
  it('le journal d\'activité raconte ce qui s\'est passé', async () => {
    const act = (await edwin.get(`/api/docs/${docId}/activity`)).data.map((a: any) => a.text).join('\n');
    expect(act).toMatch(/a invité Awa/);
    expect(act).toMatch(/a révoqué un lien/);
    expect(act).toMatch(/a restauré la version/);
  });
});

describe('commentaires ancrés et suggestions', () => {
  const anchorOf = (doc: Y.Doc, quote: string) => {
    const t = doc.getText('source');
    const i = t.toString().indexOf(quote);
    return {
      start: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, i)),
      end: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, i + quote.length)),
      quote, line: t.toString().slice(0, i).split('\n').length,
    };
  };
  let sid = '';
  it('l\'ancre survit à un ajout de texte avant le passage', async () => {
    const a = ws(edwin); await a.connect();
    const quote = 'Le budget prévisionnel reste à définir.';
    const c = (await koffi.post(`/api/docs/${docId}/comments`, { body: 'Quel montant ?', anchor: anchorOf(a.doc, quote) })).status;
    expect(c).toBe(403);                                      // Koffi n'est pas membre
    await edwin.post(`/api/docs/${docId}/members`, { email: 'koffi@test.dev', role: 'commenter' });
    const s = await koffi.post(`/api/docs/${docId}/comments`, { kind: 'suggestion', body: 'Chiffre connu', replacement: 'Le budget prévisionnel est de 12 000 €.', anchor: anchorOf(a.doc, quote) });
    expect(s.status).toBe(201);
    sid = s.data.id;
    a.text.insert(0, 'Préambule ajouté.\n\n');                // le passage se déplace
    await wait(400);
    a.close();
  });
  it('accepter la suggestion applique le texte au bon endroit', async () => {
    expect((await koffi.post(`/api/docs/${docId}/comments/${sid}/decide`, { decision: 'accept' })).status).toBe(403);
    const r = await edwin.post(`/api/docs/${docId}/comments/${sid}/decide`, { decision: 'accept' });
    expect(r.data.status).toBe('accepted');
    const md = (await edwin.get(`/api/docs/${docId}`)).data.markdown;
    expect(md).toContain('Préambule ajouté.');
    expect(md).toContain('Le budget prévisionnel est de 12 000 €.');
    expect(md).not.toContain('reste à définir');
  });
  it('une suggestion dont le passage a changé est signalée, pas appliquée en aveugle', async () => {
    const a = ws(edwin); await a.connect();
    const quote = 'Préambule ajouté.';
    const s = (await koffi.post(`/api/docs/${docId}/comments`, { kind: 'suggestion', body: '', replacement: 'Introduction.', anchor: anchorOf(a.doc, quote) })).data;
    const i = a.text.toString().indexOf(quote);
    a.text.delete(i, 3); a.text.insert(i, 'XYZ');
    await wait(300);
    expect((await edwin.post(`/api/docs/${docId}/comments/${s.id}/decide`, { decision: 'accept' })).status).toBe(409);
    a.close();
  });
  it('réponses, mentions, assignation, résolution', async () => {
    const koffiId = (await koffi.get('/api/auth/state')).data.me.id;
    const c = (await edwin.post(`/api/docs/${docId}/comments`, { body: 'Peux-tu vérifier ?', mentions: [koffiId], anchor: { quote: 'Rapport', line: 1 } })).data;
    expect((await koffi.get('/api/notifications')).data.some((n: any) => n.type === 'mention')).toBe(true);
    await koffi.post(`/api/docs/${docId}/comments/${c.id}/replies`, { body: 'Vérifié.' });
    expect((await koffi.patch(`/api/docs/${docId}/comments/${c.id}`, { assignee: koffiId })).status).toBe(403);
    await edwin.patch(`/api/docs/${docId}/comments/${c.id}`, { assignee: koffiId });
    const done = (await edwin.patch(`/api/docs/${docId}/comments/${c.id}`, { status: 'resolved' })).data;
    expect(done.status).toBe('resolved');
    expect(done.replies[0].body).toBe('Vérifié.');
    expect(done.log.map((l: any) => l.action)).toEqual(['created', 'replied', 'assigned', 'resolved']);
  });
});

describe('validation et publication', () => {
  let pid = '';
  it('une publication officielle exige la validation des relecteurs', async () => {
    const awaId = (await awa.get('/api/auth/state')).data.me.id;
    await edwin.put(`/api/docs/${docId}/workflow`, { reviewers: [awaId], requiredApprovals: 1, state: 'review' });
    expect((await awa.get('/api/notifications')).data.some((n: any) => n.type === 'review')).toBe(true);
    expect((await edwin.post(`/api/docs/${docId}/publish`, { visibility: 'public', pdf: false })).status).toBe(409);
    const w = (await awa.post(`/api/docs/${docId}/review`, { decision: 'approved' })).data;
    expect(w.state).toBe('approved');
    const p = await edwin.post(`/api/docs/${docId}/publish`, { visibility: 'public', pdf: false });
    expect(p.status).toBe(201);
    pid = p.data.id;
  });
  it('la page publiée est servie et liée à sa version', async () => {
    const r = await anon.get(`/p/${pid}`);
    expect(r.status).toBe(200);
    expect(r.data).toContain('Rapport');
    const d = (await edwin.get(`/api/docs/${docId}`)).data;
    expect(d.publications[0].stale).toBe(false);
    expect(d.workflow.state).toBe('published');
  });
  it('une modification rend la publication obsolète et invalide la validation', async () => {
    await edwin.put(`/api/docs/${docId}`, { markdown: (await edwin.get(`/api/docs/${docId}`)).data.markdown + '\nAjout après publication.\n' });
    await edwin.post(`/api/docs/${docId}/versions`, { label: 'après' });
    const d = (await edwin.get(`/api/docs/${docId}`)).data;
    expect(d.publications[0].stale).toBe(true);
    expect((await edwin.post(`/api/docs/${docId}/publish`, { pdf: false })).data.error).toMatch(/renouvelée/);
    expect((await edwin.post(`/api/docs/${docId}/publish`, { official: false, pdf: false })).status).toBe(201);   // brouillon publié permis
  });
  it('publication réservée aux membres, puis retrait', async () => {
    const p = (await edwin.post(`/api/docs/${docId}/publish`, { official: false, visibility: 'members', pdf: false })).data;
    expect((await new Http(base).get(`/p/${p.id}`)).status).toBe(401);
    expect((await awa.get(`/p/${p.id}`)).status).toBe(200);
    await edwin.post(`/api/docs/${docId}/publications/${p.id}/revoke`);
    expect((await awa.get(`/p/${p.id}`)).status).toBe(404);
  });
});

describe('branches et fusion', () => {
  it('une branche se fusionne sans perdre les changements faits entre-temps', async () => {
    const main = (await edwin.post('/api/docs', { name: 'Procédure', markdown: '# Procédure\n\nÉtape 1.\n\nÉtape 2.\n\nÉtape 3.\n' })).data;
    const br = (await edwin.post(`/api/docs/${main.id}/branch`, { name: 'Refonte' })).data;
    await edwin.put(`/api/docs/${br.id}`, { markdown: '# Procédure\n\nÉtape 1 détaillée.\n\nÉtape 2.\n\nÉtape 3.\n' });
    await edwin.put(`/api/docs/${main.id}`, { markdown: '# Procédure\n\nÉtape 1.\n\nÉtape 2.\n\nÉtape 3 corrigée.\n' });
    const prev = (await edwin.get(`/api/docs/${br.id}/merge`)).data;
    expect(prev.conflicts).toBe(0);
    await edwin.post(`/api/docs/${br.id}/merge`, {});
    const md = (await edwin.get(`/api/docs/${main.id}`)).data.markdown;
    expect(md).toContain('Étape 1 détaillée.');
    expect(md).toContain('Étape 3 corrigée.');
  });
  it('un conflit n\'est jamais tranché en silence', async () => {
    const main = (await edwin.post('/api/docs', { name: 'Conflit', markdown: 'Ligne A\n' })).data;
    const br = (await edwin.post(`/api/docs/${main.id}/branch`, {})).data;
    await edwin.put(`/api/docs/${br.id}`, { markdown: 'Ligne B\n' });
    await edwin.put(`/api/docs/${main.id}`, { markdown: 'Ligne C\n' });
    expect((await edwin.get(`/api/docs/${br.id}/merge`)).data.conflicts).toBe(1);
    expect((await edwin.post(`/api/docs/${br.id}/merge`, {})).status).toBe(409);
  });
});

describe('blocs réutilisables', () => {
  it('un bloc inclus garde sa version épinglée jusqu\'à mise à jour', async () => {
    const b = (await edwin.post('/api/blocks', { name: 'Coordonnées', markdown: 'Hub, Cotonou. Tél. 01' })).data;
    await edwin.post('/api/blocks', { id: b.id, name: 'Coordonnées', markdown: 'Hub, Cotonou. Tél. 02' });
    const d = (await edwin.post('/api/docs', { name: 'Avec bloc', markdown: `# Contact\n\n:::include {block="${b.id}" version=1} :::\n` })).data;
    const html = (await edwin.post(`/api/docs/${d.id}/export`, { format: 'html', mode: 'reading' })).data as string;
    expect(html).toContain('Tél. 01');
    expect(html).not.toContain('Tél. 02');
    expect((await edwin.get(`/api/blocks/${b.id}`)).data.versions).toHaveLength(2);
    expect((await awa.post('/api/blocks', { id: b.id, name: 'x', markdown: 'volé' })).status).toBe(403);
  });
});

describe('suppression', () => {
  it('seul le propriétaire supprime ; le document part à la corbeille', async () => {
    expect((await awa.del(`/api/docs/${docId}`)).status).toBe(403);
    expect((await edwin.del(`/api/docs/${docId}`)).status).toBe(200);
    expect(existsSync(join(HOME, 'documents', docId))).toBe(false);
  });
});
