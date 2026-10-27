// Connexion temps réel au document : Yjs sur WebSocket, reprise automatique, copie locale hors ligne.
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Role } from './api.ts';

export type SyncStatus = 'connecting' | 'synced' | 'offline' | 'denied';
export interface Peer { clientId: number; name: string; color: string; userId?: string; line?: number }

type Listener = () => void;

export class Provider {
  doc = new Y.Doc();
  text = this.doc.getText('source');
  meta = this.doc.getMap('meta');
  awareness = new awarenessProtocol.Awareness(this.doc);
  status: SyncStatus = 'connecting';
  /** Des modifications locales attendent d'être envoyées (connexion coupée). */
  pending = false;
  role: Role | null = null;
  me: { userId: string; name: string; color: string } | null = null;
  ready: Promise<void>;
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: any) => void>();
  private idb: IndexeddbPersistence;
  private resolveReady!: () => void;

  constructor(private docId: string, private share: string, private guestName: string) {
    this.ready = new Promise(r => { this.resolveReady = r; });
    this.idb = new IndexeddbPersistence(`ds-collab-${docId}`, this.doc);
    this.doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === this || origin === this.idb) return;
      if (this.ws?.readyState === WebSocket.OPEN && this.status === 'synced') {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 0);
        syncProtocol.writeUpdate(e, u);
        this.ws.send(encoding.toUint8Array(e));
      } else if (this.role !== 'viewer' && this.role !== 'commenter') {
        this.pending = true;          // gardé dans IndexedDB, renvoyé à la reconnexion
        this.emit();
      }
    });
    this.awareness.on('update', ({ added, updated, removed }: any, origin: unknown) => {
      if (origin === this) { this.emit(); return; }
      const changed = [...added, ...updated, ...removed];
      if (this.ws?.readyState === WebSocket.OPEN) {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 1);
        encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.ws.send(encoding.toUint8Array(e));
      }
      this.emit();
    });
    addEventListener('online', this.onOnline);
    this.connect();
  }

  private onOnline = () => { if (this.status === 'offline') { clearTimeout(this.timer); this.connect(); } };

  private connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ doc: this.docId });
    if (this.share) q.set('share', this.share);
    if (this.guestName) q.set('name', this.guestName);
    const ws = new WebSocket(`${proto}://${location.host}/collab?${q}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.status = 'connecting';
    this.emit();
    ws.onopen = () => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, 0);
      syncProtocol.writeSyncStep1(e, this.doc);
      ws.send(encoding.toUint8Array(e));
      if (this.awareness.getLocalState()) {
        const a = encoding.createEncoder();
        encoding.writeVarUint(a, 1);
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
        ws.send(encoding.toUint8Array(a));
      }
    };
    ws.onmessage = ev => {
      const d = decoding.createDecoder(new Uint8Array(ev.data as ArrayBuffer));
      const type = decoding.readVarUint(d);
      if (type === 0) {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 0);
        const sub = syncProtocol.readSyncMessage(d, e, this.doc, this);
        if (encoding.length(e) > 1) ws.send(encoding.toUint8Array(e));
        if (sub === syncProtocol.messageYjsSyncStep2 && this.status !== 'synced') {
          this.status = 'synced';
          this.retry = 0;
          // la réponse à l'étape 1 du serveur a déjà transmis nos modifications en attente
          this.pending = false;
          this.resolveReady();
          this.emit();
        }
      } else if (type === 1) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), this);
      } else if (type === 3) {
        const e = JSON.parse(decoding.readVarString(d));
        for (const l of this.eventListeners) l(e);
      } else if (type === 4) {
        const info = JSON.parse(decoding.readVarString(d));
        this.role = info.role;
        this.me = { userId: info.userId, name: info.name, color: info.color };
        this.awareness.setLocalStateField('user', { name: info.name, color: info.color, userId: info.userId });
        this.emit();
      }
    };
    ws.onclose = ev => {
      this.ws = null;
      if (this.closed) return;
      if (ev.code === 4403 || ev.code === 4410) { this.status = 'denied'; this.emit(); this.resolveReady(); return; }
      this.status = 'offline';
      this.emit();
      // reprise : 0,5 s, 1 s, 2 s… jusqu'à 15 s
      this.timer = setTimeout(() => this.connect(), Math.min(15000, 500 * 2 ** this.retry++));
    };
  }

  /** Après une fermeture définitive (accès retiré) ou un premier échec : on se rabat sur la copie locale. */
  async whenReady(ms = 4000) {
    await Promise.race([this.ready, new Promise(r => setTimeout(r, ms)), this.idb.whenSynced]);
  }

  setCursorLine(line: number) {
    const s = this.awareness.getLocalState() as any;
    if (s?.user) this.awareness.setLocalStateField('line', line);
  }

  peers(): Peer[] {
    const out: Peer[] = [];
    this.awareness.getStates().forEach((s: any, id) => {
      if (id === this.doc.clientID || !s?.user) return;
      out.push({ clientId: id, name: s.user.name, color: s.user.color, userId: s.user.userId, line: s.line });
    });
    return out;
  }

  /** Ancre durable : positions relatives Yjs, qui suivent le texte quand il bouge. */
  anchor(from: number, to: number) {
    return {
      start: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.text, from)),
      end: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.text, to, -1)),
    };
  }
  resolve(a: { start?: unknown; end?: unknown }): { from: number; to: number } | null {
    try {
      if (!a.start || !a.end) return null;
      const s = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(a.start), this.doc);
      const e = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(a.end), this.doc);
      return s && e ? { from: s.index, to: Math.max(s.index, e.index) } : null;
    } catch { return null; }
  }

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  onEvent(l: (e: any) => void) { this.eventListeners.add(l); return () => { this.eventListeners.delete(l); }; }
  private emit() { for (const l of this.listeners) l(); }

  destroy() {
    this.closed = true;
    clearTimeout(this.timer);
    removeEventListener('online', this.onOnline);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.ws?.close();
    this.idb.destroy();
    this.doc.destroy();
  }
}
