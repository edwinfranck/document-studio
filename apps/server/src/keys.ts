// Clés d'accès aux images et fichiers pour l'aperçu. L'aperçu est une iframe isolée (origine nulle) :
// ses requêtes partent sans cookie. Une clé signée, valable quelques heures, désigne qui la demande
// (compte ou lien de partage) et ce qu'elle ouvre (un document ou un projet). Le serveur revérifie
// les droits de ce compte ou de ce lien à chaque requête : une révocation s'applique aussitôt.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from './store.ts';

const FILE = join(HOME, 'secret.key');
const secret = existsSync(FILE) ? readFileSync(FILE, 'utf8').trim() : (() => { const s = randomBytes(32).toString('hex'); writeFileSync(FILE, s, { mode: 0o600 }); return s; })();
const HOURS = 12;
const sign = (s: string) => createHmac('sha256', secret).update(s).digest('base64url').slice(0, 32);

/** scope : « doc:<id> » ou « site:<id> » ; sujet : identifiant du compte ou jeton du lien de partage. */
export function mintKey(scope: string, subject: { user?: string; share?: string }): string {
  const exp = Math.floor(Date.now() / 1000) + HOURS * 3600;
  const who = subject.user ? `u.${subject.user}` : `s.${subject.share || ''}`;
  const payload = Buffer.from(`${scope}|${who}|${exp}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readKey(key: string): { scope: string; user?: string; share?: string } | null {
  const [payload, mac] = String(key).split('.');
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [scope, who, exp] = Buffer.from(payload, 'base64url').toString().split('|');
  if (!scope || Number(exp) * 1000 < Date.now()) return null;
  return who.startsWith('u.') ? { scope, user: who.slice(2) } : { scope, share: who.slice(2) || undefined };
}
