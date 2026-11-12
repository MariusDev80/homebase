# DESIGN : direction visuelle de Homebase

Décidé avec Marius le 20/10/2026 : interface **inspirée de GitHub** (système Primer), épurée et bien structurée. On reprend l'esprit (structure par bordures, densité, palette neutre, hiérarchie typographique sobre), pas la marque : ni logo, ni Octocat, ni nom ou visuel GitHub.

Ce document fait foi pour toute UI (shell, pages, widgets). Une exception se justifie en revue.

## 1. Principes
1. **La structure vient des bordures, pas des ombres.** Des cadres de 1 px, des fonds légèrement teintés pour les en-têtes et des séparateurs entre les lignes. Les ombres sont réservées aux éléments flottants (menus, dialogues, toasts).
2. **Dense mais lisible.** Texte de base en 14 px, interligne 1,5, espacements serrés et réguliers. Un tableau de bord montre beaucoup sans paraître chargé.
3. **Neutre d'abord, couleur pour le sens.** Le fond et le texte sont en gris neutres. La couleur porte une information (accent = interactif ou sélectionné, succès, danger, attention), jamais de la décoration.
4. **Hiérarchie par la typographie et l'espacement.** Poids 600 pour les titres, gris « muted » pour le secondaire. Pas de couleurs vives pour hiérarchiser.
5. **Clair et sombre à parité.** Chaque token a ses deux valeurs, et tout écran est vérifié dans les deux thèmes.
6. **Accessible par défaut.** Contraste WCAG AA, focus toujours visible, `prefers-reduced-motion` respecté, cibles cliquables d'au moins 24 px.

## 2. Tokens
Ce sont des variables CSS sémantiques, définies une seule fois dans `apps/web/src/app/core/theme/tokens.css` (`:root` pour le clair, `.app-dark` pour le sombre). Les valeurs ci-dessous s'inspirent des thèmes « light default » et « dark default » de GitHub, et sont à ajuster si un contraste AA l'exige.

### 2.1 Couleurs
| Token | Clair | Sombre | Usage |
|---|---|---|---|
| `--hb-bg` | `#ffffff` | `#0d1117` | fond de page, corps des cartes |
| `--hb-bg-subtle` | `#f6f8fa` | `#151b23` | en-têtes de carte, barre du haut, zones secondaires |
| `--hb-bg-inset` | `#f6f8fa` | `#010409` | champs, zones en retrait |
| `--hb-bg-emphasis` | `#25292e` | `#3d444d` | infobulles, badges forts |
| `--hb-border` | `#d1d9e0` | `#3d444d` | bordures par défaut |
| `--hb-border-muted` | `#d1d9e0b3` | `#3d444db3` | séparateurs internes |
| `--hb-fg` | `#1f2328` | `#f0f6fc` | texte principal |
| `--hb-fg-muted` | `#59636e` | `#9198a1` | texte secondaire, métadonnées, icônes au repos |
| `--hb-fg-on-emphasis` | `#ffffff` | `#ffffff` | texte sur fond plein (boutons primaires, badges) |
| `--hb-accent` | `#0969da` | `#4493f8` | liens, sélection, focus, éléments actifs |
| `--hb-accent-subtle` | `#ddf4ff` | `#388bfd1a` | fond de l'élément sélectionné |
| `--hb-success` | `#1a7f37` | `#3fb950` | succès, habit fait, service en ligne |
| `--hb-success-emphasis` | `#1f883d` | `#238636` | fond du bouton primaire |
| `--hb-danger` | `#d1242f` | `#f85149` | erreurs, suppression, service hors ligne |
| `--hb-attention` | `#9a6700` | `#d29922` | avertissements, échéance proche |
| `--hb-focus` | `#0969da` | `#1f6feb` | anneau de focus |

### 2.2 Typographie
- Police système : `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif` (Segoe UI sous Windows). Chasse fixe : `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`. Aucune police web à charger.
- Échelle : 12 px (métadonnées, badges), **14 px (base)**, 16 px (titre de carte), 20 px (titre de page), 24–32 px (rare : grandes valeurs dans les widgets).
- Poids : 400 pour le texte, 600 pour les titres, libellés de bouton et onglet actif. Pas de 700.
- Chiffres tabulaires (`font-variant-numeric: tabular-nums`) pour les timers, montants et compteurs.

### 2.3 Espacement, rayons, élévation
- Grille de 4 px : 4, 8, 12, 16, 24, 32. Padding de carte : 16 px (12 px en densité compacte).
- Rayons : 6 px (cartes, boutons, champs), 12 px pour les grands dialogues, 999 px pour les badges et compteurs.
- Ombres : aucune au repos. Menus et popovers : ombre légère + bordure. Dialogues : ombre moyenne + voile.
- Transitions : 80 à 150 ms, uniquement sur la couleur, le fond et l'opacité. Rien n'est animé si `prefers-reduced-motion` est actif.

## 3. Composants (patterns)
- **Barre supérieure** : fond `--hb-bg-subtle`, bordure basse, hauteur 48 px. À gauche le nom de l'app (600) puis la navigation, à droite la recherche (phase 1) et le thème.
- **Navigation** : onglets soulignés (style « UnderlineNav ») : texte `--hb-fg-muted`, onglet actif en `--hb-fg` 600 avec un soulignement de 2 px. Une icône facultative à gauche du libellé.
- **En-tête de page** : titre de 20 px en 600 à gauche, actions à droite, séparateur bas facultatif.
- **Carte « Box »**, la brique de base, que l'hôte de widget utilise toujours :
  - cadre `--hb-border`, rayon 6 px, fond `--hb-bg` ;
  - en-tête : fond `--hb-bg-subtle`, bordure basse, padding 8 × 16 px, icône + titre de 14 px en 600 à gauche, actions discrètes (boutons « invisibles » icône seule, menu ⋯) à droite ;
  - corps : padding 16 px. Les listes y sont des lignes séparées par `--hb-border-muted`, survolées en `--hb-bg-subtle` ;
  - pied facultatif : lien « Tout voir », métadonnées en `--hb-fg-muted` 12 px.
- **Boutons** : hauteur 32 px (28 px en compact), rayon 6 px, libellé 600.
  - *Défaut* : fond `--hb-bg-subtle`, bordure.
  - *Primaire* : fond `--hb-success-emphasis`, texte `--hb-fg-on-emphasis`. Une action principale au plus par vue.
  - *Danger* : texte `--hb-danger`, qui passe en fond plein au survol.
  - *Invisible* : sans fond ni bordure, fond au survol. Pour les actions secondaires et les icônes seules (avec `aria-label`).
- **Champs** : fond `--hb-bg-inset` (ou `--hb-bg`), bordure, rayon 6 px, hauteur 32 px. Le focus donne une bordure `--hb-accent` et un anneau de 2 px. L'erreur s'affiche sous le champ, en `--hb-danger` 12 px.
- **Badges et compteurs** : forme pilule, 12 px, bordure ou fond subtil. Pastilles d'état (point de 8 px) pour les statuts de services.
- **États vides** : centrés dans la carte, icône `--hb-fg-muted`, une phrase et une action. Jamais de grande illustration.
- **Erreurs** : bandeau (flash) dans la carte ou en haut de page : fond teinté du sens, bordure du sens, texte `--hb-fg`.
- **Focus** : `outline: 2px solid var(--hb-focus); outline-offset: -2px` (ou `2px` hors des cartes), uniquement sur `:focus-visible`.

## 4. Tableau de bord et widgets
- Fond de page `--hb-bg-subtle` en clair (les cartes blanches ressortent par leur bordure) et `--hb-bg` en sombre.
- Gouttière de grille de 16 px, et 16 à 24 px de marge de page.
- L'hôte de widget (`core/widgets/widget-host`) dessine **seul** le cadre Box et l'en-tête (icône, titre, menu ⋯ avec Configurer et Supprimer). Le composant du widget ne rend que le corps : un widget ne dessine ni son propre cadre ni sa propre ombre.
- Les placeholders (type inconnu, config invalide, version future, erreur de chargement) utilisent le même cadre, avec un état vide ou un bandeau d'erreur.
- En mode édition de la grille (phase 1), les poignées et contours apparaissent en `--hb-accent`. Ils sont invisibles hors édition.

## 5. Mise en œuvre technique
- **Tokens** dans `core/theme/tokens.css`, importé par `styles.css`.
- **Tailwind 4** : les tokens sont exposés via `@theme` sous des noms sémantiques (`bg-canvas`, `bg-canvas-subtle`, `border-default`, `text-fg`, `text-fg-muted`, `text-accent`…). Dans les templates, **seules ces classes sémantiques** sont autorisées : pas de couleur Tailwind brute (`bg-slate-800`, `text-gray-500`) ni de valeur hexadécimale en dur. Le contrôle se fait en revue, avant un lint automatique éventuel.
- **PrimeNG** : un preset maison dérivé d'Aura (`definePreset`) dont les tokens primitifs et sémantiques pointent vers les mêmes variables `--hb-*` (surface, primary = accent, rayons, focus ring), avec le `darkModeSelector: '.app-dark'` actuel. Un composant PrimeNG doit avoir le même rendu qu'un composant maison.
- **Icônes** : PrimeIcons (`pi pi-…`, imposé par le contrat Widget de l'ADR-001), taille 16 px, couleur `--hb-fg-muted` au repos. Passer aux Octicons (licence MIT) demanderait d'amender l'ADR-001 : ce n'est pas prévu.
  - **Exception : icônes météo** (décidée par Marius le 21/10/2026). PrimeIcons n'a ni pluie, ni neige, ni brouillard. Le widget Météo utilise donc un petit jeu local d'icônes SVG en ligne, reprises de Lucide (licence ISC ; notice dans `apps/web/src/app/widgets/weather/icons/LICENSE-lucide.txt`), rendues par le seul composant `widgets/weather/weather-icon.component`. Règles : `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"` ; couleur donnée par une classe sémantique (`text-fg-muted` par défaut, `text-attention` pour le soleil et l'orage, `text-accent` pour les précipitations) ; 16 px dans les listes, 32 px pour la condition courante ; `aria-hidden="true"` et `focusable="false"` (le libellé texte porte l'information). Aucune couleur en dur, aucune ressource distante. L'icône de la définition du widget reste `pi pi-sun` (ADR-001). Cette exception ne vaut que pour la météo.
- **CSP** : rien à changer. Pas de police web ni de ressource distante, les styles restent en `'self'` + les `<style>` de PrimeNG (voir `docs/SECURITY-NOTES.md`).

### Classes disponibles
Tailwind : la palette brute est désactivée (`--color-*: initial`), seules ces classes de couleur existent (préfixes `bg-`, `text-`, `border-`, `ring-`, `outline-`…). Les valeurs pointent vers `var(--hb-*)` : le changement de thème est instantané.

| Classe (suffixe) | Token | Exemples |
|---|---|---|
| `canvas` | `--hb-bg` | `bg-canvas` |
| `canvas-subtle` | `--hb-bg-subtle` | `bg-canvas-subtle` |
| `canvas-inset` | `--hb-bg-inset` | `bg-canvas-inset` |
| `emphasis` | `--hb-bg-emphasis` | `bg-emphasis` |
| `page` | `--hb-page-bg` (subtle en clair, `--hb-bg` en sombre) | `bg-page` |
| `hover` | `--hb-hover` (voile de survol) | `hover:bg-hover` |
| `default` | `--hb-border` | `border-default` |
| `muted` | `--hb-border-muted` | `border-muted`, `divide-muted` |
| `fg`, `fg-muted`, `fg-on-emphasis` | `--hb-fg`, `--hb-fg-muted`, `--hb-fg-on-emphasis` | `text-fg`, `text-fg-muted` |
| `accent`, `accent-subtle` | `--hb-accent`, `--hb-accent-subtle` | `text-accent`, `bg-accent-subtle` |
| `success`, `success-emphasis`, `success-subtle` | `--hb-success`, `--hb-success-emphasis`, teinte dérivée | `text-success` |
| `danger`, `danger-subtle` | `--hb-danger`, teinte dérivée | `text-danger`, `border-danger` |
| `attention`, `attention-subtle` | `--hb-attention`, teinte dérivée | `text-attention` |
| `focus` | `--hb-focus` | `outline-focus` |

Attention : `default` et `muted` sont les noms Tailwind des bordures ; `text-muted` n'est donc pas le gris secondaire (utiliser `text-fg-muted`).

Autres tokens exposés : `font-sans` / `font-mono` ; tailles `text-xs` (12 px), `text-sm` (14 px, base), `text-base` (16 px, titre de carte), `text-lg` (20 px, titre de page), `text-xl` / `text-2xl` (24 / 32 px) ; poids `font-normal` (400) et `font-semibold` (600) uniquement ; rayons `rounded-box` (6 px), `rounded-dialog` (12 px), `rounded-pill` ; ombre `shadow-floating` (flottants uniquement) ; chiffres tabulaires `tabular-nums`. Les teintes `*-subtle`, `page` et `hover` sont dérivées dans `tokens.css` (`color-mix`) et ne figurent pas dans le tableau de §2.1.

Classes de composants (`core/theme/components.css`, `@layer components`) : `btn` (+ `btn-primary`, `btn-danger`, `btn-invisible`, `btn-icon`, `btn-compact`), `field` / `field-error`, `switch`, `box` / `box-header` / `box-body` / `box-row`, `topbar`, `underline-nav` / `underline-nav-item` (+ `is-active`), `page-header` / `page-title`, `menu` / `menu-item`, `flash` (+ `flash-danger`, `flash-attention`), `empty-state`.

Contrôles automatiques : `apps/web/scripts/check-design-tokens.mjs` (dans `npm run lint`) refuse toute couleur brute (palette Tailwind, hexadécimal, `rgb()`/`oklch()`…) hors `tokens.css` et `homebase-preset.ts` ; `apps/web/scripts/check-contrast.mjs` (dans `npm run test`) vérifie le contraste AA des paires de §6.

## 6. Vérification
- Chaque écran est vérifié en clair et en sombre (capture de l'exe release via le port de débogage WebView2, comme en fin de phase 0).
- Contraste AA vérifié sur les paires de tokens texte/fond (test Vitest sur les valeurs de `tokens.css`, ou vérification documentée).
- La revue UI vérifie : bordures plutôt qu'ombres, une seule action primaire par vue, classes sémantiques uniquement, focus visible et états vides/erreur conformes au §3.
