// Galerie de gabarits : chaque miniature est un vrai rendu du document courant avec le gabarit.
import { useMemo, useState } from 'react';
import { Copy, Download, Pencil, Trash2 } from 'lucide-react';
import { render, type Template } from '@studio/engine';
import { api, download } from './api.ts';
import { previewEnv } from './env.ts';
import { useStudio } from './store.ts';
import { Modal, Toggle } from './ui.tsx';

const SAMPLE = `---
title: Rapport d'activité
subtitle: Bilan du trimestre et priorités
author: Équipe projet
---

## Synthèse

Le programme a accompagné **24 équipes** ce trimestre. Les ateliers pratiques restent le format le plus apprécié.

:::stats
- label: Projets
  value: 24
- label: Ateliers
  value: 12
- label: Participants
  value: 180
:::

:::callout {type="info" title="À retenir"}
Trois projets ont trouvé un partenaire industriel.
:::

| Indicateur | 2025 | 2026 |
|---|--:|--:|
| Inscrits | 140 | 180 |
`;

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const { templates, settings, setSettings, doc, markdown, loadTemplates, toast } = useStudio();
  const [cat, setCat] = useState<string>('Tous');
  const [useSample, setUseSample] = useState(false);
  const mode = settings.mode;
  const cats = ['Tous', 'Documents', 'Présentations', 'Mes gabarits', ...new Set(templates.filter(t => t.builtin).map(t => t.category))];
  const shown = templates.filter(t =>
    cat === 'Tous' || (cat === 'Documents' && t.kind !== 'slides') || (cat === 'Présentations' && t.kind !== 'document') ||
    (cat === 'Mes gabarits' && !t.builtin) || t.category === cat);

  const source = useSample || !markdown.trim() ? SAMPLE : markdown.slice(0, 6000);
  const thumbs = useMemo(() => {
    const env = previewEnv(doc?.id || '', doc?.assets || []);
    env.context = 'export';   // pas de pont d'aperçu dans les miniatures
    const out: Record<string, string> = {};
    for (const t of templates) {
      const asSlides = mode === 'slides' || t.kind === 'slides';
      try {
        out[t.id] = render(source, { ...settings, overrides: {}, templateId: t.id, mode: asSlides ? 'slides' : 'reading', reading: { toc: 'none', progress: false, search: false, colorScheme: 'template' } }, env, templates).html
          .replace('</head>', '<style>.sd-topbar,.sd-deck-hint,.sd-deck-progress{display:none!important}.sd-main{padding-top:2.2rem!important}.sd-doc-head{margin-bottom:1.5rem!important;padding-bottom:1rem!important}</style></head>');
      } catch { out[t.id] = ''; }
    }
    return out;
  }, [templates, source, mode, doc?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (t: Template) => {
    // Changer de gabarit garde les réglages de page et de diaporama, mais repart des couleurs et polices du gabarit.
    setSettings(s => ({ ...s, templateId: t.id, overrides: {} }));
    toast(`Gabarit « ${t.name} » appliqué. Le texte n'a pas changé.`);
    onClose();
  };
  const duplicate = async (t: Template) => {
    const name = prompt('Nom de la copie', `${t.name} (copie)`);
    if (!name) return;
    try { await api.saveTheme({ ...t, id: '', name, builtin: false, basedOn: t.id, category: 'Mes gabarits' }); await loadTemplates(); setCat('Mes gabarits'); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const rename = async (t: Template) => {
    const name = prompt('Nouveau nom', t.name);
    if (!name || name === t.name) return;
    try { await api.saveTheme({ ...t, name }); await loadTemplates(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const remove = async (t: Template) => {
    if (!confirm(`Supprimer le gabarit « ${t.name} » ? Les documents qui l'utilisent reviendront au gabarit par défaut.`)) return;
    try { await api.deleteTheme(t.id); await loadTemplates(); } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <Modal wide title="Gabarits" onClose={onClose}
      actions={<div style={{ fontSize: 12, marginRight: 8, width: 300 }}><Toggle checked={useSample} onChange={setUseSample}>Afficher un exemple plutôt que ce document</Toggle></div>}>
      <div className="gallery">
        <div className="gallery-side">
          {cats.map(c => (
            <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>
              <span>{c}</span>
            </button>
          ))}
        </div>
        <div className="gallery-grid">
          {shown.length === 0 && <div className="faint">Aucun gabarit ici. Personnalisez un gabarit puis « Enregistrer comme gabarit ».</div>}
          {shown.map(t => (
            <div key={t.id} className={'tcard' + (settings.templateId === t.id ? ' current' : '')} onClick={() => apply(t)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && apply(t)}>
              <div className="shot">
                {thumbs[t.id] && <Thumb html={thumbs[t.id]} slides={mode === 'slides' || t.kind === 'slides'} />}
              </div>
              <div className="info">
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </div>
              <div className="actions" onClick={e => e.stopPropagation()}>
                <button className="btn sm ghost" onClick={() => duplicate(t)} title="Dupliquer"><Copy />Dupliquer</button>
                {!t.builtin && <button className="btn sm ghost icon" onClick={() => rename(t)} title="Renommer"><Pencil /></button>}
                <button className="btn sm ghost icon" onClick={() => download(new Blob([JSON.stringify({ ...t, builtin: false }, null, 2)], { type: 'application/json' }), `${t.id}.theme.json`)} title="Exporter (.json)"><Download /></button>
                {!t.builtin && <button className="btn sm ghost icon danger" onClick={() => remove(t)} title="Supprimer"><Trash2 /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Thumb({ html, slides }: { html: string; slides: boolean }) {
  // Toile de 1000 px (lecture) ou 1280 × 720 (diapositive) réduite dans la carte.
  const w = slides ? 1280 : 1160;
  const h = slides ? 720 : 700;
  const k = 340 / w;
  return <iframe sandbox="allow-scripts" srcDoc={html} title="" tabIndex={-1} style={{ width: w, height: h, transform: `scale(${k})` }} />;
}
