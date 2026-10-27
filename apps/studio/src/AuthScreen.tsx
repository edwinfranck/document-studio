// Connexion, création de compte, et entrée d'un invité par lien de partage.
import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { collab, type Me } from './api.ts';

export function AuthScreen({ first, onDone, guest }: { first: boolean; onDone: (me: Me | null) => void; guest?: { docName: string; requireLogin: boolean; onGuest: (name: string) => void } }) {
  const [mode, setMode] = useState<'login' | 'register'>(first ? 'register' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [guestName, setGuestName] = useState(() => { try { return localStorage.getItem('sd-guest-name') || ''; } catch { return ''; } });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = mode === 'register' ? await collab.register({ name, email, password }) : await collab.login({ email, password });
      onDone(r.me);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="logo auth-logo">
          <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="currentColor" /><path d="M9 8h9l5 5v11H9z" fill="none" stroke="var(--panel)" strokeWidth="2" /><path d="M12 17h8M12 21h5" stroke="#e8590c" strokeWidth="2" /></svg>
          Document Studio
        </div>
        {guest && (
          <div className="auth-guest">
            <div className="subhead" style={{ marginTop: 0 }}>Invitation</div>
            <p>On vous a partagé <strong>« {guest.docName} »</strong>.</p>
            {!guest.requireLogin && (
              <form onSubmit={e => { e.preventDefault(); try { localStorage.setItem('sd-guest-name', guestName); } catch { /* stockage indisponible */ } guest.onGuest(guestName.trim() || 'Invité'); }} className="col">
                <input className="input" placeholder="Votre nom (visible des autres)" value={guestName} onChange={e => setGuestName(e.target.value)} autoComplete="name" />
                <button className="btn primary" type="submit">Ouvrir sans compte</button>
              </form>
            )}
            {guest.requireLogin && <p className="muted">Ce lien demande de se connecter.</p>}
            <div className="auth-sep"><span>ou</span></div>
          </div>
        )}
        {first && <p className="muted auth-intro">Créez le compte propriétaire de cet espace. Les documents déjà présents vous seront attribués.</p>}
        <form onSubmit={submit} className="col">
          {mode === 'register' && <input className="input" placeholder="Nom" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required />}
          <input className="input" type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
          <input className="input" type="password" placeholder={mode === 'register' ? 'Mot de passe (8 caractères au moins)' : 'Mot de passe'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required />
          {error && <div className="note warn">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>{mode === 'register' ? <><UserPlus />Créer le compte</> : <><LogIn />Se connecter</>}</button>
        </form>
        {!first && (
          <button className="btn ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter'}
          </button>
        )}
      </div>
    </div>
  );
}
