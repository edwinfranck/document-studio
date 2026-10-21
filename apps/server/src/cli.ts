// studio : la même chaîne de rendu en ligne de commande.
//   studio export rapport.md                       -> rapport.html (page de lecture)
//   studio export rapport.md --pdf                 -> rapport.pdf (version paginée)
//   studio export rapport.md --slides --pdf        -> diaporama en PDF
//   studio export rapport.md --template editorial --out _sorties/
//   studio check rapport.md                        -> diagnostics, code 1 en cas d'erreur
//   studio templates                               -> gabarits disponibles
//   studio serve                                   -> l'application sur http://127.0.0.1:4317
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { BUILTIN_TEMPLATES, parse, type DocSettings, type Target } from '@studio/engine';
import { exportPdf, renderHtml, exportZip } from './export.ts';
import { closeBrowser } from './browser.ts';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (n: string) => args.includes('--' + n);
const opt = (n: string) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
// pnpm lance la commande depuis la racine du dépôt : les chemins se lisent depuis le dossier d'appel.
const CWD = process.env.INIT_CWD || process.cwd();
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--pdf', '--slides', '--print', '--zip'].includes(args[i - 1])));

function help() {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
}

async function main() {
  if (cmd === 'serve') { await import('./main.ts'); return; }
  if (cmd === 'templates') { for (const t of BUILTIN_TEMPLATES) console.log(`${t.id.padEnd(16)} ${t.name.padEnd(26)} ${t.description}`); return; }
  if (!cmd || !file || !['export', 'check'].includes(cmd)) return help();
  const src = resolve(CWD, file);
  if (!existsSync(src)) throw new Error(`Fichier introuvable : ${file}`);
  const markdown = readFileSync(src, 'utf8');
  const dir = dirname(src);
  // Réglages : studio.json à côté du fichier (même nom), sinon options de la ligne de commande.
  const side = [src.replace(/\.md$/i, '.studio.json'), join(dir, 'studio.json')].find(existsSync);
  const saved: Partial<DocSettings> = side ? JSON.parse(readFileSync(side, 'utf8')).settings || {} : {};
  const mode: Target = flag('slides') ? 'slides' : flag('print') ? 'print' : saved.mode || 'reading';
  const settings: Partial<DocSettings> = { ...saved, mode, templateId: opt('template') || saved.templateId || 'corporate' };

  if (cmd === 'check') {
    const d = parse(markdown).diagnostics;
    for (const x of d) console.log(`${basename(src)}:${x.line}  ${x.severity.padEnd(7)} ${x.message}`);
    if (!d.length) console.log('Aucun problème.');
    process.exitCode = d.some(x => x.severity === 'error') ? 1 : 0;
    return;
  }
  const name = basename(src, extname(src));
  const outOpt = opt('out');
  const outPath = outOpt ? resolve(CWD, outOpt) : null;
  const outDir = outPath && (!extname(outPath) || (existsSync(outPath) && statSync(outPath).isDirectory())) ? outPath : null;
  const target = (ext: string, suffix = '') => outPath && !outDir ? outPath : join(outDir || dir, `${name}${suffix}${ext}`);
  if (outDir) mkdirSync(outDir, { recursive: true });
  const input = { markdown, settings, dir, name };
  if (flag('zip')) {
    const z = await exportZip(input, flag('pdf'));
    writeFileSync(target('.zip'), z.zip);
    console.log('✓', target('.zip'));
  } else if (flag('pdf')) {
    const r = await exportPdf(input, mode);
    const out = target('.pdf', mode === 'slides' ? '-diaporama' : '');
    writeFileSync(out, r.pdf);
    for (const x of r.diagnostics.filter(x => x.severity !== 'info')) console.warn(`  ligne ${x.line} : ${x.message}`);
    console.log('✓', out, `(${r.info.pages ?? r.info.count} ${mode === 'slides' ? 'diapositives' : 'pages'})`);
    if (r.info.overflows?.length) console.warn(`  ⚠ ${r.info.overflows.length} débordement(s) :`, JSON.stringify(r.info.overflows));
  } else {
    const r = renderHtml(input, mode);
    const out = target('.html', mode === 'slides' ? '-diaporama' : mode === 'print' ? '-impression' : '');
    writeFileSync(out, r.html);
    for (const x of r.diagnostics.filter(x => x.severity !== 'info')) console.warn(`  ligne ${x.line} : ${x.message}`);
    console.log('✓', out);
  }
}

main().catch(e => { console.error('✗', e.message); process.exitCode = 1; }).finally(() => { if (cmd !== 'serve') closeBrowser(); });
