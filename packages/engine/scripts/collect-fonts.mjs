// Copie les polices (sous-ensembles latin et latin-ext) des paquets @fontsource dans fonts/,
// écrit fonts/fonts.json, puis régénère src/assets.gen.ts à partir de src/assets/*.{css,js}.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(ROOT, 'node_modules');
const OUT = join(ROOT, 'fonts');
mkdirSync(OUT, { recursive: true });

// famille affichée -> [paquet, feuilles CSS à lire]
const FAMILIES = {
  'Inter': ['@fontsource-variable/inter', ['wght.css', 'wght-italic.css']],
  'Newsreader': ['@fontsource-variable/newsreader', ['wght.css', 'wght-italic.css']],
  'Fraunces': ['@fontsource-variable/fraunces', ['wght.css', 'wght-italic.css']],
  'Source Serif 4': ['@fontsource-variable/source-serif-4', ['wght.css', 'wght-italic.css']],
  'Space Grotesk': ['@fontsource-variable/space-grotesk', ['wght.css']],
  'DM Sans': ['@fontsource-variable/dm-sans', ['wght.css', 'wght-italic.css']],
  'Lexend': ['@fontsource-variable/lexend', ['wght.css']],
  'JetBrains Mono': ['@fontsource-variable/jetbrains-mono', ['wght.css', 'wght-italic.css']],
  'IBM Plex Sans': ['@fontsource/ibm-plex-sans', ['400.css', '400-italic.css', '500.css', '600.css', '700.css']],
  'IBM Plex Mono': ['@fontsource/ibm-plex-mono', ['400.css', '600.css']],
  'Anton': ['@fontsource/anton', ['400.css']],
};

const manifest = {};
for (const [family, [pkg, sheets]] of Object.entries(FAMILIES)) {
  const dir = join(MODULES, pkg);
  const faces = [];
  for (const sheet of sheets) {
    const css = readFileSync(join(dir, sheet), 'utf8');
    for (const block of css.matchAll(/\/\* ([^*]+) \*\/\s*@font-face\s*{([^}]*)}/g)) {
      const name = block[1].trim();
      if (!/-latin(-ext)?-/.test(name)) continue;
      const body = block[2];
      const get = k => (body.match(new RegExp(k + ':\\s*([^;]+);')) || [])[1]?.trim();
      const file = get('src').match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
      copyFileSync(join(dir, 'files', file), join(OUT, file));
      faces.push({ file, style: get('font-style'), weight: get('font-weight'), unicodeRange: get('unicode-range') });
    }
  }
  if (!faces.length) throw new Error('aucune police trouvée pour ' + family);
  manifest[family] = faces;
}
writeFileSync(join(OUT, 'fonts.json'), JSON.stringify(manifest, null, 1));

const ASSETS = join(ROOT, 'src', 'assets');
const out = ['// Fichier généré par scripts/collect-fonts.mjs : ne pas éditer, modifier src/assets/.'];
for (const f of readdirSync(ASSETS).sort()) {
  const key = f.replace(/\.(css|js)$/, (_, e) => '_' + e).replace(/[^a-zA-Z0-9_]/g, '_');
  out.push(`export const ${key} = ${JSON.stringify(readFileSync(join(ASSETS, f), 'utf8'))};`);
}
const paged = join(MODULES, 'pagedjs', 'dist', 'paged.polyfill.min.js');
if (existsSync(paged)) out.push(`export const PAGEDJS_PATH = ${JSON.stringify('pagedjs/dist/paged.polyfill.min.js')};`);
writeFileSync(join(ROOT, 'src', 'assets.gen.ts'), out.join('\n') + '\n');
console.log(`polices : ${Object.keys(manifest).length} familles, assets : ${readdirSync(ASSETS).length} fichiers`);
