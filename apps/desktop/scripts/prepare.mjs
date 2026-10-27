// Prépare le contenu embarqué dans l'installable : le serveur avec ses seules dépendances de production
// (pnpm deploy) et l'interface compilée. Résultat dans runtime/, copié dans les ressources de l'application.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(here, '..', 'runtime');
const ui = join(root, 'apps', 'studio', 'dist');
if (!existsSync(join(ui, 'index.html'))) throw new Error('Interface non compilée : lancez « pnpm build » à la racine.');
rmSync(out, { recursive: true, force: true });
execSync(`pnpm --filter @studio/server deploy --prod --legacy "${join(out, 'server')}"`, { cwd: root, stdio: 'inherit' });
// tests et fichiers de développement inutiles à l'exécution
for (const p of ['test', 'tsconfig.json']) rmSync(join(out, 'server', p), { recursive: true, force: true });
cpSync(ui, join(out, 'studio', 'dist'), { recursive: true });
console.log('runtime prêt :', out);
