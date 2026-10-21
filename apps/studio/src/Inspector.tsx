// Panneau de propriétés : réglages du document et de l'élément sélectionné, selon le mode de sortie.
import { useRef } from 'react';
import {
  Blocks, Braces, Download, FileText, Image as ImageIcon, LayoutTemplate, Palette, PanelTop, Plus, RotateCcw, Ruler, Save, Type, Upload,
} from 'lucide-react';
import {
  COMPONENTS, BY_NAME, FONT_FAMILIES, contrastReport, merge, resolveTheme, type ComponentNode, type DocSettings, type PageSettings,
  type ReadingSettings, type SlideSettings, type Template, type ThemeTokens,
} from '@studio/engine';
import { useStudio } from './store.ts';
import { api, download } from './api.ts';
import { ColorField, Field, Range, Section, Segmented, Select, Toggle, type Option } from './ui.tsx';

interface Props {
  selected: ComponentNode | null;
  onInsert(text: string): void;
  onEditComponent(c: ComponentNode, attrs: Record<string, string | true>): void;
  onOpenGallery(): void;
  onExport(format: string): void;
}

const PAIRINGS: [string, string, string, string][] = [
  ['Inter', 'Inter', 'JetBrains Mono', 'Neutre'],
  ['Fraunces', 'Newsreader', 'JetBrains Mono', 'Éditorial'],
  ['Source Serif 4', 'Source Serif 4', 'JetBrains Mono', 'Académique'],
  ['Inter', 'Source Serif 4', 'JetBrains Mono', 'Direction'],
  ['IBM Plex Sans', 'IBM Plex Sans', 'IBM Plex Mono', 'Technique'],
  ['Space Grotesk', 'Inter', 'JetBrains Mono', 'Moderne'],
  ['Lexend', 'Lexend', 'JetBrains Mono', 'Lisible'],
  ['DM Sans', 'DM Sans', 'IBM Plex Mono', 'KERNEL'],
];

const PALETTES: [string, Partial<ThemeTokens['colors']>][] = [
  ['Encre', { primary: '#1c1d20', secondary: '#4b4f58', accent: '#d9480f', link: '#1f5fbf' }],
  ['Nuit', { primary: '#14213d', secondary: '#2a9d8f', accent: '#2a9d8f', link: '#1d6f8f' }],
  ['Forêt', { primary: '#1b4332', secondary: '#40916c', accent: '#d68c45', link: '#2d6a4f' }],
  ['Bordeaux', { primary: '#5c1a2b', secondary: '#8c4a5a', accent: '#c9a227', link: '#8a2338' }],
  ['Océan', { primary: '#023e8a', secondary: '#0077b6', accent: '#f77f00', link: '#0063a6' }],
  ['Violet', { primary: '#3b2f8f', secondary: '#6c5ce7', accent: '#f79009', link: '#4a3bc4' }],
];

const COLOR_GROUPS: [string, [keyof ThemeTokens['colors'], string][]][] = [
  ['Principales', [['primary', 'Principale'], ['secondary', 'Secondaire'], ['accent', 'Accent']]],
  ['Texte et fonds', [['text', 'Texte'], ['muted', 'Texte second.'], ['bg', 'Fond'], ['surface', 'Fond second.'], ['border', 'Bordures'], ['link', 'Liens']]],
  ['Sémantiques', [['info', 'Information'], ['success', 'Succès'], ['warning', 'Attention'], ['danger', 'Erreur']]],
  ['Code', [['codeBg', 'Fond'], ['codeText', 'Texte']]],
  ['Diapositives', [['slideBg', 'Fond'], ['slideText', 'Texte'], ['slideAccent', 'Accent']]],
];

const setPath = (obj: any, path: string[], value: unknown): any => {
  const [k, ...rest] = path;
  return { ...(obj || {}), [k]: rest.length ? setPath(obj?.[k], rest, value) : value };
};

export function Inspector({ selected, onInsert, onEditComponent, onOpenGallery, onExport }: Props) {
  const { settings, setSettings, templates, doc, loadTemplates, toast } = useStudio();
  const resolved = resolveTheme(settings, templates);
  const t = resolved.tokens;
  const mode = settings.mode;
  const fontInput = useRef<HTMLInputElement>(null);
  const themeInput = useRef<HTMLInputElement>(null);

  const tok = (path: string, value: unknown) => setSettings(s => ({ ...s, overrides: setPath(s.overrides, path.split('.'), value) }), 'tok:' + path);
  const page = <K extends keyof PageSettings>(k: K, v: PageSettings[K]) => setSettings(s => ({ ...s, page: { ...s.page, [k]: v } }), 'page:' + k);
  const slides = <K extends keyof SlideSettings>(k: K, v: SlideSettings[K]) => setSettings(s => ({ ...s, slides: { ...s.slides, [k]: v } }), 'slides:' + k);
  const reading = <K extends keyof ReadingSettings>(k: K, v: ReadingSettings[K]) => setSettings(s => ({ ...s, reading: { ...s.reading, [k]: v } }));
  const meta = (k: string, v: string) => setSettings(s => ({ ...s, meta: { ...s.meta, [k]: v } }), 'meta:' + k);
  const overrideCount = countLeaves(settings.overrides);
  const customFonts = (settings.fonts || []).map(f => f.family);
  const KIND: Record<string, string> = { sans: 'Sans empattement', serif: 'Avec empattement', display: 'Titrage', mono: 'Chasse fixe' };
  const fontOptions: Option<string>[] = [
    ...FONT_FAMILIES.map(f => ({ value: f.family, label: f.family, group: KIND[f.kind] })),
    ...[...new Set(customFonts)].map(f => ({ value: f, label: f, group: 'Importées' })),
  ];

  const saveAsTemplate = async () => {
    const name = prompt('Nom du nouveau gabarit', `${resolved.template.name} — variante`);
    if (!name) return;
    const tpl: Template = {
      id: '', name, category: 'Mes gabarits', kind: resolved.template.kind, basedOn: resolved.template.id,
      description: `Variante de « ${resolved.template.name} ».`,
      tokens: t, page: merge(resolved.template.page, settings.page), slides: merge(resolved.template.slides, settings.slides), css: resolved.template.css,
    };
    try {
      const saved = await api.saveTheme(tpl);
      await loadTemplates();
      setSettings(s => ({ ...s, templateId: saved.id, overrides: {}, page: {}, slides: {} }));
      toast(`Gabarit « ${saved.name} » enregistré. Le gabarit d'origine n'a pas changé.`);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const exportTemplate = () => {
    const tpl = { ...resolved.template, tokens: t, page: merge(resolved.template.page, settings.page), slides: merge(resolved.template.slides, settings.slides), builtin: false };
    download(new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' }), `${tpl.id || 'gabarit'}.theme.json`);
  };

  const importTemplate = async (file: File) => {
    try {
      const tpl = JSON.parse(await file.text());
      if (!tpl.tokens) throw new Error('Ce fichier ne contient pas de gabarit (« tokens » manquant).');
      const saved = await api.saveTheme({ ...tpl, id: '', builtin: false });
      await loadTemplates();
      setSettings(s => ({ ...s, templateId: saved.id, overrides: {} }));
      toast(`Gabarit « ${saved.name} » importé et appliqué.`);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const importFont = async (file: File) => {
    if (!doc) return;
    if (!/\.(woff2?|ttf|otf)$/i.test(file.name)) { toast('Formats acceptés : woff2, woff, ttf, otf.', 'error'); return; }
    const family = prompt('Nom de la famille de police', file.name.replace(/[-_](regular|bold|italic|variable|vf).*$/i, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
    if (!family) return;
    try {
      const a = await api.putAsset(doc.id, file.name, file);
      useStudio.setState(s => ({ doc: s.doc && { ...s.doc, assets: [...s.doc.assets.filter(x => x.name !== a.name), a] } }));
      setSettings(s => ({ ...s, fonts: [...(s.fonts || []).filter(f => f.file !== a.name), { family, file: a.name }] }));
      toast(`Police « ${family} » ajoutée. Vérifiez que sa licence autorise l'intégration dans un document.`);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const contrastRows = contrastReport(t);
  const sizeLabel = mode === 'print' ? ['Corps (pt)', 'type.printSize', 7, 14, 0.5, ' pt'] as const : mode === 'slides' ? ['Corps (px)', 'type.slideSize', 22, 52, 1, ' px'] as const : ['Corps (px)', 'type.baseSize', 13, 24, 0.5, ' px'] as const;

  return (
    <div className="inspector">
      <Section id="theme" icon={<LayoutTemplate />} title="Thème" open>
        <div className="tpl-current" onClick={onOpenGallery} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpenGallery()}>
          <div className="swatches">{[t.colors.primary, t.colors.accent, t.colors.surface, t.colors.bg].map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          <div className="grow"><div style={{ fontWeight: 600 }}>{resolved.template.name}</div><div className="faint" style={{ fontSize: 12 }}>{t.fonts.heading} · {t.fonts.body}</div></div>
          <span className="btn sm">Changer</span>
        </div>
        {overrideCount > 0 && (
          <div className="row">
            <span className="faint grow" style={{ fontSize: 12 }}>{overrideCount} personnalisation{overrideCount > 1 ? 's' : ''}</span>
            <button className="btn sm ghost" onClick={() => setSettings(s => ({ ...s, overrides: {} }))}><RotateCcw />Réinitialiser</button>
          </div>
        )}
        <div className="row">
          <button className="btn sm grow" onClick={saveAsTemplate} title="Enregistre ces réglages comme un nouveau gabarit, sans modifier l'original"><Save />Enregistrer comme gabarit</button>
        </div>
        <div className="row">
          <button className="btn sm grow" onClick={exportTemplate}><Download />Exporter</button>
          <button className="btn sm grow" onClick={() => themeInput.current?.click()}><Upload />Importer</button>
          <input ref={themeInput} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importTemplate(f); e.target.value = ''; }} />
        </div>
      </Section>

      <Section id="doc" icon={<FileText />} title="Document">
        {(['title', 'subtitle', 'author', 'organization', 'date', 'version'] as const).map(k => (
          <Field key={k} label={{ title: 'Titre', subtitle: 'Sous-titre', author: 'Auteur', organization: 'Organisation', date: 'Date', version: 'Version' }[k]}>
            <input className="input" value={String(settings.meta?.[k] ?? '')} placeholder={k === 'title' ? 'premier titre ou front matter' : ''} onChange={e => meta(k, e.target.value)} />
          </Field>
        ))}
        <div className="token-help">Le front matter du fichier (<code>title:</code>, <code>author:</code>…) est prioritaire sur ces champs.</div>
        <Field label="Collection">
          <input className="input" value={doc?.project || ''} placeholder="Aucune" onChange={e => useStudio.getState().setProject(e.target.value)} />
        </Field>
      </Section>

      <Section id="type" icon={<Type />} title="Typographie">
        <div className="palette-row">
          {PAIRINGS.map(([h, b, m, label]) => (
            <button key={label} className="btn sm" style={{ height: 24 }} title={`${h} / ${b}`} onClick={() => setSettings(s => ({ ...s, overrides: setPath(s.overrides, ['fonts'], { heading: h, body: b, mono: m }) }))}>{label}</button>
          ))}
        </div>
        <Field label="Titres"><Select font value={t.fonts.heading} options={fontOptions} onChange={v => tok('fonts.heading', v)} /></Field>
        <Field label="Texte"><Select font value={t.fonts.body} options={fontOptions} onChange={v => tok('fonts.body', v)} /></Field>
        <Field label="Code"><Select font value={t.fonts.mono} options={fontOptions} onChange={v => tok('fonts.mono', v)} /></Field>
        <button className="btn sm" onClick={() => fontInput.current?.click()}><Plus />Importer une police locale</button>
        <input ref={fontInput} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importFont(f); e.target.value = ''; }} />
        <div className="subhead">Échelle</div>
        <Field label={sizeLabel[0]}><Range value={(t.type as any)[sizeLabel[1].split('.')[1]]} min={sizeLabel[2]} max={sizeLabel[3]} step={sizeLabel[4]} unit={sizeLabel[5]} onChange={v => tok(sizeLabel[1], v)} /></Field>
        <Field label="Rapport H1–H6"><Range value={t.type.scale} min={1.1} max={1.6} step={0.01} onChange={v => tok('type.scale', v)} /></Field>
        <Field label="Interlignage"><Range value={t.type.lineHeight} min={1.2} max={2} step={0.05} onChange={v => tok('type.lineHeight', v)} /></Field>
        <Field label="Interl. titres"><Range value={t.type.headingLineHeight} min={0.95} max={1.5} step={0.01} onChange={v => tok('type.headingLineHeight', v)} /></Field>
        <div className="subhead">Graisse et espacement</div>
        <Field label="Titres"><Range value={t.type.headingWeight} min={300} max={900} step={50} onChange={v => tok('type.headingWeight', v)} /></Field>
        <Field label="Texte"><Range value={t.type.bodyWeight} min={300} max={500} step={50} onChange={v => tok('type.bodyWeight', v)} /></Field>
        <Field label="Lettres, titres"><Range value={t.type.headingTracking} min={-0.06} max={0.1} step={0.005} unit=" em" onChange={v => tok('type.headingTracking', v)} /></Field>
        <Field label="Lettres, texte"><Range value={t.type.bodyTracking} min={-0.03} max={0.08} step={0.005} unit=" em" onChange={v => tok('type.bodyTracking', v)} /></Field>
        <Field label="Casse titres"><Segmented full value={t.type.headingCase} onChange={v => tok('type.headingCase', v)} options={[['none', 'Normale'], ['uppercase', 'Capitales']]} /></Field>
        <div className="subhead">Paragraphes</div>
        {mode === 'reading' && <Field label="Largeur (car.)"><Range value={t.type.measure} min={45} max={110} step={1} unit=" ch" onChange={v => tok('type.measure', v)} /></Field>}
        <Field label="Alignement"><Segmented full value={t.type.align} onChange={v => tok('type.align', v)} options={[['left', 'Gauche'], ['justify', 'Justifié']]} /></Field>
        <Toggle checked={t.type.hyphenate} onChange={v => tok('type.hyphenate', v)}>Césure automatique</Toggle>
        <Field label="Après paragr."><Range value={t.type.paragraphSpacing} min={0} max={2} step={0.05} unit=" em" onChange={v => tok('type.paragraphSpacing', v)} /></Field>
        <Field label="Avant titres"><Range value={t.type.headingSpaceBefore} min={0.6} max={3.5} step={0.1} unit=" em" onChange={v => tok('type.headingSpaceBefore', v)} /></Field>
      </Section>

      <Section id="colors" icon={<Palette />} title="Couleurs" hint={contrastRows.some(r => !r.ok) ? <span className="badge warning">contraste</span> : undefined}>
        <div className="palette-row">
          {PALETTES.map(([name, p]) => (
            <button key={name} title={name} onClick={() => setSettings(s => ({ ...s, overrides: { ...s.overrides, colors: { ...(s.overrides.colors || {}), ...p } } }))}>
              {Object.values(p).slice(0, 3).map((c, i) => <i key={i} style={{ background: c }} />)}
            </button>
          ))}
        </div>
        {COLOR_GROUPS.filter(([g]) => mode === 'slides' || g !== 'Diapositives').map(([group, keys]) => (
          <div key={group} className="col" style={{ gap: 6 }}>
            <div className="subhead">{group}</div>
            {keys.map(([k, label]) => (
              <Field key={k} label={label}>
                <ColorField value={t.colors[k]} onChange={v => tok('colors.' + k, v)}
                  against={k === 'text' || k === 'muted' || k === 'link' ? t.colors.bg : k === 'codeText' ? t.colors.codeBg : k === 'slideText' ? t.colors.slideBg : undefined} />
              </Field>
            ))}
          </div>
        ))}
        <div className="subhead">Contraste (WCAG)</div>
        <div className="contrast">
          {contrastRows.map(r => (
            <div key={r.label} style={{ display: 'contents' }}>
              <span>{r.label}</span>
              <span className="ratio">{r.ratio?.toFixed(2) ?? '?'} : 1</span>
              <span className={'badge ' + (r.ok ? 'ok' : 'error')}>{r.ok ? 'AA' : `< ${r.min}`}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="layout" icon={<Ruler />} title="Mise en page">
        {mode === 'print' && <PrintLayout settings={settings} resolved={resolved} page={page} tok={tok} />}
        {mode === 'slides' && <SlidesLayout s={resolved.slides} slides={slides} />}
        {mode === 'reading' && (
          <>
            <Field label="Sommaire"><Segmented full value={resolved.reading.toc} onChange={v => reading('toc', v)} options={[['side', 'Latéral'], ['top', 'En tête'], ['none', 'Aucun']]} /></Field>
            <Field label="Couleurs"><Select value={resolved.reading.colorScheme} onChange={v => reading('colorScheme', v)} options={[['template', 'Celles du gabarit'], ['inverse', 'Inversées (clair ↔ sombre)'], ['auto', 'Selon le système du lecteur']]} /></Field>
            <Toggle checked={resolved.reading.progress} onChange={v => reading('progress', v)}>Barre de progression</Toggle>
            <Toggle checked={resolved.reading.search} onChange={v => reading('search', v)}>Recherche dans le document</Toggle>
          </>
        )}
        <div className="subhead">Éléments</div>
        <Field label="Titres"><Select value={t.layout.headingStyle} onChange={v => tok('layout.headingStyle', v)} options={[['plain', 'Simples'], ['rule', 'Filet dessous'], ['bar', 'Barre d\'accent'], ['underline', 'Filet épais dessus']]} /></Field>
        <Field label="Tableaux"><Select value={t.layout.tableStyle} onChange={v => tok('layout.tableStyle', v)} options={[['lines', 'Lignes'], ['zebra', 'Zébrés'], ['grid', 'Grille'], ['minimal', 'Minimal']]} /></Field>
        <Field label="Citations"><Select value={t.layout.quoteStyle} onChange={v => tok('layout.quoteStyle', v)} options={[['rule', 'Bloc teinté'], ['large', 'Grand corps'], ['plain', 'En retrait']]} /></Field>
        <Field label="Puces"><Segmented full value={t.layout.listMarker} onChange={v => tok('layout.listMarker', v)} options={[['disc', '•'], ['dash', '–'], ['square', '■']]} /></Field>
        <Field label="Arrondis"><Range value={t.layout.radius} min={0} max={20} step={1} unit=" px" onChange={v => tok('layout.radius', v)} /></Field>
        <Field label="Densité"><Range value={t.layout.density} min={0.6} max={1.6} step={0.05} onChange={v => tok('layout.density', v)} /></Field>
        <Toggle checked={t.layout.shadow} onChange={v => tok('layout.shadow', v)}>Ombres sur les cartes</Toggle>
        <Toggle checked={t.layout.numbering} onChange={v => tok('layout.numbering', v)}>Numéroter les sections</Toggle>
        {t.layout.numbering && <Field label="Profondeur"><Segmented full value={String(t.layout.numberingDepth)} onChange={v => tok('layout.numberingDepth', +v)} options={[['1', 'H1'], ['2', 'H2'], ['3', 'H3'], ['4', 'H4']]} /></Field>}
      </Section>

      <Section id="components" icon={<Blocks />} title="Composants" hint={selected ? <code style={{ color: '#8a3ffc' }}>{selected.name}</code> : undefined}>
        {selected && <ComponentEditor c={selected} onChange={a => onEditComponent(selected, a)} />}
        <div className="token-help">Cliquez un bloc dans l'aperçu pour régler ses attributs. Tapez <code>:::</code> dans la source pour la complétion.</div>
        <ComponentLibrary onInsert={onInsert} mode={mode} />
      </Section>

      <Section id="media" icon={<ImageIcon />} title="Images et médias">
        <Field label="Alignement"><Segmented full value={t.layout.imageAlign} onChange={v => tok('layout.imageAlign', v)} options={[['center', 'Centré'], ['left', 'Gauche'], ['full', 'Pleine larg.']]} /></Field>
        <div className="token-help">Les fichiers se gèrent dans l'onglet <strong>Fichiers</strong> à gauche. Glissez ou collez une image dans la source pour l'ajouter et l'insérer.</div>
        <button className="btn sm" onClick={() => onInsert(':::image {src="./assets/" alt="" caption=""}\n:::')}><Plus />Insérer une image légendée</button>
      </Section>

      {mode === 'print' && (
        <Section id="hf" icon={<PanelTop />} title="En-têtes et pieds de page">
          <div className="subhead">En-tête</div>
          <div className="hf-grid">{(['left', 'center', 'right'] as const).map(p => <input key={p} className="input" value={resolved.page.header[p]} placeholder={{ left: 'Gauche', center: 'Centre', right: 'Droite' }[p]} onChange={e => page('header', { ...resolved.page.header, [p]: e.target.value })} />)}</div>
          <div className="subhead">Pied de page</div>
          <div className="hf-grid">{(['left', 'center', 'right'] as const).map(p => <input key={p} className="input" value={resolved.page.footer[p]} placeholder={{ left: 'Gauche', center: 'Centre', right: 'Droite' }[p]} onChange={e => page('footer', { ...resolved.page.footer, [p]: e.target.value })} />)}</div>
          <Toggle checked={resolved.page.headerOnFirst} onChange={v => page('headerOnFirst', v)}>En-tête sur la première page de texte</Toggle>
          <div className="token-help">Variables : <code>{'{title}'}</code> <code>{'{author}'}</code> <code>{'{date}'}</code> <code>{'{organization}'}</code> <code>{'{version}'}</code> <code>{'{section}'}</code> (titre courant) <code>{'{page}'}</code> <code>{'{pages}'}</code>.</div>
        </Section>
      )}

      <Section id="export" icon={<Download />} title="Exportation">
        <button className="btn" onClick={() => onExport('pdf')}><Download />PDF {mode === 'slides' ? '(une diapositive par page)' : '(version paginée)'}</button>
        <button className="btn" onClick={() => onExport('html')}><Download />HTML autonome ({mode === 'slides' ? 'diaporama' : mode === 'print' ? 'paginé' : 'lecture'})</button>
        <button className="btn" onClick={() => onExport('zip')}><Download />Paquet complet (.zip)</button>
      </Section>

      <Section id="expert" icon={<Braces />} title="Mode expert">
        <Field label="CSS personnalisé" stack>
          <textarea className="input" rows={8} spellCheck={false} value={settings.customCss} placeholder={'.sd-body h2 { letter-spacing: .02em; }'} onChange={e => setSettings(s => ({ ...s, customCss: e.target.value }), 'css')} />
        </Field>
        <div className="token-help">Appliqué après le gabarit, dans l'aperçu et les exports. <code>@import</code>, <code>url()</code> distantes et balises sont retirés. Variables disponibles : <code>--sd-c-primary</code>, <code>--sd-font-body</code>, <code>--sd-h1</code>…</div>
        <TokensEditor value={settings.overrides} onChange={v => setSettings(s => ({ ...s, overrides: v }))} />
      </Section>
    </div>
  );
}

function PrintLayout({ settings, resolved, page, tok }: { settings: DocSettings; resolved: ReturnType<typeof resolveTheme>; page: any; tok: (p: string, v: unknown) => void }) {
  const p = resolved.page;
  const t = resolved.tokens;
  void settings;
  return (
    <>
      <Field label="Format"><Select value={p.size} onChange={v => page('size', v)} options={[['A4', 'A4 (210 × 297)'], ['A3', 'A3 (297 × 420)'], ['A5', 'A5 (148 × 210)'], ['Letter', 'Letter (US)'], ['Legal', 'Legal (US)'], ['custom', 'Personnalisé']]} /></Field>
      {p.size === 'custom' && (
        <div className="margins" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label>Largeur (mm)<input className="input" type="number" min={50} max={1000} value={p.width} onChange={e => page('width', +e.target.value)} /></label>
          <label>Hauteur (mm)<input className="input" type="number" min={50} max={1000} value={p.height} onChange={e => page('height', +e.target.value)} /></label>
        </div>
      )}
      <Field label="Orientation"><Segmented full value={p.orientation} onChange={v => page('orientation', v)} options={[['portrait', 'Portrait'], ['landscape', 'Paysage']]} /></Field>
      <div className="subhead">Marges (mm)</div>
      <div className="margins">
        {(['top', 'right', 'bottom', 'left'] as const).map(k => (
          <label key={k}>{{ top: 'Haut', right: 'Droite', bottom: 'Bas', left: 'Gauche' }[k]}<input className="input" type="number" min={0} max={80} value={p.margins[k]} onChange={e => page('margins', { ...p.margins, [k]: +e.target.value })} /></label>
        ))}
      </div>
      <Field label="Colonnes"><Segmented full value={String(p.columns)} onChange={v => page('columns', +v as 1 | 2)} options={[['1', 'Une'], ['2', 'Deux']]} /></Field>
      <Field label="Couverture"><Select value={t.layout.cover} onChange={v => tok('layout.cover', v)} options={[['none', 'Aucune (titre en tête)'], ['minimal', 'Sobre'], ['band', 'Bandeau de couleur'], ['full', 'Pleine page'], ['split', 'Grille suisse']]} /></Field>
      <Toggle checked={t.layout.toc} onChange={v => tok('layout.toc', v)}>Sommaire avec numéros de page</Toggle>
      <Toggle checked={p.breakBeforeH1} onChange={v => page('breakBeforeH1', v)}>Chaque titre 1 sur une nouvelle page</Toggle>
      <Toggle checked={p.repeatTableHeaders} onChange={v => page('repeatTableHeaders', v)}>Répéter l'en-tête des tableaux coupés</Toggle>
    </>
  );
}

function SlidesLayout({ s, slides }: { s: SlideSettings; slides: (k: any, v: any) => void }) {
  return (
    <>
      <Field label="Format"><Segmented full value={s.aspect} onChange={v => slides('aspect', v)} options={[['16:9', '16:9'], ['16:10', '16:10'], ['4:3', '4:3'], ['custom', 'Autre']]} /></Field>
      {s.aspect === 'custom' && (
        <div className="margins" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label>Largeur (px)<input className="input" type="number" min={640} max={4096} value={s.width} onChange={e => slides('width', +e.target.value)} /></label>
          <label>Hauteur (px)<input className="input" type="number" min={480} max={4096} value={s.height} onChange={e => slides('height', +e.target.value)} /></label>
        </div>
      )}
      <Field label="Nouvelle slide"><Select value={s.split} onChange={v => slides('split', v)} options={[['h1', 'À chaque titre 1'], ['h2', 'À chaque titre 1 ou 2'], ['h3', 'Jusqu\'au titre 3'], ['manual', 'Seulement :::slide et ---']]} /></Field>
      <Toggle checked={s.ruleSplits} onChange={v => slides('ruleSplits', v)}>Une ligne <code>---</code> coupe la diapositive</Toggle>
      <Field label="Transition"><Select value={s.transition} onChange={v => slides('transition', v)} options={[['none', 'Aucune'], ['fade', 'Fondu'], ['slide', 'Glissement'], ['zoom', 'Zoom']]} /></Field>
      <Toggle checked={s.cover} onChange={v => slides('cover', v)}>Diapositive de couverture</Toggle>
      <Toggle checked={s.numbers} onChange={v => slides('numbers', v)}>Numéros et pied de diapositive</Toggle>
      <Toggle checked={s.progress} onChange={v => slides('progress', v)}>Barre de progression</Toggle>
      <Field label="Conclusion"><input className="input" value={s.closing} placeholder="ex. Merci — aucune si vide" onChange={e => slides('closing', e.target.value)} /></Field>
    </>
  );
}

function ComponentEditor({ c, onChange }: { c: ComponentNode; onChange: (a: Record<string, string | true>) => void }) {
  const spec = BY_NAME.get(c.given.toLowerCase())?.spec;
  if (!spec) return <div className="note warn">Composant inconnu « {c.given} » : vérifiez son nom dans la bibliothèque ci-dessous.</div>;
  const set = (k: string, v: string | boolean) => {
    const next: Record<string, string | true> = { ...c.attrs };
    const implied = BY_NAME.get(c.given.toLowerCase())?.implied || {};
    for (const ik of Object.keys(implied)) if (next[ik] === implied[ik]) delete next[ik];
    if (v === false || v === '') delete next[k]; else next[k] = v;
    onChange(next);
  };
  return (
    <div className="comp-selected">
      <div className="head"><code>:::{c.given}</code><span className="faint" style={{ fontWeight: 400 }}>ligne {c.line}</span></div>
      {Object.keys(spec.attrs).length === 0 && <div className="faint" style={{ fontSize: 12 }}>Aucun attribut.</div>}
      {Object.entries(spec.attrs).map(([k, a]) => {
        const v = c.attrs[k];
        if (a.type === 'boolean') return <Toggle key={k} title={a.description} checked={v === true || v === 'true'} onChange={x => set(k, x)}>{k}</Toggle>;
        if (a.type === 'enum') return <Field key={k} label={k} title={a.description}><Select value={String(v ?? a.default ?? '')} onChange={x => set(k, x)} options={a.values!.map(x => [x, x] as [string, string])} /></Field>;
        return <Field key={k} label={k + (a.required ? ' *' : '')} title={a.description}><input className="input" defaultValue={String(v ?? '')} key={String(v)} placeholder={a.default || ''} onBlur={e => e.target.value !== String(v ?? '') && set(k, e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></Field>;
      })}
      <div className="token-help">{spec.targets.reading === spec.targets.print ? spec.targets.reading : <>Lecture : {spec.targets.reading} Impression : {spec.targets.print} Diaporama : {spec.targets.slides}</>}</div>
    </div>
  );
}

function ComponentLibrary({ onInsert, mode }: { onInsert: (t: string) => void; mode: string }) {
  const cats = ['Contenu', 'Mise en page', 'Présentation', 'Rapport'] as const;
  const order = mode === 'slides' ? ['Présentation', 'Mise en page', 'Contenu', 'Rapport'] : cats;
  return (
    <>
      {order.map(cat => (
        <div key={cat}>
          <div className="subhead">{cat}</div>
          {COMPONENTS.filter(c => c.category === cat && !c.parent).map(c => (
            <div key={c.name} className="comp-item" title={c.description} onClick={() => onInsert(c.example)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onInsert(c.example)}>
              <span className="name">{c.name}</span><span className="label grow">{c.label}</span><Plus size={14} className="faint" />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function TokensEditor({ value, onChange }: { value: unknown; onChange: (v: any) => void }) {
  const text = JSON.stringify(value || {}, null, 2);
  return (
    <Field label="Variables surchargées (JSON)" stack>
      <textarea className="input" rows={6} spellCheck={false} defaultValue={text} key={text}
        onBlur={e => { try { const v = JSON.parse(e.target.value || '{}'); if (JSON.stringify(v) !== JSON.stringify(value)) onChange(v); } catch { useStudio.getState().toast('JSON invalide : modification ignorée.', 'error'); } }} />
    </Field>
  );
}

function countLeaves(o: unknown): number {
  if (!o || typeof o !== 'object') return o === undefined ? 0 : 1;
  return Object.values(o).reduce((n: number, v) => n + countLeaves(v), 0);
}

