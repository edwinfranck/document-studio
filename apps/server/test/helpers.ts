// Outils de test : un client HTTP avec sa session, et un client collaboratif Yjs minimal.
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export class Http {
  cookie = '';
  headers: Record<string, string> = {};
  constructor(public base: string) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(this.base + path, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...this.headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data: data as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}

/** Client collaboratif : même protocole que l'interface (sync + présence). */
export class CollabClient {
  doc = new Y.Doc();
  text = this.doc.getText('source');
  awareness = new awarenessProtocol.Awareness(this.doc);
  ws!: WebSocket;
  info: any = null;
  synced = false;
  closedCode: number | null = null;
  events: any[] = [];

  constructor(public url: string, public cookie = '') {
    this.doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === this || !this.ws || this.ws.readyState !== 1) return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, 0);
      syncProtocol.writeUpdate(e, u);
      this.ws.send(encoding.toUint8Array(e));
    });
  }

  connect(): Promise<void> {
    this.synced = false;
    return new Promise((ok, ko) => {
      this.ws = new WebSocket(this.url, { headers: this.cookie ? { cookie: this.cookie } : {} });
      this.ws.binaryType = 'arraybuffer';
      this.ws.on('unexpected-response', (_q, res) => ko(new Error('HTTP ' + res.statusCode)));
      this.ws.on('error', ko);
      this.ws.on('close', code => { this.closedCode = code; });
      this.ws.on('open', () => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 0);
        syncProtocol.writeSyncStep1(e, this.doc);
        this.ws.send(encoding.toUint8Array(e));
      });
      this.ws.on('message', (data: ArrayBuffer) => {
        const d = decoding.createDecoder(new Uint8Array(data));
        const type = decoding.readVarUint(d);
        if (type === 0) {
          const e = encoding.createEncoder();
          encoding.writeVarUint(e, 0);
          const sub = syncProtocol.readSyncMessage(d, e, this.doc, this);
          if (encoding.length(e) > 1) this.ws.send(encoding.toUint8Array(e));
          if (sub === syncProtocol.messageYjsSyncStep2 && !this.synced) { this.synced = true; ok(); }
        } else if (type === 1) awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), this);
        else if (type === 3) this.events.push(JSON.parse(decoding.readVarString(d)));
        else if (type === 4) this.info = JSON.parse(decoding.readVarString(d));
      });
    });
  }
  close() { this.ws?.close(); }
}

export const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function until(fn: () => boolean | Promise<boolean>, ms = 3000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return true; await wait(25); }
  throw new Error('Condition non atteinte dans le délai');
}
