import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { FONT_FAMILIES, fontFaceCss } from '@studio/engine';
import { api, initBackend } from './api.ts';
import { loadKatex } from './env.ts';
import { useStudio } from './store.ts';
import { Library } from './Library.tsx';
import { Workspace } from './Workspace.tsx';

const route = () => { const m = /^#\/doc\/([\w-]+)/.exec(location.hash); return m ? m[1] : null; };

export function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => { initBackend().then(() => setReady(true)); }, []);
  if (!ready) return <div className="empty" style={{ height: '100%' }}><span className="spin" /></div>;
  return <Studio />;
}

function Studio() {
  const [docId, setDocId] = useState<string | null>(route);
  const [loading, setLoading] = useState(false);
  const { doc, open, close, toasts, loadTemplates, toast } = useStudio();

  useEffect(() => {
    loadTemplates();
    // Polices du moteur, pour afficher chaque choix de police dans sa propre fonte.
    const st = document.createElement('style');
    st.textContent = fontFaceCss(FONT_FAMILIES.map(f => f.family), f => `/fonts/${f}`).replace(/font-display:block/g, 'font-display:swap');
    document.head.appendChild(st);
    loadKatex();
    try { document.documentElement.dataset.ui = JSON.parse(localStorage.getItem('sd-ui') || '"light"'); } catch { /* défaut : clair */ }
    const onHash = () => setDocId(route());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!docId) { close(); document.title = 'Document Studio'; return; }
    if (doc?.id === docId) return;
    setLoading(true);
    api.get(docId).then(d => { open(d); document.title = `${d.name} · Document Studio`; }, e => { toast(e.message, 'error'); location.hash = '#/'; }).finally(() => setLoading(false));
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {!docId && <Library onOpen={id => { location.hash = `#/doc/${id}`; }} />}
      {docId && doc?.id === docId && <Workspace key={docId} onBack={() => { location.hash = '#/'; }} />}
      {docId && loading && <div className="empty" style={{ height: '100%' }}><span className="spin" /></div>}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.kind === 'error' ? <AlertCircle /> : <CheckCircle2 />}{t.text}</div>)}
      </div>
    </>
  );
}
