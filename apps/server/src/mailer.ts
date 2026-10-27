// Envoi des e-mails : invitations, notifications, résumé quotidien.
//   STUDIO_SMTP_URL   smtp(s)://utilisateur:motdepasse@hote:port  (serveur d'envoi)
//   STUDIO_MAIL_FROM  expéditeur, ex. « Document Studio <studio@exemple.org> »
//   STUDIO_MAIL_DIR   dossier où écrire les messages au lieu de les envoyer (essais, réseau fermé)
//   STUDIO_PUBLIC_URL adresse publique du serveur, pour les liens des messages
// Sans STUDIO_SMTP_URL ni STUDIO_MAIL_DIR, aucun courrier ne part : les notifications restent dans l'application.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { esc } from '@studio/engine';

export interface Mail { to: string; subject: string; text: string; link?: string; linkLabel?: string }

let transport: Transporter | null | undefined;
const getTransport = () => {
  if (transport !== undefined) return transport;
  const url = process.env.STUDIO_SMTP_URL;
  return (transport = url ? nodemailer.createTransport(url) : null);
};

export const mailEnabled = () => !!(process.env.STUDIO_SMTP_URL || process.env.STUDIO_MAIL_DIR);
export const publicUrl = (path = '') => (process.env.STUDIO_PUBLIC_URL || `http://127.0.0.1:${process.env.STUDIO_PORT || 4317}`).replace(/\/$/, '') + path;

function html(m: Mail) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d22">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:10px;padding:28px 28px 22px">
<div style="font-weight:700;margin-bottom:16px">Document Studio</div>
${m.text.split('\n\n').map(p => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${m.link ? `<p style="margin:20px 0 6px"><a href="${esc(m.link)}" style="display:inline-block;background:#1d1d22;color:#fff;text-decoration:none;padding:10px 16px;border-radius:7px">${esc(m.linkLabel || 'Ouvrir')}</a></p>` : ''}
<p style="margin:22px 0 0;font-size:12px;color:#8a8b93">Vous recevez ce message selon vos préférences de notification, modifiables dans Document Studio.</p>
</div></body></html>`;
}

/** Envoie un message. Les erreurs d'envoi sont journalisées, jamais propagées à l'action qui l'a déclenché. */
export async function sendMail(m: Mail): Promise<boolean> {
  const from = process.env.STUDIO_MAIL_FROM || 'Document Studio <no-reply@localhost>';
  const text = m.text + (m.link ? `\n\n${m.linkLabel || 'Ouvrir'} : ${m.link}` : '');
  const dir = process.env.STUDIO_MAIL_DIR;
  try {
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${Date.now()}-${randomBytes(3).toString('hex')}.json`), JSON.stringify({ from, to: m.to, subject: m.subject, text, link: m.link }, null, 2));
      return true;
    }
    const t = getTransport();
    if (!t) return false;
    await t.sendMail({ from, to: m.to, subject: m.subject, text, html: html(m) });
    return true;
  } catch (e) {
    console.error('envoi d\'e-mail', m.to, e);
    return false;
  }
}
