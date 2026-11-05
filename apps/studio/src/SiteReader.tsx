// Lecture d'un projet multi-pages : la page rendue avec sa navigation (le même HTML que le site exporté),
// et les panneaux du projet : organisation, apparence, partage et publication, historique.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BarChart3, BookOpen, Clock, Copy, Download, ExternalLink, FileArchive, FileDown, FileText, Files, GripVertical, History, Home, Link2, Lock, Globe,
  MoreHorizontal, Palette, PanelRightClose, Pencil, Plus, Send, Share2, Trash2, Upload, UserPlus, X,
} from 'lucide-react';
import {
  applyBrand, BUILTIN_TEMPLATES, FONT_FAMILIES, render, siteContext, type DocSettings, type SearchDoc, type ThemeTokens,
} from '@studio/engine';
import { api, collab, download, shareState, type BrandOut, type Doc, type Role, type Site, type Space } from './api.ts';
import { sitePageEnv } from './env.ts';
import { useStudio } from './store.ts';
import { Avatar, canDo, NotificationsBell } from './CollabPanels.tsx';
import { ColorField, Field, Menu, Range, Segmented, Select, fmtDate, fmtSize } from './ui.tsx';
import { useLayout } from './Workspace.tsx';

type Panel = 'organize' | 'look' | 'share' | 'history';
const ROLE_OPTS: [Role, string][] = [['viewer', 'Lecteur'], ['commenter', 'Commentateur'], ['editor', 'Éditeur']];

export function SiteReader({ siteId, pageId, onBack }: { siteId: string; pageId: string | null; onBack: () => void }) {
  const { templates, toast, me } = useStudio();
  const layout = useLayout();
  const [site, setSite] = useState<Site | null>(null);
  const [page, setPage] = useState<Doc | null>(null);
  const [index, setIndex] = useState<SearchDoc[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const anchor = useRef('');
  const current = pageId || site?.entry || site?.pages[0]?.id || null;

  const loadSite = () => collab.site(siteId).then(s => { setSite(s); document.title = `${s.name} · Document Studio`; }, e => setError(e.message));
  useEffect(() => { loadSite(); collab.siteSearch(siteId).then(setIndex, () => {}); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (current) api.get(current).then(setPage, e => toast(e.message, 'error')); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => {
    if (!site || !page || page.id !== current) return '';
    const p = site.pages.find(x => x.id === page.id);
    if (!p) return '';
    const env = sitePageEnv(page.id, page.assets, site, p.path, (id, a) => `sdpage:${id}${a ? '#' + a : ''}`);
    const ctx = siteContext({ name: site.name, logo: site.logo ? collab.siteFileUrl(site.id, site.logo) : undefined, pages: site.pages, entry: site.entry }, page.id, id => `sdpage:${id}`, { inline: index });
    const settings = { ...(applyOver(site.settings, page.settings)), mode: 'reading' as const };
    try { return render(page.markdown, settings, env, templates, undefined, ctx).html; } catch (e) { console.error(e); return ''; }
  }, [site, page, index, templates, current]);

  // Navigation dans l'aperçu : les liens de pages changent de page sans recharger l'application.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.sdPreview) return;
      const m = e.data;
      if (m.type === 'sd:link' && /^sdpage:/.test(m.href)) {
        const [id, a = ''] = m.href.slice(7).split('#');
        anchor.current = a;
        if (id === current) frame.current?.contentWindow?.postMessage({ type: 'sd:hash', id: a }, '*');
        else location.hash = `#/site/${siteId}/${id}`;
      } else if (m.type === 'sd:link' && /^https?:/i.test(m.href)) window.open(m.href, '_blank', 'noopener,noreferrer');
      if (m.type === 'sd:ready' && anchor.current) { frame.current?.contentWindow?.postMessage({ type: 'sd:hash', id: anchor.current }, '*'); anchor.current = ''; }
    };
    addEventListener('message', onMsg);
    return () => removeEventListener('message', onMsg);
  }, [current, siteId]);

  if (error) return <div className="empty" style={{ height: '100%' }}><h2>Projet inaccessible</h2><p>{error}</p><button className="btn" onClick={onBack}>Bibliothèque</button></div>;
  if (!site) return <div className="empty" style={{ height: '100%' }}><span className="spin" /></div>;
  const role = site.role;
  const edit = canDo.edit(role);
  const currentPage = site.pages.find(p => p.id === current);

  const exportAs = async (format: 'site' | 'pdf' | 'pdf-pages' | 'original', cover = true) => {
    setBusy(format === 'site' ? 'Construction du site…' : format === 'original' ? 'Archive…' : 'Génération des PDF…');
    try {
      const f = format === 'original' ? await collab.siteOriginal(site.id) : await collab.exportSite(site.id, { format, cover, toc: true });
      download(f.blob, f.name);
      toast(`${f.name} téléchargé.`);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };

  const actions = (close: () => void) => (
    <>
      <div className="menu-title">Exporter</div>
      <button onClick={() => { close(); exportAs('site'); }}><Files /><span>Site HTML (.zip)<span className="sub">Une page par fichier, navigation et recherche, lisible hors ligne</span></span></button>
      <button onClick={() => { close(); exportAs('pdf'); }}><FileDown /><span>PDF unique<span className="sub">Toutes les pages dans l'ordre, couverture et sommaire</span></span></button>
      <button onClick={() => { close(); exportAs('pdf', false); }}><FileDown /><span>PDF unique sans couverture</span></button>
      <button onClick={() => { close(); exportAs('pdf-pages'); }}><FileArchive /><span>Un PDF par page (.zip)</span></button>
      {site.source && <button onClick={() => { close(); exportAs('original'); }}><FileArchive /><span>Archive d'origine<span className="sub">{site.source.zip}, telle qu'importée</span></span></button>}
    </>
  );

  return (
    <div className={'app reader app-' + layout}>
      <header className="topbar">
        <button className="btn ghost icon" onClick={onBack} aria-label="Bibliothèque" title="Bibliothèque"><ArrowLeft /></button>
        <div className="grow reader-title">
          <strong>{site.name}</strong>
          {layout !== 'mobile' && <span className="faint">{site.pages.length} pages{currentPage ? ` · ${currentPage.title}` : ''}</span>}
        </div>
        {busy && <span className="savestate"><span className="spin" /><span className="lbl">{busy}</span></span>}
        {edit && current && <a className="btn" href={`#/doc/${current}`}><Pencil /><span className="lbl">Modifier la page</span></a>}
        {layout !== 'mobile' && <>
          {edit && <button className="btn" aria-pressed={panel === 'organize'} onClick={() => setPanel(p => (p === 'organize' ? null : 'organize'))}><Files /><span className="lbl">Pages</span></button>}
          {edit && <button className="btn" aria-pressed={panel === 'look'} onClick={() => setPanel(p => (p === 'look' ? null : 'look'))}><Palette /><span className="lbl">Apparence</span></button>}
          <button className="btn" aria-pressed={panel === 'share'} onClick={() => setPanel(p => (p === 'share' ? null : 'share'))}><Share2 /><span className="lbl">Partager</span></button>
          <button className="btn ghost icon" aria-pressed={panel === 'history'} onClick={() => setPanel(p => (p === 'history' ? null : 'history'))} title="Historique du projet" aria-label="Historique du projet"><History /></button>
          <Menu trigger={t => <button className="btn primary" onClick={t}><Download /><span className="lbl">Exporter</span></button>}>{actions}</Menu>
        </>}
        <NotificationsBell />
        {layout === 'mobile' && (
          <Menu trigger={t => <button className="btn ghost icon" onClick={t} aria-label="Actions du projet"><MoreHorizontal /></button>}>
            {close => <>
              {edit && <button onClick={() => { close(); setPanel('organize'); }}><Files /><span>Pages</span></button>}
              {edit && <button onClick={() => { close(); setPanel('look'); }}><Palette /><span>Apparence</span></button>}
              <button onClick={() => { close(); setPanel('share'); }}><Share2 /><span>Partager</span></button>
              <button onClick={() => { close(); setPanel('history'); }}><History /><span>Historique</span></button>
              <hr />{actions(close)}
            </>}
          </Menu>
        )}
      </header>
      <div className="reader-body">
        <main className="reader-stage">
          {html ? <iframe ref={frame} key={current || ''} title={currentPage?.title || site.name} sandbox="allow-scripts" srcDoc={html} /> : <div className="empty"><span className="spin" /></div>}
        </main>
        {panel && (
          <aside className="reader-panel">
            <div className="pane-head">
              <strong className="grow">{{ organize: 'Pages du projet', look: 'Apparence du projet', share: 'Partager le projet', history: 'Historique du projet' }[panel]}</strong>
              <button className="btn ghost icon" onClick={() => setPanel(null)} aria-label="Fermer le panneau"><PanelRightClose /></button>
            </div>
            <div className="reader-panel-body">
              {panel === 'organize' && <Organize site={site} current={current} onChange={setSite} />}
              {panel === 'look' && <Look site={site} onChange={setSite} />}
              {panel === 'share' && <ShareSite site={site} onChange={setSite} />}
              {panel === 'history' && <SiteHistory site={site} />}
            </div>
          </aside>
        )}
        {panel && layout !== 'desktop' && <div className="scrim" onClick={() => setPanel(null)} />}
      </div>
      {!me && shareState.token && <div className="guest-note faint">Lecture par lien de partage</div>}
    </div>
  );
}

/** Réglages d'une page : ceux du projet, complétés par ceux que la page change pour elle seule. */
function applyOver(base: Partial<DocSettings>, own: Partial<DocSettings>): Partial<DocSettings> {
  const isO = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const m = (a: any, b: any): any => { if (!isO(a) || !isO(b)) return b === undefined ? a : b; const o: any = { ...a }; for (const k of Object.keys(b)) o[k] = m(a[k], b[k]); return o; };
  return m(base, own);
}

/* ---------- Organisation ---------- */

function Organize({ site, current, onChange }: { site: Site; current: string | null; onChange: (s: Site) => void }) {
  const toast = useStudio(s => s.toast);
  const [pages, setPages] = useState(site.pages);
  const [drag, setDrag] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  useEffect(() => setPages(site.pages), [site.pages]);
  const dirty = JSON.stringify(pages) !== JSON.stringify(site.pages);
  const move = (from: number, to: number) => { if (to < 0 || to >= pages.length) return; const n = [...pages]; const [x] = n.splice(from, 1); n.splice(to, 0, x); setPages(n); };
  const save = () => collab.patchSite(site.id, { pages: pages.map(p => ({ id: p.id, title: p.title })) }).then(s => { onChange(s); toast('Organisation enregistrée.'); }, (e: any) => toast(e.message, 'error'));
  const folders = [...new Set(site.pages.map(p => (p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '')))].filter(Boolean);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="faint" style={{ fontSize: 12 }}>Glissez pour changer l'ordre de la navigation ; renommez une page dans son champ. L'accueil s'ouvre en premier.</div>
      <div className="org-list">
        {pages.map((p, i) => (
          <div key={p.id} className={'org-row' + (drag === p.id ? ' dragging' : '') + (p.id === current ? ' current' : '')} draggable
            onDragStart={() => setDrag(p.id)} onDragEnd={() => setDrag(null)} onDragOver={e => { e.preventDefault(); if (drag && drag !== p.id) move(pages.findIndex(x => x.id === drag), i); }}>
            <span className="org-grip" aria-hidden="true"><GripVertical /></span>
            <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
              <input className="input org-title" value={p.title} onChange={e => setPages(pages.map(x => (x.id === p.id ? { ...x, title: e.target.value } : x)))} aria-label={`Titre de ${p.path}`} />
              <span className="faint org-path">{p.path}</span>
            </div>
            <button className="btn sm ghost icon" aria-pressed={site.entry === p.id} title="Page d'accueil" aria-label="Définir comme page d'accueil" onClick={() => collab.patchSite(site.id, { entry: p.id }).then(onChange, (e: any) => toast(e.message, 'error'))}><Home /></button>
            <a className="btn sm ghost icon" href={`#/doc/${p.id}`} title="Modifier" aria-label={`Modifier ${p.title}`}><Pencil /></a>
            {canDo.owner(site.role) && <button className="btn sm ghost icon danger" aria-label={`Supprimer ${p.title}`} onClick={() => { if (confirm(`Supprimer la page « ${p.title} » ? Elle part dans la corbeille.`)) collab.removeSitePage(site.id, p.id).then(onChange, (e: any) => toast(e.message, 'error')); }}><Trash2 /></button>}
          </div>
        ))}
      </div>
      {dirty && <div className="row"><button className="btn sm ghost" onClick={() => setPages(site.pages)}>Annuler</button><span className="grow" /><button className="btn sm primary" onClick={save}>Enregistrer l'ordre</button></div>}
      <div className="subhead">Nouvelle page</div>
      <form className="col" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); if (title.trim()) collab.addSitePage(site.id, title.trim(), folder, current || undefined).then(r => { onChange(r.site); setTitle(''); location.hash = `#/doc/${r.page}`; }, (er: any) => toast(er.message, 'error')); }}>
        <input className="input" placeholder="Titre de la page" value={title} onChange={e => setTitle(e.target.value)} />
        <div className="row"><div className="grow"><Select value={folder} onChange={setFolder} options={[['', 'À la racine'], ...folders.map(f => [f, `Dans ${f}/`] as [string, string])]} /></div><button className="btn sm" type="submit" disabled={!title.trim()}><Plus />Ajouter</button></div>
      </form>
      {site.source && (site.source.excluded.length > 0 || site.source.rejected.length > 0) && (
        <div className="note">Importé de {site.source.zip} le {new Date(site.source.importedAt).toLocaleDateString('fr-FR')}. {site.source.excluded.length ? `${site.source.excluded.length} fichier(s) Markdown laissé(s) de côté. ` : ''}{site.source.rejected.length ? `${site.source.rejected.length} fichier(s) refusé(s). ` : ''}L'archive d'origine est conservée (Exporter).</div>
      )}
    </div>
  );
}

/* ---------- Apparence commune ---------- */

const PAIRS: [string, string, string][] = [['Inter', 'Inter', 'Inter'], ['DM Sans', 'DM Sans', 'DM Sans'], ['Fraunces', 'Source Serif 4', 'Fraunces · Source Serif'], ['Space Grotesk', 'IBM Plex Sans', 'Space Grotesk · Plex'], ['Lexend', 'Lexend', 'Lexend'], ['Newsreader', 'Newsreader', 'Newsreader']];

function Look({ site, onChange }: { site: Site; onChange: (s: Site) => void }) {
  const { templates, toast } = useStudio();
  const [s, setS] = useState<Partial<DocSettings>>(site.settings);
  const [brands, setBrands] = useState<BrandOut[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { collab.brands().then(setBrands, () => {}); }, []);
  const tpl = templates.find(t => t.id === (s.templateId || 'corporate')) || BUILTIN_TEMPLATES[0];
  const tok = (o: any) => ({ ...tpl.tokens, ...o, colors: { ...tpl.tokens.colors, ...(o?.colors || {}) }, fonts: { ...tpl.tokens.fonts, ...(o?.fonts || {}) }, type: { ...tpl.tokens.type, ...(o?.type || {}) }, layout: { ...tpl.tokens.layout, ...(o?.layout || {}) } }) as ThemeTokens;
  const t = tok(s.overrides);
  // enregistré peu après chaque réglage : toutes les pages suivent
  const save = (next: Partial<DocSettings>) => {
    setS(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => collab.patchSite(site.id, { settings: next }).then(onChange, (e: any) => toast(e.message, 'error')), 400);
  };
  const over = (path: string[], v: unknown) => {
    const set = (o: any, [k, ...rest]: string[]): any => ({ ...(o || {}), [k]: rest.length ? set(o?.[k], rest) : v });
    save({ ...s, overrides: set(s.overrides, path) });
  };
  const images = site.files.filter(f => /\.(png|jpe?g|svg|webp|gif|avif)$/i.test(f.path));
  const logoInput = useRef<HTMLInputElement>(null);
  return (
    <div className="col" style={{ gap: 10 }}>
      <Field label="Gabarit"><Select value={s.templateId || 'corporate'} onChange={v => save({ ...s, templateId: v })} options={templates.filter(x => x.kind !== 'slides').map(x => [x.id, x.name] as [string, string])} /></Field>
      <Field label="Polices"><Select value={`${t.fonts.heading}|${t.fonts.body}`} onChange={v => { const [h, b] = v.split('|'); over(['fonts'], { ...(s.overrides?.fonts || {}), heading: h, body: b }); }}
        options={[...new Map([[`${t.fonts.heading}|${t.fonts.body}`, `${t.fonts.heading} · ${t.fonts.body}`], ...PAIRS.map(([h, b, l]) => [`${h}|${b}`, l] as [string, string]), ...FONT_FAMILIES.filter(f => f.kind !== 'mono').map(f => [`${f.family}|${f.family}`, f.family] as [string, string])])]} /></Field>
      <Field label="Principale"><ColorField value={t.colors.primary} onChange={v => over(['colors', 'primary'], v)} /></Field>
      <Field label="Accent"><ColorField value={t.colors.accent} onChange={v => over(['colors', 'accent'], v)} /></Field>
      <Field label="Liens"><ColorField value={t.colors.link} onChange={v => over(['colors', 'link'], v)} against={t.colors.bg} /></Field>
      <Field label="Fond du code"><ColorField value={t.colors.codeBg} onChange={v => over(['colors', 'codeBg'], v)} /></Field>
      <Field label="Largeur de lecture"><Range value={t.type.measure} min={50} max={100} step={1} unit=" car." onChange={v => over(['type', 'measure'], v)} /></Field>
      <Field label="Titres"><Select value={t.layout.headingStyle} onChange={v => over(['layout', 'headingStyle'], v)} options={[['plain', 'Simples'], ['rule', 'Filet'], ['bar', 'Barre'], ['underline', 'Soulignés'], ['numbered-margin', 'Numéros en marge']]} /></Field>
      <Field label="Tableaux"><Segmented full value={t.layout.tableStyle} onChange={v => over(['layout', 'tableStyle'], v)} options={[['lines', 'Lignes'], ['zebra', 'Zébré'], ['grid', 'Grille'], ['minimal', 'Épuré']]} /></Field>
      <Field label="Mode"><Segmented full value={s.reading?.colorScheme || 'template'} onChange={v => save({ ...s, reading: { ...s.reading, colorScheme: v } })} options={[['template', 'Gabarit'], ['inverse', 'Inversé'], ['auto', 'Système']]} /></Field>
      <Field label="Logo">
        <div className="row">
          <div className="grow"><Select value={site.logo || ''} onChange={v => collab.patchSite(site.id, { logo: v || null }).then(onChange, (e: any) => toast(e.message, 'error'))} options={[['', 'Aucun'], ...images.map(f => [f.path, f.path] as [string, string])]} /></div>
          <button className="btn sm icon" onClick={() => logoInput.current?.click()} aria-label="Déposer un logo" title="Déposer un logo"><Upload /></button>
          <input ref={logoInput} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={e => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (f) collab.putSiteFile(site.id, `_logo/${f.name}`, f).then(() => collab.patchSite(site.id, { logo: `_logo/${f.name}` })).then(onChange, (er: any) => toast(er.message, 'error'));
          }} />
        </div>
      </Field>
      <div className="subhead">Pied de page des PDF</div>
      <div className="row" style={{ gap: 6 }}>
        {(['left', 'center', 'right'] as const).map(k => <input key={k} className="input grow" placeholder={{ left: 'gauche', center: 'centre', right: 'droite' }[k]} value={s.page?.footer?.[k] ?? ''} onChange={e => save({ ...s, page: { ...s.page, footer: { left: '', center: '', right: '', ...s.page?.footer, [k]: e.target.value } } })} />)}
      </div>
      {brands.length > 0 && <>
        <div className="subhead">Identités visuelles</div>
        {brands.map(b => (
          <div key={b.id} className="brand-pick">
            <span className="swatches">{(['primary', 'secondary', 'accent'] as const).map(k => b.colors[k] && <span key={k} style={{ background: b.colors[k] }} />)}</span>
            <span className="grow">{b.name}</span>
            <button className="btn sm" onClick={() => save(applyBrand(s, b))}>Appliquer</button>
          </div>
        ))}
      </>}
      <div className="token-help">Ces réglages valent pour toutes les pages. Une page peut ensuite être ajustée seule, depuis son mode édition : ses écarts sont gardés, le reste suit le projet.</div>
    </div>
  );
}

/* ---------- Partage et publication ---------- */

function ShareSite({ site, onChange }: { site: Site; onChange: (s: Site) => void }) {
  const toast = useStudio(s => s.toast);
  const owner = canDo.owner(site.role);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [linkRole, setLinkRole] = useState<Role>('viewer');
  const [vis, setVis] = useState<'public' | 'members'>('public');
  const [spaces, setSpaces] = useState<Space[]>([]);
  useEffect(() => { if (owner) collab.spaces().then(setSpaces, () => {}); }, [owner]);
  const run = (p: Promise<Site>, msg?: string) => p.then(s => { onChange(s); if (msg) toast(msg); }, (e: any) => toast(e.message, 'error'));
  const url = (t: string) => `${location.origin}${location.pathname}#/s/${t}`;
  const pubs = (site.publications || []).filter(p => !p.revoked).slice().reverse();
  return (
    <div className="col" style={{ gap: 12 }}>
      {owner && (
        <form className="col" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); if (email.trim()) run(collab.addSiteMember(site.id, email.trim(), role).then(s => { setEmail(''); return s; }), 'Invitation envoyée.'); }}>
          <input className="input" type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} />
          <div className="row"><div className="grow"><Select value={role} onChange={setRole} options={ROLE_OPTS} /></div><button className="btn sm primary" type="submit"><UserPlus />Inviter</button></div>
        </form>
      )}
      <div className="people">
        {site.members.map(m => (
          <div key={m.userId} className="person">
            <Avatar name={m.user?.name || '?'} color={m.user?.color || '#999'} size={24} />
            <div className="grow"><div>{m.user?.name || 'Compte supprimé'}</div></div>
            <span className="badge">{m.role === 'owner' ? 'Propriétaire' : ROLE_OPTS.find(o => o[0] === m.role)?.[1]}{m.viaSpace ? ' · espace' : ''}</span>
            {owner && m.role !== 'owner' && !m.viaSpace && <button className="btn ghost icon sm danger" onClick={() => run(collab.removeSiteMember(site.id, m.userId), 'Accès retiré.')} aria-label={`Retirer ${m.user?.name}`}><X /></button>}
          </div>
        ))}
        {(site.invites || []).map(i => <div key={i.email} className="person pending"><Avatar name={i.email} color="#b0b1b8" size={24} /><div className="grow">{i.email}<div className="faint">en attente du compte</div></div></div>)}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>Les droits valent pour toutes les pages du projet. Chaque page garde son historique et ses commentaires.</div>
      {owner && spaces.length > 0 && (
        <Field label="Espace">
          <Select value={site.space?.id || ''} onChange={v => run(collab.siteSpace(site.id, v || null, site.space?.role || 'editor'))} options={[['', 'Aucun'], ...spaces.map(x => [x.id, x.name] as [string, string])]} />
        </Field>
      )}
      {owner && <>
        <div className="subhead">Liens</div>
        <div className="row"><div className="grow"><Select value={linkRole} onChange={setLinkRole} options={ROLE_OPTS} /></div><button className="btn sm" onClick={() => run(collab.addSiteLink(site.id, { role: linkRole }), 'Lien créé.')}><Link2 />Créer</button></div>
        {(site.links || []).filter(l => !l.revoked).map(l => (
          <div key={l.id} className="person">
            <span className="link-icon">{l.requireLogin ? <Lock /> : <Globe />}</span>
            <div className="grow">{ROLE_OPTS.find(o => o[0] === l.role)?.[1]}<div className="faint">créé {fmtDate(l.createdAt)}</div></div>
            <button className="btn sm ghost icon" onClick={() => navigator.clipboard.writeText(url(l.token)).then(() => toast('Lien copié.'), () => toast(url(l.token)))} aria-label="Copier le lien"><Copy /></button>
            <button className="btn sm ghost icon danger" onClick={() => run(collab.revokeSiteLink(site.id, l.id), 'Lien révoqué.')} aria-label="Révoquer le lien"><Trash2 /></button>
          </div>
        ))}
        <div className="subhead">Publication</div>
        <div className="row"><Segmented value={vis} onChange={setVis} options={[['public', 'Public'], ['members', 'Membres']]} /><span className="grow" />
          <button className="btn sm primary" onClick={() => collab.publishSite(site.id, { visibility: vis }).then(p => { toast('Projet publié.'); window.open(p.url, '_blank', 'noopener'); return collab.site(site.id); }).then(onChange, (e: any) => toast(e.message, 'error'))}><Send />Publier</button>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>La publication fige l'état actuel de toutes les pages en un site : les modifications suivantes ne changent pas le lien publié.</div>
      </>}
      <div className="people">
        {pubs.map(p => (
          <div key={p.id} className="person">
            <span className="link-icon">{p.visibility === 'public' ? <Globe /> : <Lock />}</span>
            <div className="grow">{fmtDate(p.at)}<div className="faint"><BarChart3 size={12} style={{ verticalAlign: -2 }} /> {p.views || 0} consultation{(p.views || 0) > 1 ? 's' : ''} · {p.visibility === 'public' ? 'public' : 'membres'}</div></div>
            <a className="btn sm ghost icon" href={`/p/${p.id}/`} target="_blank" rel="noreferrer" aria-label="Ouvrir la publication"><ExternalLink /></a>
            {owner && <button className="btn sm ghost icon danger" onClick={() => collab.unpublishSite(site.id, p.id).then(() => collab.site(site.id)).then(onChange, (e: any) => toast(e.message, 'error'))} aria-label="Retirer la publication"><Trash2 /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Historique du projet ---------- */

function SiteHistory({ site }: { site: Site }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof collab.siteActivity>> | null>(null);
  useEffect(() => { collab.siteActivity(site.id).then(setList, () => setList([])); }, [site.id]);
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Toutes les pages réunies. L'historique détaillé d'une page (versions, comparaison, restauration) s'ouvre depuis son mode édition.</div>
      {list === null && <div className="empty-small"><span className="spin" /></div>}
      {list?.length === 0 && <div className="empty-small">Aucune activité.</div>}
      {list?.map((a, i) => (
        <div key={i} className="activity">
          <Clock size={13} className="faint" />
          <span className="grow"><strong>{a.actorName}</strong> {a.text}{a.page && a.pageTitle ? <> · <a href={`#/doc/${a.page}`}>{a.pageTitle}</a></> : null}</span>
          <span className="faint">{fmtDate(a.at)}</span>
        </div>
      ))}
    </div>
  );
}

