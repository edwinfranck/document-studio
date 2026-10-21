// Génère docs/composants.md à partir du registre des composants (source unique).
import { writeFileSync } from 'node:fs';
import { COMPONENTS } from '../packages/engine/src/index.ts';

const out = ['# Référence des composants StudioMD', '', '> Fichier généré par `pnpm docs` depuis `packages/engine/src/registry.ts`. Ne pas éditer à la main.', ''];
for (const cat of ['Contenu', 'Mise en page', 'Présentation', 'Rapport'] as const) {
  out.push(`## ${cat}`, '');
  for (const c of COMPONENTS.filter(x => x.category === cat)) {
    out.push(`### \`${c.name}\` · ${c.label}`, '', c.description, '');
    if (c.aliases) out.push(`Alias : ${Object.entries(c.aliases).map(([a, imp]) => `\`${a}\`${Object.keys(imp).length ? ` (${Object.entries(imp).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`).join(', ')}.`, '');
    if (c.parent) out.push(`Se place dans un bloc \`${c.parent}\`.`, '');
    out.push(`Contenu : ${{ markdown: 'Markdown (composants imbriqués permis)', data: 'données YAML', raw: 'texte brut', none: 'aucun' }[c.content]}.`, '');
    const attrs = Object.entries(c.attrs);
    if (attrs.length) {
      out.push('| Attribut | Type | Défaut | Rôle |', '|---|---|---|---|');
      for (const [k, a] of attrs) out.push(`| \`${k}\`${a.required ? ' *' : ''} | ${a.values ? a.values.map(v => `\`${v}\``).join(' ') : a.type} | ${a.default ? `\`${a.default}\`` : ''} | ${a.description} |`);
      out.push('');
    }
    out.push('| Lecture | Impression / PDF | Diaporama |', '|---|---|---|', `| ${c.targets.reading} | ${c.targets.print} | ${c.targets.slides} |`, '');
    out.push('```md', c.example, '```', '');
  }
}
writeFileSync(new URL('../docs/composants.md', import.meta.url), out.join('\n'));
console.log('docs/composants.md :', COMPONENTS.length, 'composants');
