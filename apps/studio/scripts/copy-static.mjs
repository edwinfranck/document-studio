// Copie dans public/ les ressources du moteur servies telles quelles : polices, Paged.js, KaTeX.
// Le serveur local les sert aussi ; ici, elles permettent l'édition web sans serveur (Vercel).
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(APP, '../../packages/engine');
const PUB = join(APP, 'public');
mkdirSync(join(PUB, 'vendor/katex/fonts'), { recursive: true });
cpSync(join(ENGINE, 'fonts'), join(PUB, 'fonts'), { recursive: true });
copyFileSync(join(ENGINE, 'node_modules/pagedjs/dist/paged.polyfill.min.js'), join(PUB, 'vendor/paged.js'));
const KATEX = join(ENGINE, 'node_modules/katex/dist');
writeFileSync(join(PUB, 'vendor/katex.css'), readFileSync(join(KATEX, 'katex.min.css'), 'utf8').replace(/url\(fonts\//g, 'url(/vendor/katex/fonts/'));
for (const f of readdirSync(join(KATEX, 'fonts'))) if (f.endsWith('.woff2')) copyFileSync(join(KATEX, 'fonts', f), join(PUB, 'vendor/katex/fonts', f));
console.log('public/ : polices, paged.js, katex copiés');
