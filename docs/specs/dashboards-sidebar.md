# Spec : plusieurs tableaux de bord, barre verticale, grille de 8 lignes

- **Statut** : prête à implémenter. Révision 3 (2026-11-06) : deuxième revue « OK avec réserves », réserves intégrées ; décisions de Marius au §12
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§7)
- **Liens** : `CLAUDE.md` ; `docs/DESIGN.md` ; ADR-001 (contrat Widget) ; ADR-002 (données) ; ADR-003 (temps) ; `docs/specs/backup-restore.md` §3 D3, §4.7, §4.12, §9

Cette spec vaut compte rendu de décision. Elle ne modifie aucun autre document : les amendements à appliquer par le coordinateur sont rédigés au §10. Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`, sauf mention.

---

## 1. Contexte et périmètre

Aujourd'hui : une barre supérieure (nom de l'app, onglets, thème), une page « Accueil » avec un H1, un seul tableau de bord affiché, une grille gridster en mode `verticalFixed` qui défile (lignes de 96 px, jusqu'à 200 lignes), un mode « Modifier la disposition » qui seul autorise le déplacement.

Cible, avec les mots de Marius :

1. La hauteur cumulée de la grille ne dépasse jamais la fenêtre, sans défilement : **8 lignes qui s'adaptent**, comme les 12 colonnes.
2. Plus de H1 ni de nom d'app visibles.
3. Barre de navigation **verticale à gauche, sans changement de couleur de fond ni de bordure** par rapport à la page, faite de **bulles** avec une icône ; le nom s'affiche à côté, **dans une bulle de texte**, au survol et au focus clavier.
4. **Plusieurs tableaux de bord**, chacun une bulle ; une icône d'ajout en bas des icônes de tableaux crée un tableau (nom + icône).
5. Ajout de widget : **+ vert** en bas de la barre, pop-up de widgets, puis l'icône devient **bleue avec le symbole V** ; clic sur le V : fin, retour au + vert.
6. **Toujours déplaçable** : plus de mode édition ; poignée au survol et au focus de l'en-tête ; poignée de redimensionnement au survol.

**Hors périmètre** (non demandé, à ne pas improviser) : réordonner les tableaux ; déplacer un widget d'un tableau à l'autre à la main (seul le cas de débordement du §4.2 déplace des widgets) ; titre de fenêtre par tableau ; Playwright (tâche séparée de la ROADMAP, décision de Marius).

---

## 2. Faits vérifiés et suppositions

### 2.1 Vérifiés (lecture du dépôt et de `node_modules` ; confirmés par les revues indépendantes du 2026-11-05 et du 2026-11-06)

Références de lignes : `node_modules/angular-gridster2/fesm2022/angular-gridster2.mjs` (version 21.0.1, `package.json`).

| # | Fait | Source |
|---|---|---|
| V1 | `setGridDimensions` : `rows = max(minRows, y + rows des items placés) + addEmptyRowsCount`, `columns = max(minCols, x + cols)` | l. 1163-1193 |
| V2 | Sans `outerMargin` : `curColWidth = (curWidth + margin) / columns`, `curRowHeight = ((curHeight + margin) / rows) * rowHeightRatio`. Donc `rows × curRowHeight − margin = curHeight` : 8 lignes remplissent exactement la hauteur. Idem pour 12 colonnes. Dans cette branche, `outerMarginTop/Right/Bottom/Left` ne sont pas lus | l. 1238-1245, 3551-3554 |
| V3 | En `fit`, la taille mesurée est `offsetWidth/offsetHeight` | l. 1152-1155 |
| V4 | `setGridSize: true` écrit à chaque layout un `width` et un `height` en ligne : c'est la cause de l'élargissement corrigé par b04cf09. `setGridSize: false` retire ces styles et la classe `gridSize` | l. 1247-1258 |
| V5 | CSS de la lib : `gridster{position:relative;width:100%;height:100%;...}`, `gridster.fit{overflow-x:hidden;overflow-y:hidden}` | l. 1543 |
| V6 | **Piège** : à l'ajout d'un item en collision ou hors `maxRows`, `addItem` appelle `autoPositionItem`, qui modifie l'item puis appelle `itemChanged` (donc une écriture en base). S'il n'y a pas de place : `notPlaced = true` et `display: none` : **le widget disparaît** | l. 1298-1313, 1391-1403, 3543, CSS l. 3672 |
| V7 | `checkGridCollision` refuse `y + rows > maxRows` ; le déplacement à la souris annule une position invalide | l. 1347-1371, 2440-2447 |
| V8 | La lib n'écoute que `window.resize` : un bandeau qui change la hauteur du conteneur n'est pas détecté. `api.resize()` existe | l. 996-1003, 1030-1032, 1112-1123 |
| V9 | `scroll()` fait défiler `gridster.el` près des bords pendant un drag, sauf `disableScrollVertical/Horizontal` ; `overflow: hidden` reste défilable par programme | l. 1894-1947 |
| V10 | `draggable.ignoreContent: true` : le drag ne démarre que depuis un élément portant `dragHandleClass`. Bouton gauche seulement. `preventDefault` n'est appelé qu'au démarrage effectif : sélection de texte et clics dans le corps intacts | l. 417-421, 434-448, 2219-2230, 2504-2512 |
| V11 | **Piège** : `resizable.handles` active 8 poignées par défaut ; `n`, `e`, `s`, `w` sont des bandes invisibles de 10 px sur les bords (`n` recouvre le bouton supprimer, `e` l'ascenseur du corps). `handles` est honoré par poignée | l. 351-360, 3626-3638, l. 3672 |
| V12 | `enableBoundaryControl` borne avec `outerMargin<Côté> ?? margin`. Déplacement : bord de la grille ± cette valeur (l. 2278-2316). **Redimensionnement sud et est : `box − 2 × valeur`, puis `Math.ceil`** (l. 3150-3157, 3179-3186) : avec `margin` = 16, la dernière ligne n'est atteignable que si une ligne dépasse 48 px. Avec `outerMarginTop/Right/Bottom/Left: 0`, la borne devient le bord exact, sans effet sur V2 | gridster |
| V13 | Le bouton **supprimer du widget n'est pas lié au mode édition** ; seule la poignée l'est (`@if (editing())`) | `core/widgets/widget-host.component.html` l. 9, 30-40 |
| V14 | `.box` en flex colonne, `.box-body` en `overflow: auto; min-height: 0; flex: 1`, `.box-header` en `min-height: 48px` : le contenu défile déjà dans la carte | `core/theme/components.css` l. 170-204 |
| V15 | **Piège** : `DashboardComponent` déplace le focus dès que `instances().length` diminue : changer de tableau volerait le focus | `core/dashboard/dashboard.component.ts` l. 97-106 |
| V16 | `DashboardStore.load` vide `layoutPending` : charger un autre tableau sans vider d'abord perdrait des écritures | `core/dashboard/dashboard.store.ts` l. 91 |
| V17 | Fenêtre : 1280 × 800 par défaut, minimum 800 × 600 | `tauri.conf.json` l. 19-22 |
| V18 | Six définitions de widgets et non sept : `hello` (h min/déf/max 1/2/4), `search` (1/1/6), `notes` (2/3/8), `shortcuts` (2/3/8), `weather` (2/4/8), `todo` (2/4/**12**) | `widgets/*/*.definition.ts` |
| V19 | PrimeIcons contient toutes les icônes de la liste du §4.6. **Aucune manette de jeu** | `node_modules/primeicons/primeicons.css` |
| V20 | SQLite : `ADD COLUMN NOT NULL` exige un défaut non nul ; un `CHECK` ajouté est testé sur les lignes existantes (depuis 3.37) ; colonne en fin de liste. La revue a exécuté V4 sur V1 à V3 | https://www.sqlite.org/lang_altertable.html |
| V21 | `expected_schema(v)` et `supported_schema_version()` sont dérivés de `db::migrations()`. Une archive V3 reste acceptée ; la migration se fait au démarrage suivant, après `pre-migration` | `src/backup/validate.rs` l. 241-261, `src/backup/sqlite.rs` l. 9-15, `src/backup/b3_tests.rs` l. 197-218 |
| V22 | **Lacune** : `make_database` et `expected_schema` passent tous deux par `raw_sql`, donc leur comparaison est tautologique ; aucun test ne restaure une archive au schéma courant produite par le vrai migrateur ; V4 est le premier `ALTER` | `src/backup/test_support.rs`, `validate_tests.rs` l. 195 |
| V23 | Tests Rust qui supposent que 3 est la dernière version : `sqlite.rs` l. 70 ; `validate_tests.rs` l. 617-642 ; `b3_tests.rs` l. 144 ; `config_transfer_tests.rs` l. 67, l. 71 (`INSERT INTO dashboards VALUES` positionnel) | grep |
| V24 | `DashboardRepository.rename` n'a aucun appelant en production | grep |
| V25 | `p-dialog` : Échap n'agit que si `closeOnEscape && closable` (l. 838), le clic sur le voile que si `closable && dismissableMask` (l. 635). Avec `[closable]="false"`, ni l'un ni l'autre. Motif du dépôt : `host: { '(document:keydown.escape)': 'onEscape()' }`, ignoré pendant une écriture | `primeng-dialog.mjs` ; `features/settings/backup-settings.component.ts` l. 52, 226-227, 453-455 |
| V26 | `ConfirmDialog` a `appendTo = 'body'` ; `Dialog` prend `config.overlayAppendTo()` par défaut | `primeng-{confirmdialog,dialog}.mjs` |
| V27 | La liste de la recherche est un popover placé sous le champ, `maxHeight = max(160, place restante)` : sur la dernière ligne, elle sortirait de la fenêtre | `widgets/search/search.component.ts` l. 264-274 |
| V28 | `notes` et `todo_lists` référencent `widget_instances` en `ON DELETE CASCADE` ; `shortcuts` est global : les raccourcis survivent à la suppression d'un tableau | `migrations/V2__*.sql`, `V3__*.sql` |
| V29 | Le thème s'applique sans `LayoutComponent` (`App` injecte `ThemeService`) ; seul `layout.component.html` appelle `cycle()` | `app.ts` l. 13 |
| V30 | Aucun test e2e ; les specs tournent sous jsdom | glob, `apps/web/package.json` |
| V31 | F5 sur une route par chemin fonctionne en release | `docs/ROADMAP.md` l. 21 |
| V32 | Contrastes : blanc sur `#1f6feb` ≈ 4,63:1 ; blanc sur `#0969da` ≈ 5,19:1 ; blanc sur `#4493f8` ≈ **3,10:1** (insuffisant pour du texte). `check-contrast` fait foi | calcul, `apps/web/scripts/check-contrast.mjs` |
| V33 | `parseConfigImport` fait le `safeParse` strict **avant** de lire `formatVersion` : un champ inconnu d'un format plus récent donne `unknown_field`, pas `unsupported_version` | `core/backup/config-transfer.ts` l. 360-373 |
| V34 | `DASHBOARD_REPOSITORY`, `SETTINGS_REPOSITORY`, `WIDGET_INSTANCE_REPOSITORY` n'ont pas de fournisseur racine : toute spec qui instancie la barre doit les fournir | `data/data.providers.ts` l. 39-43 |
| V35 | **Piège** : `npm run dev` = `tauri dev` avec l'identifiant `fr.mariusdev.homebase`, donc la **vraie base** de Marius (`%APPDATA%\fr.mariusdev.homebase\homebase.db`), ses sauvegardes et leur rétention. `npm run tauri dev` et `cargo tauri dev` aussi | `package.json` l. 11, 13, `tauri.conf.json` l. 5, ADR-002 F6/F7 |
| V36 | `homebase.lock` vit dans `app_config_dir()`, donc dans le dossier de l'identifiant | `src/backup/lock.rs` l. 4-17, `paths.rs` l. 4 |
| V37 | Types de sauvegarde : `BackupKind { Manual, Daily, PreMigration, PreRestore, PreImport }`, réserve `Safety` = `PreRestore` et `PreImport` (5 archives), base seule pour `PreMigration` et `PreImport` ; `newest_full_backup` exclut `PreImport` ; front : `BACKUP_KINDS` + `backup.kind.*` | `src/backup/names.rs` l. 7-61, `mod.rs` l. 51, `list.rs` l. 106-116, `core/backup/backup.types.ts` l. 6-13 |
| V38 | `tauri-plugin-single-instance` 2.5.4 nomme son mutex Windows `{identifier}-sim` : app de dev et exe installé peuvent tourner ensemble | revue du 2026-11-06 (source du crate) |
| V39 | **Piège** : `tauri-plugin-autostart` 2.7.0 écrit la valeur `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\<app_name>` avec `app_name = package_info().name` (= `productName` « Homebase ») et le chemin de l'exe courant. Le réglage de démarrage automatique est exposé dans Réglages (`set_autostart`). Avec le seul identifiant changé, l'app de dev **écraserait l'entrée réelle** | `src/lib.rs` l. 87-90, `src/spike.rs` l. 84-89, revue (source du plugin) |
| V40 | `AppLock` : types `restore` et `import` ; `appUnlockedGuard` n'est posé que sur `settings` ; `SearchHotkey` écoute `keydown` sur `document`, donc à travers un dialogue modal | `core/lock/app-lock.ts`, `app.routes.ts`, `core/search/search-hotkey.ts` l. 26 |

### 2.2 Supposés (à vérifier ; si faux : s'arrêter et rapporter)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Grille pleine à 8 lignes : le « push » de gridster refuse le déplacement sans laisser d'item hors grille | M4 |
| S2 | `overflow: clip` et `overflow-clip-margin` actifs dans la WebView2 (Chromium ≥ 90) | M1 |
| S3 | Sous WebView2, `Maj+F10` et la touche Menu déclenchent `contextmenu` sur l'élément focalisé, ou au moins `keydown` | M9 ; le code écoute les deux |
| S4 | `@defer (on immediate)` se joue dans TestBed avec `deferBlockBehavior: DeferBlockBehavior.Playthrough` | specs du lot C3a |
| S5 | `tauri dev --config <fichier>` fusionne le fichier ; un chemin relatif est résolu depuis le dossier courant (racine du dépôt) | Lot 0, critère 0-1 |
| S6 | `package_info().name` suit `productName` de la configuration fusionnée (le titre de fenêtre, fixé à part dans `app.windows[0].title`, reste « Homebase ») | Lot 0, étape 3 (valeur `Run` « Homebase Dev ») |
| S7 | Le feature `migrate` de sqlx 0.8 est disponible dans le crate de l'app (unification avec `tauri-plugin-sql`) | Lot C1, test du vrai migrateur |
| S8 | Zone client ≈ fenêtre − 39 px en hauteur et − 16 px en largeur (tailles du D4) | M1 |

---

## 3. Décisions

### D0. Développement isolé de la vraie base et du vrai démarrage automatique (bloquant)
`npm run dev` fusionne `tauri.dev.conf.json` : identifiant `fr.mariusdev.homebase.dev` (dossier de données, base, sauvegardes et `homebase.lock` distincts, V35, V36, mutex distinct, V38) et `productName` « Homebase Dev » (entrée `Run` distincte, V39). `tauri.conf.json` reste inchangé : l'exe installé garde l'identifiant et le nom réels. La base de dev se remplit en y restaurant une archive réelle (M3 rejouable). La vraie base ne voit la V4 qu'au lancement de l'exe release, pour les vérifications finales, juste avant la fusion. **Le texte de V4 est figé à la revue du lot C1** : toute modification ultérieure devient une V5. Procédure de retour arrière au §9.

*Amendement (spec dashboard-theme)* : V4 est figée depuis le commit 8982993. La spec dashboard-theme ajoute V5 sur cette même branche, figée à la revue de son lot T2 ; aucun `npm run dev` du début de T2 jusqu'à cette revue. La vraie base passe de V3 à V5 au premier lancement de l'exe release.

Interdits : `npm run tauri dev` et `cargo tauri dev` (configuration réelle, V35) ; enregistrer un export ou une archive de l'app de dev dans `%APPDATA%\fr.mariusdev.homebase\backups\` (une archive de dev y serait listée, restaurable et soumise à la rotation réelle).

### D1. Grille : `gridType: 'fit'`, 12 × 8 fixes
**Retenu** : `gridType: 'fit'`, `minCols = maxCols = 12`, `minRows = maxRows = 8`, `margin = 16`, `outerMargin: false` **et `outerMarginTop/Right/Bottom/Left: 0`** (V12), `setGridSize: false`, `addEmptyRowsCount: 0`, `mobileBreakpoint: 0`, `disableScrollVertical/Horizontal: true`. V1 et V2 prouvent le remplissage exact.
*Rejeté* : `verticalFixed` avec une hauteur calculée à la main ; CSS Grid maison (perd drag, push et redimensionnement).

### D2. Commit b04cf09
| Élément | Verdict | Raison |
|---|---|---|
| `width: 100% !important` | **Retiré** (test `scripts/test-dashboard-grid-css.mjs` réécrit) | `setGridSize: false` ne pose plus de largeur en ligne (V4) |
| `scrollbar-gutter: stable` sur `html` | **Retiré** | `html` ne défile plus ; la gouttière réserverait une bande vide |
| `enableBoundaryControl` | **Conservé**, avec les `outerMargin*` à 0 | Garde la carte déplacée visible ; les marges à 0 rendent la dernière ligne et la dernière colonne atteignables au redimensionnement à toute taille (V12) |

### D3. Dispositions hors de 8 lignes : repositionnement **à l'affichage**, écrit à la première modification
`fitLayout` (§4.2), pure et déterministe, calcule le rectangle affiché de chaque widget à partir du stocké. Rien n'est écrit au chargement. **Toute modification** (déplacement, redimensionnement, ajout, suppression d'un widget) écrit en un seul lot tous les widgets placés dont le stocké diffère de l'affiché. La revue a simulé `fitLayout` sur 200 000 dispositions : aucun chevauchement, aucune perte, déterministe, idempotent.

Justification :
- **Réversible** : tant que Marius ne touche à rien, la base garde la disposition d'origine.
- **Pas d'écriture à la lecture** : conforme à l'ADR-001 §3.5, testable.
- **Stable** : sans l'écriture groupée, supprimer B ferait bouger les autres. Exemple : A, B, C(4,0), D(8,0) affichés ; sans écriture, après suppression de B, `fitLayout` repartirait du stocké et donnerait C(0,5), D(4,0).
- **Protège de V6** : gridster ne reçoit que des positions valides.

*Rejeté* : migration SQL (les tailles ne sont connues que du front ; destructif) ; réécriture au premier affichage (destructif sans action) ; laisser faire gridster (V6).

**Si la grille ne peut pas tout contenir** : bandeau avec les noms et l'action « Les déplacer vers un nouveau tableau ». Supprimer ou réduire un widget libère de la place : un widget sans place y est reposé, aucun voisin ne bouge.

### D4. Tailles des widgets (**décidé par Marius**)
| Widget | Avant (`h` min/déf/max) | Après |
|---|---|---|
| `todo` | 2 / 4 / 12 | 2 / 4 / **8** |
| `search` | **1 / 1** / 6 | **2 / 2** / 6 |
| `hello` | **1** / 2 / 4 | **2** / 2 / 4 |
| `notes`, `shortcuts`, `weather` | inchangés | inchangés |

Une carte d'une ligne ne montre que son en-tête (48 px). **`min.h ≥ 2` pour tout widget réel**, contrôlé par `widgets.providers.spec.ts`. Une ancienne recherche en `h = 1` s'affiche en `h = 2`.

Géométrie (S8, marges de page de 16 px) :

| Fenêtre | Ligne | Carte h=2 | Corps utile h=2 | Colonne | Carte w=2 |
|---|---|---|---|---|---|
| 800 × 600 (minimum) | 68 px | 120 px | 38 px | 60 px | 104 px |
| 1280 × 800 (défaut) | 93 px | 170 px | 88 px | 100 px | 184 px |

Pas de hauteur minimale de grille ni de changement de taille minimale de fenêtre.

### D5. Hauteur de page : seul le dashboard est sans défilement
La coquille fait `100dvh` ; `main` est une colonne flex en `overflow-y: auto` ; le dashboard y prend `flex: 1 1 0; min-height: 0`. Une page ordinaire garde sa hauteur de contenu et `main` défile (Réglages). `html` passe en `overflow: hidden`.

### D6. Bandeaux et redimensionnement : `ResizeObserver`
Un `ResizeObserver` sur la zone de grille appelle `Gridster.api.resize()` (V8). Les bandeaux restent au-dessus ; les lignes rétrécissent.

### D7. Barre : un lien par bulle, ordre, rôles ; **bouton de thème retiré**
De haut en bas : bulles des tableaux (zone défilante), `+` neutre (« Nouveau tableau de bord »), espace, `+` vert (widget), Réglages tout en bas (ordre choisi par Marius sur aperçu). *Amendement (spec dashboard-theme)* : une bulle palette (thème du tableau courant) s'insère entre l'espace et le `+` vert.

`<nav>` avec des listes de liens et de boutons ; **ni `menubar` ni flèches** : `Tab` parcourt les bulles. `aria-current="page"` sur l'active.

**Changement explicite** (présenté à Marius sans objection, §12) : le bouton de thème quitte la barre ; le réglage reste dans Réglages. `cycle()` et `theme.toggle` sont retirés (V29).

Titre accessible : `<h1 class="sr-only">` avec le nom du tableau. Le titre de fenêtre reste « Homebase — Tableau de bord ».

### D8. Bulle de texte : un seul élément flottant piloté en TS
La liste défile (jusqu'à 100 tableaux) ; une bulle CSS interne serait coupée. Donc un seul `.sidebar-label` en `position: fixed`, hors de la zone défilante, `aria-hidden="true"`, placé d'après la bulle d'ancrage. Affichage : `mouseenter`, ou `focusin` si `:focus-visible`. Retrait : `mouseleave`, `focusout`, Échap. **Au défilement de la liste, la bulle est repositionnée sur sa bulle d'ancrage**, et retirée si celle-ci sort de la zone visible. Écart assumé à WCAG 1.4.13 (« survolable ») : `pointer-events: none` ; l'information est dans `aria-label`. Pas de `title`.

### D9. Actions d'un tableau : clic droit et `Maj+F10`
Clic droit, `Maj+F10` ou touche Menu sur la bulle : menu « Modifier… » (nom + icône, même formulaire que la création) et « Supprimer… ». `aria-describedby` annonce ces raccourcis. Dernier tableau : « Supprimer (impossible : dernier tableau) », désactivé. *Rejeté* : bouton ⋯ par bulle.

### D10. Suppression d'un tableau : confirmation forte, **sauvegarde `pre-delete`**, application figée (sauvegarde décidée par Marius)
Dialogue : nombre de widgets, notes et tâches supprimées, raccourcis conservés, case « Je comprends que cette suppression est définitive » qui seule active le bouton danger, focus initial sur Annuler. Tableau vide : pas de case. Dernier tableau jamais supprimable.

Juste avant la suppression : **sauvegarde de sécurité de la base seule**, type `pre-delete`, dans la réserve de sécurité (5, partagée avec `pre-restore` et `pre-import`). **Son échec annule la suppression.** Sauvegarde et suppression sont faites par **une commande Rust unique** `dashboard_delete(id)`, sous le verrou de sauvegarde, comme `config_import_apply` : aucune fenêtre entre les deux, et le front ne peut pas supprimer sans sauvegarde. La commande vérifie **avant** la sauvegarde que le tableau existe et qu'il n'est pas le dernier : une suppression vouée à l'échec n'évince pas une sauvegarde de la réserve.

Pendant la sauvegarde et la suppression, **l'application est figée par `AppLock`** (nouveau type `delete`) : barre et page `inert`, navigation refusée sur les routes de tableaux (`appUnlockedGuard`), `Ctrl+K` ignoré (V40). Sans cela, `Ctrl+K` pourrait ramener l'utilisateur sur le tableau en cours de suppression.

Conséquence assumée : une rafale de suppressions peut évincer d'anciennes sauvegardes `pre-restore` ou `pre-import` (rotation bornée, comme aujourd'hui).

### D11. Icône : forme contrôlée en base, liste fermée côté front
`dashboards.icon` stocke le nom court PrimeIcons (`briefcase`). Le `CHECK` ne fige que la forme. Seule une icône de la liste (`core/dashboard/dashboard-icons.ts`) produit une classe CSS ; une valeur inconnue s'affiche avec l'icône par défaut, sans être écrasée.

### D12. Routage
| Route | Comportement |
|---|---|
| `/dashboards/:id` | Le tableau `:id`. Inconnu : redirection vers `/` (`replaceUrl`). `canDeactivate: [appUnlockedGuard]` |
| `''` | Garde : dernier ouvert s'il existe, sinon le premier. Données indisponibles ou erreur de lecture : la route affiche `DashboardComponent` et son message d'erreur, jamais une page vide ni une `NavigationError`. `canDeactivate: [appUnlockedGuard]` |
| `settings` | Inchangée |
| `**` | Vers `''` |

Dernier ouvert : réglage `dashboard.last` (UUID), écrit sans bloquer à chaque ouverture réussie. **Exclu de l'export et ignoré à l'import** (donnée de session, pas de configuration).

### D13. Store « courant ou aucun », avec une session
`DashboardStore.open(id)` charge, `close()` (destruction de `DashboardComponent`) vide. **Chaque `open` et chaque `close` incrémente `session`.** Un état qui dépend du tableau courant (l'ajout de widget, une demande de focus, un `Ctrl+K` en attente) mémorise la session de sa création et n'a plus d'effet dès que la session change. L'état ne peut pas revenir : retourner sur le même tableau crée une nouvelle session.

### D14. Ajout de widget (V décidé par Marius : il termine simplement)
Voir §4.9. Échap sur le V : même effet que le clic, seulement quand le focus est sur ce bouton. Changement de page, de tableau, retour arrière (`Alt+←`), retour sur le même tableau : fin (D13). Second widget : cliquer d'abord sur le V. Suppression du widget nouveau pendant le V : retour au `+`.

### D15. Poignées
Déplacement : bouton toujours dans le DOM, superposé à l'icône du widget, visible au survol ou au focus de l'en-tête, sans décalage de mise en page. Redimensionnement : poignée `se` seule (V11), visible au survol de la carte ; au clavier, `Maj+flèches`.

### D16. Export : `formatVersion` passe à 2, lu avant la validation stricte
`icon` est obligatoire en version 2 et absent en version 1. Les fichiers v1 restent acceptés, avec l'icône par défaut (y compris pour un tableau existant personnalisé : l'import remplace par identifiant).

Limite connue (V33) : le binaire actuel, en lisant un fichier v2, répond `unknown_field@dashboards[0].icon` et non `unsupported_version`. Le refus est correct, le message moins clair ; on ne peut pas corriger un binaire déjà livré. **Le nouveau code lit `formatVersion` avant la validation stricte** : un futur format 3, même avec des champs inconnus, donnera bien `unsupported_version`. Le plan envoyé à Rust porte toujours `icon` (`deny_unknown_fields` conservé).

### D17. Dialogues : `p-dialog` en `@defer`, Échap géré par le composant
Même composant que la restauration. `[closable]="false"`, donc Échap et voile inopérants côté PrimeNG (V25) : chaque dialogue reprend le motif de `backup-settings.component.ts`, `host: { '(document:keydown.escape)': 'onEscape()' }`, ignoré pendant une écriture. **Pas de `dismissableMask`**. Composants dans des `@defer (on immediate)` (bundle initial ≈ 444 kB, avertissement à 500 kB). `appendTo="body"` (V26).

### D18. `Ctrl+K` : aller à la barre de recherche (décidé par Marius) ; `/` reste local
- **`Ctrl+K`** : si le tableau courant contient une barre de recherche, focus comme aujourd'hui. Sinon : navigation vers le premier tableau (ordre de la barre) qui en contient une, puis focus du champ. Aucun : rien. Valable aussi depuis Réglages.
- **`/`** : comportement actuel, page courante seulement (un raccourci d'une seule touche ne doit pas faire quitter Réglages).
- **Sous `AppLock`** (restauration, import, suppression d'un tableau) : les deux touches sont ignorées par `SearchHotkey`, et toute navigation depuis un tableau ou Réglages est refusée par `appUnlockedGuard`.

---

## 4. Conception détaillée

### 4.0 Lot 0 : configuration de développement

`apps/desktop/src-tauri/tauri.dev.conf.json` :
```json
{
  "identifier": "fr.mariusdev.homebase.dev",
  "productName": "Homebase Dev"
}
```
`package.json` (racine) : `"dev": "tauri dev --config apps/desktop/src-tauri/tauri.dev.conf.json"` (S5 : vérifier la résolution du chemin ; si elle est relative à `src-tauri`, utiliser `--config tauri.dev.conf.json` ; dans tous les cas, contrôler le dossier de données obtenu). `tauri.conf.json`, `npm run build` et la CI restent inchangés.

Test Rust (dans `db.rs`, à côté de `preload_contains_db_url`) : `tauri.dev.conf.json` est un objet JSON dont les **seules** clés sont `identifier` et `productName` ; `identifier` vaut celui de `tauri.conf.json` suffixé de `.dev` ; `productName` vaut celui de `tauri.conf.json` suivi de ` Dev` ; le script `dev` de `package.json` (racine) contient `--config` et ce nom de fichier. Aucune autre clé n'est permise : la configuration de sécurité (CSP, capabilities) ne doit jamais différer en dev.

### 4.1 `core/widgets/grid.ts`

```ts
export const GRID_COLUMNS = 12;
/** Total rows of a dashboard, and the tallest a widget can be. Replaces GRID_MAX_ROWS (24). */
export const GRID_ROWS = 8;

/** Bounds w/h to [min, min(max, GRID_ROWS)], x to [0, GRID_COLUMNS - w], y to [0, GRID_ROWS - h]; floors; NaN -> min (w/h) or 0 (x/y). */
export function clampGrid(grid: GridRect, constraints: WidgetSizeConstraints): GridRect;

export function rectsOverlap(a: GridRect, b: GridRect): boolean;

/**
 * First free rect, scanning rows then columns. Tries `preferred`, then shrinks: h from preferred.h
 * down to min.h, and for each h, w from preferred.w down to min.w. null when nothing fits.
 */
export function nextFreePosition(
  existing: readonly GridRect[],
  preferred: GridSize,
  min: GridSize = preferred,
): GridRect | null;
```
`GRID_MAX_ROWS` et `GRID_MAX_TOTAL_ROWS` disparaissent. `core/widgets/index.ts`, `widget-registry.ts` (`size.max.h ≤ GRID_ROWS`) et `grid-adapter.ts` suivent.

### 4.2 `core/dashboard/grid-layout.ts`

```ts
export interface FittedLayout {
  /** Displayed rect by instance id. */
  readonly placed: ReadonlyMap<string, GridRect>;
  /** Ids without room, in input order. */
  readonly unplaced: readonly string[];
}

export function fitLayout(entries: readonly LayoutEntry[]): FittedLayout;
```

Entrées triées comme `listByDashboard` (`y`, `x`, `createdAt`, `id`) :
1. **Passe 1.** `bounded = clampGrid(grid, constraints)`. Si `bounded.x === grid.x && bounded.y === grid.y` et que `bounded` ne chevauche rien de placé : placé. Sinon : mis de côté.
2. **Passe 2**, dans l'ordre. `bounded` libre : placé. Sinon `nextFreePosition(placés, { w: bounded.w, h: bounded.h }, constraints.min)`. `null` : `unplaced`.

Un widget sans place n'occupe rien : le retirer ne change la position d'aucun autre.

`nudgeRect` : un **redimensionnement ne déplace jamais l'origine** ; si `clampGrid` change `x` ou `y` alors que `dw` ou `dh` est présent, le rectangle d'origine est renvoyé (refus).

`applyNudge` : si un élément poussé vers le bas dépasserait `GRID_ROWS`, **tout le déplacement est refusé** (`[]`) et l'hôte annonce `widgetHost.layout.blocked`.

### 4.3 `core/dashboard/grid-adapter.ts` et CSS

```ts
export interface GridOptionsParams {
  readonly onItemChange: (item: DashboardGridItem) => void;
  /** Called by draggable.start and resizable.start (diagnostic of V6, see below). */
  readonly onInteractionStart: () => void;
}

export function buildGridOptions(params: GridOptionsParams): GridsterConfig {
  return {
    gridType: 'fit',
    setGridSize: false,
    minCols: GRID_COLUMNS,
    maxCols: GRID_COLUMNS,
    minRows: GRID_ROWS,
    maxRows: GRID_ROWS,
    minItemCols: 1,
    minItemRows: 1,
    maxItemCols: GRID_COLUMNS,
    maxItemRows: GRID_ROWS,
    margin: GRID_GAP,
    outerMargin: false,
    // Read by enableBoundaryControl only (V12): 0 = the exact edge of the grid.
    outerMarginTop: 0,
    outerMarginRight: 0,
    outerMarginBottom: 0,
    outerMarginLeft: 0,
    mobileBreakpoint: 0,
    compactType: 'none',
    displayGrid: 'none',
    pushItems: true,
    disablePushOnDrag: false,
    disablePushOnResize: false,
    pushResizeItems: false,
    swap: false,
    scrollToNewItems: false,
    enableBoundaryControl: true,
    disableScrollVertical: true,
    disableScrollHorizontal: true,
    addEmptyRowsCount: 0,
    draggable: {
      enabled: true,
      ignoreContent: true,
      dragHandleClass: DRAG_HANDLE_CLASS,
      start: () => params.onInteractionStart(),
    },
    resizable: {
      enabled: true,
      handles: { s: false, e: false, n: false, w: false, se: true, ne: false, sw: false, nw: false },
      start: () => params.onInteractionStart(),
    },
    itemChangeCallback: (item) => {
      if (isDashboardGridItem(item)) params.onItemChange(item);
    },
  };
}
```
`GRID_ROW_HEIGHT` et `boundGrid` disparaissent. `fallbackConstraints` borne `default` et `max` à `GRID_ROWS`. Options **constantes** dans le composant (un objet qui change relance tout le calcul de gridster, l. 1028-1042).

Diagnostic de V6 : `DashboardComponent` pose un drapeau `interacting` dans `onInteractionStart`, et le retire dans `flushLayout`. Un `onItemChange` reçu sans geste en cours déclenche un `console.warn('gridster moved an item by itself', id)` ; l'item est quand même enregistré, puisqu'il est affiché ainsi. Ce cas ne doit pas se produire (D3).

`dashboard.component.css` :
```css
app-dashboard .dashboard-grid-area {
  position: relative;
  min-height: 0;
  flex: 1 1 0;
}
app-dashboard gridster.dashboard-grid {
  /* Absolute: its size never depends on a percentage of a flex item. */
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  /* clip: unlike hidden, cannot be scrolled by a script; the margin keeps a sub-pixel border. */
  overflow: clip;
  overflow-clip-margin: 2px;
  background: transparent;
  user-select: none;
}
```
Les règles `gridster-item`, `.gridster-item-moving`, `gridster-preview` restent ; `.dashboard-grid-editing` disparaît (lot E).

`DashboardComponent` : `host: { class: 'flex min-h-0 flex-1 flex-col' }` ;
```ts
private readonly gridster = viewChild(Gridster);
private readonly gridArea = viewChild<ElementRef<HTMLElement>>('gridArea');
// effect(onCleanup): si la zone existe et que `typeof ResizeObserver === 'function'` (jsdom : non),
// observer la zone et appeler this.gridster()?.api.resize(); onCleanup -> disconnect().
```
La zone `#gridArea` contient la grille ou l'état vide ; les bandeaux sont ses frères, en `flex-none`.

### 4.4 Coquille

```html
<div class="flex h-dvh bg-page text-fg">
  <app-sidebar [attr.inert]="lock.isLocked() ? '' : null" />
  <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto py-4 pr-4 pl-2"
        [attr.inert]="lock.isLocked() ? '' : null">
    <ng-container #alertHost />
    <router-outlet />
  </main>
  <!-- région role="status" et voile AppLock : inchangés -->
</div>
```
`styles.css` : retirer `scrollbar-gutter` ; ajouter `html { overflow: hidden; }` dans `@layer base`. `LOCK_TEXT` (layout) gagne `delete: 'dashboards.remove.inProgress'` au lot C3b.

### 4.5 `core/layout/sidebar.component.{ts,html}`

`app-sidebar` : `host: { class: 'sidebar' }`. Classes dans `core/theme/components.css` :
```css
/* No background nor border of its own: the bar is part of the page. */
.sidebar { position: relative; z-index: 10; display: flex; width: 56px; flex: none; flex-direction: column; min-height: 0; padding-block: var(--hb-space-4); }
.sidebar-group { display: flex; flex-direction: column; align-items: center; gap: var(--hb-space-2); padding-inline: var(--hb-space-2); }
.sidebar-group-scroll { min-height: 0; flex: 0 1 auto; overflow-y: auto; scrollbar-width: none; padding-block: var(--hb-space-1); }
.sidebar-spacer { flex: 1 1 auto; min-height: var(--hb-space-2); }
.sidebar-bubble { display: inline-flex; width: 40px; height: 40px; flex: none; cursor: pointer; align-items: center; justify-content: center; border: 1px solid var(--hb-border); border-radius: var(--hb-radius-full); background: var(--hb-bg); color: var(--hb-fg-muted); transition: background-color var(--hb-transition), border-color var(--hb-transition), color var(--hb-transition); }
.sidebar-bubble:hover { background: color-mix(in srgb, var(--hb-fg) 8%, var(--hb-bg)); color: var(--hb-fg); }
.sidebar-bubble[aria-current='page'] { border-color: var(--hb-accent); background: var(--hb-accent-subtle); color: var(--hb-accent); }
.sidebar-bubble[aria-disabled='true'] { cursor: not-allowed; opacity: 0.5; }
.sidebar-bubble-add { border-color: transparent; background: var(--hb-success-emphasis); color: var(--hb-fg-on-emphasis); }
.sidebar-bubble-add:hover { background: color-mix(in srgb, black 12%, var(--hb-success-emphasis)); color: var(--hb-fg-on-emphasis); }
.sidebar-bubble-done, .sidebar-bubble-done:hover { border-color: transparent; background: var(--hb-accent-emphasis); color: var(--hb-fg-on-emphasis); }
.sidebar-label { position: fixed; z-index: 20; display: flex; max-width: 20rem; height: 32px; align-items: center; padding: 0 var(--hb-space-3); border-radius: var(--hb-radius-full); background: var(--hb-bg-emphasis); box-shadow: var(--hb-shadow-floating); color: var(--hb-fg-on-emphasis); font-weight: var(--hb-weight-semibold); pointer-events: none; }
.sidebar-label > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```
`z-index: 10` : au-dessus des cartes (1 et 2), sous le voile `AppLock` (`z-1000`). **Aucun `background` ni `border` sur `.sidebar`**, contrôlé par `scripts/test-dashboard-grid-css.mjs` (motif `\.sidebar\s*\{`). Le texte de la bulle est dans un `<span>` enfant (l'ellipse ne s'applique pas au texte direct d'un conteneur flex).

```ts
interface SidebarLabel { readonly text: string; readonly top: number; readonly left: number; }
protected readonly label = signal<SidebarLabel | null>(null);
/** Ancre courante : la bulle survolée ou focalisée, pour repositionner au défilement. */
private anchor: HTMLElement | null = null;
/** event.type === 'mouseenter', ou cible en :focus-visible. */
protected showLabel(event: Event, text: string): void;
protected hideLabel(): void;
/** (scroll) de .sidebar-group-scroll : recalcule depuis `anchor`, retire si l'ancre sort de la zone visible. */
protected onListScroll(): void;
```
Positions : bulle de texte `top = rect.top + 4`, `left = rect.right + 8` ; menu (`menu` + `position: fixed`) `left = rect.right + 8`, `top = min(rect.top, innerHeight - 96)`, rendu hors de la zone défilante.

Bulle de tableau (lot C3a) :
```html
<a class="sidebar-bubble" [routerLink]="['/dashboards', d.id]" routerLinkActive="" ariaCurrentWhenActive="page"
   [attr.aria-label]="d.name" [attr.data-dashboard-id]="d.id"
   aria-describedby="sidebar-bubble-hint"
   (contextmenu)="openMenu($event, d)" (keydown)="onBubbleKeydown($event, d)">
```
`onBubbleKeydown` : `ContextMenu` ou `Maj+F10` → `preventDefault` puis `openMenu` (idempotent). `contextmenu` : `preventDefault` aussi dans le menu ouvert. Menu : `role="menu"`, items `role="menuitem" tabindex="-1"`, focus sur le premier actif, flèches / Début / Fin en sautant les désactivés, Échap et `Tab` ferment (reprendre `DashboardComponent.onMenuKeydown`, l. 153-188), clic extérieur ferme ; Échap rend le focus à la bulle.

Région `role="status"` `sr-only` : `layout.current` à chaque changement de tableau (après le premier) et annonces du flux d'ajout.

### 4.6 V4 et `data/`

`apps/desktop/src-tauri/migrations/V4__dashboard_icon.sql` (texte exact, LF, sans BOM ; **figé à la revue du lot C1**) :
```sql
-- V4__dashboard_icon : icône d'un tableau de bord (spec dashboards-sidebar).
-- Le CHECK ne fige que la forme : la liste fermée vit dans le front et peut évoluer sans migration.
-- Immuable dès sa fusion sur main. Pas de BEGIN/COMMIT ni de PRAGMA ici :
-- sqlx exécute chaque migration dans une transaction.

ALTER TABLE dashboards ADD COLUMN icon TEXT NOT NULL DEFAULT 'th-large'
  CHECK (length(icon) BETWEEN 1 AND 32
         AND icon GLOB '[a-z]*'
         AND icon NOT GLOB '*[^a-z0-9-]*');
```
`db.rs` : `version: 4, description: "dashboard_icon"`. `checksums.json` : SHA-256 du fichier.

*Note (spec dashboard-theme)* : le thème des cartes arrive par V5 (`dashboards.theme`, `theme_version`).

`data/models.ts` :
```ts
export const DEFAULT_DASHBOARD_ICON = 'th-large';
/** Same shape as the CHECK of V4. The closed list lives in core/dashboard/dashboard-icons.ts. */
export const DASHBOARD_ICON_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export interface Dashboard { id: string; name: string; sortOrder: number; icon: string; createdAt: string; updatedAt: string; }
export interface NewDashboard { id?: string; name: string; icon?: string; }
export interface DashboardPatch { name: string; icon: string; }
```

`data/repositories.ts` :
```ts
export interface DashboardRepository {
  list(): Promise<Dashboard[]>;
  get(id: string): Promise<Dashboard | null>;
  create(input: NewDashboard): Promise<Dashboard>;       // icon par défaut : DEFAULT_DASHBOARD_ICON
  createIfNone(input: NewDashboard): Promise<boolean>;
  /** Remplace `rename` (V24). Une instruction. not_found si absent ; invalid_input si nom ou icône hors format. */
  update(id: string, patch: DashboardPatch): Promise<Dashboard>;
  /** Réservé au nettoyage d'un tableau vide qu'on vient de créer (§4.7) ; la suppression utilisateur passe par `dashboard_delete` (§4.8). */
  remove(id: string): Promise<boolean>;
}
export interface WidgetInstanceRepository {
  // existant, plus :
  /** Une instruction UPDATE ... FROM json_each. Ids en double ou valeurs invalides : invalid_input ; lot vide : 0 sans requête ; tableau absent : constraint. */
  moveToDashboard(targetDashboardId: string, items: readonly LayoutItem[]): Promise<number>;
  /** Première instance du type, dans l'ordre des tableaux (sort_order, created_at, id) puis listByDashboard ; null si aucune. */
  findFirstOfType(widgetType: string): Promise<WidgetInstanceRecord | null>;
}
```
SQL :
```sql
-- moveToDashboard
UPDATE widget_instances
SET dashboard_id = $1, grid_x = j.x, grid_y = j.y, grid_w = j.w, grid_h = j.h, updated_at = $3
FROM (
  SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.x') AS x, json_extract(value, '$.y') AS y,
         json_extract(value, '$.w') AS w, json_extract(value, '$.h') AS h
  FROM json_each($2)
) AS j
WHERE widget_instances.id = j.id;

-- findFirstOfType (colonnes de WIDGET_INSTANCE_COLUMNS préfixées par w.)
SELECT w.* FROM widget_instances AS w JOIN dashboards AS d ON d.id = w.dashboard_id
WHERE w.widget_type = $1
ORDER BY d.sort_order, d.created_at, d.id, w.grid_y, w.grid_x, w.created_at, w.id
LIMIT 1;
```

`core/dashboard/dashboard-icons.ts` :
```ts
export const DASHBOARD_ICONS = [
  'th-large', 'home', 'briefcase', 'desktop', 'code', 'wrench', 'chart-line', 'wallet',
  'calendar', 'book', 'graduation-cap', 'pencil', 'palette', 'camera', 'video', 'microphone',
  'headphones', 'play-circle', 'trophy', 'star', 'heart', 'users', 'globe', 'bolt',
] as const;
export type DashboardIcon = (typeof DASHBOARD_ICONS)[number];
/** Only a listed icon produces a class; anything else shows the default icon. */
export function dashboardIconClass(icon: string): string;
```
Usage : pro → `briefcase`, perso → `home`, streaming → `video`, jeu vidéo → `trophy` (V19).

### 4.7 Stores et routes

`core/dashboard/dashboard-list.store.ts` (bundle initial : ne doit **pas** importer `core/backup`) :
```ts
export const MAX_DASHBOARDS = 100;              // = CONFIG_LIMITS.maxDashboards
export const LAST_DASHBOARD_SETTING = 'dashboard.last';
export class DashboardLimitError extends Error {}

@Injectable({ providedIn: 'root' })
export class DashboardListStore {
  readonly dashboards: Signal<readonly Dashboard[]>;
  readonly status: Signal<'idle' | 'loading' | 'ready' | 'error'>;
  readonly canCreate: Signal<boolean>;          // ready et < MAX_DASHBOARDS
  readonly canRemove: Signal<boolean>;          // au moins 2 tableaux
  /** createIfNone puis list. Ne rejette jamais : en cas d'échec, status 'error' (une nouvelle tentative est permise). */
  load(defaultName: string): Promise<void>;
  /** Dernier ouvert s'il existe encore, sinon le premier ; null si liste vide ou en erreur. Un échec de lecture du réglage = premier. Ne rejette jamais. */
  defaultTargetId(): Promise<string | null>;
  /** settings.set sans bloquer ; une erreur est journalisée, jamais propagée. */
  rememberOpened(id: string): void;
  create(input: { readonly name: string; readonly icon: string }): Promise<Dashboard>;  // DashboardLimitError
  update(id: string, patch: DashboardPatch): Promise<Dashboard>;
  countWidgets(id: string): Promise<number>;
  /** PendingWrites.flushAll() (avant une suppression). */
  prepareRemoval(): Promise<void>;
  /** Après la suppression Rust réussie (ou un `not_found`, tableau déjà supprimé) : relit la liste. */
  afterRemoval(): Promise<void>;
}
```
Le dernier tableau est protégé par l'interface (`canRemove`) et par Rust (`last_dashboard`) : pas de classe d'erreur côté front.

`core/dashboard/dashboard.store.ts` :
```ts
export type DashboardStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
export type OpenOutcome = 'ready' | 'not-found' | 'error' | 'superseded';
export type AddBlockReason = 'limit' | 'full';
export class GridFullError extends Error { readonly widgetType: string; }

export class DashboardStore implements WidgetConfigWriter {
  readonly layout: Signal<FittedLayout>;        // computed : fitLayout(instances + contraintes)
  /** +1 à chaque open et close (D13). */
  readonly session: Signal<number>;
  /** id null : createIfNone puis premier. Remplace load(). */
  open(id: string | null, defaultName: string): Promise<OpenOutcome>;
  /** Résultat de la dernière ouverture lancée. */
  whenOpened(): Promise<OpenOutcome>;
  /** Aucun tableau courant : dashboard null, instances vides, status 'idle'. */
  close(): void;
  addBlockReason(type: WidgetTypeId): AddBlockReason | null;
  canAdd(type: WidgetTypeId): boolean;
  add(type: WidgetTypeId): Promise<WidgetInstanceRecord>;   // GridFullError ; nextFreePosition(placés, default, min)
  remove(id: string): Promise<void>;
  /** Pose les widgets sans place dans un tableau vide ; renvoie leur nombre. */
  moveUnplacedTo(targetDashboardId: string): Promise<number>;
}
```

Jeton et session :
- `open` : `++token`, `session + 1`, `status = 'loading'`, `await PendingWrites.flushAll()` (V16), puis `layoutError = false`. À **chaque** retour d'`await` (y compris dans les branches `not-found` et `error`), si `token` a changé : `'superseded'`, sans toucher l'état. `id === null` → `createIfNone` + `list()[0]` ; sinon `get(id)`, `null` → `not-found`. Puis `listByDashboard`, mise à jour, `persistedGrids` réinitialisé, `'ready'`.
- `close` : `++token`, `session + 1`, état vidé. **Ne vide pas `layoutPending`** : la chaîne d'écriture en cours se termine (son `dashboardId` est capturé ; `updateLayout` ignore les ids absents).

Écriture des repositionnés (D3), helper privé `persistDisplayed(extra)` : lot = `extra` ∪ {widgets placés dont le stocké diffère de l'affiché}, en un seul `changeLayout`. Appelé :
- par `changeLayout(items)` : comparaison à `layout().placed`, lot non vide seulement si au moins un item change réellement ;
- par `add` après la création (l'instance créée est déjà à sa place) ;
- par `remove` : l'affiché est relevé **avant** la suppression, puis, après succès, les restants reçoivent cet affiché (état local et écriture). Un widget sans place peut ensuite occuper la place libérée ; aucun voisin ne bouge.

`unplaced` n'est jamais écrit. `nudge` travaille sur `layout().placed`. `moveUnplacedTo` ne modifie pas la position des placés.

`core/dashboard/dashboard-home.guard.ts` :
```ts
export const dashboardHomeGuard: CanActivateFn = async () => {
  const list = inject(DashboardListStore);        // inject avant le premier await
  const router = inject(Router);
  const transloco = inject(TranslocoService);
  try {
    await list.load(transloco.translate('dashboard.defaultName'));
    const id = await list.defaultTargetId();
    return id === null ? true : router.createUrlTree(['/dashboards', id]);
  } catch {
    return true;                                  // jamais de NavigationError ni de page vide
  }
};
```
`app.routes.ts` :
```ts
{ path: '', pathMatch: 'full', title: 'pages.dashboard.title', canActivate: [dashboardHomeGuard], canDeactivate: [appUnlockedGuard], loadComponent: dashboard },
{ path: 'dashboards/:id', title: 'pages.dashboard.title', canDeactivate: [appUnlockedGuard], loadComponent: dashboard },
{ path: 'settings', ... inchangée },
{ path: '**', redirectTo: '' },
```
(`canDeactivate` sur les routes de tableaux : lot C3b.)

`DashboardComponent` : abonnement `inject(ActivatedRoute).paramMap` (`takeUntilDestroyed`). Pour chaque valeur : `flushLayout()` ; `await store.open(id, defaultName)` ; `'not-found'` → `router.navigateByUrl('/', { replaceUrl: true })` ; `'ready'` avec un id → `list.rememberOpened(id)`. Destruction : `flushLayout()` puis `store.close()`. Titre masqué : nom lu dans `DashboardListStore`.

`entries` : instance passée à l'hôte = `{ ...instance, grid: placed }` si le rectangle diffère, sinon l'instance elle-même.

Bandeau de débordement, au-dessus de la grille :
```html
@if (unplacedNames().length > 0) {
  <div role="alert" class="flash flash-attention mb-4 flex-none" data-testid="dashboard-unplaced"> ... </div>
}
```
Action (lot C3a) : `list.create({ name: dashboard.overflowName, icon: icône du tableau courant })` (nom coupé par points de code pour tenir en 100), puis `store.moveUnplacedTo(id)`, sans naviguer. La création et le déplacement ne sont pas atomiques : en cas d'échec du déplacement, **suppression best-effort du tableau vide créé** (`DashboardRepository.remove`, sans sauvegarde : il ne contient rien ; échec seulement journalisé), puis `dashboard.moveUnplacedError`. `DashboardLimitError` → `dashboards.limit`.

*Amendement (spec dashboard-theme)* : le tableau « (suite) » reçoit aussi le thème du tableau courant (`theme`, `themeVersion`), dans le même `INSERT`.

### 4.8 Dialogues et suppression

Dans `core/layout/`, tous en `p-dialog` `[modal]="true"`, `[closable]="false"`, `[closeOnEscape]="false"`, sans `dismissableMask`, `appendTo="body"`, `[focusOnShow]="false"` (focus posé en `afterNextRender`), avec un bouton Annuler explicite, et `host: { '(document:keydown.escape)': 'onEscape()' }` ignoré pendant une écriture (V25) :

| Composant | Entrées / sorties | Contenu |
|---|---|---|
| `dashboard-form-dialog.component.ts` | `dashboard: Dashboard \| null` ; `closed` | `<form novalidate (submit)>` avec `event.preventDefault()` (CSP `form-action 'none'`) ; champ nom ; `<fieldset>` de radios natifs ; bouton `btn-primary`. Nom : `trim`, 1 à 100 caractères, erreur sous le champ. Boutons désactivés pendant l'écriture. Noms en double autorisés |
| `dashboard-delete-dialog.component.ts` | `dashboard: Dashboard` ; `closed` | D10 ; compte via `countWidgets` (échec : message et confirmation bloquée) ; suppression via `BackupService.deleteDashboard` |
| `widget-picker-dialog.component.ts` | aucune (lit `WidgetAddFlow`) | §4.9 |

Radio d'icône : `<label class="icon-choice" [attr.title]="nom"><input class="sr-only" type="radio" name="dashboard-icon" ...><i aria-hidden="true"></i><span class="sr-only">nom</span></label>`. `.icon-choice` : 40 × 40 px, `:has(input:checked)` en accent, `:has(:focus-visible)` avec l'anneau de focus. Une icône inconnue (D11) ne coche rien et reste conservée.

Après création : `router.navigate(['/dashboards', id])`, fermeture, focus sur `[data-dashboard-id]`. Après modification : focus rendu à la bulle.

**Suppression** (seul `dashboard-delete-dialog`, chargé à la demande, importe `core/backup`) :
1. si c'est le tableau courant : `await router.navigate` vers le voisin suivant, sinon le précédent ; échec → message, arrêt ;
2. `appLock.lock('delete')` ; dans un `try … finally { appLock.unlock() }`, étapes 3 à 5 ;
3. `await list.prepareRemoval()` ;
4. `await backup.deleteDashboard(id)` ; erreurs : `not_found` → tableau déjà supprimé, on continue à l'étape 5 ; `last_dashboard` → `dashboards.remove.last` ; `busy` → `dashboards.remove.busy` ; `unavailable` → `dashboards.remove.unavailable` ; autre → `dashboards.remove.error` (rien n'a été supprimé) ;
5. `await list.afterRemoval()` ;
6. fermeture ; focus sur la bulle active, sinon le `+` neutre.

`core/lock/app-lock.ts` : `AppLockKind = 'restore' | 'import' | 'delete'`. `core/search/search-hotkey.ts` : touches ignorées si `AppLock.isLocked()`.

**Rust, commande `dashboard_delete(id: String) -> Result<(), BackupError>`** (`src/backup/dashboard_delete.rs`, exposée dans `src/backup/commands.rs`) :
1. `id` hors forme UUID (`is_uuid_shape`) → `invalid_id` ;
2. `state.try_acquire()` (verrou de sauvegarde) → `busy` s'il est pris ;
3. **sous le verrou, avant toute sauvegarde**, connexion en lecture : `SELECT (SELECT COUNT(*) FROM dashboards WHERE id = ?1), (SELECT COUNT(*) FROM dashboards)` ; absent → `not_found` ; dernier → `last_dashboard` (nouvelle variante `BackupError::LastDashboard`, sérialisée `last_dashboard`) ; aucune sauvegarde n'est créée dans ces cas ;
4. `create_backup(root, clock, BackupKind::PreDelete, &[])` (base seule, rétention de la réserve de sécurité) ; **échec → erreur renvoyée, aucune suppression** ;
5. connexion d'écriture (mêmes options que `write_plan` : `create_if_missing(false)`, `busy_timeout` 5 s, `foreign_keys(true)`, indispensable pour la cascade), une instruction qui garde la protection (défense en profondeur) :
```sql
DELETE FROM dashboards WHERE id = ?1 AND EXISTS (SELECT 1 FROM dashboards WHERE id <> ?1)
```
   0 ligne → `not_found` ; erreur SQLite → `database { code }` ;
6. fermeture de la connexion (erreur après succès : journalisée, `Ok`).

`src/backup/names.rs` : `BackupKind::PreDelete`, **ajouté à `ALL`**, `as_str() == "pre-delete"`, `pool() == Pool::Safety`, `includes_images() == false`. `src/backup/list.rs` : **exclu de `newest_full_backup`** (comme `PreImport`). `src/backup/error.rs` : `LastDashboard`. `build.rs` : `"dashboard_delete"` dans `AppManifest::commands` ; `capabilities/default.json` : `"allow-dashboard-delete"`. Front : `BACKUP_KINDS` gagne `'pre-delete'` ; `BackupErrorDto` gagne `{ kind: 'last_dashboard' }` ; `BackupService.deleteDashboard(id): Promise<void>` via le chemin `invoke` existant (`unavailable` hors Tauri).

### 4.9 Flux d'ajout : `core/dashboard/widget-add-flow.ts`

```ts
export type AddWidgetPhase = 'unavailable' | 'idle' | 'choosing' | 'confirming';

type RawState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'choosing'; readonly session: number }
  | { readonly kind: 'confirming'; readonly session: number; readonly instanceId: string };

@Injectable({ providedIn: 'root' })
export class WidgetAddFlow {
  readonly phase: Signal<AddWidgetPhase>;
  readonly newInstanceId: Signal<string | null>;   // non null seulement en 'confirming'
  readonly pending: Signal<boolean>;
  readonly addFailed: Signal<boolean>;
  open(): void;                                   // idle -> choosing (session courante)
  cancel(): void;                                 // choosing -> idle, focus au déclencheur
  pick(type: WidgetTypeId): Promise<void>;        // choosing -> confirming ; échec : reste, addFailed
  finish(): void;                                 // confirming -> idle
  registerTrigger(focus: () => void): () => void;
  focusTrigger(): void;
}
```
`phase` (`computed`) :
- `store.status() !== 'ready'` → `'unavailable'` ;
- état brut dont `session !== store.session()` → `'idle'` ;
- `confirming` dont l'instance n'est plus dans `store.instances()` → `'idle'` ;
- sinon l'état brut.

Toute action (`open`, `pick`, `finish`, `cancel`) commence par remettre l'état brut à `idle` si sa session est périmée : l'état V ne peut jamais réapparaître. Si `pick` aboutit alors que la session a changé pendant l'écriture : `idle`, le widget reste créé.

| Phase | Icône, classe | `aria-label` et bulle de texte | Clic |
|---|---|---|---|
| `unavailable` | `pi pi-plus`, `.sidebar-bubble-add`, `aria-disabled="true"` | `dashboard.addWidgetUnavailable` | rien |
| `idle` | `pi pi-plus`, `.sidebar-bubble-add`, `aria-haspopup="dialog"` | `dashboard.addWidget` | `open()` |
| `choosing` | idem, `aria-expanded="true"` | idem | sans objet (dialogue modal) |
| `confirming` | `pi pi-check`, `.sidebar-bubble-done` | `dashboard.finishAdd` | `finish()` ; Échap sur le bouton aussi |

**Un seul `<button>`** (`data-testid="add-widget"`), sans `disabled` natif, pour garder le focus et la bulle de texte.

Pop-up (affichée tant que `phase() === 'choosing'`) : pour chaque `registry.list()`, un bouton `.menu-item` (icône, titre, description, `data-testid="add-<type>"`), désactivé si `pending` ou `store.addBlockReason(type) !== null`, avec la raison en texte. Aucune entrée possible faute de place : `flash-attention` `dashboard.gridFull`. Échec : `flash-danger` `dashboard.addError`, focus sur la première entrée active. Échap : `cancel()` sauf si `pending`.

Après `pick` réussi : dialogue fermé, focus sur le bouton (V), annonce `dashboard.widgetAdded`. Mise en évidence : l'hôte fait `[class.is-highlighted]="highlighted() || isNew()"` avec `isNew = flow.newInstanceId() === instance().id`.

Retrait d'un widget : `accept` de l'hôte fait `store.remove` puis `flow.focusTrigger()`. L'effet de V15 est supprimé.

### 4.10 Poignées (lot E)

```html
<header class="box-header">
  <span class="widget-header-icon">
    <i [class]="def?.icon ?? 'pi pi-question-circle'" class="widget-type-icon" aria-hidden="true"></i>
    <button type="button"
      class="btn btn-invisible btn-icon btn-compact {{ dragHandleClass }}"
      data-testid="widget-drag-handle" ...>
      <i class="pi pi-arrows-alt" aria-hidden="true"></i>
    </button>
  </span>
  <h2 class="flex-1 truncate">...</h2>
  <!-- bouton supprimer inchangé -->
</header>
```
L'entrée `editing` disparaît. `dashboard.component.css` (sélecteurs préfixés par `gridster-item` pour l'emporter sur `.box-header > i` et les styles de bouton) :
```css
app-dashboard gridster-item .widget-header-icon { position: relative; display: inline-flex; width: 16px; height: 16px; flex: none; align-items: center; justify-content: center; }
app-dashboard gridster-item .widget-type-icon { color: var(--hb-fg-muted); font-size: 16px; transition: opacity var(--hb-transition); }
app-dashboard gridster-item .widget-drag-handle { position: absolute; top: 50%; left: 50%; cursor: move; opacity: 0; transform: translate(-50%, -50%); transition: opacity var(--hb-transition); }
app-dashboard gridster-item .box-header:hover .widget-drag-handle,
app-dashboard gridster-item .box-header:focus-within .widget-drag-handle { opacity: 1; }
app-dashboard gridster-item .box-header:hover .widget-type-icon,
app-dashboard gridster-item .box-header:focus-within .widget-type-icon { opacity: 0; }
/* Resize: south-east corner only, visible on hover of the card. */
app-dashboard .gridster-item-resizable-handler.handle-se { width: 0; height: 0; border-width: 0 0 14px 14px; border-color: transparent; }
app-dashboard gridster-item:hover .gridster-item-resizable-handler.handle-se { border-color: transparent transparent var(--hb-fg-muted); }
app-dashboard .gridster-item-resizable-handler.handle-se:hover { border-color: transparent transparent var(--hb-accent); }
```
`onItemChange` perd son test `editing`. Clés `dashboard.editLayout` et `dashboard.doneEditing` et le bouton disparaissent.

Vérifié (V10, V11) : clic, sélection de texte, champ, bouton du corps, clic droit ne déclenchent aucun déplacement ; plus aucune bande `n` ou `e` ne recouvre le bouton supprimer ou l'ascenseur. Seul le coin `se` capte 14 × 14 px en bas à droite (R5).

### 4.11 Recherche inter-tableaux et `Ctrl+K`

`core/dashboard/widget-focus.ts` :
```ts
export interface WidgetFocusRequest {
  readonly instanceId: string;
  readonly sequence: number;
  /** Session du store à la création (D13). */
  readonly session: number;
}

export class WidgetFocus {
  readonly request: Signal<WidgetFocusRequest | null>;
  /**
   * Va au tableau de l'instance si besoin, attend son ouverture, puis demande le focus.
   * 'not-found' : instance absente, lecture en échec, navigation refusée ou ouverture en échec ;
   * 'unplaced' : l'instance existe mais n'a pas de place sur la grille.
   */
  focusInstance(instanceId: string): Promise<'focused' | 'not-found' | 'unplaced'>;
  /** true une seule fois par requête, et seulement si sa session est la session courante. */
  claim(request: WidgetFocusRequest): boolean;
}
```
Parcours :
1. Instance dans `store.instances()` : si elle est dans `layout().placed`, requête immédiate, **sans aucun `await`** (ordre actuel avec le refocus du champ conservé) ; sinon `'unplaced'`.
2. Sinon `WIDGET_INSTANCE_REPOSITORY.get` ; `null` ou erreur → `'not-found'`. `router.navigate(['/dashboards', record.dashboardId])` ; `false` → `'not-found'`. `await store.whenOpened()` ; autre que `'ready'` ou tableau différent → `'not-found'`. Puis même test qu'en 1.

Une requête d'une session dépassée n'est jamais consommée : changer de tableau ou de page l'annule de fait.

`WidgetHostComponent` : `lastFocusSequence` disparaît. Effet : si `request?.instanceId === instance().id && widgetFocus.claim(request)` → `reveal()` en `afterNextRender`. `reveal()` perd `scrollIntoView`.

`widgets/search/search.component.ts` :
- `activate` attend `focusInstance` ; `'not-found'` → `notFound`, `'unplaced'` → nouveau message `unplaced` ;
- `place()` : si `viewportHeight - rect.bottom - 16 < 160` et que la place au-dessus est plus grande (V27), `Placement` a `top: null`, `bottom = viewportHeight - rect.top + 4`, `maxHeight = rect.top - 20` ; sinon `bottom: null`. Le template ajoute `[style.bottom.px]="placement()?.bottom"`.

**`SearchHotkey`** (`core/search/search-hotkey.ts`, D18) :
- `export const SEARCH_WIDGET_TYPE = 'search';` dans `core/search`, service propre à ce widget ; couplage par chaîne assumé et noté dans l'ADR-001 (§10.1) ; `core/` n'importe toujours aucun widget (R2) ;
- `AppLock.isLocked()` → aucune action, ni `preventDefault` (lot C3b) ;
- touche reconnue **et** cible enregistrée → comportement actuel (`Ctrl+K` et `/`) ;
- `/` sans cible → rien (pas de `preventDefault`, la touche reste disponible) ;
- `Ctrl+K` sans cible : `preventDefault`, puis `findFirstOfType(SEARCH_WIDGET_TYPE)` ; `null` ou erreur → rien. Sinon :
  ```ts
  private pending: { readonly dashboardId: string; session: number | null } | null;
  ```
  1. `pending = { dashboardId, session: null }` ; `await router.navigate(['/dashboards', dashboardId])` ; `false` → `pending = null` ;
  2. `await store.whenOpened()` ; si le résultat n'est pas `'ready'` ou si `store.dashboard()?.id !== dashboardId` (un autre tableau a été ouvert entre-temps) → `pending = null` ; sinon, si `pending` est toujours cette demande, `pending.session = store.session()` ;
- `register(focus)` : la demande est consommée (`pending = null`, puis `focus` en `afterNextRender` sur l'injecteur racine, le champ n'existant pas encore au moment du `register`) si `pending.dashboardId === store.dashboard()?.id` et (`pending.session === null` ou `pending.session === store.session()`) ; si `pending.session` est connue et différente de la session courante → `pending = null` sans focus ;
- une nouvelle frappe remplace `pending`. Ainsi une demande ne survit ni à l'ouverture d'un autre tableau, ni à un retour ultérieur sur le même tableau (nouvelle session), ni à une ouverture en échec. Si la barre du tableau cible n'a pas de place (jamais enregistrée), `pending` meurt à la session suivante.

### 4.12 Export et import

**Lot C2b** (dès que `dashboard.last` existe), `dashboard.last` est exclu des deux côtés :
- `core/backup/config-transfer.ts` : `EXCLUDED_SETTING_KEYS = ['dashboard.last']`. `buildConfigExport` les écarte ; `parseConfigImport` les ignore sans erreur (un fichier exporté entre C2a et C2b peut en contenir) ;
- `src/backup/config_transfer.rs` : `run_statements` n'écrit pas une clé `dashboard.last` (défense si le front l'envoyait) ; test dédié.

**Lot F** (*Note* : `formatVersion` 3 depuis la spec dashboard-theme) :
- `CONFIG_FORMAT_VERSION = 2`, `SUPPORTED_FORMAT_VERSIONS = [1, 2]`, `ConfigExportDashboard.icon: string`, `ConfigExportInput` idem.
- **Avant** le `safeParse` strict : si la racine est un objet dont `formatVersion` est un nombre `> 2` → `unsupported_version@formatVersion`, seul problème rapporté (D16, V33).
- `envelopeSchema` : `icon: v.optional(v.string())` dans le dashboard. Après le parse : `formatVersion` différent de 1 et 2 → `invalid_value` (0, 1,5). Version 1 avec `icon` → `unknown_field` sur `${dPath}.icon` ; version 2 sans `icon` → `missing_field` ; `icon` hors `DASHBOARD_ICON_PATTERN` → `invalid_value`. Icône valide hors liste : acceptée (D11).
- `ConfigImportPlanDashboard.icon: string` ; version 1 → `DEFAULT_DASHBOARD_ICON`.
- `ConfigTransferService.exportToFile` transmet `dashboard.icon`.
- `backup.types.ts` : `IMPORT_PROBLEMS` gagne `'invalid_icon'`.
- Rust : `PlanDashboard.icon: String` (`deny_unknown_fields` conservé) ; `validate_plan` : `is_dashboard_icon_shape` (1 à 32 caractères, `a-z` puis `a-z0-9-`, écrit à la main) sinon `ImportProblem::InvalidIcon` ;
```rust
const UPSERT_DASHBOARD: &str = "INSERT INTO dashboards (id, name, sort_order, icon, created_at, updated_at) VALUES (?1, ?2, ?3, ?5, ?4, ?4) \
ON CONFLICT (id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, icon = excluded.icon, updated_at = excluded.updated_at";
```
  avec `.bind(&dashboard.icon)` en cinquième position.

Les grilles importées gardent leur limite (`maxGrid` 10 000) ; `fitLayout` s'occupe de l'affichage.

### 4.13 Tokens

`tokens.css` : `--hb-accent-emphasis: #0969da` (clair), `#1f6feb` (sombre). `styles.css` : `--color-accent-emphasis: var(--hb-accent-emphasis)`. `check-contrast.mjs` : paires `['fg-on-emphasis', 'accent-emphasis']` et `['fg-on-emphasis', 'bg-emphasis']`. `--hb-topbar-height`, `.topbar`, `.underline-nav*` retirés (lot B).

### 4.14 i18n FR (`core/i18n/fr.json`)

Chaque lot n'ajoute que ce qu'il utilise :
```json
"layout": {
  "mainNav": "Navigation principale",
  "dashboardsNav": "Tableaux de bord",
  "current": "Tableau affiché : {{ name }}"
},
"dashboard": {
  "defaultName": "Accueil",
  "loadError": "Impossible de charger le tableau de bord.",
  "addWidget": "Ajouter un widget",
  "addWidgetUnavailable": "Ouvrez un tableau de bord pour ajouter un widget",
  "finishAdd": "Terminer l'ajout du widget",
  "widgetAdded": "Widget {{ title }} ajouté. Le bouton Terminer l'ajout est actif.",
  "empty": "Aucun widget pour l'instant. Utilisez le bouton vert pour en ajouter un.",
  "addError": "Impossible d'ajouter ce widget.",
  "gridFull": "La grille est pleine : supprimez ou réduisez un widget, ou créez un autre tableau.",
  "picker": {
    "cancel": "Annuler",
    "limitReached": "Déjà présent sur ce tableau",
    "noRoom": "Plus assez de place"
  },
  "unplaced": "{{ count }} widget(s) ne tiennent pas sur ce tableau : {{ names }}.",
  "moveUnplaced": "Les déplacer vers un nouveau tableau",
  "moveUnplacedError": "Impossible de déplacer ces widgets.",
  "overflowName": "{{ name }} (suite)",
  "layoutError": "Impossible d'enregistrer la disposition ; la dernière disposition enregistrée a été rétablie."
},
"dashboards": {
  "add": "Nouveau tableau de bord",
  "limit": "Nombre maximal de tableaux atteint (100).",
  "bubbleHint": "Clic droit ou Maj + F10 : modifier ou supprimer ce tableau.",
  "form": {
    "titleCreate": "Nouveau tableau de bord",
    "titleEdit": "Modifier le tableau de bord",
    "name": "Nom",
    "nameInvalid": "Le nom doit contenir de 1 à 100 caractères.",
    "icon": "Icône",
    "create": "Créer",
    "save": "Enregistrer",
    "cancel": "Annuler",
    "error": "Impossible d'enregistrer ce tableau de bord."
  },
  "menu": {
    "label": "Actions du tableau {{ name }}",
    "edit": "Modifier…",
    "remove": "Supprimer…",
    "removeLast": "Supprimer (impossible : dernier tableau)"
  },
  "remove": {
    "title": "Supprimer « {{ name }} » ?",
    "message": "Ce tableau contient {{ count }} widget(s). Ils seront supprimés définitivement, avec leurs notes et leurs tâches. Les raccourcis sont conservés.",
    "messageEmpty": "Ce tableau est vide.",
    "safetyBackup": "Une sauvegarde de sécurité de la base est créée juste avant la suppression.",
    "acknowledge": "Je comprends que cette suppression est définitive.",
    "confirm": "Supprimer définitivement",
    "cancel": "Annuler",
    "inProgress": "Suppression du tableau en cours…",
    "error": "Impossible de supprimer ce tableau de bord : rien n'a été supprimé.",
    "last": "Le dernier tableau de bord ne peut pas être supprimé.",
    "busy": "Une sauvegarde ou une restauration est en cours : réessayez dans un instant.",
    "unavailable": "Suppression disponible uniquement dans l'application Windows.",
    "countError": "Impossible de lire le contenu de ce tableau : suppression bloquée."
  },
  "icons": {
    "th-large": "Grille", "home": "Maison", "briefcase": "Travail", "desktop": "Ordinateur",
    "code": "Code", "wrench": "Outils", "chart-line": "Graphique", "wallet": "Portefeuille",
    "calendar": "Calendrier", "book": "Livre", "graduation-cap": "Études", "pencil": "Écriture",
    "palette": "Création", "camera": "Photo", "video": "Vidéo", "microphone": "Micro",
    "headphones": "Casque", "play-circle": "Lecture", "trophy": "Trophée", "star": "Étoile",
    "heart": "Cœur", "users": "Personnes", "globe": "Monde", "bolt": "Éclair"
  }
}
```
Autres : `backup.kind.pre-delete` = « Avant suppression d'un tableau » ; `backup.importProblems.invalid_icon` = « icône de tableau de bord invalide. » ; `widgets.search.unplaced` = « Ce widget ne tient pas sur la grille de son tableau. ». Modifiés : `widgetHost.layout.blocked` = « Déplacement impossible : limite atteinte ou grille pleine. » ; `widgets.search.notFound` = « Cet élément n'existe plus. » ; `backup.intro` (texte du §10.6). Retirés : `nav.dashboard`, `theme.toggle`, `dashboard.editLayout`, `dashboard.doneEditing`. `fr.spec.ts` suit ; un test vérifie que chaque `DASHBOARD_ICONS` a sa clé `dashboards.icons.*`.

### 4.15 Sécurité

- **Une seule nouvelle commande Tauri**, `dashboard_delete`, avec sa permission `allow-dashboard-delete` : elle ne fait que sauvegarder puis supprimer un tableau identifié par un UUID, jamais le dernier. Elle ajoute une sauvegarde au lieu d'en retirer, et un script injecté peut déjà supprimer ce tableau par SQL (ADR-002 R1). Capabilities et `build.rs` changent de cette seule entrée ; `tauri.conf.json` et la CSP sont inchangés ; `capability_tests.rs` est mis à jour.
- `tauri.dev.conf.json` ne contient que `identifier` et `productName` (test) : la configuration de sécurité ne diffère jamais en dev.
- `:id` de route et `id` de `dashboard_delete` : paramètres liés uniquement.
- Icône : forme contrôlée en SQL, TS et Rust ; classe CSS produite depuis la liste fermée.
- Nom de tableau : interpolation et `aria-label`, jamais `innerHTML`.
- Aucun secret ; `dashboard.last` (UUID) n'est ni exporté ni importé.
- `inert` : barre et `main` sous `AppLock` (restauration, import, suppression d'un tableau). Les dialogues sont en `body`, hors de cette inertie, mais modaux ; pendant une suppression, `SearchHotkey` et `appUnlockedGuard` empêchent toute navigation.

---

## 5. Cas limites

| # | Cas | Comportement |
|---|---|---|
| C1 | Ancienne disposition jusqu'à la ligne 200 | Repositionnée à l'affichage, base intacte jusqu'à la première modification (D3) |
| C2 | Widget stocké en `h = 12` | Affiché en `h = 8` |
| C3 | Ancienne recherche en `h = 1` | Affichée en `h = 2` ; un voisin chevauché est repositionné ; aucune écriture au chargement |
| C4 | Trop de widgets pour la grille | Bandeau + action ; échec du déplacement → tableau vide créé supprimé au mieux |
| C5 | Suppression d'un widget | Les restants gardent leur position affichée (écrite) ; un widget sans place peut prendre la place libérée |
| C6 | Type de widget inconnu | `fallbackConstraints` : min 1 × 1, placé, supprimable |
| C7 | Fenêtre de 800 × 600, avec ou sans bandeau | Lignes d'environ 68 px ; dernière ligne et dernière colonne atteignables au redimensionnement (D1) |
| C8 | Fenêtre réduite ou agrandie | Recalcul, aucune écriture |
| C9 | Fenêtre masquée (zone de notification), largeur 0 | `onResize` ne fait rien (l. 1113) ; le retour de taille relance le calcul |
| C10 | Bandeau de sauvegarde ou d'erreur | Lignes réduites (D6) |
| C11 | Réglages long | `main` défile (D5) |
| C12 | Déplacement clavier dans une grille pleine | Refusé, annoncé |
| C13 | Redimensionnement clavier en bord de grille | Refusé, origine conservée |
| C14 | Ajout sans place à la taille par défaut | Réduit jusqu'au minimum, sinon entrée désactivée ; `GridFullError` en dernier recours |
| C15 | Double clic dans la pop-up ou sur Créer | `pending` ; un seul widget ou tableau |
| C16 | Nom de tableau déjà pris | Autorisé |
| C17 | 100 tableaux | `+` neutre `aria-disabled`, `dashboards.limit` ; `DashboardLimitError` en dernier recours |
| C18 | Dernier tableau | « Supprimer » désactivé ; Rust renvoie `last_dashboard` sans créer de sauvegarde ni rien supprimer |
| C19 | Suppression du tableau courant | Navigation vers le voisin, verrou, sauvegarde, suppression ; échec : on reste sur le voisin, rien n'est supprimé, message |
| C20 | Échec de la sauvegarde `pre-delete` (disque plein, verrou pris) | Aucune suppression ; message (`busy` dédié) ; verrou rendu |
| C21 | Tableau déjà supprimé (deux fenêtres impossibles, mais réponse `not_found`) | Aucune sauvegarde ; la liste est relue |
| C22 | `Ctrl+K`, clic sur une bulle ou `Alt+←` pendant une suppression | Ignoré (`SearchHotkey`) ou refusé (`appUnlockedGuard`) ; barre et page `inert` |
| C23 | Écritures différées avant une suppression ou un changement | `PendingWrites.flushAll()` avant |
| C24 | Clics rapides entre bulles | Jeton : seule la dernière ouverture s'applique, y compris ses branches d'erreur |
| C25 | `:id` inconnu (favori, F5 après suppression ou import) | `/` → dernier ouvert s'il existe, sinon premier |
| C26 | `dashboard.last` périmé, non-chaîne ou illisible | Premier tableau |
| C27 | Échec d'écriture de `dashboard.last` | Journalisé ; le tableau s'affiche |
| C28 | F5 sur `/dashboards/:id` | Rouvre ce tableau (V31) |
| C29 | Hors Tauri (`ng serve`) | Garde : `true` ; message d'erreur de la page ; aucune `NavigationError` ; `+` vert indisponible ; suppression indisponible |
| C30 | `maxInstances` | Par tableau : une recherche par tableau |
| C31 | Résultat de recherche sur un autre tableau | Navigation, attente de l'ouverture, focus, mise en évidence |
| C32 | Résultat sur un widget sans place | Message `unplaced` |
| C33 | Résultat d'un widget supprimé, ou note sans instance | `notFound` |
| C34 | Requête de focus puis changement de tableau | Requête périmée (session), jamais rejouée |
| C35 | `Ctrl+K` sans barre de recherche sur la page courante | Navigation vers le premier tableau qui en a une, focus du champ ; aucun : rien |
| C36 | `/` sans barre de recherche sur la page courante (Réglages compris) | Rien ; la touche n'est pas interceptée |
| C37 | `Ctrl+K` vers A, puis clic sur C avant la fin du chargement | Demande abandonnée ; ouvrir A plus tard ne focalise rien |
| C38 | `Ctrl+K` vers A dont la barre de recherche n'a pas de place | Aucun focus ; demande abandonnée à la session suivante |
| C39 | Clic sur le `+` vert depuis Réglages | Rien (`aria-disabled`) |
| C40 | État V, puis Réglages, puis retour au même tableau | `+` vert (nouvelle session) |
| C41 | Pop-up ouverte puis `Alt+←` | Session changée : pop-up fermée, rien n'est rouvert ensuite |
| C42 | État V puis suppression du widget | `+` vert, focus sur le bouton |
| C43 | Fermeture de l'application pendant le V | Le widget est enregistré |
| C44 | Fichier d'export v1 | Accepté, icône par défaut |
| C45 | Fichier v3 avec champs inconnus | `unsupported_version` seul (nouveau code) |
| C46 | Fichier v2 lu par l'ancien binaire | Refusé (`unknown_field`) ; message moins clair, assumé (D16) |
| C47 | Icône valide mais inconnue | Conservée, icône par défaut à l'affichage |
| C48 | Icône mal formée dans un fichier | `invalid_value` (front), `invalid_icon` (Rust), avant toute écriture et toute sauvegarde |
| C49 | `dashboard.last` dans un fichier importé | Ignoré des deux côtés |
| C50 | Archive V3 restaurée avec le binaire V4 | Acceptée, migrée au démarrage après `pre-migration` |
| C51 | Archive V4 (vrai migrateur) restaurée avec le binaire V4 | Acceptée (test du lot C1, M12) |
| C52 | Archive V4 restaurée avec un binaire V3 | `schema_too_new` |
| C53 | Retour à un exe V3 après V4 | `VersionMissing` : procédure du §9 |
| C54 | `npm run dev` | Base, sauvegardes, verrou, mutex et entrée de démarrage automatique de dev, distincts des réels (D0) |
| C55 | Démarrage automatique activé dans l'app de dev | Valeur `Run` « Homebase Dev », pointant sur l'exe de dev ; la valeur « Homebase » est intacte |
| C56 | Changement d'heure, fuseaux | Sans objet : aucune date métier ; `updated_at` UTC via `Clock` ; noms de sauvegarde en UTC |
| C57 | Hors-ligne, conflits de synchronisation | Sans objet : tout est local, un seul processus par identifiant |
| C58 | `prefers-reduced-motion` | Règle globale existante ; seulement des transitions de couleur et d'opacité |

---

## 6. Évolution des tests existants

### 6.1 Vitest, runner Angular (lot entre crochets)

| Fichier | Changement |
|---|---|
| `core/widgets/grid.spec.ts` | [A] `y` borné à `GRID_ROWS - h` ; `h` ≤ 8 ; `nextFreePosition` : balayage, trou réutilisé, réduction, `null` |
| `core/dashboard/grid-layout.spec.ts` | [A] refus en bord (`nudgeRect`), refus de la poussée au-delà de 8 lignes ; bloc `fitLayout` (§6.3) |
| `core/dashboard/grid-adapter.spec.ts` | [A] options : `fit`, 12 × 8, `setGridSize: false`, scroll désactivé, `outerMargin*` à 0, poignée `se` seule ; `boundGrid` retiré ; `fallbackConstraints` borné à 8. [E] drag et redimensionnement toujours actifs |
| `core/dashboard/dashboard.store.spec.ts` | [A] second ajout en (2,0) ; `addBlockReason`, `GridFullError` ; écriture des repositionnés au déplacement, à l'ajout et à la suppression (exemple de D3). [C2a] `load` → `open(null, name)` ; jeton (deux `open`, branches `not-found` et `error` comprises) ; `close` incrémente jeton et session, ne vide pas `layoutPending` ; `open` remet `layoutError` à `false` ; `moveUnplacedTo` |
| `core/dashboard/dashboard.component.spec.ts` | [A] « nothing written on load with rows beyond 8 » ; `console.warn` d'un `onItemChange` sans geste. [C2a] `provideRouter` et `ActivatedRoute` avec `id`. [D] **supprimer** les blocs du menu d'ajout ; « focus to the add button » passe dans la spec d'hôte. [E] **supprimer** le bouton de bascule ; garder drag, clavier, échec d'écriture sans bascule |
| `core/widgets/widget-host.component.spec.ts` | [C2a] `provideRouter([])`. [C2b] `scrollIntoView` retiré ; requête antérieure à la création de l'hôte consommée une fois ; requête d'une autre session ignorée. [D] `isNew`, focus au déclencheur après suppression. [E] poignée toujours présente |
| `core/layout/layout.component.spec.ts` | [B] `header` → `app-sidebar` ; liens dans `nav` ; **supprimer** le test du thème et l'assertion « Homebase ». [C2a] fakes `DASHBOARD_REPOSITORY`, `SETTINGS_REPOSITORY`, `WIDGET_INSTANCE_REPOSITORY` (V34). [C3b] voile et `inert` pour le type `delete` |
| `app.spec.ts` | [B] le test « app name in the header » devient : `nav` d'`aria-label` « Navigation principale », aucun « Homebase » visible. [C2a] mêmes fakes que ci-dessus |
| `app.routes.spec.ts` | [C2a] `/does/not/exist` et `/` → `/dashboards/dashboard-1` ; id inconnu → dernier ouvert sinon premier ; erreur de données → page d'erreur, pas de `NavigationError`. [C3b] navigation refusée depuis un tableau sous `AppLock` |
| `core/widgets/widget-registry.spec.ts` l. 56 | [A] `h: 25` → `h: 9` |
| `widgets/widgets.providers.spec.ts` | [A] `min.h ≥ 2` et `max.h ≤ 8` pour toute définition réelle |
| `widgets/search/search.component.spec.ts` | [C2b] `focusInstance` en `mockResolvedValue` ; message `unplaced` ; `place()` au-dessus du champ |
| `core/search/search-hotkey.spec.ts` (nouvelle) | [C2b] cible présente : comportement actuel (`Ctrl+K` et `/`) ; `/` sans cible : rien, pas de `preventDefault` ; `Ctrl+K` sans cible : navigation puis focus à l'enregistrement ; aucun tableau : rien ; erreur de lecture : rien ; C37 et C38 ; retour ultérieur au même tableau : pas de focus. [C3b] sous `AppLock` : aucune action |
| `core/backup/config-transfer.spec.ts` | [C2b] `dashboard.last` absent de l'export, ignoré à l'import. [F] l. 347-358 : 3 → `unsupported_version`, 0 et 1,5 → `invalid_value` ; v3 avec champ inconnu → `unsupported_version` seul |
| `core/theme/theme.service.spec.ts` | [B] `cycle` retiré : `setMode` |
| `core/i18n/fr.spec.ts` | [B][C3a][E] `SHELL_KEYS` et clés retirées |
| `core/testing/fake-*.repository.ts` | [C1] `icon`, `update` au lieu de `rename`, `moveToDashboard`, `findFirstOfType` |

### 6.2 Scripts
`scripts/test-dashboard-grid-css.mjs` : [A] refuse toute largeur forcée sur `gridster.dashboard-grid`, exige `overflow: clip` ; [B] `.sidebar` sans `background` ni `border` ; [E] poignée `opacity: 0` au repos, visible sur `:hover` et `:focus-within`.

### 6.3 Table de `fitLayout`

| Entrée (`id`: x,y,w,h ; min 2×2, max 12×8 sauf mention) | `placed` | `unplaced` |
|---|---|---|
| vide | vide | vide |
| a: 0,0,4,3 ; b: 4,0,4,3 | identiques | vide |
| a: 0,0,4,3 ; b: 0,3,4,3 ; c: 0,6,4,3 ; d: 0,9,4,3 | a, b identiques ; c: 4,0,4,3 ; d: 8,0,4,3 | vide |
| a: 0,6,4,12 | a: 0,0,4,8 | vide |
| a: 11,0,4,3 | a: 8,0,4,3 | vide |
| a: 0,0,2,1 (h relevé à 2) ; b: 0,1,2,2 | a: 0,0,2,2 ; b: 2,0,2,2 | vide |
| a: 0,0,12,8 ; b: 0,8,2,2 | a identique | b |
| 25 entrées 2×2, toutes en 0,0 | 24 placées | la 25e |
| a: 0,0,6,8 ; b: 0,0,6,8 | a identique ; b: 6,0,6,8 | vide |
| a: 0,0,8,8 ; b: 0,0,8,8 | a identique ; b: 8,0,4,8 | vide |

Plus : déterminisme (deux appels égaux) ; idempotence (`fitLayout` de son propre résultat placé = identique) ; aucun chevauchement sur 1 000 dispositions aléatoires à graine fixe.

### 6.4 `test:data`
[C1] `migrations.spec.ts` : V4 sur V1 à V3 avec une ligne existante (icône par défaut, `updated_at` inchangé) ; `CHECK` refuse `'pi pi-x'`, `''`, `'A'`, 33 caractères ; accepte `chart-line`. `sqlite-dashboard.repository.spec.ts` : `create` avec et sans icône, `update`, `invalid_input`. `sqlite-widget-instance.repository.spec.ts` : `moveToDashboard` (déplacement, lot vide, FK absente → `constraint`, ids en double → `invalid_input`) ; `findFirstOfType` (ordre des tableaux, aucun → `null`).

### 6.5 Tests e2e
Aucun ici (décision de Marius) : tâche Playwright séparée après cette refonte (§10.5). Géométrie vérifiée à la main (M1).

---

## 7. Lots

**Règles communes**
- Lire `CLAUDE.md`, puis cette spec. Un lot à la fois, dans l'ordre : 0, A, B, C1, C2a, C2b, C3a, C3b, D, E, F. Chaque lot laisse l'application utilisable et le dépôt vert.
- Interdits : `any`, `Date` (hors exemptions ESLint), couleur brute, texte en dur, `CommonModule`, modification d'une migration existante, modification de capabilities, de `build.rs`, de `tauri.conf.json` ou de la CSP hors de ce qui est écrit ici, relèvement d'un budget.
- Composants standalone, `OnPush`, état en signals.
- **Base réelle intouchable** :
  - jamais l'exe release ni un ancien `npm run dev` sur la vraie base ;
  - `npm run dev` seulement une fois le lot 0 fusionné, après avoir vérifié qu'il utilise le dossier `fr.mariusdev.homebase.dev` ;
  - **jamais `npm run tauri dev` ni `cargo tauri dev`** (configuration réelle, V35) ;
  - jamais d'export ni d'archive de l'app de dev enregistrés dans `%APPDATA%\fr.mariusdev.homebase\backups\`.
- **Commandes de fin de lot** (racine, toutes vertes) :
  ```
  npm run format:check
  npm run lint
  npm run test
  npm run rust:fmt:check
  npm run rust:lint
  npm run rust:test
  cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --release --all-targets -- -D warnings
  npm run web:build
  ```
- **Conditions d'arrêt** : supposition infirmée ; test existant cassé sans lien avec le lot ; bundle initial ≥ 500 kB ou avertissement de budget ; schéma Rust cassé hors de V23 ; API gridster ou PrimeNG qui contredit V1 à V12 ou V25 ; besoin de modifier V4 après la revue de C1 (→ V5, avec accord) ; toute écriture constatée dans `%APPDATA%\fr.mariusdev.homebase\` ou dans la valeur `Run` « Homebase ».
- **Rapport de lot** : fichiers touchés, résultats des commandes, taille du bundle initial, suppositions vérifiées, écarts.
- Cocher la ligne de la ROADMAP après application du §10.5.

### Lot 0 : base de développement séparée (avant tout autre lot)
Fichiers : `apps/desktop/src-tauri/tauri.dev.conf.json` (créé) ; `package.json` (racine, script `dev`) ; `src/db.rs` (test).

Étapes :
1. Créer le fichier (§4.0) ; modifier le script `dev`.
2. Test Rust du §4.0.
3. Avant tout lancement, relever : `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v Homebase` (présente ou absente, chemin) et les dates de modification des fichiers de `%APPDATA%\fr.mariusdev.homebase\`. Lancer `npm run dev`. Constater que `%APPDATA%\fr.mariusdev.homebase.dev\homebase.db` est créé. Dans Réglages de l'app de dev, activer puis désactiver le démarrage automatique : la valeur `Run` « Homebase Dev » apparaît puis disparaît (S6). Relever de nouveau : la valeur « Homebase » et les fichiers réels sont **identiques**. Sinon : arrêter immédiatement, remettre la valeur « Homebase » telle que relevée, rapporter.
4. Décrire dans le rapport l'ensemencement : dans l'app de dev, Réglages > Sauvegardes > « Restaurer depuis un fichier… » avec une archive exportée de l'app réelle (export vers un dossier hors `%APPDATA%`).

Acceptation :
- 0-1 `npm run dev` n'écrit que dans le dossier `.dev` et sous la valeur `Run` « Homebase Dev » (constats de l'étape 3).
- 0-2 `tauri.conf.json` inchangé ; `npm run build` produit toujours l'identifiant et le nom réels.
- 0-3 Test Rust du fichier de dev vert.

### Lot A : grille de 8 lignes
Fichiers : `core/widgets/grid.ts`, `index.ts`, `widget-registry.ts` ; `core/dashboard/grid-layout.ts`, `grid-adapter.ts`, `dashboard.store.ts`, `dashboard.component.{ts,html,css}` ; `core/layout/layout.component.html` ; `styles.css` ; `widgets/{todo,search,hello}/*.definition.ts` ; `scripts/test-dashboard-grid-css.mjs` ; specs.

Étapes :
1. `grid.ts` (§4.1) et sa spec.
2. `GRID_MAX_ROWS` remplacé ; `GRID_MAX_TOTAL_ROWS` retiré.
3. `grid-layout.ts` (§4.2) et sa spec (§6.3).
4. `grid-adapter.ts` (§4.3), en gardant pour ce lot `editing` dans `draggable.enabled` et `resizable.enabled`.
5. Définitions (D4) et test associé.
6. `dashboard.store.ts` : `layout`, `addBlockReason`, `GridFullError`, `persistDisplayed` (changement de disposition, ajout, suppression), `nudge` (§4.7), sans `open`, `close` ni `session` (lot C2a).
7. `dashboard.component` : hôte, `#gridArea`, `ResizeObserver`, `entries`, drapeau `interacting` et `console.warn`, bandeau `dashboard-unplaced` (texte seul), options constantes sauf `editing`.
8. CSS (§4.3) ; `styles.css` ; layout : `flex h-dvh flex-col`, `main` en `flex min-h-0 flex-1 flex-col overflow-y-auto p-4`.
9. Script CSS ; specs marquées [A].
10. i18n : `dashboard.unplaced`, `dashboard.gridFull`.

Acceptation :
- A1 `fitLayout` passe le §6.3.
- A2 Aucun `updateLayout` au chargement d'une disposition allant jusqu'à la ligne 20.
- A3 Une modification écrit le widget concerné et tous les repositionnés en un appel ; la suppression de B dans l'exemple de D3 laisse C en (4,0) et D en (8,0), y compris après rechargement du store.
- A4 `buildGridOptions` : `fit`, `minRows = maxRows = 8`, `setGridSize: false`, scrolls désactivés, `outerMarginTop/Right/Bottom/Left = 0`, `handles` limité à `se`.
- A5 Définitions réelles : `min.h ≥ 2`, `max.h ≤ 8`.
- A6 `git grep` sous `apps/web/src` : ni `width: 100% !important`, ni `scrollbar-gutter`, ni `GRID_MAX`.

### Lot B : barre verticale
Fichiers à créer : `core/layout/sidebar.component.{ts,html}`, `.spec.ts`. À modifier : `core/layout/layout.component.{ts,html}`, `.spec.ts` ; `core/theme/components.css`, `tokens.css` ; `styles.css` ; `scripts/check-contrast.mjs`, `scripts/test-dashboard-grid-css.mjs` ; `core/dashboard/dashboard.component.html` ; `core/theme/theme.service.ts`, `.spec.ts` ; `fr.json`, `fr.spec.ts` ; `app.spec.ts`.

Étapes :
1. Tokens (§4.13), `check-contrast`.
2. CSS (§4.5) ; retirer `.topbar`, `.underline-nav*`, `--hb-topbar-height` et leur mention dans la règle de focus.
3. `SidebarComponent` : bulles « Tableau de bord » (lien `/`, exact) et « Réglages », bulle de texte avec `<span>`, repositionnement au défilement (D8).
4. Layout (§4.4) : retirer `ThemeService`, `THEME_ICONS`, `header`, nom de l'app.
5. Retirer `cycle()` et `theme.toggle`.
6. Dashboard : `<h1 class="sr-only">` ; boutons Ajouter et Modifier dans une ligne d'actions à droite (provisoire).
7. Specs [B].

Tests (`sidebar.component.spec.ts`) : `aria-label` de chaque bulle ; `aria-current` ; `mouseenter` affiche `.sidebar-label` (texte dans un `span`), `mouseleave` le retire ; `focusin` avec `matches(':focus-visible')` simulé `true` l'affiche, `false` non ; Échap le retire ; défilement : `top` recalculé ; ancre hors zone : retirée ; `aria-hidden`.

Acceptation :
- B1 Ni `header`, ni « Homebase » visible, ni bouton de thème dans `app-layout`.
- B2 `app-sidebar` et `main` `inert` sous `AppLock` ; région de statut hors `inert`.
- B3 `.sidebar` sans `background` ni `border` (script).
- B4 Nouvelles paires de contraste vertes dans les deux thèmes.
- B5 Bundle initial < 500 kB (valeur rapportée).

### Lot C1 : V4 et couche de données
Fichiers à créer : `migrations/V4__dashboard_icon.sql`. À modifier : `migrations/checksums.json` ; `src/db.rs` ; `data/models.ts`, `repositories.ts`, `index.ts`, `sqlite/row-mappers.ts`, `sqlite/sqlite-dashboard.repository.ts`, `sqlite/sqlite-widget-instance.repository.ts`, leurs specs, `migrations.spec.ts` ; `core/testing/fake-*.repository.ts` ; tests Rust de V23 ; `src/backup/test_support.rs`, `validate_tests.rs`.

Étapes :
1. Migration, `checksums.json`, `db.rs`.
2. `data/` (§4.6) : `update`, `moveToDashboard`, `findFirstOfType`, `DASHBOARD_COLUMNS` avec `icon`.
3. Fakes.
4. Tests `test:data` (§6.4).
5. Tests Rust existants :
   - `sqlite.rs` l. 70 : 4 ;
   - `validate_tests.rs` l. 617-642 : `supported: 4` ; second cas `db_archive(&dir, 4, "INSERT ... VALUES (5, 'x', 1, X'00', 0); CREATE TABLE future (a)")`, attendu `archive: 5` ;
   - `b3_tests.rs` l. 144 : `supported_schema_version()` ;
   - `config_transfer_tests.rs` l. 67 : `supported_schema_version()` ; l. 71 : colonnes nommées.
6. `npm run rust:test` : tout autre test qui suppose « 3 = à jour » passe à `supported_schema_version()` ; les autres `make_database(…, 3, …)` restent. Rapporter la liste.
7. `test_support.rs` : `make_database_with_migrator(path, with_sample_rows)`, qui applique `db::migrations()` avec le **vrai** `sqlx::migrate::Migrator` (construit comme le fait `tauri-plugin-sql`, S7). Si impossible sans code fragile : s'arrêter et rapporter.
8. Nouveaux tests Rust (`validate_tests.rs`) :
   - `expected_schema_of_version_4_matches_a_real_database` ;
   - `v3_database_migrated_to_v4_has_the_schema_of_v4_and_the_default_icon` ;
   - `archive_of_version_3_is_still_accepted` ;
   - `archive_at_the_supported_version_made_by_the_real_migrator_is_accepted` : `make_database_with_migrator`, un tableau avec une icône, `create_backup(Manual)`, `extract_validated` → `Ok`, manifeste `schema_version == supported_schema_version()`.
9. **Revue du lot : le texte de V4 est figé ensuite.**

Acceptation :
- C1-1 V1 à V3 inchangées.
- C1-2 Tests `data` et Rust verts, dont le test du vrai migrateur.
- C1-3 Aucune modification de `core/` hors fakes ; comportement inchangé.
- C1-4 `registered_migrations_match_files_exactly` vert.

### Lot C2a : stores, garde, routes, page
Fichiers à créer : `core/dashboard/dashboard-list.store.ts`, `dashboard-home.guard.ts`, `dashboard-icons.ts`, leurs specs. À modifier : `core/dashboard/dashboard.store.ts`, `dashboard.component.{ts,html}` ; `core/widgets/widget-host.component.spec.ts` ; `app.routes.ts`, `.spec.ts` ; `core/layout/layout.component.ts`, `.spec.ts` ; `app.spec.ts` ; `fr.json` ; specs [C2a].

Étapes :
1. `dashboard-icons.ts`.
2. `DashboardListStore` (§4.7) : `load` et `defaultTargetId` ne rejettent jamais.
3. `DashboardStore` : `session`, `open`, `whenOpened`, `close`, `moveUnplacedTo` (§4.7) ; `store.load` remplacé dans toutes les specs.
4. Garde et routes (sans `canDeactivate`, ajouté en C3b).
5. `DashboardComponent` : `paramMap`, `not-found`, `rememberOpened`, `close`, `<h1>`.
6. `LayoutComponent` : `list.load(...)`.
7. Sidebar : la bulle « Tableau de bord » pointe sur `/` ; elle perd son `aria-current` jusqu'au lot C3a (limite temporaire admise).
8. L'effet de V15 ne compare le nombre d'instances que si `store.session()` n'a pas changé (retiré au lot D).
9. Specs [C2a], dont les fakes de V34.

Tests :
- `dashboard-list.store.spec.ts` : `load` idempotent, nouvel essai après échec ; `defaultTargetId` (dernier valide, périmé, non-chaîne, lecture en échec, liste vide) ; `create` limite ; `prepareRemoval` appelle `flushAll` ; `rememberOpened` qui échoue sans rejet.
- `dashboard-home.guard.spec.ts` : redirection ; `true` sur toute erreur.
- `dashboard.store.spec.ts` : lignes [C2a] du §6.1.

Acceptation :
- C2a-1 F5 simulé sur `/dashboards/:id` ouvre ce tableau.
- C2a-2 `/` et un id inconnu mènent au dernier ouvert s'il existe, sinon au premier.
- C2a-3 Changer de tableau ne vole pas le focus.
- C2a-4 Hors Tauri, `/` affiche le message d'erreur de la page, sans `NavigationError`.

### Lot C2b : recherche inter-tableaux, `Ctrl+K`, exclusion de `dashboard.last`
Fichiers à créer : `core/dashboard/widget-focus.spec.ts`, `core/search/search-hotkey.spec.ts`. À modifier : `core/dashboard/widget-focus.ts` ; `core/widgets/widget-host.component.{ts,html}` ; `core/search/search-hotkey.ts`, `index.ts` ; `widgets/search/search.component.{ts,html}`, `.spec.ts` ; `core/backup/config-transfer.ts`, `.spec.ts` ; `src/backup/config_transfer.rs`, `config_transfer_tests.rs` ; `fr.json`.

Étapes :
1. `WidgetFocus` et hôte (§4.11).
2. `search.component` : `activate`, `unplaced`, `place()` ; `notFound` modifié.
3. `SearchHotkey` (D18, §4.11), sans la garde `AppLock` (lot C3b).
4. Exclusion de `dashboard.last` (§4.12), TS et Rust.
5. Specs [C2b].

Tests :
- `widget-focus.spec.ts` : même tableau, aucune navigation ; autre tableau, navigation puis requête après `whenOpened` ; `unplaced` ; `null`, erreur, navigation refusée, ouverture en échec → `not-found` ; requête non consommée après changement de session.
- `search-hotkey.spec.ts` : lignes [C2b] du §6.1.
- `config_transfer_tests.rs` : un plan contenant `dashboard.last` ne l'écrit pas.

Acceptation :
- C2b-1 Un résultat d'un autre tableau navigue puis révèle la carte, y compris si l'hôte est créé après la requête.
- C2b-2 `Ctrl+K` sans barre locale va au tableau qui en a une et focalise son champ ; `/` reste local.
- C2b-3 C37 et C38 couverts par la spec.
- C2b-4 `dashboard.last` absent de tout export.

### Lot C3a : bulles de tableaux, création, modification
Fichiers à créer : `core/layout/dashboard-form-dialog.component.ts` et sa spec. À modifier : `core/layout/sidebar.component.{ts,html}`, `.spec.ts` ; `core/dashboard/dashboard.component.{ts,html}` (action du bandeau) ; `core/theme/components.css` (`.icon-choice`) ; `fr.json`, `fr.spec.ts`.

Étapes :
1. Liste des tableaux, `dashboardIconClass`, `+` neutre ; bulle « Tableau de bord » et `nav.dashboard` retirées.
2. Menu contextuel (§4.5) ; « Supprimer… » présent mais branché au lot C3b (désactivé avec `removeLast` s'il ne reste qu'un tableau).
3. Formulaire en `@defer (on immediate)`, Échap par l'hôte (D17).
4. Annonce `layout.current`.
5. Action du bandeau de débordement, avec nettoyage best-effort (§4.7).
6. Specs (`deferBlockBehavior: DeferBlockBehavior.Playthrough`, S4).

Tests : une bulle par tableau, dans l'ordre ; icône inconnue → classe par défaut ; `contextmenu` et `Maj+F10` ouvrent le menu sans navigation ; flèches, Échap (focus rendu), clic extérieur ; `+` neutre `aria-disabled` à 100 ; formulaire : nom vide et 101 caractères refusés, radios, double soumission, création qui navigue et focalise, icône inconnue conservée, erreur d'écriture, Échap ferme sauf pendant l'écriture, clic sur le voile sans effet ; bandeau : déplacement réussi sans navigation, échec → tableau vide supprimé et message.

Acceptation :
- C3a-1 Les classes d'icône de tableau ne viennent que de `dashboardIconClass`.
- C3a-2 Bundle initial < 500 kB ; `primeng/dialog` hors du bundle initial.

### Lot C3b : suppression d'un tableau avec sauvegarde `pre-delete` et verrou
Fichiers à créer : `src/backup/dashboard_delete.rs` (+ tests) ; `core/layout/dashboard-delete-dialog.component.ts` et sa spec. À modifier : `src/backup/names.rs`, `list.rs`, `mod.rs`, `error.rs`, `commands.rs`, `src/lib.rs` (enregistrement), `build.rs`, `capabilities/default.json`, `src/capability_tests.rs` ; `core/backup/backup.types.ts`, `backup.service.ts`, `.spec.ts` ; `core/lock/app-lock.ts` ; `core/layout/layout.component.ts` (`LOCK_TEXT`), `.spec.ts` ; `core/search/search-hotkey.ts`, `.spec.ts` ; `app.routes.ts`, `.spec.ts` ; `sidebar.component.{ts,html}` ; `fr.json`.

Étapes :
1. `BackupKind::PreDelete` : `ALL`, `as_str`, `pool` (`Safety`), `includes_images` (`false`) ; tests de `names.rs` (chaîne, réserve, sans images, analyse du nom).
2. `list.rs` : exclusion dans `newest_full_backup`, test.
3. `BackupError::LastDashboard` ; `dashboard_delete.rs` et commande (§4.8) ; `build.rs`, capability, `capability_tests.rs`.
4. Front : `BACKUP_KINDS`, `BackupErrorDto`, `backup.kind.pre-delete`, `BackupService.deleteDashboard`.
5. `AppLockKind` `delete`, `LOCK_TEXT` ; `SearchHotkey` ignore les touches sous verrou ; `canDeactivate: [appUnlockedGuard]` sur les deux routes de tableaux.
6. Dialogue (§4.8, D10) et branchement du menu.
7. Specs.

Tests Rust : suppression avec cascade (note, liste, tâches supprimées ; raccourci conservé) ; archive `pre-delete` présente, base seule, schéma courant ; sauvegarde impossible (nom déjà pris, comme `failed_pre_migration_sets_the_marker…`) → erreur et **rien supprimé** ; dernier tableau → `last_dashboard`, **aucune archive créée**, rien supprimé ; tableau absent → `not_found`, aucune archive ; id mal formé → `invalid_id` ; verrou pris → `busy`, aucune archive ; rétention : la 6e sauvegarde de sécurité évince la plus ancienne, tous types confondus.

Tests TS : case obligatoire ; pas de case si vide ; focus initial sur Annuler ; tableau courant : navigation **avant** le verrou, puis `prepareRemoval` et `deleteDashboard` sous verrou ; verrou rendu après succès et après chaque échec ; pendant le verrou, `Ctrl+K` sans effet et navigation refusée ; `not_found` → liste relue, dialogue fermé ; `last_dashboard`, `busy`, `unavailable`, autre erreur → messages, liste inchangée ; compte en échec → bloqué ; texte : nombre, notes, tâches, raccourcis, sauvegarde de sécurité ; Échap ignoré pendant la suppression.

Acceptation :
- C3b-1 Aucune suppression utilisateur de tableau sans archive `pre-delete` (test Rust).
- C3b-2 Aucune archive créée pour une suppression refusée (absent, dernier, verrou).
- C3b-3 Seules différences de capabilities et `build.rs` : `dashboard_delete`.
- C3b-4 Le dernier tableau n'est jamais supprimable (UI et Rust).
- C3b-5 Aucune navigation possible pendant la suppression (C22).

### Lot D : `+` vert et V bleu
Fichiers à créer : `core/dashboard/widget-add-flow.ts`, `.spec.ts` ; `core/layout/widget-picker-dialog.component.ts`, `.spec.ts`. À modifier : `sidebar.component.{ts,html}` ; `dashboard.component.{ts,html}` ; `widget-host.component.{ts,html}` ; specs ; `fr.json`.

Étapes :
1. `WidgetAddFlow` (§4.9).
2. Bouton unique, `registerTrigger`, Échap en `confirming`, annonces.
3. Pop-up en `@defer`, Échap par l'hôte, pas de voile actif.
4. `isNew` dans l'hôte.
5. Retirer du dashboard : menu, `adding`, `addFailed`, `menuOpen`, `onDocumentClick`, `onMenuKeydown`, effet de V15.
6. `accept` de l'hôte : `store.remove` puis `flow.focusTrigger()`.
7. Specs [D].

Tests (`widget-add-flow.spec.ts`) : transitions du §4.9 ; `pick` en échec reste en `choosing` ; **retour au même tableau** (V, `close()`, `open()` du même id) → `idle`, et `finish`/`open` repartent proprement ; `choosing` puis changement de session → `idle`, la pop-up ne se rouvre pas au retour ; instance disparue → `idle` ; `unavailable` hors tableau ; `pick` en double → une instance ; `pick` résolu après un changement de session → `idle`, widget créé. Pop-up : raison affichée, entrée désactivée, `gridFull`, Échap → `cancel` sauf `pending`. Sidebar : icône et classe par phase, même nœud `button` après `pick`, `aria-disabled` hors tableau, Échap sur le V.

Acceptation :
- D1 Parcours complet (spec) : `+`, choix, fermeture, mise en évidence, V bleu, clic, `+` vert.
- D2 Le V ne crée, n'annule ni ne supprime rien.
- D3 Plus de menu d'ajout ni de `.btn-primary` dans `DashboardComponent`.
- D4 Grille pleine : entrées désactivées, message, aucun `create`.
- D5 Bundle initial < 500 kB.

### Lot E : déplacement toujours actif
Fichiers : `core/widgets/widget-host.component.{ts,html}`, `.spec.ts` ; `core/dashboard/dashboard.component.{ts,html,css}`, `.spec.ts`, `grid-adapter.ts`, `.spec.ts` ; `scripts/test-dashboard-grid-css.mjs` ; `fr.json`, `fr.spec.ts`.

Étapes :
1. Adaptateur : `editing` retiré, `enabled: true`.
2. Dashboard : `editing`, `toggleEditing`, bouton, `.dashboard-grid-editing` retirés.
3. Hôte : entrée `editing` retirée, en-tête (§4.10).
4. CSS (§4.10).
5. Clés retirées ; specs [E].

Tests : poignée pour chaque carte, placeholder compris ; bouton de bascule absent ; flèches et `Maj+flèches` ; options (`ignoreContent`, `dragHandleClass`, `handles`) ; bouton supprimer hors de la poignée.

Acceptation :
- E1 `git grep -E "toggle-layout-edit|editLayout|doneEditing|dashboard-grid-editing"` sous `apps/web/src` : rien.
- E2 Déplacement clavier dès le rendu.
- E3 Script CSS : poignée invisible au repos, visible au survol et au focus.

### Lot F : export et import, icône
Fichiers : `core/backup/config-transfer.ts`, `config-transfer.service.ts`, `backup.types.ts`, specs ; `src/backup/config_transfer.rs`, `config_transfer_tests.rs`, `error.rs` ; `fr.json`.

Étapes :
1. TS (§4.12), y compris la lecture de `formatVersion` avant la validation stricte.
2. Rust (§4.12).
3. `config_transfer_tests.rs` : `"icon"` dans tous les fixtures, y compris ceux de `deny_unknown_fields` (l. 342-345).
4. Nouveaux tests.

Tests : `validDoc()` en v2 avec `icon` ; v1 sans `icon` → `th-large` ; v1 avec `icon` → `unknown_field@dashboards[0].icon` ; v2 sans → `missing_field@dashboards[0].icon` ; `'pi pi-x'`, `'A'`, 33 caractères → `invalid_value@dashboards[0].icon` ; icône hors liste acceptée ; v3 → `unsupported_version` ; v3 avec un champ inconnu → `unsupported_version` seul ; 0 et 1,5 → `invalid_value` ; export avec l'icône ; Rust : l'upsert crée et remplace l'icône, `InvalidIcon` avant toute sauvegarde `pre-import`, `{"icon": 1}`, champ inconnu et `icon` absent refusés à la désérialisation.

Acceptation :
- F1 Aller-retour : nom, icône et grille restitués exactement.
- F2 Un fichier v1 (fixture littérale) s'importe.
- F3 `deny_unknown_fields` conservé.
- F4 Ni `dashboard.last` ni clé secrète dans un export.

---

## 8. Critères d'acceptation d'ensemble

1. Commandes de fin de lot vertes après le lot F.
2. V1 à V3 inchangées ; V4 présente, enregistrée, au manifeste, inchangée depuis la revue de C1.
3. Aucune couleur brute, aucun `any`, aucun `Date` ajouté, `OnPush` partout, textes via Transloco.
4. Bundle initial < 500 kB ; budget inchangé.
5. `tauri.conf.json` et la CSP inchangés ; capabilities et `build.rs` modifiés uniquement pour `dashboard_delete` ; `tauri.dev.conf.json` réduit à `identifier` et `productName`.
6. M1 à M17 (et MT1 à MT9 de la spec dashboard-theme) passées par Marius sur l'exe release et la vraie base, **juste avant la fusion**.

---

## 9. Vérifications manuelles

**Ordre.** Pendant les lots : sur l'app de dev (`npm run dev`, dossier `.dev`, ensemencé par une archive réelle). Juste avant la fusion : M1 à M17 sur l'exe release (`npm run build`, installé), donc sur la vraie base ; M10 en premier.

**Avant d'installer l'exe V4 :** conserver l'installateur V3 actuellement installé (copier le `.msi` ou le `-setup.exe` de la version en cours hors du dossier `target`, par exemple dans `Documents\Homebase\installateurs\`). Sans lui, le retour arrière est impossible.

**Retour arrière (vraie base), si la V4 pose problème après installation :**
1. Quitter Homebase (y compris dans la zone de notification ; vérifier le Gestionnaire des tâches).
2. Dans `%APPDATA%\fr.mariusdev.homebase\backups\`, ouvrir la plus récente `homebase-<stamp>-pre-migration.zip` et en extraire `homebase.db`.
3. Remplacer `%APPDATA%\fr.mariusdev.homebase\homebase.db` par ce fichier, puis supprimer `homebase.db-wal` et `homebase.db-shm` s'ils existent.
4. Réinstaller l'exe V3 avec l'installateur conservé (sinon `VersionMissing`). Les images ne sont pas concernées.

- **M1 Hauteur.** Plusieurs widgets ; agrandir, réduire jusqu'à 800 × 600. Aucun ascenseur de page, rien de coupé, même forme à toute taille. Console WebView2 : `document.documentElement.scrollHeight === innerHeight` et `document.querySelector('main').scrollHeight === document.querySelector('main').clientHeight`, tous deux `true`.
- **M2 Réglages.** La page défile (molette, clavier). Le lien « Voir les sauvegardes » d'un bandeau mène à la carte.
- **M3 Ancienne disposition** (base de dev ensemencée, puis vraie base avant toute modification) : les widgets autrefois sous la ligne 8 sont tous visibles. Redémarrer : mêmes positions. Déplacer un widget, redémarrer : mêmes positions.
- **M4 Grille pleine.** Remplir un tableau. Déplacement à la souris vers une zone pleine : refus, rien hors grille. Ajout : entrées désactivées et message. Flèches sur la poignée : refus annoncé. Avec un widget sans place (bandeau) : supprimer un autre widget ; le widget sans place prend la place libérée, **aucun autre ne bouge** ; redémarrer : mêmes positions.
- **M5 Contenu.** Texte long dans une note : il défile dans la carte. Sélection, saisie, clics : aucun déplacement. Recherche en dernière ligne : liste entière dans la fenêtre.
- **M6 Barre.** Fond et bordure identiques à la page, clair et sombre. Survol : bulle de texte, y compris par-dessus un widget ; avec beaucoup de tableaux, faire défiler la liste : la bulle suit. Tab : bulle au focus, focus visible.
- **M7 Tableaux.** Créer « Pro » (`briefcase`), « Jeu vidéo » (`trophy`), « Perso » (`home`), « Streaming » (`video`). Widgets propres à chacun ; une recherche par tableau permise. F5 rouvre le même. Relancer : retour au dernier ouvert.
- **M8 Suppression.** Tableau avec une note et des tâches : texte explicite, case obligatoire. Pendant la suppression : voile « Suppression du tableau en cours… », `Ctrl+K` et clics sur la barre sans effet. Après : une sauvegarde « Avant suppression d'un tableau » (base seule) apparaît dans Réglages ; note et tâches disparues de la recherche ; raccourcis conservés. Dernier tableau non supprimable, et aucune sauvegarde créée en essayant.
- **M9 Clavier.** Sur une bulle : `Maj+F10`, puis la touche Menu si disponible : menu, flèches, Échap (focus rendu). `Tab` parcourt la barre. Narrateur : nom, « page en cours », raccourci annoncé.
- **M10 Migrations V4 et V5** (première action sur la vraie base, une seule fois ; vaut aussi MT6 de la spec dashboard-theme) : une seule sauvegarde « Avant mise à jour », base seule, schéma 3, prise avant que V4 et V5 soient appliquées ensemble ; tous les widgets présents ; tableau existant à l'icône grille et au thème par défaut.
- **M11 Restauration V3.** Restaurer cette sauvegarde : acceptée, redémarrage, V4 et V5 appliquées ensemble, nouvelle sauvegarde « Avant mise à jour » (schéma 3). Données retrouvées.
- **M12 Restauration au schéma courant.** Créer une sauvegarde manuelle (schéma 5), modifier quelque chose (icône et thème compris), la restaurer : acceptée, redémarrage, état d'avant la modification, icônes et thèmes compris.
- **M13 `+` vert et V.** Clic : pop-up ; choix : fermeture, widget mis en évidence, V sur fond bleu ; clic : `+` vert sans autre changement ; Échap sur le V : pareil. Pendant le V : changer de tableau, aller dans Réglages puis **revenir au même tableau** : `+` vert. Pop-up ouverte puis `Alt+←` : la pop-up se ferme et ne revient pas. Depuis Réglages, le `+` est grisé et sa bulle le dit. Échap dans la pop-up : fermeture ; clic sur le voile : rien.
- **M14 Poignées.** Survol de l'en-tête : l'icône devient la poignée, sans décalage ; glisser déplace. Survol de la carte : coin bas-droit visible ; tirer redimensionne, jusqu'à la dernière ligne et la dernière colonne, même à 800 × 600 avec un bandeau. Le bouton supprimer et l'ascenseur du corps réagissent normalement ; seuls les 14 × 14 px du coin bas-droit appartiennent à la poignée. Tab sur la poignée : flèches et `Maj+flèches`.
- **M15 Recherche.** Depuis un tableau, chercher une note d'un autre tableau, Entrée : le tableau s'ouvre, la carte est focalisée et mise en évidence.
- **M16 `Ctrl+K` et `/`.** Sur un tableau sans barre de recherche, puis depuis Réglages : `Ctrl+K` ouvre le tableau qui en a une et place le curseur dans le champ ; `/` ne fait rien. Sans aucune barre nulle part : rien.
- **M17 Export et import.** Le fichier exporté a `"formatVersion": 3`, les icônes, les thèmes, et pas de `dashboard.last`. Modifier une icône et un thème, importer : ils reviennent, rechargement. Un ancien fichier v1 ou v2 : accepté ; l'aperçu annonce que les thèmes seront remis par défaut (et les icônes, pour v1). `"formatVersion": 4` : refusé. Pendant un import, barre et page figées sous le voile.

---

## 10. Amendements à appliquer par le coordinateur

### 10.1 ADR-001

§3.2, `size`, remplacer par :
> - `size` : `min`, `default`, `max` en unités de grille (`w` sur une grille de `GRID_COLUMNS = 12` colonnes, `h` ≤ `GRID_ROWS = 8`), entiers, `1 ≤ min ≤ default ≤ max` sur chaque axe. Un widget réel a `min.h ≥ 2`, sinon sa carte ne montre que l'en-tête. *Amendement (spec dashboards-sidebar).*

§3.5, après « À l'affichage, `grid` est borné… », ajouter :
> *Amendement (spec dashboards-sidebar)* : la grille compte 8 lignes dont la hauteur suit la fenêtre, comme les 12 colonnes. `core/dashboard/grid-layout.ts` (`fitLayout`) calcule le rectangle affiché à partir du stocké, de façon pure et déterministe, sans écriture à la lecture : ce qui tient reste en place, le reste prend la première place libre, à sa taille puis réduite jusqu'au minimum. Toute modification (déplacement, redimensionnement, ajout, suppression) écrit tous les widgets repositionnés, si bien qu'aucun ne bouge ensuite sans action. Un widget sans place est signalé par un bandeau, avec une action de déplacement vers un nouveau tableau.

§3.5, remplacer « Dashboard affiché en phase 0 : … » par :
> Dashboard affiché : celui de la route `/dashboards/:id`. La route `/` mène au dernier ouvert (réglage `dashboard.last`, ni exporté ni importé) ou au premier ; le dashboard par défaut est créé au premier lancement par `DashboardRepository.createIfNone({ name })` (nom traduit, clé `dashboard.defaultName` ; une fois créé, c'est une donnée utilisateur). *Amendement (spec dashboards-sidebar).*

§3.5, exemple JSON : `"formatVersion": 2` et `"icon": "th-large"` après `"sortOrder": 0`. Après l'amendement phase 1, ajouter :
> *Amendement (spec dashboards-sidebar)* : `formatVersion` passe à 2, lu avant la validation stricte de l'enveloppe (un format plus récent est refusé en `unsupported_version` même s'il ajoute des champs). `dashboards[].icon` y est obligatoire (forme `^[a-z][a-z0-9-]{0,31}$`, liste fermée côté front ; une valeur inconnue est conservée et s'affiche avec l'icône par défaut). Les fichiers en version 1 restent acceptés, sans `icon` : leurs tableaux prennent l'icône par défaut. Le réglage `dashboard.last` n'est ni exporté ni importé.

§3.6, ajouter :
> *Amendement (spec dashboards-sidebar)* : `core/search` connaît le type `search` par la constante `SEARCH_WIDGET_TYPE` (raccourci `Ctrl+K`, qui ouvre le tableau contenant une barre de recherche). C'est un couplage par chaîne, assumé : `core/search` est le service propre à ce widget et n'importe rien de `widgets/`. Renommer le type `search` imposerait de changer cette constante.

§3.7 : `DashboardRepository { list, get, create, createIfNone, update, remove }` ; `WidgetInstanceRepository { …, updateLayout(dashboardId, items) → number, moveToDashboard(targetDashboardId, items) → number, findFirstOfType(widgetType), remove }`. Ajouter : « La suppression d'un dashboard par l'utilisateur passe par la commande Rust `dashboard_delete`, qui prend d'abord une sauvegarde `pre-delete` (spec dashboards-sidebar). »

§3.9, ajouter :
> *Amendement (spec dashboards-sidebar)* : `gridType: 'fit'`, 12 × 8 fixes, sans `setGridSize`, `outerMargin*` à 0 pour `enableBoundaryControl`. Déplacement et redimensionnement toujours actifs, depuis la poignée de l'en-tête et le coin bas-droit seulement ; plus de mode édition.

§3.10 : « Tailles min 2×2, défaut 3×2, max 6×4 ».

§5 : « `maxInstances` atteint » : « entrée de la pop-up désactivée ». Ajouter :
> | Plus de place sur la grille | `add` rejeté (`GridFullError`), entrée de la pop-up désactivée, message |

§7, point 2 : « Plusieurs dashboards affichés : **clos (spec dashboards-sidebar).** »

§8.4 reste historique.

### 10.2 ADR-002

Fin de §3.4 :
> *Amendement (spec dashboards-sidebar, V4)* : `dashboards.icon TEXT NOT NULL DEFAULT 'th-large'` avec un `CHECK` de forme. Exception justifiée à « pas de `DEFAULT` » (règle des horodatages) : `ADD COLUMN NOT NULL` exige un défaut. Le `CHECK` ne fige pas la liste des icônes.

Fin de §3.5 :
> *Amendement (spec dashboards-sidebar)* : `Dashboard.icon`, `NewDashboard.icon?` ; `DashboardRepository.update(id, { name, icon })` remplace `rename`, sans appelant ; `remove` ne sert plus qu'au nettoyage d'un dashboard vide juste créé ; la suppression par l'utilisateur passe par la commande Rust `dashboard_delete` (contrôle d'existence et du nombre de dashboards sous le verrou de sauvegarde, sauvegarde `pre-delete`, puis une instruction `DELETE` qui épargne le dernier dashboard). `WidgetInstanceRepository.moveToDashboard(targetDashboardId, items)` (une instruction `UPDATE … FROM json_each`) et `findFirstOfType(widgetType)`.

Fin de §2.7, « Sauvegarde », après la rétention :
> *Amendement (spec dashboards-sidebar)* : type `pre-delete` (base seule, réserve de sécurité), pris par `dashboard_delete` juste avant la suppression d'un dashboard ; son échec annule la suppression ; aucune archive n'est créée pour une suppression refusée d'avance (dashboard absent ou dernier).

### 10.3 `docs/DESIGN.md`

§2.1, après `--hb-accent-subtle` :
> | `--hb-accent-emphasis` | `#0969da` | `#1f6feb` | fond plein d'accent, avec `--hb-fg-on-emphasis` (`--hb-accent` n'atteint pas AA en sombre) |

§3, remplacer « Barre supérieure » et « Navigation » par :
> - **Barre de navigation** : verticale à gauche, 56 px, **sans fond ni bordure propres**. Bulles de 40 px (`.sidebar-bubble`) : rondes, cadre `--hb-border`, fond `--hb-bg`, icône `--hb-fg-muted` ; actif (`aria-current="page"`) en `--hb-accent` sur `--hb-accent-subtle`. De haut en bas : tableaux de bord (zone défilante), `+` neutre, espace, `+` vert, Réglages. Pas de bouton de thème (réglage dans Réglages).
> - **Bulle de texte** (`.sidebar-label`) : au survol et au focus clavier d'une bulle, le nom à côté, sur `--hb-bg-emphasis`, texte `--hb-fg-on-emphasis`, pilule, ombre de flottant.
> - **Ajout de widget** : `+` sur `--hb-success-emphasis` (`.sidebar-bubble-add`), puis V sur `--hb-accent-emphasis` (`.sidebar-bubble-done`). Seule action primaire de la vue tableau de bord.

§3, « En-tête de page », ajouter : « Le tableau de bord n'en a pas : son titre est un `<h1 class="sr-only">`. »

§4, remplacer « En mode édition… » par :
> - La grille compte 12 colonnes et 8 lignes dont la taille suit la fenêtre : un tableau de bord ne défile jamais, seul le contenu d'une carte peut défiler. Le déplacement est toujours actif : la poignée remplace l'icône au survol et au focus de l'en-tête ; le coin bas-droit de redimensionnement apparaît au survol de la carte. Déplacement en cours et aperçu de dépôt en `--hb-accent`.

§4, « L'hôte de widget » : « (icône ou poignée, titre, Supprimer) ».

§5 : retirer `topbar`, `underline-nav` / `underline-nav-item` ; ajouter `sidebar`, `sidebar-group`, `sidebar-group-scroll`, `sidebar-spacer`, `sidebar-bubble` (+ `sidebar-bubble-add`, `sidebar-bubble-done`), `sidebar-label`, `icon-choice` ; Tailwind : `accent-emphasis`.

### 10.4 `docs/PLAN.md`

§4, après « Front : … » :
> Navigation : barre verticale à gauche, plusieurs tableaux de bord (`/dashboards/:id`) d'une grille de 12 × 8 cellules qui ne défile jamais (`docs/specs/dashboards-sidebar.md`). `npm run dev` utilise l'identifiant `fr.mariusdev.homebase.dev` et le nom « Homebase Dev » (base, sauvegardes et démarrage automatique séparés) ; `npm run tauri dev` et `cargo tauri dev` sont proscrits.

§2, ligne Grille, fin de cellule : « Mode `fit` : 12 × 8 fixes (spec dashboards-sidebar). »

### 10.5 `docs/ROADMAP.md`

Ligne de la sauvegarde (Phase 1) : remplacer « M10 (sauvegarde avant migration) à vérifier à la première migration V4, en phase 2 » par « M10 (sauvegarde avant migration) à vérifier à la première migration V4 (spec dashboards-sidebar, M10) ».

Après la sortie de la Phase 1 :
```markdown
## Phase 1 bis : navigation et grille
Spec : `docs/specs/dashboards-sidebar.md`.
- [ ] (S) Lot 0 : base et démarrage automatique de développement séparés (`tauri.dev.conf.json`)
- [ ] (S) Lot A : grille de 8 lignes qui s'adaptent, repositionnement à l'affichage
- [ ] (S) Lot B : barre verticale à bulles, retrait du H1, du nom de l'app et du bouton de thème
- [ ] (S) Lot C1 : migration V4 `dashboards.icon`, couche de données (texte de V4 figé à la revue)
- [ ] (S) Lot C2a : plusieurs tableaux (stores, garde, routes, page)
- [ ] (S) Lot C2b : recherche inter-tableaux, Ctrl+K, exclusion de `dashboard.last`
- [ ] (S) Lot C3a : bulles de tableaux, création, modification
- [ ] (S) Lot C3b : suppression d'un tableau (sauvegarde `pre-delete`, verrou)
- [ ] (S) Lot D : `+` vert et V bleu d'ajout de widget
- [ ] (S) Lot E : déplacement toujours actif, poignées
- [ ] (S) Lot F : export et import (`formatVersion` 2)
- [ ] (O) Revue de fin de phase ; vérifications M1 à M17 par Marius sur l'exe release, juste avant la fusion
- [ ] (S) Tests Playwright des parcours critiques (navigation, ajout de widget, géométrie de la grille), après cette refonte
```

### 10.6 `docs/specs/backup-restore.md`

- l. 138 : remplacer « `<kind>` ∈ `manual`, `daily`, `pre-migration`, `pre-restore`, `pre-import` » par « `<kind>` ∈ `manual`, `daily`, `pre-migration`, `pre-restore`, `pre-import`, `pre-delete` ».
- l. 139 : remplacer « `pre-migration` et `pre-import` contiennent la base seule » par « `pre-migration`, `pre-import` et `pre-delete` contiennent la base seule ».
- l. 146 : remplacer « `| sécurité | `pre-restore`, `pre-import` | 5 |` » par « `| sécurité | `pre-restore`, `pre-import`, `pre-delete` | 5 |` ».
- l. 185 : ajouter la ligne « `| `pre-delete` (base seule) | Juste avant la suppression d'un tableau de bord (commande `dashboard_delete`), après contrôle que le tableau existe et n'est pas le dernier ; son échec annule la suppression |` ».
- l. 195 : remplacer « `formatVersion` (1) » par « `formatVersion` (2 ; 1 accepté en lecture) ».
- l. 256 : remplacer « `"formatVersion": 1,` » par « `"formatVersion": 2,` », et ajouter `"icon": "th-large",` dans l'objet dashboard de l'exemple.
- l. 330 : remplacer « ignore les archives endommagées, `pre-migration`, `pre-import` » par « ignore les archives endommagées, `pre-migration`, `pre-import`, `pre-delete` ».
- l. 508 : `pub enum BackupKind { Manual, Daily, PreMigration, PreRestore, PreImport, PreDelete }`.
- l. 549 : remplacer « `formatVersion` (supérieur à 1 → `unsupported_version`, autre valeur non valide → `invalid_value`) » par « `formatVersion`, lu avant la validation stricte (supérieur à 2 → `unsupported_version` ; autre valeur que 1 ou 2 → `invalid_value`) ».
- l. 692 (`backup.intro`) : « Une sauvegarde contient la base et les images. Homebase garde les 10 dernières sauvegardes manuelles, les 7 quotidiennes, les 5 de sécurité (avant restauration, import ou suppression d'un tableau) et les 3 d'avant mise à jour. »
- l. 719 : ajouter `backup.kind.pre-delete          Avant suppression d'un tableau`.
- l. 865 (M9) : « `"formatVersion": 2` est refusé » → « `"formatVersion": 3` est refusé ».
- l. 866 (M10) : ajouter « Exécutée avec la spec dashboards-sidebar (M10 de cette spec). »
- l. 957 : `// false : PreMigration, PreImport, PreDelete`.
- l. 1187 : « Refus : `formatVersion: 2` » → « Refus : `formatVersion: 3` ».
- §4.12, ajouter à la fin :
> **Amendement (spec dashboards-sidebar, 2026-11-06)** : `formatVersion` passe à 2 et se lit avant la validation stricte. `dashboards[].icon` y est obligatoire ; absent en version 1, où le plan reçoit l'icône par défaut. `ConfigImportPlan.dashboards[].icon` est toujours présent ; `validate_plan` contrôle sa forme (`invalid_icon`) ; `UPSERT_DASHBOARD` écrit `icon`. Le réglage `dashboard.last` est exclu de l'export, ignoré à l'analyse et jamais écrit par `config_import_apply`.
- §4.13, ajouter : `BackupError::LastDashboard` (`last_dashboard`), renvoyé par `dashboard_delete`.

### 10.7 `CLAUDE.md`

Section « Commandes », ligne Dev : remplacer « Dev (fenêtre Tauri + `ng serve`) : `npm run dev` » par « Dev (fenêtre Tauri + `ng serve`, base et démarrage automatique de développement séparés : `fr.mariusdev.homebase.dev`, « Homebase Dev ») : `npm run dev`. Jamais `npm run tauri dev` ni `cargo tauri dev` (vraie base) ».

---

## 11. Risques

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | Cartes de `h = 2` serrées sur petite fenêtre | Contenu à faire défiler | Assumé (« défile dans sa carte ») |
| R2 | Widget à hauteur interne fixe à 68 px de ligne | Affichage serré | `.box-body` défile ; M1, M5 |
| R3 | V4 lancée sur la vraie base puis modifiée | `VersionMismatch`, démarrage impossible | Lot 0 ; V4 figée à la revue de C1 ; vraie base seulement à M10 ; installateur V3 conservé ; retour arrière (§9) ; V5 (spec dashboard-theme) figée à la revue de son lot T2, même procédure |
| R4 | Widget stocké très grand réduit à l'écran | Perte apparente de taille | Taille stockée conservée jusqu'à la première modification (D3) |
| R5 | Le coin `se` capte 14 × 14 px en bas à droite de la carte | Petit masquage au survol | Assumé ; M14 |
| R6 | Gridster 21.0.1 en `fit` avec push, en zoneless | Comportement souris inattendu | M4, M14 ; repli gridstack (PLAN §2) non activé |
| R7 | `pointer-events: none` sur la bulle de texte | Écart WCAG 1.4.13 | Assumé (D8) |
| R8 | Pas de test automatique de géométrie | Régression silencieuse | Script CSS, M1 ; tâche Playwright planifiée |
| R9 | Rafale de suppressions de tableaux | Éviction d'anciennes sauvegardes de sécurité | Aucune archive pour une suppression refusée d'avance ; rotation bornée comme aujourd'hui ; sauvegardes manuelles et quotidiennes non concernées |
| R10 | Budget initial | Avertissement | `@defer` ; `core/backup` hors du bundle initial ; condition d'arrêt |
| R11 | Ancien binaire face à un export v2 | Message `unknown_field` au lieu de `unsupported_version` | Refus correct ; assumé (D16) |
| R12 | Commande de dev lancée sans le fichier de dev (`npm run tauri dev`, `cargo tauri dev`) | Écriture dans la vraie base et la vraie entrée de démarrage | Règle commune, `CLAUDE.md` (§10.7), condition d'arrêt |

---

## 12. Décisions de Marius et points restants

**Décidé (2026-11-05)**
1. `search` et `hello` : `min.h = 2` (D4).
2. Sauvegarde de sécurité de la base seule juste avant la suppression d'un tableau : type `pre-delete`, réserve de sécurité, échec = suppression annulée (D10, §4.8, lot C3b).
3. `Ctrl+K` va au tableau qui contient une barre de recherche et la focalise ; rien s'il n'y en a aucune (D18). `/` reste limité à la page courante.
4. Playwright : tâche séparée de la ROADMAP après cette refonte ; vérifications manuelles cette fois (§6.5, §10.5).
5. **Changement explicite** : le bouton de thème quitte la barre ; le thème se règle dans Réglages (D7). Présenté sans objection.

**Restant à confirmer (non bloquant)**
6. Ordre bas de barre : `+` vert au-dessus de Réglages, Réglages tout en bas (D7). **Décidé** par Marius sur aperçu.
7. Icône « jeu vidéo » : `trophy` (pas de manette dans PrimeIcons) ; une exception SVG comme la météo reste possible à part.
8. Un fichier d'export v1 importé remet les icônes personnalisées au défaut (D16).
