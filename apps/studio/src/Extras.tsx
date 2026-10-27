// Fonctions avancées : branches et fusion, bibliothèque de blocs réutilisables, identités visuelles, comparaison de gabarits.
import { useEffect, useMemo, useState } from 'react';
import { Blocks, Copy, GitBranch, GitMerge, Link2, Plus, RefreshCw, Stamp, Trash2, Unlink } from 'lucide-react';
import { findIncludes, lineDiff, render, type Target } from '@studio/engine';
import { collab, type Block, type BrandOut, type Doc } from './api.ts';
import { previewEnv } from './env.ts';
import { useStudio } from './store.ts';
import { Modal, Select, Toggle } from './ui.tsx';

/* ---------- Branches ---------- */

export function BranchBanner({ doc, onMerged }: { doc: Doc; onMerged: () => void }) {
  const [open, setOpen] = useState(false);
  if (!doc.branchOf) return null;
  return (
    <>
      <div className="branch-banner">
        <GitBranch />
        <span className="grow">Branche de <a href={`#/doc/${doc.branchOf.docId}`}>« {doc.branchOf.name} »</a>, depuis la version {doc.branchOf.baseVersion}. Le document principal n'est pas modifié tant que vous ne fusionnez pas.</span>
        <button className="btn sm" onClick={() => setOpen(true)}><GitMerge />Fusionner…</button>
      </div>
      {open && <MergeDialog doc={doc} onClose={() => setOpen(false)} onMerged={() => { setOpen(false); onMerged(); }} />}
    </>
  );
}

function MergeDialog({ doc, onClose, onMerged }: { doc: Doc; onClose: () => void; onMerged: () => void }) {
  const toast = useStudio(s => s.toast);
  const [p, setP] = useState<Awaited<ReturnType<typeof collab.mergePreview>> | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { collab.mergePreview(doc.id).then(r => { setP(r); setText(r.text); }, (e: any) => toast(e.message, 'error')); }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = (text.match(/^<<<<<<< /gm) || []).length;
  const diff = useMemo(() => (p ? lineDiff(p.main, text) : []), [p, text]);
  return (
    <Modal wide title={p ? `Fusionner dans « ${p.targetName} »` : 'Fusion'} onClose={onClose}
      footer={<>
        <span className="grow faint" style={{ fontSize: 12 }}>{conflicts ? `${conflicts} conflit(s) : choisissez le texte à garder entre les marqueurs <<<<<<< et >>>>>>>, puis supprimez-les.` : 'Aucun conflit : les changements des deux côtés sont conservés.'}</span>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={!p?.canMerge || conflicts > 0} title={!p?.canMerge ? 'Il faut le droit d\'édition sur le document principal' : ''} onClick={() => collab.merge(doc.id, text).then(r => { toast(`Fusion faite : version ${r.version} du document principal.`); onMerged(); }, (e: any) => toast(e.message, 'error'))}><GitMerge />Fusionner</button>
      </>}>
      {!p ? <div className="empty-small"><span className="spin" /></div> : (
        <div className="merge">
          <div className="merge-col">
            <div className="subhead">Résultat (modifiable)</div>
            <textarea className="input merge-text" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
          </div>
          <div className="merge-col">
            <div className="subhead">Changements apportés au document principal</div>
            <div className="diff">
              {diff.filter(l => l.kind !== 'same').map((l, i) => (
                <div key={i} className={'diff-line diff-' + l.kind}><span className="diff-n">{l.old ?? ''}</span><span className="diff-n">{l.new ?? ''}</span>
                  <span className="diff-text">{l.parts.map((x, k) => <span key={k} className={x.kind === 'added' ? 'sug-ins' : x.kind === 'removed' ? 'sug-del' : ''}>{x.text}</span>)}</span></div>
              ))}
              {!diff.some(l => l.kind !== 'same') && <div className="empty-small">Aucun changement.</div>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function BranchButton({ docId, onClose }: { docId: string; onClose: () => void }) {
  const toast = useStudio(s => s.toast);
  const [name, setName] = useState('');
  return (
    <Modal title="Créer une branche" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={() => collab.branch(docId, name).then(d => { toast('Branche créée.'); location.hash = `#/doc/${d.id}`; onClose(); }, (e: any) => toast(e.message, 'error'))}><GitBranch />Créer</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Une copie de travail pour préparer une refonte sans toucher au document principal. Vous pourrez comparer puis fusionner ; les changements faits entre-temps sur le principal sont conservés.</p>
      <input className="input" placeholder="Nom de la branche (ex. Refonte de la partie budget)" value={name} onChange={e => setName(e.target.value)} autoFocus style={{ width: '100%' }} />
    </Modal>
  );
}

/* ---------- Blocs réutilisables ---------- */

export function BlocksSection({ blocks, reload, getSelectionText, onInsert, onReplaceLine }: {
  blocks: Block[]; reload: () => void; getSelectionText: () => string; onInsert: (text: string) => void; onReplaceLine: (line: number, text: string) => void;
}) {
  const { markdown, toast, me } = useStudio();
  const [saving, setSaving] = useState<{ name: string; text: string; shared: boolean } | null>(null);
  const includes = findIncludes(markdown);
  return (
    <div className="col" style={{ gap: 8 }}>
      {includes.length > 0 && (
        <>
          <div className="subhead">Dans ce document</div>
          {includes.map(r => {
            const b = blocks.find(x => x.id === r.block);
            const latest = b?.versions[b.versions.length - 1];
            const pinned = r.version ?? latest?.version;
            const outdated = b && latest && pinned !== undefined && latest.version > pinned;
            return (
              <div key={r.line} className="block-item">
                <Link2 size={14} className="faint" />
                <div className="grow"><div>{b?.name || r.block}</div><div className="faint">{b ? `version ${pinned}${outdated ? ` · v${latest!.version} disponible` : ''}` : 'introuvable'}</div></div>
                {outdated && <button className="btn sm" title="Passer à la dernière version du bloc" onClick={() => onReplaceLine(r.line, `:::include {block="${r.block}" version=${latest!.version}} :::`)}><RefreshCw />Mettre à jour</button>}
                {b && <button className="btn sm ghost" title="Remplacer par une copie indépendante du contenu" onClick={() => onReplaceLine(r.line, (b.versions.find(v => v.version === pinned) || latest!).markdown)}><Unlink />Détacher</button>}
              </div>
            );
          })}
        </>
      )}
      <div className="subhead">Bibliothèque</div>
      {!blocks.length && <div className="faint" style={{ fontSize: 12 }}>Aucun bloc. Sélectionnez un passage dans la source, puis « Enregistrer la sélection ».</div>}
      {blocks.map(b => {
        const last = b.versions[b.versions.length - 1];
        return (
          <div key={b.id} className="block-item">
            <Blocks size={14} className="faint" />
            <div className="grow"><div>{b.name}</div><div className="faint">v{last.version}{b.owner !== me?.id ? ' · partagé' : ''}</div></div>
            <button className="btn sm ghost" title="Insérer une copie indépendante" onClick={() => onInsert(last.markdown)}><Copy />Copie</button>
            <button className="btn sm ghost" title="Insérer un bloc lié : il ne change que si vous le mettez à jour" onClick={() => onInsert(`:::include {block="${b.id}" version=${last.version}} :::`)}><Link2 />Lié</button>
            {b.owner === me?.id && <button className="btn sm ghost icon danger" onClick={() => { if (confirm(`Supprimer le bloc « ${b.name} » ? Les documents qui l'incluent afficheront un avertissement.`)) collab.deleteBlock(b.id).then(reload, (e: any) => toast(e.message, 'error')); }} aria-label="Supprimer le bloc"><Trash2 /></button>}
          </div>
        );
      })}
      {!saving ? (
        <button className="btn sm" onClick={() => { const t = getSelectionText(); if (!t.trim()) { toast('Sélectionnez d\'abord le passage dans la source.', 'error'); return; } setSaving({ name: '', text: t, shared: true }); }}><Plus />Enregistrer la sélection comme bloc</button>
      ) : (
        <div className="thread draft">
          <input className="input" placeholder="Nom du bloc (ex. Coordonnées du Hub)" value={saving.name} onChange={e => setSaving({ ...saving, name: e.target.value })} autoFocus />
          <Toggle checked={saving.shared} onChange={v => setSaving({ ...saving, shared: v })}>Visible par tous les comptes</Toggle>
          <div className="row"><div className="grow" /><button className="btn sm ghost" onClick={() => setSaving(null)}>Annuler</button>
            <button className="btn sm primary" disabled={!saving.name.trim()} onClick={() => collab.saveBlock({ name: saving.name, markdown: saving.text, shared: saving.shared }).then(() => { setSaving(null); reload(); toast('Bloc enregistré.'); }, (e: any) => toast(e.message, 'error'))}>Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Comparaison de gabarits ---------- */

export function CompareTemplates({ onClose, blocks }: { onClose: () => void; blocks: Block[] }) {
  const { templates, settings, markdown, doc, setSettings } = useStudio();
  const [a, setA] = useState(settings.templateId);
  const [b, setB] = useState(templates.find(t => t.id !== settings.templateId)?.id || settings.templateId);
  const [mode, setMode] = useState<Target>(settings.mode);
  const opts = templates.map(t => [t.id, t.name] as [string, string]);
  const html = (id: string) => {
    const env = previewEnv(doc?.id || '', doc?.assets || []);
    env.context = 'export';
    return render(markdown, { ...settings, overrides: {}, templateId: id, mode, reading: { ...settings.reading, toc: 'none', progress: false } }, env, templates, bid => blocks.find(x => x.id === bid) as any).html;
  };
  const ha = useMemo(() => html(a), [a, mode, markdown]); // eslint-disable-line react-hooks/exhaustive-deps
  const hb = useMemo(() => html(b), [b, mode, markdown]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal wide title="Comparer deux gabarits" onClose={onClose}
      actions={<div style={{ width: 170 }}><Select value={mode} onChange={setMode} options={[['reading', 'Lecture'], ['print', 'Impression'], ['slides', 'Diaporama']]} /></div>}>
      <div className="compare">
        {[[a, setA, ha], [b, setB, hb]].map(([id, set, h], i) => (
          <div key={i} className="compare-col">
            <div className="row compare-head">
              <div className="grow"><Select value={id as string} onChange={set as (v: string) => void} options={opts} /></div>
              <button className="btn sm primary" onClick={() => { setSettings(s => ({ ...s, templateId: id as string, overrides: {} })); onClose(); }}>Choisir</button>
            </div>
            <iframe sandbox="allow-scripts" srcDoc={h as string} title={`Gabarit ${i + 1}`} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Identités visuelles ---------- */

/** Applique une identité de la bibliothèque. Une version plus récente est proposée, jamais imposée. */
export function BrandSection({ onSettings }: { onSettings: () => void }) {
  const { doc, settings, toast } = useStudio();
  const [list, setList] = useState<BrandOut[] | null>(null);
  const [cover, setCover] = useState(false);
  const [busy, setBusy] = useState('');
  useEffect(() => { collab.brands().then(setList, () => setList([])); }, []);
  if (!doc) return null;
  const applied = settings.brand;
  const source = applied && list?.find(b => b.id === applied.id);
  const apply = (b: BrandOut, withCover: boolean) => {
    setBusy(b.id);
    collab.applyBrand(doc.id, b.id, withCover).then(r => {
      // les réglages arrivent aussi par la connexion temps réel ; on les reprend tout de suite pour l'aperçu
      useStudio.setState(x => ({ settings: { ...x.settings, ...r.settings } as any, doc: x.doc && { ...x.doc, assets: r.assets } }));
      toast(`Identité « ${b.name} » appliquée (version ${b.version}).`);
    }, (e: any) => toast(e.message, 'error')).finally(() => setBusy(''));
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      {applied && (
        <div className={'note' + (source && source.version > applied.version ? ' warn' : '')}>
          <strong>{applied.name}</strong> · version {applied.version}
          {source && source.version > applied.version && <>
            <div style={{ margin: '4px 0 6px' }}>Version {source.version} disponible : {source.history.filter(h => h.version > applied.version).map(h => h.summary).join(' ; ')}.</div>
            <button className="btn sm" disabled={!!busy} onClick={() => apply(source, false)}><RefreshCw />Mettre à jour</button>
          </>}
          {!source && list && <div className="faint" style={{ fontSize: 12 }}>Cette identité n'est plus dans votre bibliothèque ; ses réglages restent appliqués.</div>}
        </div>
      )}
      {list === null && <div className="empty-small"><span className="spin" /></div>}
      {list?.length === 0 && <div className="token-help">Aucune identité. Créez-en une (logos, couleurs, polices, couverture, pieds de page) pour l'appliquer d'un clic.</div>}
      {list?.map(b => (
        <div key={b.id} className="brand-pick">
          <span className="swatches">{(['primary', 'secondary', 'accent'] as const).map(k => b.colors[k] && <span key={k} style={{ background: b.colors[k] }} />)}</span>
          <span className="grow"><span style={{ fontWeight: 600 }}>{b.name}</span><span className="faint" style={{ fontSize: 12 }}> · v{b.version}{b.logos.length ? ` · ${b.logos.length} logo${b.logos.length > 1 ? 's' : ''}` : ''}</span></span>
          <button className="btn sm" disabled={!!busy} onClick={() => apply(b, cover)}>{busy === b.id ? <span className="spin" /> : <Stamp />}{applied?.id === b.id ? 'Réappliquer' : 'Appliquer'}</button>
        </div>
      ))}
      {list && list.some(b => b.cover) && <Toggle checked={cover} onChange={setCover}>Insérer aussi la couverture de l'identité</Toggle>}
      <button className="btn sm ghost" onClick={onSettings}><Plus />Gérer les identités</button>
      <div className="token-help">Appliquer change la présentation (couleurs, polices, pieds de page, logos copiés dans les fichiers du document), jamais le texte, sauf la couverture si vous la demandez.</div>
    </div>
  );
}
