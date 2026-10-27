// Plugins de composants : déclarés au moteur avant tout rendu (aperçu, exports dans la page, complétion).
import { registerPlugins } from '@studio/engine';
import { api } from './api.ts';
import { useStudio } from './store.ts';

export async function loadPlugins() {
  try {
    const list = api.backend.kind === 'browser' ? JSON.parse(localStorage.getItem('ds-plugins') || '[]') : await api.plugins();
    registerPlugins(Array.isArray(list) ? list : []);
  } catch { /* sans plugins */ }
  useStudio.setState(s => ({ pluginsRev: s.pluginsRev + 1 }));
}
