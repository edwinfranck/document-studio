# Plugins de composants

Un plugin ajoute un composant StudioMD, décrit dans un fichier JSON : sa syntaxe, ses attributs typés, son rendu HTML pour chaque sortie et son CSS. Il ne contient aucun code exécutable.

Installation : Paramètres → Plugins → « Installer un plugin (.json) ». Sur un serveur, seul un administrateur installe ; le plugin sert alors à tous les comptes et aux exports du serveur. Dans l'édition web, il est gardé dans le navigateur.

## Exemple

```json
{
  "id": "jauge",
  "name": "jauge",
  "label": "Jauge",
  "version": "1.0.0",
  "description": "Barre de progression avec un libellé.",
  "content": "markdown",
  "attrs": {
    "valeur": { "type": "number", "required": true, "description": "Pourcentage atteint (0 à 100)." },
    "couleur": { "type": "color", "default": "#2b59c3", "description": "Couleur de la barre." }
  },
  "template": "<div class=\"jauge\"><div class=\"jauge-txt\">{{content}}</div><div class=\"jauge-barre\"><span style=\"width:{{valeur}}%;background:{{couleur}}\"></span></div></div>",
  "targets": { "slides": "<div class=\"jauge jauge-grande\"><strong>{{valeur}} %</strong>{{content}}</div>" },
  "css": ".jauge-barre{height:10px;border-radius:5px;background:var(--sd-surface)}.jauge-barre span{display:block;height:100%;border-radius:5px}",
  "example": ":::jauge {valeur=72}\nTaux de réussite\n:::"
}
```

Dans un document :

```markdown
:::jauge {valeur=72 couleur="#1c7c3c"}
Taux de réussite
:::
```

## Champs

| Champ | Rôle |
|---|---|
| `id` | identifiant du plugin (minuscules, chiffres, tirets) |
| `name` | nom écrit après `:::` ; ne peut pas reprendre un composant intégré |
| `label`, `description`, `version`, `author` | présentation dans la bibliothèque de composants |
| `content` | `markdown` (le bloc a un contenu) ou `none` |
| `attrs` | attributs : `type` parmi `string`, `number`, `boolean`, `enum` (avec `values`), `color`, `url` ; `required`, `default`, `description` |
| `template` | rendu HTML commun aux trois sorties |
| `targets` | rendu propre à `reading`, `print` ou `slides`, à la place de `template` |
| `css` | styles du composant, ajoutés aux documents qui l'utilisent ; les variables `--sd-*` du thème sont disponibles |
| `example` | texte inséré depuis la bibliothèque et la complétion |

## Gabarit

| Écriture | Résultat |
|---|---|
| `{{valeur}}` | valeur de l'attribut, échappée selon son type (nombre, couleur validée, URL sûre) |
| `{{content}}` | contenu Markdown du bloc, rendu par le moteur |
| `{{#titre}}…{{/titre}}` | partie affichée seulement si `titre` est renseigné (`{{#content}}` : si le bloc a un contenu) |
| `{{^titre}}…{{/titre}}` | partie affichée seulement s'il ne l'est pas |

## Sécurité

- Le gabarit est nettoyé à l'installation : balises `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg` retirées, attributs `on…` supprimés, adresses `javascript:` et `data:` neutralisées.
- Chaque valeur insérée est échappée ; une couleur ou une URL invalide est remplacée par la valeur par défaut.
- Le CSS passe par le même filtre que le CSS personnalisé : ni `@import` ni ressource distante.
- Un plugin invalide est refusé avec la liste de ses problèmes ; un document qui emploie un plugin retiré affiche « Composant inconnu » sans rien perdre de son texte.
