// Comptes et sessions. Fichiers ordinaires : users.json, sessions.json.
// Mots de passe hachés par scrypt (sel aléatoire) ; session = jeton aléatoire en cookie httpOnly.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { DEFAULT_NOTIF_PREFS, NOTIF_CATEGORIES, type NotifCategory, type NotifChannel } from '@studio/engine';
import { HOME, HttpError } from './store.ts';

export interface Prefs { notify: Record<NotifCategory, NotifChannel>; digest: 'immediate' | 'daily' }
export interface User { id: string; name: string; email: string; color: string; pass: string; createdAt: string; admin?: boolean; prefs?: Partial<Prefs> }
export type PublicUser = Pick<User, 'id' | 'name' | 'email' | 'color'> & { admin?: boolean };

const USERS = join(HOME, 'users.json');
const SESSIONS = join(HOME, 'sessions.json');
const SESSION_DAYS = 30;
const COLORS = ['#2b59c3', '#c4302b', '#1c7c3c', '#b25e09', '#8a3ffc', '#0e9384', '#d6336c', '#5f3dc4', '#e8590c', '#1098ad'];

const readJson = <T>(f: string, d: T): T => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d; } catch { return d; } };
const writeJson = (f: string, v: unknown) => { writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); renameSync(f + '.tmp', f); };

let users: User[] = readJson(USERS, []);
let sessions: Record<string, { userId: string; expiresAt: number }> = readJson(SESSIONS, {});
/** Comptes créés avant l'arrivée du rôle d'administrateur : le plus ancien le devient. */
const ensureAdmin = () => { if (users.length && !users.some(u => u.admin)) { users.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].admin = true; writeJson(USERS, users); } };
ensureAdmin();

export const pub = (u: User): PublicUser => ({ id: u.id, name: u.name, email: u.email, color: u.color, admin: isAdmin(u) || undefined });
/** Administrateur du serveur : le premier compte, ou une adresse de STUDIO_ADMINS (séparées par des virgules). */
export const isAdmin = (u: User | null | undefined) => !!u && (!!u.admin || (process.env.STUDIO_ADMINS || '').split(',').map(x => x.trim().toLowerCase()).includes(u.email));
export const prefsOf = (u: User): Prefs => ({ notify: { ...DEFAULT_NOTIF_PREFS, ...(u.prefs?.notify || {}) }, digest: u.prefs?.digest === 'daily' ? 'daily' : 'immediate' });
export const hasUsers = () => users.length > 0;
export const userById = (id: string) => users.find(u => u.id === id);
export const userByEmail = (email: string) => users.find(u => u.email === email.trim().toLowerCase());
export const allUsers = () => users.map(pub);

function hash(password: string, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
function verify(password: string, stored: string) {
  const [, salt, h] = stored.split('$');
  const a = Buffer.from(h, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Inscription ouverte, sauf STUDIO_SIGNUP=invite : seules les adresses déjà invitées peuvent créer un compte. */
export function register(input: { name?: string; email?: string; password?: string }, invited: (email: string) => boolean): User {
  const name = String(input.name || '').trim().slice(0, 80);
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!name) throw new HttpError(400, 'Indiquez votre nom.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères au moins.');
  if (userByEmail(email)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse.');
  if (users.length && process.env.STUDIO_SIGNUP === 'invite' && !invited(email)) throw new HttpError(403, 'Inscription sur invitation : demandez à un propriétaire de document de vous inviter.');
  const u: User = { id: randomBytes(6).toString('hex'), name, email, color: COLORS[users.length % COLORS.length], pass: hash(password), createdAt: new Date().toISOString(), admin: users.length === 0 || undefined };
  users.push(u);
  writeJson(USERS, users);
  return u;
}

export function login(email: string, password: string): User {
  const u = userByEmail(String(email || ''));
  // même délai et même message, que l'adresse existe ou non
  const ok = u ? verify(String(password || ''), u.pass) : (verify('x', hash('y')), false);
  if (!u || !ok) throw new HttpError(401, 'Adresse ou mot de passe incorrect.');
  return u;
}

export function updateProfile(id: string, patch: { name?: string; color?: string; prefs?: Partial<Prefs> }) {
  const u = userById(id);
  if (!u) throw new HttpError(404, 'Compte introuvable.');
  if (patch.name?.trim()) u.name = patch.name.trim().slice(0, 80);
  if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) u.color = patch.color;
  if (patch.prefs) {
    const cur = prefsOf(u);
    for (const c of NOTIF_CATEGORIES) {
      const v = patch.prefs.notify?.[c.key];
      if (v === 'off' || v === 'app' || v === 'email') cur.notify[c.key] = v;
    }
    if (patch.prefs.digest === 'daily' || patch.prefs.digest === 'immediate') cur.digest = patch.prefs.digest;
    u.prefs = cur;
  }
  writeJson(USERS, users);
  return pub(u);
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  sessions[token] = { userId, expiresAt: Date.now() + SESSION_DAYS * 86400e3 };
  for (const [k, s] of Object.entries(sessions)) if (s.expiresAt < Date.now()) delete sessions[k];
  writeJson(SESSIONS, sessions);
  return token;
}
export function dropSession(token: string) { delete sessions[token]; writeJson(SESSIONS, sessions); }

export const cookieOf = (req: IncomingMessage, name: string) =>
  (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.slice(1).join('=');

export function currentUser(req: IncomingMessage): User | null {
  const t = cookieOf(req, 'sd_session');
  const s = t ? sessions[t] : undefined;
  if (!s || s.expiresAt < Date.now()) return null;
  return userById(s.userId) || null;
}

export const sessionCookie = (token: string, secure: boolean) =>
  `sd_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
export const clearCookie = 'sd_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';

/** Réinitialise l'état en mémoire (tests). */
export function _reload() { users = readJson(USERS, []); sessions = readJson(SESSIONS, {}); ensureAdmin(); }
