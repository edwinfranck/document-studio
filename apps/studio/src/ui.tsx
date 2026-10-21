// Primitives d'interface : champs, menus, fenêtres. Une hauteur de contrôle unique (--h).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { contrast } from '@studio/engine';

export function Section({ icon, title, hint, open, children, id }: { icon: ReactNode; title: string; hint?: ReactNode; open?: boolean; children: ReactNode; id?: string }) {
  const key = 'sd-sec-' + (id || title);
  const [isOpen, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? !!open : v === '1'; } catch { return !!open; } });
  return (
    <details className="section" open={isOpen} onToggle={e => { const o = (e.target as HTMLDetailsElement).open; setOpen(o); try { localStorage.setItem(key, o ? '1' : '0'); } catch { /* stockage indisponible */ } }}>
      <summary>{icon}{title}{hint && <span className="hint">{hint}</span>}<ChevronRight className="chev" /></summary>
      {isOpen && <div className="section-body">{children}</div>}
    </details>
  );
}

export function Field({ label, children, stack, title }: { label: string; children: ReactNode; stack?: boolean; title?: string }) {
  return <div className={'field' + (stack ? ' stack' : '')} title={title}><span className="label">{label}</span>{children}</div>;
}

/** Champ glissable : cliquer ou glisser fixe la valeur, double-clic pour la saisir, flèches au clavier. */
export function Range({ value, min, max, step, unit = '', onChange }: { value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const decimals = (String(step).split('.')[1] || '').length;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const fmt = (v: number) => v.toFixed(decimals).replace('-', '−');
  const pct = ((value - min) / (max - min)) * 100;
  const fromX = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(+clamp(min + ((x - r.left) / r.width) * (max - min)).toFixed(decimals));
  };
  return (
    <div ref={ref} className={'scrub' + (editing ? ' editing' : '')} role="slider" tabIndex={0}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} style={{ ['--p' as any]: `${Math.max(0, Math.min(100, pct))}%` }}
      onPointerDown={e => {
        if (editing || e.button !== 0) return;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        fromX(e.clientX);
        const move = (ev: PointerEvent) => fromX(ev.clientX);
        const up = () => { el.classList.remove('dragging'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={e => {
        if (editing) return;
        const k = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(+clamp(value + step * k).toFixed(decimals)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(+clamp(value - step * k).toFixed(decimals)); }
        if (e.key === 'Enter') setEditing(true);
      }}>
      <span className="scrub-fill" />
      <span className="scrub-thumb" />
      {editing ? (
        <input className="scrub-input" autoFocus defaultValue={value} inputMode="decimal"
          onBlur={e => { const v = parseFloat(e.target.value.replace(',', '.').replace('−', '-')); if (!isNaN(v)) onChange(+Math.min(max, Math.max(min, v)).toFixed(decimals)); setEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); e.stopPropagation(); }} />
      ) : <span className="scrub-value">{fmt(value)}<small>{unit.trim()}</small></span>}
    </div>
  );
}

export interface Option<T extends string> { value: T; label: string; hint?: string; group?: string; font?: string }

/** Liste déroulante maison : aperçu de chaque option (polices dans leur fonte), groupes, clavier. */
export function Select<T extends string>({ value, options, onChange, font }: { value: T; options: [T, string][] | Option<T>[]; onChange: (v: T) => void; font?: boolean }) {
  const opts: Option<T>[] = (options as any[]).map(o => (Array.isArray(o) ? { value: o[0], label: o[1] } : o));
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, up: false });
  const current = opts.find(o => o.value === value);
  const show = () => {
    const r = btn.current!.getBoundingClientRect();
    const up = r.bottom + 320 > innerHeight && r.top > 320;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 180), up });
    setHi(Math.max(0, opts.findIndex(o => o.value === value)));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const scroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', off);
    return () => { document.removeEventListener('mousedown', off); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', off); };
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);
  const pick = (o: Option<T>) => { onChange(o.value); setOpen(false); btn.current?.focus(); };
  const key = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(opts.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(opts[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key.length === 1) { const i = opts.findIndex(o => o.label.toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) setHi(i); }
  };
  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} type="button" className="dropdown" aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}>
        <span className="dropdown-label" style={font && current ? { fontFamily: `"${current.value}"` } : undefined}>{current?.label ?? value}</span>
        <ChevronDown className="dropdown-chev" />
      </button>
      {open && createPortal(
        <div ref={list} className="listbox" role="listbox" style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: innerHeight - pos.top } : { top: pos.top }) }}>
          {opts.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? <div className="listbox-group" key={'g' + o.group}>{o.group}</div> : null;
            lastGroup = o.group;
            return [head, (
              <div key={o.value} data-i={i} role="option" aria-selected={o.value === value} className={'listbox-opt' + (i === hi ? ' hi' : '')}
                onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); pick(o); }}>
                <span style={font ? { fontFamily: `"${o.font || o.value}"`, fontSize: 14 } : undefined}>{o.label}</span>
                {o.hint && <span className="listbox-hint">{o.hint}</span>}
                {o.value === value && <Check className="listbox-check" />}
              </div>
            )];
          })}
        </div>, document.body)}
    </>
  );
}

/** Interrupteur : libellé à gauche, bascule à droite. */
export function Toggle({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <span className="grow">{children}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, full }: { value: T; options: [T, ReactNode, string?][]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={'seg' + (full ? ' full' : '')} role="group">
      {options.map(([v, l, title]) => <button key={v} type="button" aria-pressed={value === v} title={title} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

const toHex = (c: string) => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : '#000000';
};

export function ColorField({ value, onChange, against }: { value: string; onChange: (v: string) => void; against?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const ratio = against ? contrast(value, against) : null;
  return (
    <div className="color">
      <input type="color" value={toHex(value)} onChange={e => onChange(e.target.value)} aria-label="Choisir la couleur" />
      <input className="input" value={text} spellCheck={false}
        onChange={e => { setText(e.target.value); if (/^#[0-9a-f]{3,8}$/i.test(e.target.value) || /^rgba?\(/.test(e.target.value)) onChange(e.target.value); }}
        onBlur={() => setText(value)} />
      {ratio !== null && <span className={'badge ' + (ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'warning' : 'error')} title="Contraste avec le fond (WCAG)">{ratio.toFixed(1)}</span>}
    </div>
  );
}

export function Menu({ trigger, children, align = 'right' }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen(o => !o), open)}
      {open && <div className={'menu' + (align === 'left' ? ' left' : '')} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; actions?: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><div className="grow" />{actions}<button className="btn ghost icon" onClick={onClose} aria-label="Fermer"><X /></button></div>
        <div className="modal-body" style={wide ? { padding: 0 } : undefined}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Poignée de redimensionnement d'un panneau. */
export function Resizer({ onDrag }: { onDrag: (dx: number) => void }) {
  const [active, setActive] = useState(false);
  return (
    <div className={'resizer' + (active ? ' active' : '')} role="separator" aria-orientation="vertical"
      onPointerDown={e => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        setActive(true);
        let x = e.clientX;
        const move = (ev: PointerEvent) => { onDrag(ev.clientX - x); x = ev.clientX; };
        const up = () => { setActive(false); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        document.body.style.cursor = 'col-resize';
      }} />
  );
}

export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* stockage indisponible */ } }, [key, v]);
  return [v, setV];
}

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400 && new Date().getDate() === d.getDate()) return `aujourd'hui, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

export const fmtSize = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${Math.round(n / 1024)} Ko` : `${(n / 1048576).toFixed(1)} Mo`);
