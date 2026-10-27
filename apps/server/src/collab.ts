// Édition simultanée : un salon Yjs par document, transporté en WebSocket (protocole y-protocols).
//
// - La source Markdown est un Y.Text (« source ») ; les réglages, un Y.Map (« meta »).
// - Lecteurs et commentateurs reçoivent les changements mais ne peuvent pas en envoyer : leurs messages
//   d'écriture sont ignorés côté serveur, quel que soit le client.
// - Persistance : collab.bin (état Yjs complet, jamais réinitialisé) et document.md (miroir lisible).
// - Versions (regroupement documenté dans docs/collaboration.md) : une version est enregistrée quand une
//   autre personne commence à écrire, après 30 s sans frappe si la dernière version a plus de 5 min,
//   quand le dernier participant quitte, et lors des actions explicites (restauration, publication, fusion).
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { diffChars } from 'diff';
import type { DocSettings, Role } from '@studio/engine';
import { can } from '@studio/engine';
import * as S from './store.ts';
import { currentUser } from './auth.ts';

export const MSG_SYNC = 0, MSG_AWARENESS = 1, MSG_EVENT = 3, MSG_INFO = 4;
const IDLE_CHECKPOINT_MS = 30_000;
const MIN_VERSION_GAP_MS = 5 * 60_000;

interface Conn { ws: WebSocket; userId: string; name: string; color: string; role: Role; share?: string; awarenessIds: Set<number> }

class Room {
  doc = new Y.Doc();
  text = this.doc.getText('source');
  meta = this.doc.getMap('meta');
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Set<Conn>();
  pendingAuthors = new Set<string>();
  persistTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastSettings = '';

  constructor(public id: string) {
    this.awareness.setLocalState(null);
    const dir = S.docDir(id);
    const bin = join(dir, 'collab.bin');
    const md = S.readMarkdown(id);
    const settings = S.readMeta(id).settings || {};
    if (existsSync(bin)) {
      Y.applyUpdate(this.doc, new Uint8Array(readFileSync(bin)), 'load');
      // Fichier modifié hors de l'application (éditeur de texte, CLI) : fusionné comme une modification, jamais écrasé.
      if (this.text.toString() !== md) {
        applyDiff(this.text, md, 'external');
        S.addVersion(id, { markdown: md, settings, authors: [], kind: 'auto', label: 'Modifié hors de l\'application' });
        S.logActivity(id, 'system', 'external-edit', 'Le fichier document.md a été modifié hors de l\'application ; la modification a été intégrée.');
      }
    } else {
      this.doc.transact(() => { this.text.insert(0, md); this.meta.set('settings', settings); }, 'load');
    }
    if (!this.meta.has('settings')) this.doc.transact(() => this.meta.set('settings', settings), 'load');
    this.lastSettings = JSON.stringify(this.meta.get('settings'));

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      for (const c of this.conns) if (c !== origin) send(c.ws, msg);
      if (origin === 'load') return;
      this.schedulePersist();
    });
    this.awareness.on('update', ({ added, updated, removed }: any, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (origin && (origin as Conn).awarenessIds) {
        for (const id of added) (origin as Conn).awarenessIds.add(id);
        for (const id of removed) (origin as Conn).awarenessIds.delete(id);
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      const msg = encoding.toUint8Array(enc);
      for (const c of this.conns) send(c.ws, msg);
    });
  }

  get markdown() { return this.text.toString(); }
  get settings(): Partial<DocSettings> { return (this.meta.get('settings') as Partial<DocSettings>) || {}; }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 400);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.checkpoint('idle'), IDLE_CHECKPOINT_MS);
  }

  persist() {
    clearTimeout(this.persistTimer);
    if (!S.docExists(this.id)) return;
    const dir = S.docDir(this.id);
    S.writeAtomic(join(dir, 'collab.bin'), Y.encodeStateAsUpdate(this.doc));
    if (S.readMarkdown(this.id) !== this.markdown) S.writeMarkdownFile(this.id, this.markdown);
    const st = JSON.stringify(this.settings);
    S.patchMeta(this.id, m => {
      if (st !== this.lastSettings) m.settings = this.settings;
      m.updatedAt = new Date().toISOString();
    });
    this.lastSettings = st;
  }

  /** Enregistre une version si des modifications attendent (règles en tête de fichier). */
  checkpoint(reason: 'idle' | 'author-change' | 'leave' | 'explicit', force = false) {
    if (!S.docExists(this.id)) return null;
    this.persist();
    if (!this.pendingAuthors.size && !force) return null;
    const last = S.latestVersion(this.id);
    if (reason === 'idle' && last && Date.now() - new Date(last.at).getTime() < MIN_VERSION_GAP_MS) return null;
    const v = S.addVersion(this.id, { markdown: this.markdown, settings: this.settings, authors: [...this.pendingAuthors], kind: 'auto' });
    this.pendingAuthors.clear();
    if (v) this.event({ type: 'versions' });
    return v;
  }

  event(e: Record<string, unknown>) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_EVENT);
    encoding.writeVarString(enc, JSON.stringify(e));
    const msg = encoding.toUint8Array(enc);
    for (const c of this.conns) send(c.ws, msg);
  }

  info(c: Conn) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_INFO);
    encoding.writeVarString(enc, JSON.stringify({ role: c.role, userId: c.userId, name: c.name, color: c.color }));
    send(c.ws, encoding.toUint8Array(enc));
  }
}

const rooms = new Map<string, Room>();
export function room(id: string): Room {
  let r = rooms.get(id);
  if (!r) { r = new Room(id); rooms.set(id, r); }
  return r;
}
export const liveRoom = (id: string) => rooms.get(id);

function send(ws: WebSocket, msg: Uint8Array) {
  if (ws.readyState === 1) ws.send(msg, err => { if (err) ws.close(); });
}

/** Remplace le texte par `next` avec le minimum d'opérations : le travail concurrent des autres est préservé. */
export function applyDiff(text: Y.Text, next: string, origin: unknown) {
  const doc = text.doc!;
  doc.transact(() => {
    let pos = 0;
    for (const p of diffChars(text.toString(), next)) {
      if (p.added) { text.insert(pos, p.value); pos += p.value.length; }
      else if (p.removed) text.delete(pos, p.value.length);
      else pos += p.value.length;
    }
  }, origin);
}

/** Écrit un nouveau texte (restauration, fusion, API) dans le document collaboratif, connecté ou non. */
export function writeText(id: string, md: string, actor: string, settings?: Partial<DocSettings>) {
  const r = room(id);
  if (r.markdown !== md) applyDiff(r.text, md, 'server');
  if (settings) r.doc.transact(() => r.meta.set('settings', settings), 'server');
  r.pendingAuthors.add(actor);
  r.persist();
  if (!r.conns.size) closeIdle(id);
  return r;
}

export function setSettings(id: string, settings: Partial<DocSettings>, actor: string) {
  const r = room(id);
  r.doc.transact(() => r.meta.set('settings', settings), 'server');
  r.pendingAuthors.add(actor);
  r.persist();
  if (!r.conns.size) closeIdle(id);
}

function closeIdle(id: string) {
  const r = rooms.get(id);
  if (!r || r.conns.size) return;
  r.checkpoint('leave');
  r.doc.destroy();
  rooms.delete(id);
}

/** Document supprimé : les connexions sont fermées, rien n'est réécrit. */
export function closeRoom(id: string) {
  const r = rooms.get(id);
  if (!r) return;
  clearTimeout(r.persistTimer); clearTimeout(r.idleTimer);
  for (const c of r.conns) c.ws.close(4410, 'Document supprimé');
  r.conns.clear();
  r.doc.destroy();
  rooms.delete(id);
}

export function broadcast(id: string, e: Record<string, unknown>) { rooms.get(id)?.event(e); }

/** Après un changement de droits ou une révocation : rôle recalculé, connexion fermée si l'accès est perdu. */
export function refreshAccess(id: string) {
  const r = rooms.get(id);
  if (!r) return;
  const m = S.readMeta(id);
  for (const c of [...r.conns]) {
    const a = S.accessOf(m, c.userId.startsWith('guest:') ? null : c.userId, c.share);
    if (!a.role) { c.ws.close(4403, 'Accès révoqué'); continue; }
    if (a.role !== c.role) { c.role = a.role; r.info(c); }
  }
}

/** Liste des personnes connectées (pour l'interface et les tests). */
export const presence = (id: string) => [...(rooms.get(id)?.conns || [])].map(c => ({ userId: c.userId, name: c.name, role: c.role }));

export function attachCollab(server: import('node:http').Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/collab') { socket.destroy(); return; }
    const id = url.searchParams.get('doc') || '';
    const share = url.searchParams.get('share') || undefined;
    let access: S.Access;
    try { access = S.accessOf(S.readMeta(id), currentUser(req)?.id || null, share); }
    catch { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    if (!access.role) {
      S.audit('ws-denied', { doc: id, ip: req.socket.remoteAddress });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    const user = currentUser(req);
    wss.handleUpgrade(req, socket, head, ws => {
      const guestName = (url.searchParams.get('name') || 'Invité').slice(0, 40);
      const conn: Conn = {
        ws, role: access.role!, share, awarenessIds: new Set(),
        userId: user?.id || `guest:${Math.random().toString(36).slice(2, 10)}`,
        name: user?.name || `${guestName} (invité)`, color: user?.color || '#8a8b93',
      };
      join_(id, conn);
    });
  });
  return wss;
}

function join_(id: string, c: Conn) {
  const r = room(id);
  r.conns.add(c);
  r.info(c);
  c.ws.binaryType = 'arraybuffer';
  c.ws.on('message', (data: ArrayBuffer) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const sub = decoding.peekVarUint(dec);
        const writes = sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate;
        if (writes && !can(c.role, 'edit')) return;                       // lecture seule : ignoré
        if (writes && !r.pendingAuthors.has(c.userId) && r.pendingAuthors.size) r.checkpoint('author-change');
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(dec, enc, r.doc, c);
        if (writes) r.pendingAuthors.add(c.userId);
        if (encoding.length(enc) > 1) send(c.ws, encoding.toUint8Array(enc));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(r.awareness, decoding.readVarUint8Array(dec), c);
      }
    } catch (e) {
      console.error('collab', id, e);
    }
  });
  c.ws.on('close', () => {
    r.conns.delete(c);
    awarenessProtocol.removeAwarenessStates(r.awareness, [...c.awarenessIds], null);
    if (!r.conns.size) closeIdle(id);
  });
  // Étape 1 de la synchronisation et présences existantes.
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, r.doc);
  send(c.ws, encoding.toUint8Array(enc));
  const states = [...r.awareness.getStates().keys()];
  if (states.length) {
    const a = encoding.createEncoder();
    encoding.writeVarUint(a, MSG_AWARENESS);
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(r.awareness, states));
    send(c.ws, encoding.toUint8Array(a));
  }
}

/** Arrêt propre : tout est persisté et versionné. */
export function flushAll() { for (const id of [...rooms.keys()]) { rooms.get(id)!.checkpoint('leave'); } }
