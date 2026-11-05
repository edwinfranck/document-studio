// Import d'un projet ZIP : envoi et analyse, rapport, choix du mode, organisation, thème, construction.
// On peut revenir à chaque étape tant que rien n'est construit.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, BookOpen, Check, ChevronDown, ChevronUp, File, FileText, Files, Folder, FolderTree, GripVertical, Home, Image as ImageIcon, Info, Library, Link2, ListOrdered, X,
} from 'lucide-react';
import type { ArchiveReport } from '@studio/engine';
import { api, type ImportPlan, type ImportResult } from './api.ts';
import { analyze, build, cancel, type ImportSession } from './importer.ts';
import { useStudio } from './store.ts';
import { Modal, Toggle, fmtSize } from './ui.tsx';

type Step = 'upload' | 'report' | 'mode' | 'organize' | 'theme' | 'build';
type Mode = ImportPlan['mode'];
const STEPS: [Step, string][] = [['report', 'Analyse'], ['mode', 'Mode'], ['organize', 'Organisation'], ['theme', 'Thème']];

export function ImportWizard({ file, onClose, onDone }: { file: File; onClose: () => void; onDone: (r: ImportResult) => void }) {
  const { templates, toast } = useStudio();
  const [step, setStep] = useState<Step>('upload');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('Lecture de l\'archive…');
  const [error, setError] = useState('');
  const [session, setSession] = useState<ImportSession | null>(null);
  const [mode, setMode] = useState<Mode>('site');
  const [name, setName] = useState(file.name.replace(/\.zip$/i, ''));
  const [order, setOrder] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState<string>('');
  const [fixes, setFixes] = useState<Set<number>>(new Set());
  const [templateId, setTemplateId] = useState('technique');
  const abort = useRef(new AbortController());
  const siteAllowed = api.backend.kind === 'server';

  useEffect(() => {
    const ctl = abort.current;
    analyze(file, (n, t) => { setProgress(t ? n / t : 0); if (n >= t) setPhase('Analyse du contenu…'); }, ctl.signal).then(s => {
      setSession(s);
      const r = s.report;
      setOrder(r.order);
      setEntry(r.entry || r.order[0] || '');
      setMode(r.suggestedMode === 'site' && !siteAllowed ? 'merge' : r.suggestedMode);
      setTemplateId(r.suggestedMode === 'site' ? 'technique' : 'editorial');
      setFixes(new Set(r.problems.map((p, i) => (p.fix ? i : -1)).filter(i => i >= 0)));
      setStep('report');
    }, e => { if (e?.name !== 'AbortError') setError(e.message || String(e)); });
    return () => ctl.abort();
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { abort.current.abort(); cancel(session); onClose(); };
  const r = session?.report;
  const included = order.filter(p => !excluded.has(p));

  const run = async () => {
    if (!session || !r) return;
    setStep('build');
    try {
      const res = await build(session, {
        mode, name: name.trim() || 'Projet importé', order: included, entry: mode === 'site' ? entry : undefined, templateId,
        titles, fixes: r.problems.filter((p, i) => p.fix && p.path && fixes.has(i)).map(p => ({ path: p.path!, from: p.fix!.from, to: p.fix!.to })),
      });
      onDone(res);
    } catch (e: any) { toast(e.message, 'error'); setStep('theme'); }
  };

  const errors = r?.problems.filter(p => p.level === 'error').length || 0;
  const footer = step === 'upload' || step === 'build' ? (
    <><span className="grow" /><button className="btn" onClick={close} disabled={step === 'build'}>Annuler l'import</button></>
  ) : (
    <>
      <button className="btn ghost" onClick={close}>Annuler</button>
      <span className="grow" />
      {step !== 'report' && <button className="btn" onClick={() => setStep(step === 'mode' ? 'report' : step === 'organize' ? 'mode' : 'organize')}>Retour</button>}
      {step === 'report' && <button className="btn primary" disabled={!!errors} onClick={() => setStep('mode')}>Choisir le mode</button>}
      {step === 'mode' && <button className="btn primary" onClick={() => setStep('organize')}>Organiser</button>}
      {step === 'organize' && <button className="btn primary" disabled={!included.length} onClick={() => setStep('theme')}>Choisir le thème</button>}
      {step === 'theme' && <button className="btn primary" onClick={run}><Check />{mode === 'site' ? 'Créer le projet' : mode === 'merge' ? 'Créer le document' : `Importer ${included.length} document${included.length > 1 ? 's' : ''}`}</button>}
    </>
  );

  return (
    <Modal wide title={`Importer « ${file.name} »`} onClose={close} footer={footer}
      actions={step !== 'upload' && step !== 'build' ? <ol className="wizard-steps">{STEPS.map(([k, l], i) => <li key={k} aria-current={k === step} className={STEPS.findIndex(s => s[0] === step) > i ? 'done' : ''}><span>{i + 1}</span>{l}</li>)}</ol> : undefined}>
      <div className="wizard">
        {step === 'upload' && (
          <div className="wizard-progress">
            {error ? (
              <div className="note warn"><strong>Import impossible.</strong> {error}<div style={{ marginTop: 8 }}><button className="btn sm" onClick={close}>Fermer</button></div></div>
            ) : (
              <>
                <div className="row"><span className="spin" /><strong>{phase}</strong><span className="grow" /><span className="faint">{Math.round(progress * 100)} % · {fmtSize(file.size)}</span></div>
                <div className="bar"><span style={{ width: `${Math.max(3, progress * 100)}%` }} /></div>
                <p className="faint" style={{ margin: 0, fontSize: 12 }}>L'archive est lue sans être extraite sur votre appareil. Rien n'est créé avant votre validation.</p>
              </>
            )}
          </div>
        )}
        {step === 'report' && r && <Report r={r} fixes={fixes} setFixes={setFixes} />}
        {step === 'mode' && r && (
          <div className="col" style={{ gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>{r.kindReason}</p>
            <div className="mode-cards">
              <ModeCard on={mode === 'site'} disabled={!siteAllowed} pick={() => setMode('site')} icon={<FolderTree />} title="Documentation multi-pages" suggested={r.suggestedMode === 'site'}
                text="Chaque fichier devient une page : navigation latérale, recherche dans toutes les pages, page précédente et suivante, liens entre fichiers conservés."
                note={siteAllowed ? undefined : 'Demande le serveur Document Studio ou l\'application de bureau.'} />
              <ModeCard on={mode === 'merge'} pick={() => setMode('merge')} icon={<BookOpen />} title="Document continu" suggested={r.suggestedMode === 'merge'}
                text="Les fichiers choisis sont réunis en un seul document, un chapitre par fichier, avec un sommaire. Les liens entre fichiers deviennent des renvois internes." />
              <ModeCard on={mode === 'separate'} pick={() => setMode('separate')} icon={<Files />} title="Documents séparés"
                text={`Chaque fichier devient un document indépendant, rangé dans la collection « ${name || 'Projet importé'} ». Chacun s'édite et s'exporte à part.`} />
            </div>
          </div>
        )}
        {step === 'organize' && r && (
          <Organize r={r} mode={mode} name={name} setName={setName} order={order} setOrder={setOrder} excluded={excluded} setExcluded={setExcluded} titles={titles} setTitles={setTitles} entry={entry} setEntry={setEntry} />
        )}
        {step === 'theme' && (
          <div className="col" style={{ gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>{mode === 'site' ? 'Le thème s\'applique à toutes les pages ; chaque page pourra ensuite être ajustée.' : 'Le thème se change à tout moment depuis le document.'}</p>
            <div className="tpl-pick">
              {templates.filter(t => t.kind !== 'slides').map(t => (
                <button key={t.id} className="tpl-pick-item" aria-pressed={t.id === templateId} onClick={() => setTemplateId(t.id)}>
                  <span className="tpl-pick-swatch" style={{ background: t.tokens.colors.bg, color: t.tokens.colors.primary, fontFamily: `"${t.tokens.fonts.heading}"` }}>Aa<i style={{ background: t.tokens.colors.accent }} /></span>
                  <span className="tpl-pick-name">{t.name}</span>
                  <span className="faint">{t.tokens.fonts.heading}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 'build' && (
          <div className="wizard-progress">
            <div className="row"><span className="spin" /><strong>{mode === 'site' ? `Construction du projet : ${included.length} pages…` : 'Création…'}</strong></div>
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>Tout ou rien : si une étape échoue, rien n'est gardé et le message l'explique.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ModeCard({ on, pick, icon, title, text, suggested, disabled, note }: { on: boolean; pick: () => void; icon: React.ReactNode; title: string; text: string; suggested?: boolean; disabled?: boolean; note?: string }) {
  return (
    <button className="mode-card" aria-pressed={on} disabled={disabled} onClick={pick}>
      <span className="mode-card-icon">{icon}</span>
      <strong>{title}{suggested && !disabled && <span className="badge ok">conseillé</span>}</strong>
      <span className="muted">{text}</span>
      {note && <span className="badge warning">{note}</span>}
    </button>
  );
}

function Report({ r, fixes, setFixes }: { r: ArchiveReport; fixes: Set<number>; setFixes: (s: Set<number>) => void }) {
  const [filter, setFilter] = useState<'all' | 'warning'>('warning');
  const tiles: [React.ReactNode, number, string][] = [
    [<FileText />, r.stats.pages, 'pages Markdown'], [<Folder />, r.stats.folders, 'dossiers'], [<ImageIcon />, r.stats.images, 'images'],
    [<File />, r.stats.resources - r.stats.images, 'autres fichiers'], [<Link2 />, r.stats.internalLinks, 'liens entre pages'], [<AlertTriangle />, r.stats.brokenLinks, 'liens cassés'],
  ];
  const shown = r.problems.map((p, i) => ({ p, i })).filter(x => filter === 'all' || x.p.level !== 'info');
  return (
    <div className="report">
      <div className="stat-row">{tiles.map(([ic, n, l], i) => <div key={i}><strong>{n}</strong><span className="row" style={{ gap: 4 }}>{ic}{l}</span></div>)}</div>
      <div className="report-grid">
        <div className="col" style={{ gap: 8, minWidth: 0 }}>
          <div className="subhead" style={{ marginTop: 0 }}>Structure</div>
          {r.entry && <div className="note"><Home size={14} style={{ verticalAlign: -2 }} /> <strong>Accueil proposé : {r.entry}</strong><br />{r.entryReason}</div>}
          <Tree r={r} />
        </div>
        <div className="col" style={{ gap: 8, minWidth: 0 }}>
          <div className="subhead row" style={{ marginTop: 0 }}><span className="grow">Points à vérifier ({r.problems.length})</span>
            <button className="chip" aria-pressed={filter === 'warning'} onClick={() => setFilter('warning')}>Importants</button>
            <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Tous</button>
          </div>
          {!shown.length && <div className="empty-small">Rien à signaler.</div>}
          <div className="problems-list">
            {shown.map(({ p, i }) => (
              <div key={i} className={'problem ' + p.level}>
                {p.level === 'error' ? <AlertCircle /> : p.level === 'warning' ? <AlertTriangle /> : <Info />}
                <div className="grow">
                  {p.path && <code>{p.path}{p.line ? ` · ligne ${p.line}` : ''}</code>}
                  <div>{p.message}</div>
                  {p.fix && <Toggle checked={fixes.has(i)} onChange={v => { const n = new Set(fixes); if (v) n.add(i); else n.delete(i); setFixes(n); }}>Corriger en « {p.fix.to} »</Toggle>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Arborescence de l'archive : dossiers, pages, ressources, fichiers refusés. */
function Tree({ r }: { r: ArchiveReport }) {
  const lines = useMemo(() => {
    const out: { depth: number; name: string; kind: string; note?: string; folder?: boolean }[] = [];
    const seen = new Set<string>();
    for (const f of [...r.files].sort((a, b) => a.path.localeCompare(b.path, 'fr', { numeric: true }))) {
      const parts = f.path.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const d = parts.slice(0, i + 1).join('/');
        if (!seen.has(d)) { seen.add(d); out.push({ depth: i, name: parts[i], kind: 'folder', folder: true }); }
      }
      out.push({ depth: parts.length - 1, name: parts[parts.length - 1], kind: f.status === 'rejected' ? 'rejected' : f.kind, note: f.status === 'rejected' ? f.reason : fmtSize(f.size) });
    }
    return out;
  }, [r]);
  return (
    <div className="tree">
      {lines.slice(0, 400).map((l, i) => (
        <div key={i} className={'tree-row ' + l.kind} style={{ paddingLeft: 6 + l.depth * 16 }} title={l.note}>
          {l.folder ? <Folder /> : l.kind === 'markdown' ? <FileText /> : l.kind === 'image' ? <ImageIcon /> : l.kind === 'rejected' ? <X /> : <File />}
          <span className="grow">{l.name}</span>
          {!l.folder && <span className="faint">{l.kind === 'rejected' ? 'non importé' : l.note}</span>}
        </div>
      ))}
      {lines.length > 400 && <div className="faint" style={{ padding: 6 }}>… {lines.length - 400} lignes de plus</div>}
    </div>
  );
}

function Organize({ r, mode, name, setName, order, setOrder, excluded, setExcluded, titles, setTitles, entry, setEntry }: {
  r: ArchiveReport; mode: Mode; name: string; setName: (v: string) => void; order: string[]; setOrder: (v: string[]) => void;
  excluded: Set<string>; setExcluded: (v: Set<string>) => void; titles: Record<string, string>; setTitles: (v: Record<string, string>) => void; entry: string; setEntry: (v: string) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const move = (from: number, to: number) => { if (to < 0 || to >= order.length) return; const n = [...order]; const [x] = n.splice(from, 1); n.splice(to, 0, x); setOrder(n); };
  const page = (p: string) => r.pages.find(x => x.path === p);
  return (
    <div className="col" style={{ gap: 12 }}>
      <label className="field-stack"><span className="faint">{mode === 'site' ? 'Nom du projet' : mode === 'merge' ? 'Titre du document' : 'Collection'}</span>
        <input className="input title-input" value={name} onChange={e => setName(e.target.value)} />
      </label>
      <div className="faint" style={{ fontSize: 12 }}>
        <ListOrdered size={13} style={{ verticalAlign: -2 }} /> {mode === 'site' ? 'Ordre des pages dans la navigation. Les dossiers deviennent des groupes ; leur README ou index en est la page.' : mode === 'merge' ? 'Ordre des chapitres. Décochez un fichier pour le laisser hors du document.' : 'Décochez un fichier pour ne pas l\'importer.'} Glissez une ligne pour la déplacer.
      </div>
      <div className="org-list">
        {order.map((p, i) => {
          const pg = page(p);
          const off = excluded.has(p);
          return (
            <div key={p} className={'org-row' + (off ? ' off' : '') + (drag === p ? ' dragging' : '')} draggable
              onDragStart={e => { setDrag(p); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDrag(null)}
              onDragOver={e => { e.preventDefault(); if (drag && drag !== p) move(order.indexOf(drag), i); }}>
              <span className="org-grip" aria-hidden="true"><GripVertical /></span>
              <Toggle checked={!off} onChange={v => { const n = new Set(excluded); if (v) n.delete(p); else n.add(p); setExcluded(n); }}><span className="sr-only">Inclure {p}</span></Toggle>
              <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <input className="input org-title" value={titles[p] ?? pg?.title ?? p} onChange={e => setTitles({ ...titles, [p]: e.target.value })} aria-label={`Titre de ${p}`} disabled={off} />
                <span className="faint org-path">{p} · {pg?.words ?? 0} mots{pg?.empty ? ' · vide' : ''}</span>
              </div>
              {mode === 'site' && !off && <button className="btn sm ghost" aria-pressed={entry === p} onClick={() => setEntry(p)} title="Page d'accueil du projet"><Home />{entry === p ? 'Accueil' : ''}</button>}
              <div className="org-moves">
                <button className="btn ghost icon sm" onClick={() => move(i, i - 1)} disabled={!i} aria-label="Monter"><ChevronUp /></button>
                <button className="btn ghost icon sm" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label="Descendre"><ChevronDown /></button>
              </div>
            </div>
          );
        })}
      </div>
      {mode === 'site' && <div className="note"><Library size={14} style={{ verticalAlign: -2 }} /> Les fichiers décochés et les ressources restent dans l'archive d'origine, conservée avec le projet.</div>}
    </div>
  );
}
