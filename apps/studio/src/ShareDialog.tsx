// Partager : personnes et rôles, liens révocables, publications liées à une version, fichiers.
import { useEffect, useState } from 'react';
import { BarChart3, Copy, ExternalLink, FileCode2, FileDown, Files, Globe, Link2, Lock, Presentation, Send, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import { publishBlockers, WORKFLOW_LABELS, type Target } from '@studio/engine';
import { api, collab, type Doc, type PubStats, type Publication, type Role, type Space } from './api.ts';
import { useStudio } from './store.ts';
import { Avatar, canDo } from './CollabPanels.tsx';
import { Modal, Segmented, Select, Toggle, fmtDate } from './ui.tsx';

const ROLE_OPTS: [Role, string][] = [['viewer', 'Lecteur'], ['commenter', 'Commentateur'], ['editor', 'Éditeur']];
const ROLE_HELP: Record<string, string> = {
  viewer: 'consulte et télécharge les formats autorisés',
  commenter: 'commente et suggère, sans modifier',
  editor: 'modifie le document avec les autres',
};
const EXPIRY: [string, string][] = [['', 'Sans expiration'], ['1', '24 heures'], ['7', '7 jours'], ['30', '30 jours'], ['90', '90 jours']];

export function ShareDialog({ onClose, onExport }: { onClose: () => void; onExport: (f: string, m?: Target) => void }) {
  const { doc, toast } = useStudio();
  const [tab, setTab] = useState<'people' | 'links' | 'publish' | 'files'>(api.backend.collab ? 'people' : 'files');
  if (!doc) return null;
  const role = doc.role || 'owner';
  const set = (d: Doc) => useStudio.setState(s => ({ doc: s.doc && { ...s.doc, ...d, markdown: s.doc.markdown, settings: s.doc.settings } }));
  const run = (p: Promise<Doc>, msg?: string) => p.then(d => { set(d); if (msg) toast(msg); }, (e: any) => toast(e.message, 'error'));

  return (
    <Modal title={`Partager « ${doc.name} »`} onClose={onClose}
      actions={api.backend.collab ? <Segmented value={tab} onChange={setTab} options={[['people', 'Personnes'], ['links', 'Liens'], ['publish', 'Publier'], ['files', 'Fichiers']]} /> : undefined}>
      {tab === 'people' && <People doc={doc} role={role} run={run} />}
      {tab === 'links' && <Links doc={doc} role={role} run={run} />}
      {tab === 'publish' && <Publish doc={doc} role={role} />}
      {tab === 'files' && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row wrap">
            <button className="btn" onClick={() => onExport('pdf', 'print')}><FileDown />PDF</button>
            <button className="btn" onClick={() => onExport('html', 'reading')}><FileCode2 />Page HTML</button>
            <button className="btn" onClick={() => onExport('html', 'slides')}><Presentation />Diaporama HTML</button>
            <button className="btn" onClick={() => onExport('zip')}><Files />Paquet .zip</button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Les fichiers HTML intègrent polices, images et scripts : ils s'ouvrent hors ligne, sans l'application.</p>
          {!api.backend.collab && (
            <div className="note warn"><strong>Édition web :</strong> vos documents sont enregistrés dans ce navigateur seulement. Le partage avec des personnes, les liens et la collaboration demandent le serveur Document Studio (voir le README).</div>
          )}
        </div>
      )}
    </Modal>
  );
}

function People({ doc, role, run }: { doc: Doc; role: Role; run: (p: Promise<Doc>, m?: string) => void }) {
  const [email, setEmail] = useState('');
  const [r, setR] = useState<Role>('editor');
  const owner = canDo.owner(role);
  return (
    <div className="col" style={{ gap: 12 }}>
      {owner && (
        <form className="row wrap" onSubmit={e => { e.preventDefault(); if (email.trim()) run(collab.addMember(doc.id, email.trim(), r).then(d => { setEmail(''); return d; }), 'Invitation envoyée.'); }}>
          <input className="input grow" type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} style={{ minWidth: 200 }} />
          <div style={{ width: 160 }}><Select value={r} onChange={setR} options={ROLE_OPTS} /></div>
          <button className="btn primary" type="submit"><UserPlus />Inviter</button>
        </form>
      )}
      {owner && <div className="faint" style={{ fontSize: 12 }}>{ROLE_OPTS.map(([k, l]) => `${l} : ${ROLE_HELP[k]}`).join(' · ')}. Une adresse sans compte reçoit l'accès à la création de son compte.</div>}
      {owner && <SpaceChoice doc={doc} run={run} />}
      {!owner && doc.space && <div className="faint" style={{ fontSize: 12 }}>Rangé dans l'espace « {doc.space.name} ».</div>}
      <div className="people">
        {(doc.members || []).map(m => (
          <div key={m.userId} className="person">
            <Avatar name={m.user?.name || '?'} color={m.user?.color || '#999'} />
            <div className="grow"><div>{m.user?.name || 'Compte supprimé'}</div><div className="faint">{m.user?.email}</div></div>
            {m.viaSpace ? <span className="badge" title="Accès donné par l'espace d'équipe"><UsersRound />{ROLE_OPTS.find(o => o[0] === m.role)?.[1]} · espace</span> : m.role === 'owner' || !owner ? <span className="badge">{m.role === 'owner' ? 'Propriétaire' : ROLE_OPTS.find(o => o[0] === m.role)?.[1]}</span> : (
              <>
                <div style={{ width: 150 }}><Select value={m.role} onChange={v => run(collab.setMember(doc.id, m.userId, v))} options={ROLE_OPTS} /></div>
                <button className="btn ghost icon danger" onClick={() => run(collab.removeMember(doc.id, m.userId), 'Accès retiré.')} aria-label={`Retirer ${m.user?.name}`}><X /></button>
              </>
            )}
          </div>
        ))}
        {(doc.invites || []).map(i => (
          <div key={i.email} className="person pending">
            <Avatar name={i.email} color="#b0b1b8" />
            <div className="grow"><div>{i.email}</div><div className="faint">en attente de création du compte</div></div>
            <span className="badge">{ROLE_OPTS.find(o => o[0] === i.role)?.[1]}</span>
            {owner && <button className="btn ghost icon danger" onClick={() => run(collab.removeMember(doc.id, i.email), 'Invitation annulée.')} aria-label="Annuler l'invitation"><X /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpaceChoice({ doc, run }: { doc: Doc; run: (p: Promise<Doc>, m?: string) => void }) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  useEffect(() => { collab.spaces().then(setSpaces, () => setSpaces([])); }, []);
  if (!spaces?.length && !doc.space) return null;
  const sid = doc.space?.id || '';
  const role = doc.space?.role || 'editor';
  return (
    <div className="link-form">
      <div className="row wrap">
        <UsersRound size={16} className="faint" />
        <span className="grow">Espace d'équipe</span>
        <div style={{ width: 190 }}><Select value={sid} onChange={v => run(collab.docSpace(doc.id, v || null, role), v ? 'Document rangé dans l\'espace.' : 'Document retiré de l\'espace.')} options={[['', 'Aucun'], ...(spaces || []).map(x => [x.id, x.name] as [string, string]), ...(doc.space && !(spaces || []).some(x => x.id === sid) ? [[sid, doc.space.name] as [string, string]] : [])]} /></div>
        {sid && <div style={{ width: 160 }}><Select value={role} onChange={v => run(collab.docSpace(doc.id, sid, v))} options={ROLE_OPTS} /></div>}
      </div>
      {sid && <div className="faint" style={{ fontSize: 12 }}>Les membres de l'espace sont {ROLE_OPTS.find(o => o[0] === role)?.[1].toLowerCase()}s ; ses administrateurs sont éditeurs.</div>}
    </div>
  );
}

function Links({ doc, role, run }: { doc: Doc; role: Role; run: (p: Promise<Doc>, m?: string) => void }) {
  const toast = useStudio(s => s.toast);
  const [r, setR] = useState<Role>('viewer');
  const [exp, setExp] = useState('');
  const [login, setLogin] = useState(false);
  const [dl, setDl] = useState(true);
  if (!canDo.owner(role)) return <p className="muted">Seul le propriétaire gère les liens de partage.</p>;
  const url = (t: string) => `${location.origin}${location.pathname}#/s/${t}`;
  const copy = (t: string) => navigator.clipboard.writeText(url(t)).then(() => toast('Lien copié.'), () => toast(url(t)));
  const links = (doc.links || []).slice().reverse();
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="link-form">
        <div className="row wrap">
          <div style={{ width: 170 }}><Select value={r} onChange={setR} options={ROLE_OPTS} /></div>
          <div style={{ width: 170 }}><Select value={exp} onChange={setExp} options={EXPIRY} /></div>
          <button className="btn primary" onClick={() => run(collab.addLink(doc.id, { role: r, requireLogin: login, allowDownload: dl, expiresAt: exp ? new Date(Date.now() + Number(exp) * 86400e3).toISOString() : undefined }), 'Lien créé.')}><Link2 />Créer un lien</button>
        </div>
        <Toggle checked={login} onChange={setLogin}>Exiger un compte (recommandé pour un document confidentiel)</Toggle>
        <Toggle checked={dl} onChange={setDl}>Autoriser le téléchargement (source, PDF, HTML)</Toggle>
      </div>
      <div className="people">
        {!links.length && <div className="empty-small">Aucun lien.</div>}
        {links.map(l => {
          const expired = l.expiresAt && new Date(l.expiresAt).getTime() < Date.now();
          const off = l.revoked || expired;
          return (
            <div key={l.id} className={'person' + (off ? ' pending' : '')}>
              <span className="link-icon">{l.requireLogin ? <Lock /> : <Globe />}</span>
              <div className="grow">
                <div>{ROLE_OPTS.find(o => o[0] === l.role)?.[1]}{l.requireLogin ? ' · compte exigé' : ' · sans compte'}{!l.allowDownload ? ' · sans téléchargement' : ''}</div>
                <div className="faint">{l.revoked ? 'révoqué' : expired ? 'expiré' : l.expiresAt ? `jusqu'au ${new Date(l.expiresAt).toLocaleDateString('fr-FR')}` : 'sans expiration'} · créé {fmtDate(l.createdAt)}</div>
              </div>
              {!off && <button className="btn sm" onClick={() => copy(l.token)}><Copy />Copier</button>}
              {!off && <button className="btn sm ghost danger" onClick={() => run(collab.patchLink(doc.id, l.id, { revoked: true }), 'Lien révoqué : il ne donne plus accès.')}><Trash2 />Révoquer</button>}
            </div>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Un lien sans compte suffit pour un document public. Pour un document confidentiel, exigez un compte et invitez nominativement : un lien difficile à deviner ne vaut pas une autorisation.</p>
    </div>
  );
}

function Publish({ doc, role }: { doc: Doc; role: Role }) {
  const toast = useStudio(s => s.toast);
  const [official, setOfficial] = useState(true);
  const [vis, setVis] = useState<'public' | 'members'>('public');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Publication | null>(null);
  const refresh = () => api.get(doc.id).then(d => useStudio.setState(s => ({ doc: s.doc && { ...s.doc, ...d, markdown: s.doc.markdown, settings: s.doc.settings } })));
  const w = doc.workflow!;
  const blockers = official ? publishBlockers(w as any, doc.version || 0) : [];
  const pubs = (doc.publications || []).filter(p => !p.revoked).slice().reverse();
  const base = `${location.origin}/p/`;
  return (
    <div className="col" style={{ gap: 12 }}>
      {canDo.owner(role) ? (
        <div className="link-form">
          <div className="row wrap">
            <Segmented value={official ? 'yes' : 'no'} onChange={v => setOfficial(v === 'yes')} options={[['yes', 'Version officielle'], ['no', 'Brouillon partagé']]} />
            <Segmented value={vis} onChange={setVis} options={[['public', 'Public'], ['members', 'Membres']]} />
          </div>
          <input className="input" placeholder="Note de version (facultatif)" value={label} onChange={e => setLabel(e.target.value)} />
          <div className="faint" style={{ fontSize: 12 }}>État : {WORKFLOW_LABELS[w.state]}. La publication fige la version actuelle : les modifications suivantes ne changent pas le lien publié.</div>
          {blockers.length > 0 && <div className="note warn">{blockers.join(' ')}</div>}
          <div className="row"><div className="grow" />
            <button className="btn primary" disabled={busy || blockers.length > 0} onClick={() => { setBusy(true); collab.publish(doc.id, { official, visibility: vis, label }).then(p => { toast(`Version ${p.version} publiée.`); setLabel(''); return refresh(); }, (e: any) => toast(e.message, 'error')).finally(() => setBusy(false)); }}>
              {busy ? <span className="spin" /> : <Send />}Publier la version actuelle
            </button>
          </div>
        </div>
      ) : <p className="muted">Seul le propriétaire publie.</p>}
      <div className="people">
        {!pubs.length && <div className="empty-small">Aucune publication.</div>}
        {pubs.map(p => (
          <div key={p.id} className="person">
            <span className="link-icon">{p.visibility === 'public' ? <Globe /> : <Lock />}</span>
            <div className="grow">
              <div>v{p.version}{p.label ? ` · ${p.label}` : ''} {p.official ? <span className="badge ok">officielle</span> : <span className="badge">brouillon</span>} {p.stale && <span className="badge warning" title="Le document a changé depuis : republiez pour mettre à jour.">obsolète</span>}</div>
              <div className="faint">{fmtDate(p.at)} · {p.visibility === 'public' ? 'lien public' : 'membres seulement'} · {p.views ? `${p.views} consultation${p.views > 1 ? 's' : ''}` : 'pas encore consultée'}</div>
            </div>
            <a className="btn sm" href={base + p.id} target="_blank" rel="noreferrer"><ExternalLink />Lecture</a>
            <a className="btn sm ghost hide-sm" href={base + p.id + '/slides'} target="_blank" rel="noreferrer">Diapos</a>
            <a className="btn sm ghost hide-sm" href={base + p.id + '/pdf'} target="_blank" rel="noreferrer">PDF</a>
            <button className="btn sm ghost icon" onClick={() => setStats(p)} aria-label="Consultations" title="Consultations"><BarChart3 /></button>
            {canDo.owner(role) && <button className="btn sm ghost danger" onClick={() => collab.unpublish(doc.id, p.id).then(refresh, (e: any) => toast(e.message, 'error'))} aria-label="Retirer la publication"><Trash2 /></button>}
          </div>
        ))}
      </div>
      {stats && <StatsDialog docId={doc.id} pub={stats} onClose={() => setStats(null)} />}
    </div>
  );
}

/** Consultations d'une publication : total, formats, 30 derniers jours. Aucune donnée personnelle. */
function StatsDialog({ docId, pub, onClose }: { docId: string; pub: Publication; onClose: () => void }) {
  const toast = useStudio(st => st.toast);
  const [s, setS] = useState<PubStats | null>(null);
  useEffect(() => { collab.pubStats(docId, pub.id).then(setS, (e: any) => toast(e.message, 'error')); }, [docId, pub.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400e3).toISOString().slice(0, 10));
  const max = Math.max(1, ...days.map(d => s?.days[d]?.views || 0));
  const visitors = days.reduce((n, d) => n + (s?.days[d]?.visitors || 0), 0);
  return (
    <Modal title={`Consultations · v${pub.version}${pub.label ? ` · ${pub.label}` : ''}`} onClose={onClose}>
      {!s ? <div className="empty-small"><span className="spin" /></div> : (
        <div className="col" style={{ gap: 14 }}>
          <div className="stat-row">
            <div><strong>{s.total}</strong><span>consultations</span></div>
            <div><strong>{visitors}</strong><span>visiteurs sur 30 jours</span></div>
            {(['reading', 'slides', 'print', 'pdf'] as const).map(f => <div key={f}><strong>{s.formats[f] || 0}</strong><span>{{ reading: 'lecture', slides: 'diaporama', print: 'impression', pdf: 'PDF' }[f]}</span></div>)}
          </div>
          <div className="bars" role="img" aria-label="Consultations par jour sur 30 jours">
            {days.map(d => <span key={d} title={`${new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${s.days[d]?.views || 0}`} style={{ height: `${((s.days[d]?.views || 0) / max) * 100}%` }} />)}
          </div>
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>Aucune adresse IP ni aucun identifiant n'est conservé : un visiteur est reconnu le temps d'une journée par une empreinte dont la clé change chaque jour.{s.last ? ` Dernière consultation ${fmtDate(s.last)}.` : ''}</p>
        </div>
      )}
    </Modal>
  );
}
