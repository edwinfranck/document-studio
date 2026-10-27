// Déclaration des composants StudioMD : syntaxe, attributs, contenu et comportement par cible.
// Le rendu HTML de chaque composant est dans components.ts ; ici, uniquement le contrat.

export type AttrType = 'string' | 'number' | 'boolean' | 'enum' | 'color' | 'url';

export interface AttrSpec {
  type: AttrType;
  values?: string[];
  default?: string;
  required?: boolean;
  description: string;
}

export interface ComponentSpec {
  name: string;
  aliases?: Record<string, Record<string, string>>;  // alias -> attributs implicites
  category: 'Contenu' | 'Mise en page' | 'Présentation' | 'Rapport';
  label: string;
  description: string;
  content: 'markdown' | 'data' | 'raw' | 'none';
  parent?: string;                // doit être placé dans ce composant
  attrs: Record<string, AttrSpec>;
  targets: { reading: string; print: string; slides: string };
  example: string;
}

const CALLOUT_TYPES = ['info', 'note', 'tip', 'success', 'warning', 'danger'];

export const COMPONENTS: ComponentSpec[] = [
  {
    name: 'callout', category: 'Contenu', label: 'Encadré',
    description: 'Met en valeur une information, un conseil ou un avertissement.',
    aliases: Object.fromEntries(CALLOUT_TYPES.map(t => [t, { type: t }]).concat([['attention', { type: 'warning' }], ['important', { type: 'danger' }]])),
    content: 'markdown',
    attrs: {
      type: { type: 'enum', values: CALLOUT_TYPES, default: 'info', description: 'Nature de l\'encadré, qui fixe sa couleur et son icône.' },
      title: { type: 'string', description: 'Titre affiché en tête.' },
    },
    targets: { reading: 'Encadré coloré avec icône.', print: 'Identique, jamais coupé entre deux pages s\'il tient sur une page.', slides: 'Encadré agrandi à la taille de la diapositive.' },
    example: ':::callout {type="warning" title="Attention"}\nLa salle ferme à 18 h.\n:::',
  },
  {
    name: 'include', category: 'Contenu', label: 'Bloc réutilisable',
    description: 'Insère un bloc de la bibliothèque, à une version précise. Le bloc ne change pas tant que la version n\'est pas mise à jour.',
    content: 'none',
    attrs: {
      block: { type: 'string', required: true, description: 'Identifiant du bloc.' },
      version: { type: 'number', description: 'Version épinglée (sinon, la dernière).' },
    },
    targets: { reading: 'Contenu du bloc.', print: 'Contenu du bloc.', slides: 'Contenu du bloc.' },
    example: ':::include {block="coordonnees" version=1} :::',
  },
  {
    name: 'details', category: 'Contenu', label: 'Accordéon',
    description: 'Contenu repliable, ouvert d\'un clic.',
    aliases: { accordion: {} },
    content: 'markdown',
    attrs: {
      title: { type: 'string', required: true, description: 'Libellé toujours visible.' },
      open: { type: 'boolean', description: 'Ouvert au chargement.' },
    },
    targets: { reading: 'Repliable (<details>).', print: 'Toujours déplié : le titre puis le contenu.', slides: 'Toujours déplié.' },
    example: ':::details {title="Voir le détail du calcul"}\nLe total inclut la TVA.\n:::',
  },
  {
    name: 'tabs', category: 'Contenu', label: 'Onglets',
    description: 'Plusieurs variantes d\'un même contenu, une visible à la fois.',
    content: 'markdown', attrs: {},
    targets: { reading: 'Onglets cliquables.', print: 'Chaque onglet à la suite, sous son titre.', slides: 'Chaque onglet à la suite, sous son titre.' },
    example: ':::tabs\n:::tab {title="macOS"}\n`brew install pandoc`\n:::\n:::tab {title="Linux"}\n`apt install pandoc`\n:::\n:::',
  },
  {
    name: 'tab', category: 'Contenu', label: 'Onglet', parent: 'tabs',
    description: 'Un onglet d\'un bloc d\'onglets.',
    content: 'markdown',
    attrs: { title: { type: 'string', required: true, description: 'Libellé de l\'onglet.' } },
    targets: { reading: 'Panneau d\'onglet.', print: 'Section titrée.', slides: 'Section titrée.' },
    example: ':::tab {title="Windows"}\n…\n:::',
  },
  {
    name: 'pullquote', category: 'Contenu', label: 'Citation mise en valeur',
    description: 'Une phrase en grand, avec son auteur.',
    aliases: { quote: {} },
    content: 'markdown',
    attrs: {
      author: { type: 'string', description: 'Auteur de la citation.' },
      source: { type: 'string', description: 'Fonction, ouvrage ou date.' },
    },
    targets: { reading: 'Citation en grand corps.', print: 'Citation en grand corps, insécable.', slides: 'Occupe la diapositive.' },
    example: ':::pullquote {author="Grace Hopper"}\nLe plus dangereux : « on a toujours fait comme ça ».\n:::',
  },
  {
    name: 'image', category: 'Contenu', label: 'Image légendée',
    description: 'Image avec légende, largeur et alignement.',
    aliases: { figure: {} },
    content: 'markdown',
    attrs: {
      src: { type: 'url', required: true, description: 'Chemin relatif au document ou URL.' },
      alt: { type: 'string', description: 'Texte alternatif (accessibilité). Fortement recommandé.' },
      caption: { type: 'string', description: 'Légende sous l\'image.' },
      width: { type: 'string', description: 'Largeur : 50%, 320px… Par défaut, la largeur du texte.' },
      align: { type: 'enum', values: ['center', 'left', 'right', 'full'], default: 'center', description: 'Alignement ; full déborde sur toute la largeur.' },
    },
    targets: { reading: 'Figure légendée.', print: 'Figure insécable, image et légende sur la même page.', slides: 'Image ajustée à l\'espace disponible.' },
    example: ':::image {src="./assets/atelier.jpg" alt="Atelier" caption="Session de travail"}\n:::',
  },
  {
    name: 'gallery', category: 'Contenu', label: 'Galerie',
    description: 'Grille d\'images ; chaque image markdown du bloc devient une vignette légendée par son texte alternatif.',
    content: 'markdown',
    attrs: { cols: { type: 'number', default: '3', description: 'Nombre de colonnes.' } },
    targets: { reading: 'Grille responsive.', print: 'Grille, insécable si possible.', slides: 'Grille.' },
    example: ':::gallery {cols=2}\n![Avant](./avant.jpg)\n![Après](./apres.jpg)\n:::',
  },
  {
    name: 'video', category: 'Contenu', label: 'Vidéo',
    description: 'Vidéo locale ou distante (fichier mp4/webm).',
    content: 'none',
    attrs: {
      src: { type: 'url', required: true, description: 'Fichier vidéo.' },
      poster: { type: 'url', description: 'Image affichée avant lecture et dans le PDF.' },
      caption: { type: 'string', description: 'Légende.' },
    },
    targets: { reading: 'Lecteur vidéo.', print: 'Image de l\'affiche (ou un cadre) avec la légende et le lien : le PDF ne lit pas les vidéos.', slides: 'Lecteur vidéo.' },
    example: ':::video {src="./demo.mp4" poster="./demo.jpg" caption="Démonstration"}\n:::',
  },
  {
    name: 'columns', category: 'Mise en page', label: 'Colonnes',
    description: 'Contenu en colonnes ; chaque colonne est un bloc :::column.',
    content: 'markdown',
    attrs: {
      count: { type: 'number', description: 'Nombre de colonnes (par défaut, le nombre de blocs column).' },
      ratio: { type: 'string', description: 'Proportions, ex. « 2:1 ».' },
      gap: { type: 'enum', values: ['small', 'medium', 'large'], default: 'medium', description: 'Espace entre colonnes.' },
    },
    targets: { reading: 'Colonnes, empilées sur mobile.', print: 'Colonnes.', slides: 'Colonnes.' },
    example: ':::columns {count=2}\n:::column\n## Réalisations\n…\n:::\n:::column\n## Prochaines étapes\n…\n:::\n:::',
  },
  {
    name: 'column', category: 'Mise en page', label: 'Colonne', parent: 'columns',
    description: 'Une colonne d\'un bloc :::columns.',
    content: 'markdown', attrs: {},
    targets: { reading: 'Colonne.', print: 'Colonne.', slides: 'Colonne.' },
    example: ':::column\n…\n:::',
  },
  {
    name: 'grid', category: 'Mise en page', label: 'Grille',
    description: 'Grille automatique : chaque bloc enfant (carte, image, paragraphe) occupe une case.',
    content: 'markdown',
    attrs: { cols: { type: 'number', default: '3', description: 'Nombre de colonnes.' } },
    targets: { reading: 'Grille responsive.', print: 'Grille.', slides: 'Grille.' },
    example: ':::grid {cols=3}\n:::card {title="Un"}\n…\n:::\n:::card {title="Deux"}\n…\n:::\n:::',
  },
  {
    name: 'card', category: 'Mise en page', label: 'Carte',
    description: 'Bloc encadré avec titre facultatif.',
    content: 'markdown',
    attrs: {
      title: { type: 'string', description: 'Titre de la carte.' },
      tone: { type: 'enum', values: ['default', 'primary', 'accent', 'muted'], default: 'default', description: 'Teinte de fond.' },
    },
    targets: { reading: 'Carte.', print: 'Carte insécable.', slides: 'Carte.' },
    example: ':::card {title="Objectif"}\nFormer 200 étudiants.\n:::',
  },
  {
    name: 'stats', category: 'Mise en page', label: 'Chiffres clés',
    description: 'Rangée de chiffres clés. Contenu : une liste YAML de label / value (et hint facultatif).',
    aliases: { kpi: {} },
    content: 'data', attrs: {},
    targets: { reading: 'Rangée de chiffres.', print: 'Rangée de chiffres insécable.', slides: 'Chiffres en très grand.' },
    example: ':::stats\n- label: Projets accompagnés\n  value: 24\n- label: Participants\n  value: 180\n  hint: +40 % sur un an\n:::',
  },
  {
    name: 'section', category: 'Mise en page', label: 'Section à fond',
    description: 'Bloc avec fond coloré, pleine largeur si demandé.',
    content: 'markdown',
    attrs: {
      bg: { type: 'string', default: 'surface', description: 'Fond : surface, primary, accent, dark, ou une couleur #hex.' },
      full: { type: 'boolean', description: 'Déborde sur toute la largeur de la page.' },
    },
    targets: { reading: 'Bande de couleur.', print: 'Bloc de couleur (fonds imprimés).', slides: 'Fond de la zone.' },
    example: ':::section {bg="primary"}\n## Notre ambition\n…\n:::',
  },
  {
    name: 'aside', category: 'Mise en page', label: 'Encadré latéral',
    description: 'Note de marge : à côté du texte sur grand écran, en ligne ailleurs.',
    content: 'markdown',
    attrs: { title: { type: 'string', description: 'Titre.' } },
    targets: { reading: 'Dans la marge sur grand écran.', print: 'Encadré en ligne, corps réduit.', slides: 'Encadré.' },
    example: ':::aside {title="Le saviez-vous ?"}\n…\n:::',
  },
  {
    name: 'spacer', category: 'Mise en page', label: 'Espace',
    description: 'Espace vertical contrôlé.',
    content: 'none',
    attrs: { size: { type: 'enum', values: ['small', 'medium', 'large', 'xlarge'], default: 'medium', description: 'Hauteur.' } },
    targets: { reading: 'Espace.', print: 'Espace (supprimé en haut de page).', slides: 'Espace.' },
    example: ':::spacer {size="large"} :::',
  },
  {
    name: 'slide', category: 'Présentation', label: 'Diapositive',
    description: 'Une diapositive explicite, avec sa mise en page et son fond.',
    content: 'markdown',
    attrs: {
      layout: { type: 'enum', values: ['default', 'cover', 'section', 'center', 'split', 'image', 'statement', 'closing'], default: 'default', description: 'Mise en page.' },
      bg: { type: 'string', description: 'Fond : light, dark, primary, accent, ou #hex.' },
      image: { type: 'url', description: 'Image de fond.' },
    },
    targets: { reading: 'Section ordinaire (le contenu reste lisible).', print: 'Section ordinaire.', slides: 'Une diapositive.' },
    example: ':::slide {layout="center" bg="dark"}\n# Merci\n:::',
  },
  {
    name: 'notes', category: 'Présentation', label: 'Notes du présentateur',
    description: 'Visibles seulement dans la vue présentateur.',
    content: 'markdown', attrs: {},
    targets: { reading: 'Masquées.', print: 'Masquées.', slides: 'Vue présentateur (touche P).' },
    example: ':::notes\nRappeler les chiffres de l\'an dernier.\n:::',
  },
  {
    name: 'cover', category: 'Rapport', label: 'Couverture personnalisée',
    description: 'Remplace le contenu de la couverture générée à partir des métadonnées.',
    content: 'markdown',
    attrs: { bg: { type: 'string', description: 'Fond : primary, dark, accent ou #hex.' } },
    targets: { reading: 'En-tête du document.', print: 'Première page.', slides: 'Première diapositive.' },
    example: ':::cover\n# Rapport annuel\n2026\n:::',
  },
  {
    name: 'toc', category: 'Rapport', label: 'Sommaire',
    description: 'Sommaire à cet endroit (sinon, selon le gabarit).',
    content: 'none',
    attrs: { depth: { type: 'number', default: '2', description: 'Profondeur des titres listés.' } },
    targets: { reading: 'Sommaire en ligne.', print: 'Sommaire avec numéros de page.', slides: 'Diapositive de sommaire.' },
    example: ':::toc {depth=2} :::',
  },
  {
    name: 'pagebreak', category: 'Rapport', label: 'Saut de page',
    description: 'Force une nouvelle page à l\'impression ; coupe aussi la diapositive.',
    aliases: { newpage: {} },
    content: 'none', attrs: {},
    targets: { reading: 'Invisible.', print: 'Nouvelle page.', slides: 'Nouvelle diapositive.' },
    example: ':::pagebreak :::',
  },
  {
    name: 'appendix', category: 'Rapport', label: 'Annexe',
    description: 'Annexe : nouvelle page, titres préfixés « Annexe A », « Annexe B »…',
    content: 'markdown',
    attrs: {},
    targets: { reading: 'Section titrée.', print: 'Commence sur une nouvelle page.', slides: 'Diapositives ordinaires.' },
    example: ':::appendix\n## Méthodologie\n…\n:::',
  },
  {
    name: 'references', category: 'Rapport', label: 'Références',
    description: 'Bibliographie : une liste dont chaque élément est une référence.',
    aliases: { bibliography: {} },
    content: 'markdown',
    attrs: { title: { type: 'string', default: 'Références', description: 'Titre de la section.' } },
    targets: { reading: 'Liste numérotée en retrait.', print: 'Liste numérotée, retrait suspendu.', slides: 'Liste.' },
    example: ':::references\n1. Bringhurst, R. *The Elements of Typographic Style*, 2004.\n:::',
  },
  {
    name: 'table', category: 'Rapport', label: 'Tableau',
    description: 'Options de présentation pour le tableau markdown qu\'il contient.',
    content: 'markdown',
    attrs: {
      caption: { type: 'string', description: 'Légende.' },
      style: { type: 'enum', values: ['lines', 'zebra', 'grid', 'minimal'], description: 'Style (sinon celui du gabarit).' },
      compact: { type: 'boolean', description: 'Corps et cellules réduits, pour les tableaux larges.' },
      wide: { type: 'boolean', description: 'Utilise toute la largeur de la page.' },
    },
    targets: { reading: 'Défilement horizontal si trop large.', print: 'En-têtes répétés sur chaque page ; réduit si trop large.', slides: 'Tableau.' },
    example: ':::table {caption="Budget 2026" style="zebra" compact}\n| Poste | Montant |\n|---|--:|\n| Matériel | 1 200 € |\n:::',
  },
];

export const BY_NAME = new Map<string, { spec: ComponentSpec; implied: Record<string, string> }>();
for (const spec of COMPONENTS) {
  BY_NAME.set(spec.name, { spec, implied: {} });
  for (const [alias, implied] of Object.entries(spec.aliases || {})) BY_NAME.set(alias, { spec, implied });
}

export const isVerbatim = (name: string) => {
  const c = BY_NAME.get(name);
  return !!c && (c.spec.content === 'data' || c.spec.content === 'raw');
};
