// Aperçu en direct : deux iframes isolées en alternance, pour remplacer le rendu sans clignotement
// (la nouvelle version n'apparaît qu'une fois prête : paginée, ajustée).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Maximize2, Minus, Monitor, Plus, Smartphone, Tablet } from 'lucide-react';
import type { Target } from '@studio/engine';
import { useStudio } from './store.ts';
import { Segmented, usePersisted } from './ui.tsx';

const MM = 96 / 25.4;

export interface PreviewProps {
  html: string;
  mode: Target;
  pageWidthMm: number;
  slideSize: [number, number];
  scrollRequest: { line: number; n: number } | null;
  onSelect(line: number): void;
}

type Device = 'full' | 'tablet' | 'mobile';

export function Preview({ html, mode, pageWidthMm, slideSize, scrollRequest, onSelect }: PreviewProps) {
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  const stageRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const pending = useRef<{ idx: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const scrollY = useRef(0);
  const slideIdx = useRef(0);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ pages?: number; index?: number; count?: number; overflows?: any[]; error?: string }>({});
  const [zoom, setZoom] = usePersisted<number | 'fit'>('sd-zoom-' + mode, mode === 'reading' ? 1 : 'fit');
  const [device, setDevice] = usePersisted<Device>('sd-device', 'full');
  const [stage, setStage] = useState({ w: 800, h: 600 });

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Écrit le nouveau rendu dans l'iframe cachée.
  useEffect(() => {
    const idx = 1 - activeRef.current;
    const f = frames[idx].current;
    if (!f) return;
    if (pending.current) clearTimeout(pending.current.timer);
    setBusy(true);
    f.srcdoc = html;
    pending.current = { idx, timer: setTimeout(() => swap(idx), mode === 'print' ? 20000 : 4000) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const swap = (idx: number) => {
    if (!pending.current || pending.current.idx !== idx) return;
    clearTimeout(pending.current.timer);
    pending.current = null;
    activeRef.current = idx;
    setActive(idx);
    setBusy(false);
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || !m.sdPreview) return;
      const idx = frames.findIndex(r => r.current?.contentWindow === e.source);
      if (idx < 0) return;
      const win = frames[idx].current!.contentWindow!;
      const isPending = pending.current?.idx === idx;
      const readyType = mode === 'print' ? 'sd:paged' : mode === 'slides' ? 'sd:slides' : 'sd:ready';
      if (m.type === 'sd:ready' && isPending && mode !== 'slides') win.postMessage({ type: 'sd:restore', y: scrollY.current }, '*');
      if (m.type === 'sd:paged') {
        win.postMessage({ type: 'sd:restore', y: scrollY.current }, '*');
        if (isPending || idx === activeRef.current) {
          setInfo({ pages: m.pages, overflows: m.overflows, error: m.error });
          useStudio.setState({ runtime: (m.overflows || []).map((o: any) => ({ line: o.line, severity: 'warning', message: `Page ${o.page} : ${o.kind === 'table' ? 'tableau' : o.kind === 'pre' ? 'bloc de code' : 'élément'} plus large que la zone imprimable.` })) });
        }
      }
      if (m.type === 'sd:slides') {
        if (isPending && m.index !== slideIdx.current && slideIdx.current < m.count) { win.postMessage({ type: 'sd:goto', index: slideIdx.current }, '*'); }
        if (idx === activeRef.current || isPending) {
          if (idx === activeRef.current) slideIdx.current = m.index;
          setInfo({ index: isPending ? Math.min(slideIdx.current, m.count - 1) : m.index, count: m.count, overflows: m.overflows });
          useStudio.setState({ runtime: (m.overflows || []).map((o: { index: number; line: number }) => ({ line: o.line, severity: 'warning', message: `Diapositive ${o.index + 1} : contenu trop long, même réduit à 70 %. Coupez-la en deux.` })) });
        }
      }
      if (isPending && m.type === readyType) {
        if (mode === 'reading') setTimeout(() => swap(idx), 30); else swap(idx);
      }
      if (idx !== activeRef.current) return;
      if (m.type === 'sd:scroll') scrollY.current = m.y;
      if (m.type === 'sd:select') onSelect(m.line);
      if (m.type === 'sd:link' && /^https?:/i.test(m.href)) window.open(m.href, '_blank', 'noopener,noreferrer');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  useEffect(() => { if (mode !== 'print') useStudio.setState({ runtime: [] }); setInfo({}); scrollY.current = 0; slideIdx.current = 0; }, [mode]);

  useEffect(() => {
    if (!scrollRequest) return;
    frames[activeRef.current].current?.contentWindow?.postMessage({ type: 'sd:scrollTo', line: scrollRequest.line, smooth: true }, '*');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  // Géométrie : zoom par mise à l'échelle de l'iframe (le document garde sa largeur réelle).
  const pageW = pageWidthMm * MM + 64;
  const fit = mode === 'print' ? Math.min(2, (stage.w - 8) / pageW) : 1;
  const z = mode === 'slides' ? 1 : zoom === 'fit' ? fit : zoom;
  const devW = mode === 'reading' && device !== 'full' ? (device === 'tablet' ? 820 : 390) : null;
  const w = devW ?? stage.w / z;
  const h = stage.h / z;
  const left = devW ? Math.max(0, (stage.w - devW * z) / 2) : 0;
  const frameStyle = { width: w, height: h, transform: `scale(${z})`, left };
  const setZ = (v: number) => setZoom(Math.round(Math.min(3, Math.max(0.25, v)) * 100) / 100);
  const go = (d: number) => frames[activeRef.current].current?.contentWindow?.postMessage({ type: 'sd:goto', index: (info.index ?? 0) + d }, '*');
  const issues = info.overflows?.length || 0;

  return (
    <>
      <div className="stagebar">
        {mode !== 'slides' && (
          <div className="zoom">
            <button className="btn ghost sm icon" onClick={() => setZ(z - 0.1)} aria-label="Zoom arrière"><Minus /></button>
            <output>{Math.round(z * 100)} %</output>
            <button className="btn ghost sm icon" onClick={() => setZ(z + 0.1)} aria-label="Zoom avant"><Plus /></button>
            <button className="btn ghost sm" aria-pressed={zoom === 'fit' || (mode === 'reading' && zoom === 1)} onClick={() => setZoom(mode === 'print' ? 'fit' : 1)} title={mode === 'print' ? 'Ajuster à la largeur' : 'Taille réelle'}><Maximize2 />{mode === 'print' ? 'Largeur' : 'Taille réelle'}</button>
          </div>
        )}
        {mode === 'reading' && (
          <Segmented value={device} onChange={setDevice} options={[['full', <Monitor />, 'Ordinateur'], ['tablet', <Tablet />, 'Tablette (820 px)'], ['mobile', <Smartphone />, 'Mobile (390 px)']]} />
        )}
        {mode === 'slides' && info.count !== undefined && (
          <div className="row">
            <button className="btn ghost sm icon" onClick={() => go(-1)} aria-label="Diapositive précédente"><ChevronLeft /></button>
            <span className="info">{(info.index ?? 0) + 1} / {info.count}</span>
            <button className="btn ghost sm icon" onClick={() => go(1)} aria-label="Diapositive suivante"><ChevronRight /></button>
            <span className="info faint">{slideSize[0]} × {slideSize[1]}</span>
          </div>
        )}
        <div className="grow" />
        {mode === 'print' && info.pages !== undefined && <span className="info">{info.pages} page{info.pages > 1 ? 's' : ''}</span>}
        {info.error && <span className="badge error">Pagination : {info.error}</span>}
      </div>
      <div className="stage" ref={stageRef}>
        {frames.map((r, i) => (
          <iframe key={i} ref={r} title={i === active ? 'Aperçu du document' : ''} className={i === active ? '' : 'hidden'}
            sandbox="allow-scripts" style={frameStyle} aria-hidden={i !== active} tabIndex={i === active ? 0 : -1} />
        ))}
        {busy && <div className="busy"><span className="spin" />{mode === 'print' ? 'Pagination…' : 'Rendu…'}</div>}
        {issues > 0 && (
          <div className="overflow-note" title="Voir la liste des problèmes"><AlertTriangle />{issues} {mode === 'slides' ? 'diapositive(s) trop chargée(s)' : 'débordement(s)'}</div>
        )}
      </div>
    </>
  );
}
