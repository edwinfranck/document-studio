import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { FONT_FAMILIES, fontFaceCss } from '@studio/engine';
import { api, collab, initBackend, shareState, type Me } from './api.ts';
import { loadKatex } from './env.ts';
import { useStudio } from './store.ts';
import { Library } from './Library.tsx';
import { Workspace } from './Workspace.tsx';
import { AuthScreen } from './AuthScreen.tsx';

const route = () => { const m = /^#\/doc\/([\w-]+)/.exec(location.hash); return m ? m[1] : null; };
const shareRoute = () => /^#\/s\/([\w-]+)/.exec(location.hash)?.[1] || null;

/** Jeton de lien mémorisé par document, pour qu'un rechargement de page garde l'accès. */
const rememberShare = (docId: string, token: string) => { try { sessionStorage.setItem('sd-share-' + docId, token); } catch { /* stockage indisponible */ } };
const recallShare = (docId: string) => { try { return sessionStorage.getItem('sd-share-' + docId) || ''; } catch { return ''; } };

export function App() {
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<{ need: boolean; first: boolean; guest?: { docName: string; requireLogin: boolean; token: string; docId?: string } } | null>(null);
  const me = useStudio(s => s.me);

  const boot = async () => {
    const be = await initBackend();
    if (!be.collab) { setReady(true); return; }
    const st = await collab.state();
    useStudio.setState({ me: st.me });
    const token = shareRoute();
    if (token) {
      try {
        const s = await collab.share(token);
        if (st.me) { shareState.token = token; rememberShare(s.docId, token); location.hash = `#/doc/${s.docId}`; }
        else { setAuth({ need: true, first: false, guest: { docName: s.name, requireLogin: false, token, docId: s.docId } }); setReady(true); return; }
      } catch (e: any) {
        if (/connecter/.test(e.message)) { setAuth({ need: true, first: false, guest: { docName: 'un document', requireLogin: true, token } }); setReady(true); return; }
        useStudio.getState().toast(e.message, 'error');
        location.hash = '#/';
      }
    }
    const id = route();
    if (id && !shareState.token) shareState.token = recallShare(id);
    if (!st.me && !shareState.token) setAuth({ need: true, first: !st.hasUsers });
    setReady(true);
  };
  useEffect(() => { boot(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <div className="empty" style={{ height: '100%' }}><span className="spin" /></div>;
  if (auth?.need && !me) {
    return (
      <AuthScreen first={auth.first} guest={auth.guest && {
        docName: auth.guest.docName, requireLogin: auth.guest.requireLogin,
        onGuest: name => {
          shareState.token = auth.guest!.token; shareState.guestName = name;
          rememberShare(auth.guest!.docId!, auth.guest!.token);
          setAuth(null);
          location.hash = `#/doc/${auth.guest!.docId}`;
        },
      }}
        onDone={(m: Me | null) => {
          useStudio.setState({ me: m });
          setAuth(null);
          const t = auth.guest?.token;
          if (t) { location.hash = `#/s/${t}`; boot(); }
        }} />
    );
  }
  return <Studio />;
}

function Studio() {
  const [docId, setDocId] = useState<string | null>(route);
  const [loading, setLoading] = useState(false);
  const { doc, open, close, toasts, loadTemplates, toast, me } = useStudio();

  useEffect(() => {
    if (me || !api.backend.collab) loadTemplates();
    // Polices du moteur, pour afficher chaque choix de police dans sa propre fonte.
    const st = document.createElement('style');
    st.textContent = fontFaceCss(FONT_FAMILIES.map(f => f.family), f => `/fonts/${f}`).replace(/font-display:block/g, 'font-display:swap');
    document.head.appendChild(st);
    loadKatex();
    try { document.documentElement.dataset.ui = JSON.parse(localStorage.getItem('sd-ui') || '"light"'); } catch { /* défaut : clair */ }
    const onHash = () => {
      const t = shareRoute();
      if (t) { location.reload(); return; }        // nouveau lien : on repasse par la porte d'entrée
      setDocId(route());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!docId) { close(); document.title = 'Document Studio'; return; }
    if (doc?.id === docId) return;
    if (!shareState.token) shareState.token = recallShare(docId);
    setLoading(true);
    api.get(docId).then(d => { open(d); document.title = `${d.name} · Document Studio`; }, e => { toast(e.message, 'error'); location.hash = '#/'; }).finally(() => setLoading(false));
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un invité par lien n'a pas de bibliothèque : il ne voit que le document partagé.
  const guestOnly = api.backend.collab && !me;
  return (
    <>
      {!docId && !guestOnly && <Library onOpen={id => { shareState.token = ''; location.hash = `#/doc/${id}`; }} />}
      {!docId && guestOnly && <div className="empty" style={{ height: '100%' }}><h2>Lien de partage requis</h2><p>Ouvrez le lien qu'on vous a envoyé.</p></div>}
      {docId && doc?.id === docId && <Workspace key={docId} onBack={() => { location.hash = guestOnly ? location.hash : '#/'; }} />}
      {docId && loading && <div className="empty" style={{ height: '100%' }}><span className="spin" /></div>}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.kind === 'error' ? <AlertCircle /> : <CheckCircle2 />}{t.text}</div>)}
      </div>
    </>
  );
}
