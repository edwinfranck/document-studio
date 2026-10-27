// Paramètres : notifications, espaces d'équipe, identités visuelles, plugins, modèles de validation.
import { useEffect, useRef, useState } from 'react';
import { Download, Plug, Plus, ShieldCheck, Trash2, Upload, UserPlus, Users, X } from 'lucide-react';
import { FONT_FAMILIES, NOTIF_CATEGORIES, type Brand, type ComponentPlugin, type WorkflowTemplate } from '@studio/engine';
import { api, collab, download, type BrandOut, type Space } from './api.ts';
import { Avatar } from './CollabPanels.tsx';
import { loadPlugins } from './plugins.ts';
import { useStudio } from './store.ts';
import { ColorField, Field, Modal, Segmented, Select, fmtDate } from './ui.tsx';

export type SettingsTab = 'notifications' | 'spaces' | 'brands' | 'plugins' | 'validation';

export function SettingsDialog({ onClose, initial }: { onClose: () => void; initial?: SettingsTab }) {
  const server = api.backend.collab;
  const tabs: [SettingsTab, string][] = server
    ? [['notifications', 'Notifications'], ['spaces', 'Espaces'], ['brands', 'Identités'], ['plugins', 'Plugins'], ['validation', 'Validation']]
    : [['plugins', 'Plugins']];
  const [tab, setTab] = useState<SettingsTab>(tabs.some(t => t[0] === initial) ? initial! : tabs[0][0]);
  return (
    <Modal wide title="Paramètres" onClose={onClose}
      actions={tabs.length > 1 ? <Segmented value={tab} onChange={setTab} options={tabs} /> : undefined}>
      <div className="settings-body">
        {tab === 'notifications' && <NotificationsPrefs />}
        {tab === 'spaces' && <Spaces />}
        {tab === 'brands' && <Brands />}
        {tab === 'plugins' && <Plugins />}
        {tab === 'validation' && <ValidationTemplates />}
      </div>
    </Modal>
  );
}

/* ---------- Notifications ---------- */

function NotificationsPrefs() {
  const { prefs, mailEnabled, toast } = useStudio();
  if (!prefs) return <div className="empty-small"><span className="spin" /></div>;
  const save = (p: Parameters<typeof collab.updateMe>[0]['prefs']) =>
    collab.updateMe({ prefs: p }).then(r => useStudio.setState({ prefs: r.prefs }), (e: any) => toast(e.message, 'error'));
  return (
    <div className="col" style={{ gap: 14 }}>
      {!mailEnabled && <div className="note">Aucun envoi d'e-mail n'est configuré sur ce serveur : le choix « E-mail » vaut « Application » tant que l'administrateur n'a pas renseigné STUDIO_SMTP_URL.</div>}
      <div className="pref-grid">
        {NOTIF_CATEGORIES.map(c => (
          <div key={c.key} className="pref-row">
            <div className="grow"><div className="pref-label">{c.label}</div><div className="faint">{c.help}</div></div>
            <Segmented value={prefs.notify[c.key]} onChange={v => save({ notify: { ...prefs.notify, [c.key]: v } })}
              options={[['off', 'Aucune'], ['app', 'Application'], ['email', 'E-mail']]} />
          </div>
        ))}
      </div>
      <div className="pref-row">
        <div className="grow"><div className="pref-label">Rythme des e-mails</div><div className="faint">Le résumé regroupe en un seul message par jour ce qui serait parti par e-mail.</div></div>
        <Segmented value={prefs.digest} onChange={v => save({ digest: v })} options={[['immediate', 'À chaque fois'], ['daily', 'Résumé quotidien']]} />
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>Les modifications du texte ne déclenchent jamais de notification : seuls les événements ci-dessus en produisent.</p>
    </div>
  );
}

/* ---------- Espaces d'équipe ---------- */

function Spaces() {
  const { toast, me } = useStudio();
  const [list, setList] = useState<Space[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const load = () => collab.spaces().then(l => { setList(l); setSel(s => s && l.some(x => x.id === s) ? s : l[0]?.id || null); }, (e: any) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sp = list?.find(x => x.id === sel);
  const admin = sp?.myRole === 'admin';
  const run = (p: Promise<unknown>, msg?: string) => p.then(() => { load(); if (msg) toast(msg); }, (e: any) => toast(e.message, 'error'));
  return (
    <div className="settings-split">
      <div className="settings-list">
        <form className="row" onSubmit={e => { e.preventDefault(); if (name.trim()) run(collab.createSpace(name.trim()).then(s => { setName(''); setSel(s.id); }), 'Espace créé.'); }}>
          <input className="input grow" placeholder="Nouvel espace (ex. Pédagogie)" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn icon" type="submit" aria-label="Créer l'espace"><Plus /></button>
        </form>
        {list === null && <div className="empty-small"><span className="spin" /></div>}
        {list?.length === 0 && <div className="empty-small">Aucun espace. Un espace réunit une équipe : ses membres retrouvent les documents qui y sont rangés.</div>}
        {list?.map(x => (
          <button key={x.id} className="settings-item" aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>
            <Users /><span className="grow">{x.name}</span><span className="faint">{x.members.length}</span>
          </button>
        ))}
      </div>
      <div className="settings-detail">
        {!sp ? <div className="empty-small">Choisissez ou créez un espace.</div> : (
          <div className="col" style={{ gap: 12 }}>
            <div className="row">
              {admin ? <input className="input grow title-input" defaultValue={sp.name} key={sp.id + sp.name} onBlur={e => e.target.value.trim() && e.target.value !== sp.name && run(collab.patchSpace(sp.id, { name: e.target.value }))} />
                : <h3 className="grow" style={{ margin: 0 }}>{sp.name}</h3>}
              <span className="badge">{sp.documents} document{sp.documents > 1 ? 's' : ''}</span>
            </div>
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>Pour ranger un document ici : « Partager » puis « Personnes ». Les administrateurs éditent tous les documents de l'espace ; les membres reçoivent le rôle choisi pour chaque document.</p>
            {admin && (
              <form className="row wrap" onSubmit={e => { e.preventDefault(); if (email.trim()) run(collab.addSpaceMember(sp.id, email.trim(), role).then(() => setEmail('')), 'Invitation envoyée.'); }}>
                <input className="input grow" type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} style={{ minWidth: 180 }} />
                <div style={{ width: 150 }}><Select value={role} onChange={setRole} options={[['member', 'Membre'], ['admin', 'Administrateur']]} /></div>
                <button className="btn primary" type="submit"><UserPlus />Ajouter</button>
              </form>
            )}
            <div className="people">
              {sp.members.map(m => (
                <div key={m.userId} className="person">
                  <Avatar name={m.user?.name || '?'} color={m.user?.color || '#999'} />
                  <div className="grow"><div>{m.user?.name || 'Compte supprimé'}{m.userId === me?.id ? ' (vous)' : ''}</div><div className="faint">{m.user?.email}</div></div>
                  {admin ? <div style={{ width: 150 }}><Select value={m.role} onChange={v => run(collab.setSpaceMember(sp.id, m.userId, v))} options={[['member', 'Membre'], ['admin', 'Administrateur']]} /></div>
                    : <span className="badge">{m.role === 'admin' ? 'Administrateur' : 'Membre'}</span>}
                  {(admin || m.userId === me?.id) && <button className="btn ghost icon danger" onClick={() => run(collab.removeSpaceMember(sp.id, m.userId), m.userId === me?.id ? 'Vous avez quitté l\'espace.' : 'Membre retiré.')} aria-label={m.userId === me?.id ? 'Quitter l\'espace' : `Retirer ${m.user?.name}`}><X /></button>}
                </div>
              ))}
              {sp.invites.map(i => (
                <div key={i.email} className="person pending">
                  <Avatar name={i.email} color="#b0b1b8" />
                  <div className="grow"><div>{i.email}</div><div className="faint">en attente de création du compte</div></div>
                  <button className="btn ghost icon danger" onClick={() => run(collab.removeSpaceMember(sp.id, i.email))} aria-label="Annuler l'invitation"><X /></button>
                </div>
              ))}
            </div>
            {admin && <div className="row"><div className="grow" /><button className="btn ghost danger" onClick={() => { if (confirm(`Supprimer l'espace « ${sp.name} » ? Les documents restent à leurs propriétaires.`)) run(collab.deleteSpace(sp.id), 'Espace supprimé.'); }}><Trash2 />Supprimer l'espace</button></div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Identités visuelles ---------- */

const COLOR_KEYS: [keyof Brand['colors'], string][] = [['primary', 'Principale'], ['secondary', 'Secondaire'], ['accent', 'Accent'], ['text', 'Texte'], ['bg', 'Fond'], ['link', 'Liens']];

function Brands() {
  const { toast, templates } = useStudio();
  const [list, setList] = useState<BrandOut[] | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Brand> | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = (pick?: string) => collab.brands().then(l => { setList(l); const id = pick ?? sel ?? l[0]?.id ?? null; setSel(id); setDraft(l.find(b => b.id === id) || null); }, (e: any) => toast(e.message, 'error'));
  useEffect(() => { load(); collab.spaces().then(setSpaces, () => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = list?.find(b => b.id === sel);
  const editable = !cur || cur.canEdit;
  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => setDraft(d => ({ ...d, [k]: v }));
  const save = () => draft && collab.saveBrand({ ...draft, id: cur?.id }).then(b => { toast(`« ${b.name} » enregistrée (version ${b.version}).`); load(b.id); }, (e: any) => toast(e.message, 'error'));
  const hf = (k: 'header' | 'footer', side: 'left' | 'center' | 'right', v: string) => setDraft(d => ({ ...d, [k]: { left: '', center: '', right: '', ...(d?.[k] || {}), [side]: v } }));
  return (
    <div className="settings-split">
      <div className="settings-list">
        <button className="btn" onClick={() => { setSel(null); setDraft({ name: 'Nouvelle identité', colors: {}, fonts: {}, logos: [] }); }}><Plus />Nouvelle identité</button>
        {list === null && <div className="empty-small"><span className="spin" /></div>}
        {list?.length === 0 && !draft && <div className="empty-small">Aucune identité. Une identité réunit logos, couleurs, polices, couverture, en-têtes et pieds de page : on l'applique à un document en un clic.</div>}
        {list?.map(b => (
          <button key={b.id} className="settings-item" aria-pressed={b.id === sel} onClick={() => { setSel(b.id); setDraft(b); }}>
            <span className="swatches">{COLOR_KEYS.slice(0, 3).map(([k]) => b.colors[k] && <span key={k} style={{ background: b.colors[k] }} />)}</span>
            <span className="grow">{b.name}</span><span className="faint">v{b.version}</span>
          </button>
        ))}
      </div>
      <div className="settings-detail">
        {!draft ? <div className="empty-small">Choisissez ou créez une identité.</div> : (
          <fieldset className="col brand-form" style={{ gap: 12 }} disabled={!editable}>
            {!editable && <div className="note">Seuls son auteur et les administrateurs de son espace modifient cette identité. Vous pouvez l'appliquer à vos documents.</div>}
            <div className="row wrap">
              <input className="input grow title-input" value={draft.name || ''} onChange={e => set('name', e.target.value)} placeholder="Nom de l'identité" />
              <div style={{ width: 200 }}><Select value={draft.space || ''} onChange={v => set('space', v || undefined)} options={[['', 'Tout le serveur'], ...spaces.map(s => [s.id, `Espace ${s.name}`] as [string, string])]} /></div>
            </div>
            <Field label="Organisation"><input className="input" value={draft.organization || ''} onChange={e => set('organization', e.target.value)} placeholder="Nom affiché sur les couvertures" /></Field>
            <div className="subhead">Couleurs</div>
            <div className="brand-colors">
              {COLOR_KEYS.map(([k, l]) => (
                <Field key={k} label={l}>
                  {draft.colors?.[k] ? <div className="row"><ColorField value={draft.colors[k]!} onChange={v => set('colors', { ...draft.colors, [k]: v })} /><button type="button" className="btn ghost icon sm" onClick={() => { const c = { ...draft.colors }; delete c[k]; set('colors', c); }} aria-label="Retirer"><X /></button></div>
                    : <button type="button" className="btn sm ghost" onClick={() => set('colors', { ...draft.colors, [k]: '#1d1d22' })}><Plus />Définir</button>}
                </Field>
              ))}
            </div>
            <div className="subhead">Polices et gabarit</div>
            <div className="brand-colors">
              <Field label="Titres"><Select font value={draft.fonts?.heading || ''} onChange={v => set('fonts', { ...draft.fonts, heading: v || undefined })} options={[['', 'Celle du gabarit'], ...FONT_FAMILIES.map(f => [f.family, f.family] as [string, string])]} /></Field>
              <Field label="Texte"><Select font value={draft.fonts?.body || ''} onChange={v => set('fonts', { ...draft.fonts, body: v || undefined })} options={[['', 'Celle du gabarit'], ...FONT_FAMILIES.map(f => [f.family, f.family] as [string, string])]} /></Field>
              <Field label="Gabarit"><Select value={draft.templateId || ''} onChange={v => set('templateId', v || undefined)} options={[['', 'Celui du document'], ...templates.map(t => [t.id, t.name] as [string, string])]} /></Field>
            </div>
            <div className="subhead">Logos</div>
            <div className="row wrap">
              {(draft.logos || []).map(l => (
                <div key={l.file} className="logo-tile">
                  {cur && <img src={collab.brandAssetUrl(cur.id, l.file)} alt={l.label} />}
                  <code>./assets/{l.file}</code>
                  {editable && <button type="button" className="btn ghost icon sm danger" onClick={() => set('logos', (draft.logos || []).filter(x => x.file !== l.file))} aria-label="Retirer le logo"><X /></button>}
                </div>
              ))}
              {cur && editable && <button type="button" className="btn sm" onClick={() => file.current?.click()}><Upload />Ajouter un logo</button>}
              {!cur && <span className="faint" style={{ fontSize: 12 }}>Enregistrez l'identité pour y déposer des logos.</span>}
              <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={e => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (f && cur) collab.brandLogo(cur.id, f.name, f).then(b => { toast('Logo ajouté.'); setList(l => l && l.map(x => (x.id === b.id ? b : x))); setDraft(b); }, (er: any) => toast(er.message, 'error'));
              }} />
            </div>
            <div className="subhead">En-tête et pied de page (impression)</div>
            {(['header', 'footer'] as const).map(k => (
              <div key={k} className="row hf-row">
                <span className="faint" style={{ width: 70 }}>{k === 'header' ? 'En-tête' : 'Pied'}</span>
                {(['left', 'center', 'right'] as const).map(side => <input key={side} className="input grow" value={draft[k]?.[side] || ''} onChange={e => hf(k, side, e.target.value)} placeholder={{ left: 'gauche', center: 'centre', right: 'droite' }[side]} />)}
              </div>
            ))}
            <div className="faint" style={{ fontSize: 12 }}>Variables : {'{title}'}, {'{author}'}, {'{date}'}, {'{page}'}, {'{pages}'}, {'{section}'}.</div>
            <Field label="Couverture (StudioMD)" stack>
              <textarea className="input mono" rows={5} value={draft.cover || ''} onChange={e => set('cover', e.target.value)} placeholder={':::cover\n![Logo](./assets/logo.png)\n# Titre du document\n:::'} spellCheck={false} />
            </Field>
            {editable && <div className="row"><div className="grow" />
              {cur && <button type="button" className="btn ghost danger" onClick={() => { if (confirm(`Supprimer « ${cur.name} » ? Les documents qui l'utilisent gardent leurs réglages.`)) collab.deleteBrand(cur.id).then(() => { setSel(null); setDraft(null); load(''); }, (e: any) => toast(e.message, 'error')); }}><Trash2 />Supprimer</button>}
              <button type="button" className="btn primary" onClick={save}>Enregistrer</button>
            </div>}
            {cur && cur.history.length > 0 && (
              <>
                <div className="subhead">Versions</div>
                <div className="brand-history">
                  {cur.history.slice().reverse().map(h => <div key={h.version} className="row"><strong>v{h.version}</strong><span className="grow">{h.summary}</span><span className="faint">{fmtDate(h.at)}</span></div>)}
                </div>
                <p className="faint" style={{ margin: 0, fontSize: 12 }}>Une nouvelle version ne modifie aucun document : chacun propose « Mettre à jour » dans son panneau Identité.</p>
              </>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}

/* ---------- Plugins ---------- */

const EXAMPLE_PLUGIN: ComponentPlugin = {
  id: 'jauge', name: 'jauge', label: 'Jauge', version: '1.0.0', author: '',
  description: 'Barre de progression avec un libellé.', content: 'markdown',
  attrs: {
    valeur: { type: 'number', required: true, description: 'Pourcentage atteint (0 à 100).' },
    couleur: { type: 'color', default: '#2b59c3', description: 'Couleur de la barre.' },
  },
  template: '<div class="jauge"><div class="jauge-txt">{{content}}</div><div class="jauge-barre"><span style="width:{{valeur}}%;background:{{couleur}}"></span></div><div class="jauge-val">{{valeur}} %</div></div>',
  targets: { slides: '<div class="jauge jauge-grande"><div class="jauge-val">{{valeur}} %</div><div class="jauge-txt">{{content}}</div></div>' },
  css: '.jauge{margin:1em 0}.jauge-barre{height:10px;border-radius:5px;background:var(--sd-surface)}.jauge-barre span{display:block;height:100%;border-radius:5px}.jauge-val{font-weight:700}.jauge-grande .jauge-val{font-size:3em}',
  example: ':::jauge {valeur=72}\nTaux de réussite\n:::',
};

function Plugins() {
  const { toast, me } = useStudio();
  const [list, setList] = useState<ComponentPlugin[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api.plugins().then(setList, () => setList([])); }, []);
  const canInstall = !api.backend.collab || !!me?.admin;
  const after = (l: ComponentPlugin[]) => { setList(l); loadPlugins(); };
  const install = async (f: File) => {
    try {
      const p = JSON.parse(await f.text());
      after(await api.installPlugin(p));
      toast(`Plugin « ${p.label || p.id} » installé : écrivez :::${p.name} dans la source.`);
    } catch (e: any) { toast(e instanceof SyntaxError ? 'Fichier JSON illisible.' : e.message, 'error'); }
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>Un plugin ajoute un composant StudioMD décrit dans un fichier JSON : sa syntaxe, ses attributs et son rendu HTML pour chaque sortie. Il ne contient aucun code exécutable : le gabarit est nettoyé et chaque valeur échappée.</p>
      <div className="row wrap">
        {canInstall && <button className="btn primary" onClick={() => file.current?.click()}><Upload />Installer un plugin (.json)</button>}
        <button className="btn" onClick={() => download(new Blob([JSON.stringify(EXAMPLE_PLUGIN, null, 2)], { type: 'application/json' }), 'plugin-jauge.json')}><Download />Modèle de plugin</button>
        <input ref={file} type="file" hidden accept=".json,application/json" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) install(f); }} />
      </div>
      {!canInstall && <div className="note">Seul un administrateur du serveur installe ou retire des plugins. Ceux qui sont installés servent à tous.</div>}
      <div className="people">
        {list === null && <div className="empty-small"><span className="spin" /></div>}
        {list?.length === 0 && <div className="empty-small">Aucun plugin installé.</div>}
        {list?.map(p => (
          <div key={p.id} className="person">
            <span className="link-icon"><Plug /></span>
            <div className="grow">
              <div><code>:::{p.name}</code> {p.label}{p.version ? <span className="faint"> · v{p.version}</span> : ''}</div>
              <div className="faint">{p.description || 'Sans description'}{p.author ? ` · ${p.author}` : ''}</div>
            </div>
            {canInstall && <button className="btn ghost icon danger" onClick={() => { if (confirm(`Retirer le plugin « ${p.label} » ? Les documents qui l'emploient afficheront un composant inconnu.`)) api.removePlugin(p.id).then(after, (e: any) => toast(e.message, 'error')); }} aria-label={`Retirer ${p.label}`}><Trash2 /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Modèles de validation ---------- */

function ValidationTemplates() {
  const toast = useStudio(s => s.toast);
  const [list, setList] = useState<(WorkflowTemplate & { reviewerNames?: string[] })[] | null>(null);
  const load = () => collab.workflowTemplates().then(setList, () => setList([]));
  useEffect(() => { load(); }, []);
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>Un modèle garde une liste de relecteurs et le nombre de validations exigées. On le crée depuis « Demander une relecture » sur un document, puis on le réutilise d'un clic.</p>
      <div className="people">
        {list === null && <div className="empty-small"><span className="spin" /></div>}
        {list?.length === 0 && <div className="empty-small">Aucun modèle.</div>}
        {list?.map(t => (
          <div key={t.id} className="person">
            <span className="link-icon"><ShieldCheck /></span>
            <div className="grow">
              <div>{t.name}</div>
              <div className="faint">{(t.reviewerNames || []).join(', ')} · {t.requiredApprovals ? `${t.requiredApprovals} validation${t.requiredApprovals > 1 ? 's' : ''} requise${t.requiredApprovals > 1 ? 's' : ''}` : 'publication libre'}</div>
            </div>
            <button className="btn ghost icon danger" onClick={() => collab.deleteWorkflowTemplate(t.id).then(load, (e: any) => toast(e.message, 'error'))} aria-label={`Supprimer ${t.name}`}><Trash2 /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

