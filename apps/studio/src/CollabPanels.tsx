// Panneaux collaboratifs : présences, commentaires et suggestions, historique et comparaison,
// activité, notifications, validation.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AtSign, Bell, Check, CheckCheck, ChevronDown, CircleDot, Clock, Eye, FileClock, GitCompare, History, MessageSquare,
  PenLine, RotateCcw, Save, Send, ShieldCheck, SquareDashedMousePointer, Tag, ThumbsDown, ThumbsUp, UserPlus, X,
} from 'lucide-react';
import { lineDiff, settingsDiff, WORKFLOW_LABELS, type DiffLine, type WorkflowTemplate } from '@studio/engine';
import { collab, type Comment, type Member, type Me, type Notification, type Role, type VersionInfo, type Workflow } from './api.ts';
import type { Provider, Peer } from './collabClient.ts';
import { useStudio } from './store.ts';
import { Menu, Modal, Segmented, Select, Toggle, fmtDate } from './ui.tsx';

export const canDo = {
  comment: (r?: Role | null) => r === 'commenter' || r === 'editor' || r === 'owner',
  edit: (r?: Role | null) => r === 'editor' || r === 'owner',
  owner: (r?: Role | null) => r === 'owner',
};

const initials = (n: string) => n.replace(/\(.*\)/, '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
export function Avatar({ name, color, size = 26, title }: { name: string; color: string; size?: number; title?: string }) {
  return <span className="avatar" title={title || name} style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}>{initials(name)}</span>;
}

/* ---------- Présences ---------- */

export function Presence({ provider, onJump }: { provider: Provider; onJump: (line: number) => void }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => provider.subscribe(() => setPeers(provider.peers())), [provider]);
  const seen = new Map<string, Peer>();
  for (const p of peers) seen.set(p.userId || String(p.clientId), p);
  const list = [...seen.values()];
  if (!list.length) return null;
  return (
    <div className="presence" aria-label={`${list.length} autre(s) personne(s) sur ce document`}>
      {list.slice(0, 4).map(p => (
        <button key={p.clientId} className="presence-item" onClick={() => p.line && onJump(p.line)} title={`${p.name}${p.line ? ` · ligne ${p.line}` : ''}`}>
          <Avatar name={p.name} color={p.color} size={26} />
        </button>
      ))}
      {list.length > 4 && <span className="presence-more">+{list.length - 4}</span>}
    </div>
  );
}

export function SyncState({ provider }: { provider: Provider }) {
  const [, force] = useState(0);
  useEffect(() => provider.subscribe(() => force(x => x + 1)), [provider]);
  const s = provider.status;
  const label = s === 'synced' ? 'Synchronisé' : s === 'connecting' ? 'Connexion…' : s === 'denied' ? 'Accès retiré' : provider.pending ? 'Hors ligne · modifications en attente' : 'Hors ligne';
  return <span className={'sync sync-' + s + (provider.pending ? ' pending' : '')} title={s === 'offline' ? 'Vos modifications sont gardées sur cet appareil et seront envoyées à la reconnexion.' : label}><span className="sync-dot" />{label}</span>;
}

/* ---------- Saisie avec mentions ---------- */

function MentionBox({ value, onChange, members, onMention, placeholder, onSubmit, autoFocus }: {
  value: string; onChange: (v: string) => void; members: Member[]; onMention: (userId: string) => void; placeholder: string; onSubmit: () => void; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const people = members.filter(m => m.user).map(m => m.user!) as Me[];
  const matches = query === null ? [] : people.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const detect = (v: string, caret: number) => {
    const m = /(^|\s)@([\p{L}\w-]*)$/u.exec(v.slice(0, caret));
    setQuery(m ? m[2] : null); setHi(0);
  };
  const pick = (u: Me) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\p{L}\w-]*)$/u, `@${u.name} `);
    onChange(before + value.slice(caret));
    onMention(u.id);
    setQuery(null);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = before.length; }, 0);
  };
  return (
    <div className="mention-box">
      <textarea ref={ref} className="input" rows={2} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={e => {
          if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setHi(h => (h + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
          if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[hi]); return; }
          if (e.key === 'Escape') setQuery(null);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit(); }
        }} />
      {matches.length > 0 && (
        <div className="mention-list" role="listbox">
          {matches.map((u, i) => <div key={u.id} role="option" aria-selected={i === hi} className={'listbox-opt' + (i === hi ? ' hi' : '')} onMouseDown={e => { e.preventDefault(); pick(u); }}><Avatar name={u.name} color={u.color} size={20} />{u.name}</div>)}
        </div>
      )}
    </div>
  );
}

const renderBody = (body: string, members: Member[]) => {
  const names = members.map(m => m.user?.name).filter(Boolean) as string[];
  if (!names.length) return body;
  const re = new RegExp(`(@(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return body.split(re).map((part, i) => (re.test(part) ? <span key={i} className="mention">{part}</span> : <span key={i}>{part}</span>));
};

/* ---------- Commentaires et suggestions ---------- */

export interface Selection { from: number; to: number; text: string; line: number }
export interface ZoneSel { page: number; rect: { x: number; y: number; w: number; h: number }; line: number; excerpt: string }

export function CommentsPanel({ docId, provider, role, members, comments, reload, getSelection, onJump, activeId, setActiveId, zone, clearZone, onStartZone }: {
  docId: string; provider: Provider; role: Role; members: Member[]; comments: Comment[]; reload: () => void;
  getSelection: () => Selection | null; onJump: (c: Comment) => void; activeId: string | null; setActiveId: (id: string | null) => void;
  /** Zone tracée sur une page imprimée, en attente de commentaire. */
  zone?: ZoneSel | null; clearZone?: () => void; onStartZone?: () => void;
}) {
  const me = useStudio(s => s.me);
  const mode = useStudio(s => s.settings.mode);
  const currentSlide = useStudio(s => s.currentSlide);
  const toast = useStudio(s => s.toast);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'suggestions' | 'mine' | 'mentions'>('open');
  const [draft, setDraft] = useState<{ kind: 'comment' | 'suggestion'; sel: Selection | null; zone?: ZoneSel; body: string; replacement: string; mentions: string[] } | null>(null);
  useEffect(() => { if (zone) setDraft({ kind: 'comment', sel: null, zone, body: '', replacement: '', mentions: [] }); }, [zone]);
  const cancel = () => { setDraft(null); clearZone?.(); };
  const myId = me?.id || provider.me?.userId;

  const shown = comments.filter(c =>
    filter === 'open' ? c.status === 'open' :
    filter === 'resolved' ? c.status !== 'open' :
    filter === 'suggestions' ? c.kind === 'suggestion' && c.status === 'open' :
    filter === 'mine' ? c.assignee === myId && c.status === 'open' :
    c.mentions.includes(myId || '-'));
  const counts = { open: comments.filter(c => c.status === 'open').length, suggestions: comments.filter(c => c.kind === 'suggestion' && c.status === 'open').length };

  const start = (kind: 'comment' | 'suggestion') => {
    const sel = getSelection();
    if (kind === 'suggestion' && !sel) { toast('Sélectionnez dans la source le passage à modifier, ou placez le curseur à l\'endroit où insérer.', 'error'); return; }
    setDraft({ kind, sel, body: '', replacement: kind === 'suggestion' && sel ? sel.text : '', mentions: [] });
  };
  const submit = async () => {
    if (!draft) return;
    const s = draft.sel;
    const z = draft.zone;
    const anchor = z ? { quote: '', line: z.line || 1, page: z.page, rect: z.rect, excerpt: z.excerpt }
      : s ? { ...provider.anchor(s.from, s.to), quote: s.text, line: s.line } : { quote: '', line: 1 };
    try {
      await collab.addComment(docId, {
        kind: draft.kind, body: draft.body, replacement: draft.kind === 'suggestion' ? draft.replacement : undefined, mentions: draft.mentions,
        anchor: { ...anchor, slide: mode === 'slides' && !z ? currentSlide + 1 : undefined },
      });
      cancel(); reload();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="side-panel">
      {canDo.comment(role) && !draft && (
        <div className="row panel-actions">
          <button className="btn sm grow" onClick={() => start('comment')}><MessageSquare />Commenter</button>
          <button className="btn sm grow" onClick={() => start('suggestion')} title="Proposer un texte de remplacement sans modifier le document"><PenLine />Suggérer</button>
          {onStartZone && <button className="btn sm grow" onClick={onStartZone} title="Tracer un rectangle sur une page imprimée et la commenter"><SquareDashedMousePointer />Zone</button>}
        </div>
      )}
      {draft && (
        <div className="thread draft">
          <div className="thread-quote">{draft.zone ? <><span className="badge">Page {draft.zone.page}</span> {draft.zone.excerpt ? `« ${draft.zone.excerpt.slice(0, 120)} »` : 'zone sans texte'}</> : draft.sel ? (draft.sel.text ? `« ${draft.sel.text.slice(0, 160)} »` : `Insertion ligne ${draft.sel.line}`) : `Commentaire général${mode === 'slides' ? ` · diapositive ${currentSlide + 1}` : ''}`}</div>
          {draft.kind === 'suggestion' && (
            <textarea className="input" rows={3} value={draft.replacement} placeholder="Texte proposé (vide = supprimer le passage)" onChange={e => setDraft({ ...draft, replacement: e.target.value })} autoFocus />
          )}
          <MentionBox value={draft.body} onChange={v => setDraft({ ...draft, body: v })} members={members} onMention={u => setDraft(d => d && { ...d, mentions: [...new Set([...d.mentions, u])] })}
            placeholder={draft.kind === 'suggestion' ? 'Pourquoi ce changement ? (facultatif) · @ pour mentionner' : 'Votre commentaire · @ pour mentionner'} onSubmit={submit} autoFocus={draft.kind === 'comment'} />
          <div className="row"><div className="grow" /><button className="btn sm ghost" onClick={cancel}>Annuler</button><button className="btn sm primary" onClick={submit} disabled={draft.kind === 'comment' && !draft.body.trim()}><Send />Envoyer</button></div>
        </div>
      )}
      <div className="chips">
        {([['open', `Ouverts ${counts.open || ''}`], ['suggestions', `Suggestions ${counts.suggestions || ''}`], ['mine', 'Assignés à moi'], ['mentions', 'Mentions'], ['resolved', 'Traités']] as const).map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="threads">
        {!shown.length && <div className="empty-small">{filter === 'open' ? 'Aucun commentaire ouvert.' : 'Rien ici.'}</div>}
        {shown.map(c => <Thread key={c.id} c={c} docId={docId} provider={provider} role={role} members={members} reload={reload} active={activeId === c.id} onFocus={() => { setActiveId(c.id); onJump(c); }} />)}
      </div>
    </div>
  );
}

function Thread({ c, docId, provider, role, members, reload, active, onFocus }: { c: Comment; docId: string; provider: Provider; role: Role; members: Member[]; reload: () => void; active: boolean; onFocus: () => void }) {
  const toast = useStudio(s => s.toast);
  const me = useStudio(s => s.me);
  const [reply, setReply] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const range = c.anchor.start ? provider.resolve(c.anchor) : null;
  const current = range ? provider.text.toString().slice(range.from, range.to) : '';
  // Ancre obsolète : le passage a été supprimé ou réécrit depuis.
  const stale = !!c.anchor.quote && (!range || current !== c.anchor.quote);
  const act = (p: Promise<unknown>) => p.then(reload, (e: any) => toast(e.message, 'error'));
  const assignee = members.find(m => m.userId === c.assignee)?.user;
  const people = members.filter(m => m.user);
  const isAuthor = c.author === (me?.id || provider.me?.userId);
  return (
    <div className={'thread' + (active ? ' active' : '') + (c.status !== 'open' ? ' done' : '')} onClick={onFocus}>
      <div className="thread-head">
        <Avatar name={c.authorName} color={members.find(m => m.userId === c.author)?.user?.color || '#8a8b93'} size={22} />
        <strong className="grow">{c.authorName}</strong>
        <span className="faint">{fmtDate(c.at)}</span>
      </div>
      {(c.anchor.quote || c.anchor.slide || c.anchor.page) && (
        <div className={'thread-quote' + (stale ? ' stale' : '')}>
          {c.anchor.slide ? <span className="badge">Diapositive {c.anchor.slide}</span> : null}
          {c.anchor.page ? <span className="badge" title="Zone d'une page imprimée"><SquareDashedMousePointer />Page {c.anchor.page}</span> : null}
          {' '}{c.anchor.quote ? `« ${c.anchor.quote.slice(0, 160)} »` : c.anchor.excerpt ? `« ${c.anchor.excerpt.slice(0, 120)} »` : ''}
          {stale && <span className="badge warning" title="Le passage a été modifié ou supprimé depuis.">Passage modifié</span>}
        </div>
      )}
      {c.kind === 'suggestion' && (
        <div className="suggestion">
          <span className="sug-del">{c.anchor.quote || '(insertion)'}</span>
          <span className="sug-ins">{c.replacement || '(suppression)'}</span>
        </div>
      )}
      {c.body && <div className="thread-body">{renderBody(c.body, members)}</div>}
      {c.replies.map(r => (
        <div key={r.id} className="reply"><strong>{r.authorName}</strong> <span className="faint">{fmtDate(r.at)}</span><div>{renderBody(r.body, members)}</div></div>
      ))}
      <div className="thread-meta">
        {c.status !== 'open' && <span className={'badge ' + (c.status === 'accepted' ? 'ok' : c.status === 'rejected' ? 'error' : '')}>{{ resolved: 'Résolu', accepted: 'Acceptée', rejected: 'Refusée', open: '' }[c.status]}</span>}
        {assignee && <span className="badge"><UserPlus />{assignee.name}</span>}
      </div>
      {active && (
        <div className="thread-actions" onClick={e => e.stopPropagation()}>
          {c.status === 'open' && canDo.comment(role) && (
            <>
              <MentionBox value={reply} onChange={setReply} members={members} onMention={u => setMentions(m => [...m, u])} placeholder="Répondre · @ pour mentionner"
                onSubmit={() => reply.trim() && act(collab.reply(docId, c.id, reply, mentions).then(() => { setReply(''); setMentions([]); }))} />
              <div className="row wrap">
                {reply.trim() && <button className="btn sm primary" onClick={() => act(collab.reply(docId, c.id, reply, mentions).then(() => { setReply(''); setMentions([]); }))}><Send />Répondre</button>}
                {c.kind === 'suggestion' && canDo.edit(role) && <>
                  <button className="btn sm" onClick={() => act(collab.decide(docId, c.id, 'accept'))} disabled={stale} title={stale ? 'Le passage a changé : relisez avant d\'appliquer' : ''}><ThumbsUp />Accepter</button>
                  <button className="btn sm" onClick={() => act(collab.decide(docId, c.id, 'reject'))}><ThumbsDown />Refuser</button>
                </>}
                {c.kind === 'comment' && (isAuthor || canDo.edit(role)) && <button className="btn sm" onClick={() => act(collab.patchComment(docId, c.id, { status: 'resolved' }))}><Check />Résoudre</button>}
                {canDo.edit(role) && people.length > 0 && (
                  <Menu trigger={t => <button className="btn sm ghost" onClick={t}><UserPlus />{assignee ? 'Réassigner' : 'Assigner'}</button>}>
                    {close => <>
                      {people.map(m => <button key={m.userId} onClick={() => { close(); act(collab.patchComment(docId, c.id, { assignee: m.userId })); }}><span className="row"><Avatar name={m.user!.name} color={m.user!.color} size={20} />{m.user!.name}</span></button>)}
                      {assignee && <button onClick={() => { close(); act(collab.patchComment(docId, c.id, { assignee: null })); }}><X /><span>Retirer l'assignation</span></button>}
                    </>}
                  </Menu>
                )}
              </div>
            </>
          )}
          {c.status !== 'open' && c.kind === 'comment' && (isAuthor || canDo.edit(role)) && <button className="btn sm" onClick={() => act(collab.patchComment(docId, c.id, { status: 'open' }))}><RotateCcw />Rouvrir</button>}
        </div>
      )}
    </div>
  );
}

/* ---------- Historique et comparaison ---------- */

export function HistoryPanel({ docId, role, onRestored }: { docId: string; role: Role; onRestored: () => void }) {
  const toast = useStudio(s => s.toast);
  const provider = useStudio(s => s.provider);
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [diff, setDiff] = useState<{ a: number | 'current'; b: number | 'current' } | null>(null);
  const [label, setLabel] = useState('');
  const load = () => collab.versions(docId).then(setList, e => toast(e.message, 'error'));
  useEffect(() => { load(); return provider?.onEvent(e => { if (e.type === 'versions') load(); }); }, [docId, provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (n: number) => setSel(s => (s.includes(n) ? s.filter(x => x !== n) : [...s.slice(-1), n]));
  return (
    <div className="side-panel">
      {canDo.edit(role) && (
        <form className="row panel-actions" onSubmit={e => { e.preventDefault(); collab.nameVersion(docId, label).then(() => { setLabel(''); load(); toast('Version enregistrée.'); }, (er: any) => toast(er.message, 'error')); }}>
          <input className="input grow" placeholder="Nommer l'état actuel (ex. Envoyé au comité)" value={label} onChange={e => setLabel(e.target.value)} />
          <button className="btn sm" type="submit"><Tag />Enregistrer</button>
        </form>
      )}
      <div className="hint-line faint">Cochez deux versions pour les comparer.</div>
      {sel.length === 2 && <button className="btn sm accent" onClick={() => setDiff({ a: Math.min(...sel), b: Math.max(...sel) })}><GitCompare />Comparer v{Math.min(...sel)} et v{Math.max(...sel)}</button>}
      {list === null && <div className="empty-small"><span className="spin" /></div>}
      <div className="versions">
        {list?.map((v, i) => (
          <div key={v.n} className={'version' + (sel.includes(v.n) ? ' selected' : '')}>
            <button className="version-check" aria-pressed={sel.includes(v.n)} onClick={() => toggle(v.n)} aria-label={`Sélectionner la version ${v.n}`}>{sel.includes(v.n) && <Check />}</button>
            <div className="grow">
              <div className="row"><strong>v{v.n}</strong>{v.label && <span className="badge">{v.label}</span>}{v.kind === 'restore' && <span className="badge warning">restauration</span>}{v.kind === 'merge' && <span className="badge">fusion</span>}<span className="faint grow" style={{ textAlign: 'right' }}>{fmtDate(v.at)}</span></div>
              <div className="faint">{v.authorNames.join(', ') || 'Auteur inconnu'}</div>
              <div className="version-summary">{v.summary}</div>
              <div className="row wrap">
                {list[i + 1] && <button className="btn sm ghost" onClick={() => setDiff({ a: list[i + 1].n, b: v.n })}><GitCompare />Changements</button>}
                <button className="btn sm ghost" onClick={() => setDiff({ a: v.n, b: 'current' })}><Eye />Comparer à l'actuel</button>
                {canDo.owner(role) && i > 0 && (
                  <button className="btn sm ghost" onClick={() => { if (confirm(`Restaurer la version ${v.n} ? Une nouvelle version est créée ; rien n'est effacé.`)) collab.restore(docId, v.n).then(() => { load(); onRestored(); toast(`Version ${v.n} restaurée.`); }, (e: any) => toast(e.message, 'error')); }}><RotateCcw />Restaurer</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {diff && <DiffModal docId={docId} a={diff.a} b={diff.b} onClose={() => setDiff(null)} />}
    </div>
  );
}

export function DiffModal({ docId, a, b, onClose, title }: { docId: string; a: number | 'current' | string; b: number | 'current' | string; onClose: () => void; title?: string }) {
  const { markdown, settings } = useStudio();
  const [va, setVa] = useState<{ markdown: string; settings: any; label: string } | null>(null);
  const [vb, setVb] = useState<{ markdown: string; settings: any; label: string } | null>(null);
  const [tab, setTab] = useState<'text' | 'settings'>('text');
  const [context, setContext] = useState(true);
  useEffect(() => {
    const get = async (x: number | 'current' | string) =>
      x === 'current' ? { markdown, settings, label: 'version actuelle' }
        : typeof x === 'string' ? { markdown: x, settings: {}, label: 'résultat' }
        : collab.version(docId, x).then(v => ({ markdown: v.markdown, settings: v.settings, label: `v${v.n}` }));
    get(a).then(setVa); get(b).then(setVb);
  }, [docId, a, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (va && vb ? lineDiff(va.markdown, vb.markdown) : []), [va, vb]);
  const sdiff = useMemo(() => (va && vb ? settingsDiff(va.settings, vb.settings) : []), [va, vb]);
  const changed = lines.filter(l => l.kind !== 'same').length;
  // Lignes inchangées repliées, sauf deux lignes de contexte autour des changements.
  const visible = context ? lines.map((l, i) => l.kind !== 'same' || lines.slice(Math.max(0, i - 2), i + 3).some(x => x.kind !== 'same')) : lines.map(() => true);
  return (
    <Modal wide title={title || <>Changements · {va?.label} → {vb?.label}</>} onClose={onClose}
      actions={<Segmented value={tab} onChange={setTab} options={[['text', `Texte (${changed})`], ['settings', `Mise en forme (${sdiff.length})`]]} />}>
      {!va || !vb ? <div className="empty-small"><span className="spin" /></div> : tab === 'text' ? (
        <div className="diff-wrap">
          <div className="row diff-toolbar"><Toggle checked={context} onChange={setContext}>Masquer les lignes inchangées</Toggle><span className="legend"><span className="sug-ins">ajout</span><span className="sug-del">suppression</span></span></div>
          {changed === 0 && <div className="empty-small">Le texte est identique.</div>}
          <div className="diff">
            {lines.map((l, i) => {
              if (!visible[i]) return i > 0 && visible[i - 1] ? <div key={i} className="diff-gap">…</div> : null;
              return <DiffRow key={i} l={l} />;
            })}
          </div>
        </div>
      ) : (
        <div className="diff-wrap">
          {!sdiff.length && <div className="empty-small">Aucun changement de mise en forme.</div>}
          <table className="settings-diff"><tbody>
            {sdiff.map(d => <tr key={d.path}><td className="mono">{d.path}</td><td className="sug-del">{JSON.stringify(d.before) ?? '—'}</td><td className="sug-ins">{JSON.stringify(d.after) ?? '—'}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </Modal>
  );
}

function DiffRow({ l }: { l: DiffLine }) {
  return (
    <div className={'diff-line diff-' + l.kind}>
      <span className="diff-n">{l.old ?? ''}</span><span className="diff-n">{l.new ?? ''}</span>
      <span className="diff-text">{l.parts.map((p, i) => <span key={i} className={p.kind === 'added' ? 'sug-ins' : p.kind === 'removed' ? 'sug-del' : ''}>{p.text}</span>)}{!l.parts.some(p => p.text) && ' '}</span>
    </div>
  );
}

/* ---------- Activité ---------- */

export function ActivityPanel({ docId }: { docId: string }) {
  const provider = useStudio(s => s.provider);
  const [list, setList] = useState<import('./api.ts').Activity[] | null>(null);
  const load = () => collab.activity(docId).then(setList, () => setList([]));
  useEffect(() => { load(); return provider?.onEvent(() => load()); }, [docId, provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = new Map<string, typeof list>();
  for (const a of list || []) {
    const day = new Date(a.at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    groups.set(day, [...(groups.get(day) || []), a]);
  }
  return (
    <div className="side-panel">
      {list === null && <div className="empty-small"><span className="spin" /></div>}
      {list?.length === 0 && <div className="empty-small">Aucune activité.</div>}
      {[...groups.entries()].map(([day, items]) => (
        <div key={day}>
          <div className="subhead">{day}</div>
          {items!.map((a, i) => (
            <div key={i} className="activity"><Clock size={13} className="faint" /><span className="grow"><strong>{a.actorName}</strong> {a.text}</span><span className="faint">{new Date(a.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- Notifications ---------- */

export function NotificationsBell() {
  const me = useStudio(s => s.me);
  const [list, setList] = useState<Notification[]>([]);
  const load = () => collab.notifications().then(setList, () => {});
  useEffect(() => {
    if (!me) return;
    load();
    const t = setInterval(load, 20000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [me]);
  if (!me) return null;
  const unread = list.filter(n => !n.read).length;
  return (
    <Menu trigger={toggle => (
      <button className="btn ghost icon bell" onClick={() => { toggle(); load(); }} aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`}>
        <Bell />{unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
    )}>
      {close => (
        <div className="notif-menu">
          <div className="row" style={{ padding: '6px 10px' }}><strong className="grow">Notifications</strong>{unread > 0 && <button className="btn sm ghost" style={{ width: 'auto' }} onClick={() => collab.readNotifications('all').then(load)}><CheckCheck />Tout lu</button>}</div>
          {!list.length && <div className="empty-small">Rien de nouveau.</div>}
          {list.slice(0, 30).map(n => (
            <button key={n.id} className={'notif' + (n.read ? '' : ' unread')} onClick={() => { close(); collab.readNotifications([n.id]).then(load); if (n.link) location.hash = n.link.replace(/\?.*$/, ''); }}>
              {!n.read && <CircleDot className="notif-dot" />}<span><span>{n.text}</span><span className="sub">{fmtDate(n.at)}</span></span>
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

/* ---------- Validation ---------- */

const STATE_TONE: Record<string, string> = { draft: '', review: 'info', changes: 'warning', pending: 'info', approved: 'ok', published: 'ok', archived: '' };

export function WorkflowControl({ docId, workflow, role, members, onChange }: { docId: string; workflow: Workflow; role: Role; members: Member[]; onChange: (w: Workflow) => void }) {
  const me = useStudio(s => s.me);
  const toast = useStudio(s => s.toast);
  const [ask, setAsk] = useState(false);
  const [decide, setDecide] = useState<'approved' | 'changes' | null>(null);
  const [note, setNote] = useState('');
  const mine = workflow.reviewers.find(r => r.userId === me?.id);
  const act = (p: Promise<Workflow>) => p.then(onChange, (e: any) => toast(e.message, 'error'));
  const name = (id: string) => members.find(m => m.userId === id)?.user?.name || 'Membre';
  return (
    <>
      <Menu trigger={t => (
        <button className={'btn sm state-badge ' + STATE_TONE[workflow.state]} onClick={t} title="Étape de validation">
          <ShieldCheck />{WORKFLOW_LABELS[workflow.state]}<ChevronDown />
        </button>
      )}>
        {close => (
          <>
            <div className="menu-title">Validation</div>
            {workflow.reviewers.length > 0 && (
              <div className="reviewers">
                {workflow.reviewers.map(r => <div key={r.userId} className="row"><span className="grow">{name(r.userId)}</span><span className={'badge ' + (r.decision === 'approved' ? 'ok' : r.decision === 'changes' ? 'warning' : '')}>{{ pending: 'en attente', approved: 'validé', changes: 'corrections' }[r.decision]}</span></div>)}
                {workflow.requiredApprovals > 0 && <div className="faint" style={{ fontSize: 12 }}>{workflow.requiredApprovals} validation(s) requise(s) pour publier officiellement{workflow.approvedVersion ? ` · validé en v${workflow.approvedVersion}` : ''}</div>}
              </div>
            )}
            {mine && (workflow.state === 'review' || workflow.state === 'pending' || workflow.state === 'changes') && <>
              <button onClick={() => { close(); setDecide('approved'); }}><ThumbsUp /><span>Valider cette version</span></button>
              <button onClick={() => { close(); setDecide('changes'); }}><ThumbsDown /><span>Demander des corrections</span></button>
            </>}
            {canDo.edit(role) && <button onClick={() => { close(); setAsk(true); }}><Send /><span>Demander une relecture<span className="sub">Choisir les relecteurs et les validations requises</span></span></button>}
            {canDo.edit(role) && workflow.state !== 'draft' && <button onClick={() => { close(); act(collab.workflow(docId, { state: 'draft' })); }}><FileClock /><span>Repasser en brouillon</span></button>}
            {canDo.edit(role) && workflow.state === 'changes' && <button onClick={() => { close(); act(collab.workflow(docId, { state: 'pending' })); }}><History /><span>Corrections faites : redemander la validation</span></button>}
            {canDo.owner(role) && workflow.state !== 'archived' && <button onClick={() => { close(); act(collab.workflow(docId, { state: 'archived' })); }}><X /><span>Archiver</span></button>}
          </>
        )}
      </Menu>
      {ask && <ReviewRequest docId={docId} workflow={workflow} role={role} members={members} onClose={() => setAsk(false)} onDone={w => { onChange(w); setAsk(false); toast('Relecture demandée : les relecteurs sont notifiés.'); }} />}
      {decide && (
        <Modal title={decide === 'approved' ? 'Valider cette version' : 'Demander des corrections'} onClose={() => setDecide(null)}
          footer={<><button className="btn" onClick={() => setDecide(null)}>Annuler</button><button className="btn primary" onClick={() => { act(collab.review(docId, decide, note)); setDecide(null); setNote(''); }}>{decide === 'approved' ? <><ThumbsUp />Valider</> : <><ThumbsDown />Envoyer</>}</button></>}>
          <p className="muted" style={{ marginTop: 0 }}>{decide === 'approved' ? 'La validation porte sur la version actuelle du document. Toute modification ultérieure demandera une nouvelle validation avant une publication officielle.' : 'Précisez ce qui doit être corrigé.'}</p>
          <textarea className="input" rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder={decide === 'approved' ? 'Remarque (facultatif)' : 'Corrections attendues'} style={{ width: '100%' }} />
        </Modal>
      )}
    </>
  );
}

function ReviewRequest({ docId, workflow, role, members, onClose, onDone }: { docId: string; workflow: Workflow; role: Role; members: Member[]; onClose: () => void; onDone: (w: Workflow) => void }) {
  const toast = useStudio(s => s.toast);
  const [picked, setPicked] = useState<string[]>(workflow.reviewers.map(r => r.userId));
  const [required, setRequired] = useState(String(workflow.requiredApprovals || Math.max(1, picked.length)));
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [tplName, setTplName] = useState<string | null>(null);
  useEffect(() => { collab.workflowTemplates().then(setTemplates, () => {}); }, []);
  const people = members.filter(m => m.user);
  const useTemplate = (t: WorkflowTemplate) => {
    const known = t.reviewers.filter(r => people.some(m => m.userId === r));
    setPicked(known);
    setRequired(String(Math.min(t.requiredApprovals, known.length)));
    if (known.length < t.reviewers.length) toast(`${t.reviewers.length - known.length} relecteur(s) du modèle n'ont pas accès à ce document : invitez-les d'abord.`, 'error');
  };
  const saveTemplate = () => collab.saveWorkflowTemplate({ name: tplName || '', reviewers: picked, requiredApprovals: Number(required) })
    .then(t => { setTemplates(l => [...l.filter(x => x.id !== t.id), t]); setTplName(null); toast(`Modèle « ${t.name} » enregistré.`); }, (e: any) => toast(e.message, 'error'));
  return (
    <Modal title="Demander une relecture" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!picked.length} onClick={() => collab.workflow(docId, { reviewers: picked, state: 'review', ...(canDo.owner(role) ? { requiredApprovals: Number(required) } : {}) }).then(onDone, (e: any) => toast(e.message, 'error'))}><Send />Envoyer la demande</button></>}>
      {templates.length > 0 && <>
        <div className="subhead" style={{ marginTop: 0 }}>Modèles</div>
        <div className="chips">{templates.map(t => <button key={t.id} className="chip" onClick={() => useTemplate(t)} title={`${t.reviewers.length} relecteur(s) · ${t.requiredApprovals} validation(s)`}>{t.name}</button>)}</div>
      </>}
      <div className="subhead" style={templates.length ? undefined : { marginTop: 0 }}>Relecteurs</div>
      {people.length === 0 && <p className="muted">Invitez d'abord des personnes depuis « Partager ».</p>}
      <div className="col" style={{ gap: 2 }}>
        {people.map(m => <Toggle key={m.userId} checked={picked.includes(m.userId)} onChange={v => setPicked(p => (v ? [...p, m.userId] : p.filter(x => x !== m.userId)))}><span className="row"><Avatar name={m.user!.name} color={m.user!.color} size={22} />{m.user!.name}</span></Toggle>)}
      </div>
      {canDo.owner(role) && (
        <>
          <div className="subhead">Validations requises avant une publication officielle</div>
          <Select value={required} onChange={setRequired} options={['0', '1', '2', '3', '4', '5'].map(n => [n, n === '0' ? 'Aucune (publication libre)' : `${n} validation${n === '1' ? '' : 's'}`] as [string, string])} />
        </>
      )}
      {picked.length > 0 && (tplName === null
        ? <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setTplName('')}><Save />Enregistrer ces relecteurs comme modèle</button>
        : <form className="row" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); saveTemplate(); }}>
            <input className="input grow" autoFocus placeholder="Nom du modèle (ex. Comité pédagogique)" value={tplName} onChange={e => setTplName(e.target.value)} />
            <button className="btn sm" type="submit"><Save />Enregistrer</button>
          </form>)}
    </Modal>
  );
}

export function Section({ children }: { children: ReactNode }) { return <>{children}</>; }
