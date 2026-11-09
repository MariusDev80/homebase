# Spec : thème par tableau de bord (couleurs des cartes)

- **Statut** : prête à implémenter. Révision 2 (2026-11-09) : revue indépendante « OK avec réserves » intégrée (640 paires de contraste recalculées ; V5 exécutée sur better-sqlite3) ; décisions de Marius au §12
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§7), **sur la branche `dashboards-sidebar`**
- **Liens** : `CLAUDE.md` ; `docs/DESIGN.md` ; ADR-001 (contrat Widget) ; ADR-002 (données) ; `docs/specs/dashboards-sidebar.md` (D0, D7, D11, D13, D16, D17, §4.6, §4.7, §7, §9) ; `docs/specs/backup-restore.md` (§4.7, §4.12)

Cette spec vaut compte rendu de décision (contexte, options, décision, conséquences, risques). Elle ne modifie aucun autre document : les amendements à appliquer par le coordinateur sont rédigés au §10. Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`, scripts relatifs à `apps/web/`, sauf mention.

---

## 1. Contexte et périmètre

Demande de Marius (décisions prises) :
1. Un bouton dans la barre verticale, **au-dessus du `+` vert** d'ajout de widget, règle le thème du **tableau de bord courant** : couleur de **fond** et couleur du **haut (en-tête)** des cartes.
2. Une **palette fermée d'une douzaine de teintes pastel**, chacune avec une variante claire et une variante sombre. La teinte du texte et des icônes posés dessus s'adapte pour rester lisible (contraste vérifié par `check-contrast`).
3. **Deux choix** (fond, en-tête), chacun avec « Par défaut ». Fond « Par défaut » = rendu actuel de DESIGN.md. En-tête « Par défaut » = **suit le fond** : la variante un peu plus soutenue de la même teinte, ou le rendu actuel si le fond est par défaut.
4. Le thème est stocké avec le tableau (migration **V5**) et part dans l'export de configuration (**format 3** ; formats 1 et 2 toujours acceptés).
5. **Extensible** : d'autres options viendront ; si possible sans migration à chaque option.
6. Le tableau « (suite) » créé par le bandeau de débordement **hérite du thème**, comme de l'icône.
7. Livraison **sur la branche `dashboards-sidebar`**, avant sa fusion (avec la phase 1 bis).

**Hors périmètre** (non demandé, à ne pas improviser) : couleur de la page, de la barre ou des dialogues ; couleur par widget ; teintes libres (sélecteur de couleur) ; Playwright (tâche séparée de la ROADMAP).

---

## 2. Faits vérifiés et suppositions

### 2.1 Vérifiés (lecture du dépôt et de `node_modules`, 2026-11-09 ; revue indépendante du même jour)

| # | Fait | Source |
|---|---|---|
| V1 | `.box` : fond `--hb-bg`, cadre `--hb-border` ; `.box-header` : fond `--hb-bg-subtle`, bordure basse `--hb-border` ; `.box-header > i` en `--hb-fg-muted` ; `.btn-icon` en `--hb-fg-muted` ; `.btn-invisible:hover` en `--hb-hover` | `core/theme/components.css` l. 62-66, 87-99, 169-203 |
| V2 | En-tête d'une carte : icône du type, poignée (`btn btn-invisible btn-icon btn-compact`), titre `h2` (`--hb-fg`), bouton Supprimer (`btn btn-invisible btn-icon btn-compact`, sans couleur de danger) | `core/widgets/widget-host.component.html` l. 8-40 |
| V3 | La poignée de redimensionnement est un enfant de `gridster-item`, **hors de `.box`** ; sa couleur est `var(--hb-fg-muted)` | `core/dashboard/dashboard.component.css` l. 94-99 |
| V4 | `@theme inline` : les utilitaires Tailwind référencent directement `var(--hb-*)`. Redéfinir un `--hb-*` sur un sous-arbre change donc les utilitaires de ce sous-arbre | `styles.css` l. 11-39 |
| V5 | Les teintes dérivées (`--hb-success-subtle`, `--hb-danger-subtle`, `--hb-attention-subtle`, `--hb-hover`) sont calculées sur `:root` : une redéfinition de `--hb-bg` plus bas ne les recalcule pas (`--hb-hover` est un voile translucide, valable sur tout fond) | `core/theme/tokens.css` l. 26-29 |
| V6 | Les widgets n'emploient que des utilitaires sémantiques : `text-fg`, `text-fg-muted`, `text-danger` (notes, todo, en texte), `text-attention` (todo, météo, **en texte**), `text-accent` (icône météo), `bg-canvas` (popover de recherche, raccourcis), `bg-canvas-subtle`, `border-default`, `border-muted`, `hover:bg-hover`, `bg-accent-subtle`, `bg-attention-subtle`. Aucun `--hb-*` direct, aucun composant PrimeNG | grep `widgets/**` |
| V7 | `check-contrast.mjs` ne lit que les déclarations hexadécimales de `:root` et `.app-dark`, un seul seuil (4,5), ignore l'alpha ; `--hb-page-bg` (alias `var(...)`) n'est pas lisible aujourd'hui ; il prend le chemin de `tokens.css` en `argv[2]` | `scripts/check-contrast.mjs` l. 9-44 |
| V8 | `check-design-tokens.mjs` n'autorise l'hexadécimal que dans `tokens.css` et `homebase-preset.ts`, sous `src/app` | `scripts/check-design-tokens.mjs` l. 11, 19 |
| V9 | Angular passe toute propriété de style contenant `-` par `style.setProperty` (drapeau `DashCase`) : les propriétés personnalisées `--x` sont prises en charge par `[style]` | `@angular/core` `applyStyling` (`_debug_node-chunk.mjs` l. 5080) ; `@angular/platform-browser` `setStyle` l. 609 |
| V10 | CSP : `style-src 'self' 'unsafe-inline'` ; la barre emploie déjà `[style.top.px]` | `tauri.conf.json` l. 26 ; `sidebar.component.html` l. 108 |
| V11 | `p-dialog` a les entrées `position` (`left`, `bottomleft`…), `maskStyleClass`, `focusTrap` (vrai par défaut) ; le voile porte `p-overlay-mask` quand `modal` | `primeng-dialog.mjs` l. 30-52, 176, 206, 261, 365, 538-542 |
| V12 | Ordre des couches : `theme, base, primeng, components, utilities` : une règle de `components` l'emporte sur PrimeNG | `styles.css` l. 1 |
| V13 | Budgets : `initial` avertit à 500 kB ; `anyComponentStyle` avertit à **4 kB** (une feuille de composant ne peut pas porter 24 règles de teintes) | `angular.json` l. 38-47 |
| V14 | `resolveConfig` / `serializeConfig` sont génériques sur `WidgetConfigSpec<T>` (version, schéma Standard Schema, défauts, migrations) | `core/widgets/widget-config.ts`, `widget-definition.ts` l. 32-37 |
| V15 | valibot est déjà dans le bundle initial (définitions de widgets fournies par `provideAllWidgets` dans `app.config.ts`) | `app.config.ts` l. 10 ; `widgets/*/*.config.ts` |
| V16 | La route du tableau (`DashboardComponent`) est chargée à la demande ; `fr.json` aussi (`import('./fr.json')`) | dashboards-sidebar §4.7 ; `core/i18n/i18n.providers.ts` l. 26 |
| V17 | `dashboards` est une table `STRICT` ; V4 a ajouté `icon` par `ALTER TABLE ADD COLUMN` ; le test `expected_schema_of_version_4_matches_a_real_database` fige le texte `CREATE TABLE` réécrit par SQLite | `migrations/V1__init.sql`, `V4__dashboard_icon.sql` ; `src/backup/validate_tests.rs` l. 881-912 |
| V18 | **Piège** : `migrate_with_real_migrator` applique **toutes** les migrations ; `v3_database_migrated_to_v4_has_the_schema_of_v4_and_the_default_icon` compare ensuite à une base V4 : il cassera avec V5 | `validate_tests.rs` l. 914-949 ; `test_support.rs` l. 78-93 |
| V19 | Tests Rust qui supposent que 4 est la dernière version : `sqlite.rs` l. 70 ; `validate_tests.rs` l. 629 et 636-641 ; plus V18 | grep |
| V20 | `config_transfer_tests.rs` construit des plans avec `"icon"` à une vingtaine d'endroits (l. 38, 122, 144, 163, 185-190, 276, 343, 346, 362-363, 404-405, 450, 476-477, 500-501, 618, 752-753, 774-776, 983) | grep |
| V21 | `parseConfigImport` lit `formatVersion` avant la validation stricte : le binaire actuel répondra `unsupported_version` à un fichier v3 | `core/backup/config-transfer.ts` l. 366-374 |
| V22 | `UPSERT_DASHBOARD` et l'ordre de ses `bind` | `src/backup/config_transfer.rs` l. 261-262, 352-358 |
| V23 | `DashboardListStore.update` remplace l'entrée dans la liste ; le titre de la page est lu dans la liste (pattern à suivre pour le thème) | `dashboard-list.store.ts` l. 96-100 ; `dashboard.component.ts` l. 141-145 |
| V24 | `DashboardRepository.update` n'écrit que `name` et `icon` : une écriture de thème sur d'autres colonnes ne peut pas l'écraser (et inversement) | `sqlite-dashboard.repository.ts` l. 75-86 |
| V25 | `migrations.spec.ts` dispose de `createTestDatabase(n)` et d'un modèle de test de migration (V4) | `data/migrations.spec.ts` l. 90-138 |
| V26 | Phase 1 bis non fusionnée ; revue de fin de phase et M1 à M17 en attente ; **V4 figée depuis le commit 8982993** (toute correction de V4 serait une nouvelle migration) | `docs/ROADMAP.md` l. 45 ; coordinateur |
| V27 | DESIGN §1.3 : « la couleur porte une information […], jamais de la décoration » : les teintes demandent une exception écrite | `docs/DESIGN.md` l. 10 |
| V28 | `SearchHotkey` ignore `Ctrl+K` et `/` quand la cible est dans un `[role="dialog"]` : depuis le panneau, `Ctrl+K` ne fait rien | `core/search/search-hotkey.ts` l. 82 |
| V29 | `moveUnplaced` crée le tableau « (suite) » avec `list.create({ name, icon })`, en lisant le tableau courant dans `list.dashboards()` | `core/dashboard/dashboard.component.ts` l. 174-201 |
| V30 | `npm run test:design` (dans `npm run test`) lance `test-dashboard-grid-css.mjs`, `check-contrast.mjs`, `test-design-tokens.mjs`… ; `test-design-tokens.mjs` vérifie le contrôleur sur des fixtures `ok`/`ko` (modèle à suivre) | `apps/web/package.json` l. 12 ; `scripts/test-design-tokens.mjs` |
| V31 | Le panneau d'import affiche l'aperçu (`ImportPreview`) dans `config-transfer-settings.component.ts` (clés `configTransfer.*`) | `features/settings/config-transfer-settings.component.ts` l. 135-176 |
| V32 | **Revue indépendante** : les 640 paires de contraste du §4.2 recalculées passent, marges du §4.1 exactes ; le défaut `#d1d9e0` est sous 1,3:1 contre les en-têtes teintés (1,01 à 1,22) et les corps teintés (jusqu'à 1,16) : d'où la règle de bordure du D5 ; la bordure d'une teinte atteint ≥ 1,52:1 contre l'en-tête par défaut et ≥ 1,3:1 contre le corps blanc ; sous le voile de survol, le pire cas d'une icône d'en-tête est 4,42:1 (Pervenche, sombre) | revue du 2026-11-09 |
| V33 | **Revue indépendante** : V5 exécutée sur better-sqlite3 : texte `CREATE TABLE` conforme au §4.3 ; V3 → V5 identique à une V5 neuve ; `CHECK` conformes (JSON invalide refusé en contrainte) | revue du 2026-11-09 |

### 2.2 Supposés (à vérifier ; si faux : s'arrêter et rapporter)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | `v.optional(schéma, 'default')` dans un `v.strictObject` remplit la valeur absente et donne le type de sortie `{ cardBody: string; cardHeader: string }` | `dashboard-theme.spec.ts` (lot T3) |
| S2 | jsdom restitue une propriété personnalisée posée par `[style]` via `style.getPropertyValue('--x')` | `dashboard.component.spec.ts` (T3). Si faux : tester la fonction pure et les attributs `data-card-body`/`data-card-header` (§4.5), rapporter |
| S3 | Sur le voile de `p-dialog`, `.dialog-mask-clear` (`--p-mask-background: transparent; background: transparent`) supprime l'assombrissement, sans flash à l'ouverture | MT2 |
| S4 | La SQLite embarquée par sqlx produit le même texte `CREATE TABLE` que better-sqlite3 (V33) | test Rust du lot T2. Si le texte diffère : **ne pas toucher V5**, rapporter |
| S5 | Le bundle initial reste sous 500 kB (estimation +6 à +8 kB, §4.10) | `npm run web:build` à chaque lot |

---

## 3. Décisions

### D1. Modèle : un objet JSON versionné (`theme` + `theme_version`), pas une colonne par option

| Option | Pour | Contre |
|---|---|---|
| A. Une colonne par option (`card_body_tint`, `card_header_tint`) avec `CHECK` de forme | `CHECK` par colonne ; correspondance directe | **Chaque nouvelle option = une migration** : texte figé dès le premier lancement, sauvegarde `pre-migration`, matrice de restauration, nouveau `formatVersion`, tests de schéma figé. C'est le coût que Marius veut éviter |
| **B. Objet JSON `theme` + entier `theme_version`** (même forme que `config` / `config_version` des widgets) | Options ajoutées **sans migration ni nouveau format de fichier** : nouvelle version du schéma de thème côté front, avec migration TS (ADR-001) ; réutilise `resolveConfig`/`serializeConfig` (V14) ; export `{ version, data }` identique aux widgets ; Rust ne contrôle que la forme, comme pour les configs | Le SQL ne contrôle que la forme (objet, taille) ; la liste des teintes vit côté front (comme les icônes, D11 de dashboards-sidebar) |
| C. Objet JSON sans version, clés additives | Une colonne de moins | Un ancien binaire perdrait les clés inconnues en réécrivant le thème ; pas de chemin de migration |

**Retenu : B.** Règles d'évolution :
- **Ajouter une teinte** : nouvelles valeurs dans `tokens.css` et `CARD_TINTS`, aucune version à changer (une teinte inconnue d'un binaire plus ancien est conservée et rendue « par défaut »).
- **Ajouter une option** (nouvelle clé) : `DASHBOARD_THEME_SPEC.version` + 1 et migration `n → n+1` qui pose la valeur par défaut. Un binaire plus ancien voit une version future : rendu par défaut, panneau en lecture seule (aucune perte).
- Aucune migration SQL, aucun nouveau `formatVersion` d'export pour ces deux cas.

### D2. Valeur d'un créneau : forme contrôlée, liste fermée au rendu
Thème v1 : `{ cardBody: string, cardHeader: string }`, chaque valeur de forme `^[a-z][a-z0-9-]{0,31}$`, clé absente = `'default'` (défaut du schéma, S1). `'default'` n'est jamais un identifiant de teinte. Seule une teinte de `CARD_TINTS` produit un style (`knownTint`) ; une valeur valide mais inconnue est traitée comme `'default'` au rendu **et conservée** (même règle que l'icône, D11 de dashboards-sidebar). Valeur en base pour un tableau jamais personnalisé : `'{}'` (défaut de V5), qui se résout en deux `'default'`.

### D3. Palette : 12 teintes, 4 rôles, 2 thèmes
Rôles par teinte : `body` (corps de carte), `header` (en-tête, un peu plus soutenu que `body`), `muted` (texte secondaire et icônes, sur les deux surfaces), `border` (cadre de la carte et séparateur de l'en-tête). Valeurs au §4.1.
- **Clair** : pastels de l'échelle Tailwind CSS v3 (licence MIT ; seules des valeurs hexadécimales sont reprises) : `body` = nuance 100, `header` = 200, `muted` = 800 (600 pour les neutres), `border` = la plus claire des nuances 300/400/500 qui atteint 1,3:1 contre l'en-tête.
- **Sombre** : la nuance 950 (800 pour les neutres) mélangée au fond (`header` : 70 % sur `#151b23` ; `body` : 35 % sur `#0d1117`), `muted` = 400, `border` = 900 (700 pour les neutres). Le pastel n'a pas de sens sur fond sombre : on garde la teinte, assourdie. **Ces teintes sombres sont à peine perceptibles contre la page (1,03 à 1,10:1, V32)** : c'est voulu pour le confort, mais Marius doit en juger explicitement (MT1, §12 point 1) ; elles se renforcent dans `tokens.css` sans migration, sous réserve de `check-contrast`.
- **Couleurs de sens sur un corps teinté** : en clair, les couleurs de sens de DESIGN (`accent`, `danger`, `success`, `attention`) n'atteignent pas 4,5:1 sur un pastel (il faudrait une luminance relative ≥ 0,86 à 0,92). Elles sont donc remplacées, **seulement dans un corps teinté**, par leurs nuances plus profondes de Primer (`--hb-on-tint-*`, §4.1). En sombre, elles restent identiques.
- Le texte principal `--hb-fg` reste partagé : il dépasse 4,5:1 sur toutes les teintes.

Valeurs calculées à la main puis recalculées par la revue (V32). **`check-contrast` fait foi** (§4.2, règle de correction au lot T1).

### D4. Application : une portée `.card-theme` qui redéfinit les tokens dans la carte
La zone de grille du tableau courant porte la classe `.card-theme`, qui déclare des **créneaux** (`--hb-card-body-*`, `--hb-card-header-*`) valant par défaut les tokens actuels. Le tableau pose en ligne (`[style]`, V9) les créneaux de ses teintes : `var(--hb-tint-<id>-<rôle>)`, `<id>` venant **uniquement** de `CARD_TINTS`. Dans la carte, `.box` et `.box-header` redéfinissent les tokens sémantiques à partir des créneaux. Conséquences :
- tout ce qui est dans une carte (widgets, placeholders, popover de recherche) suit le thème sans modification, puisque les widgets n'emploient que des tokens (V4, V6) ;
- aucune règle par teinte en CSS : 24 règles × 3 déclarations iraient soit dans le bundle initial, soit au-delà du budget de 4 kB d'une feuille de composant (V13) ;
- un changement clair/sombre est instantané (les `--hb-tint-*` changent sur `.app-dark`) ;
- aucun impact hors de la grille : barre, Réglages, dialogues (attachés à `body`) gardent le rendu actuel ;
- **règle** : `.card-theme` n'est jamais posé sur le même élément que `.box` (le créneau y vaudrait `var(--hb-bg)` redéfini par lui-même : cycle, fond transparent). Vérifié par les specs (§6.1).

*Rejeté* : une classe par teinte sur chaque carte (règles par teinte, mêmes défauts) ; des attributs `data-*` et des règles par teinte (idem) ; des styles calculés en TS (hexadécimal hors de `tokens.css`).

### D5. En-tête « Par défaut » = suit le fond ; bordures de la teinte présente (décision de Marius)
- **Teinte effective du corps** = `knownTint(cardBody)` ; **de l'en-tête** = `knownTint(cardHeader) ?? knownTint(cardBody)`. Un en-tête par défaut (ou de valeur inconnue) sous un fond teinté prend donc le rôle `header` de la même teinte, un peu plus soutenu ; sous un fond par défaut, il garde le rendu actuel.
- **Bordures** (le défaut `#d1d9e0` passe sous 1,3:1 contre toute teinte, V32) :
  - séparateur de l'en-tête = `border` de la teinte effective de l'en-tête, sinon défaut ;
  - cadre de la carte = `border` de la teinte du corps, sinon `border` de la teinte de l'en-tête, sinon défaut.
- Cas mixtes restants : « en-tête teinté, corps par défaut » (cadre et séparateur prennent la bordure de la teinte de l'en-tête) ; « deux teintes différentes » (chaque partie garde sa bordure ; le séparateur contraste avec son en-tête). Paires ajoutées au §4.2.

### D6. Seuils de contraste
| Paire | Seuil | Raison |
|---|---|---|
| Texte (principal, secondaire, couleurs de sens) sur corps ou en-tête | 4,5:1 | WCAG AA, texte normal |
| Icônes (type, poignée, Supprimer, coin de redimensionnement) | 3:1 | WCAG 1.4.11. Elles emploient le token `muted`, vérifié à 4,5:1 au repos ; **sous le voile de survol** (`--hb-hover`), le pire cas mesuré est 4,42:1 (Pervenche, sombre, V32) : il reste au-dessus de 3:1, il n'y a pas de texte sous ce voile |
| Anneau de focus sur corps et en-tête | 3:1 | WCAG 1.4.11 / 2.4.13 |
| Bordures (cadre, séparateur) contre l'en-tête, le corps, la page, et le corps et l'en-tête par défaut (cas mixtes) | **1,3:1** | Le rendu par défaut est à 1,34:1 (`#d1d9e0` sur `#f6f8fa`, choix GitHub) : imposer 3:1 aux seules cartes teintées les rendrait plus lourdes que les autres. Le cadre d'une carte n'identifie pas un contrôle (WCAG 1.4.11 non applicable). §12, point 8 |

### D7. UI : bouton palette, dialogue modal à voile transparent, aperçu en direct, écriture à la validation
- Bouton `pi pi-palette`, bulle neutre (`.sidebar-bubble`) **au-dessus du `+` vert**, bulle de texte « Thème du tableau de bord » comme les autres (D8 de dashboards-sidebar).
- Panneau : `p-dialog` modal (focus piégé, Échap géré par le composant, D17 de dashboards-sidebar), **en bas à gauche** près du bouton, **voile transparent** (`maskStyleClass="dialog-mask-clear"`, S3) pour que la grille reste visible sans assombrissement. Chargé à la demande (`@defer`).
- **Aperçu en direct** : chaque choix change le brouillon, appliqué tout de suite à la grille du tableau courant ; une mini-carte dans le panneau montre aussi le résultat (utile sur un tableau vide). Chaque pastille montre la teinte en deux bandes (en-tête en haut, corps en bas), plus parlantes que la seule couleur du corps, surtout en sombre.
- **Écriture à la validation** (« Enregistrer ») ; « Annuler » ou Échap rétablissent le thème enregistré (**confirmé par Marius**).
  *Rejeté* : écriture débouncée à chaque choix (intégration à `PendingWrites`, retour arrière optimiste, pas d'annulation).

### D8. Session, verrou, ajout de widget
- Le flux (`DashboardThemeFlow`) reprend le modèle de `WidgetAddFlow` (D13 de dashboards-sidebar) : l'état « édition » mémorise la session du store et le tableau ; tout changement de session (autre tableau, `Alt+←` / `Alt+→`, Réglages) le rend inactif, ferme le panneau et abandonne le brouillon, sans écriture. `Ctrl+K` et `/` sont **ignorés** depuis le panneau (V28).
- Une écriture en cours capture la session : à son retour, le panneau n'est fermé que si la session n'a pas changé (sinon on fermerait un panneau rouvert entre-temps sur un autre tableau).
- Sous `AppLock` (restauration, import, suppression d'un tableau), le flux est `unavailable` : barre `inert`, ouverture et écriture refusées.
- Ouvrir le panneau pendant le V bleu (fin d'ajout de widget) termine d'abord l'ajout (V → `+`), comme un clic sur le V.

### D9. Export : `formatVersion` 3 ; 1 et 2 acceptés ; thème futur conservé
`dashboards[].theme = { version, data }` obligatoire en v3, interdit en v1 et v2 (qui donnent le thème par défaut, comme l'icône en v1 ; l'aperçu d'import l'annonce). Côté front : `resolveConfig` avec `DASHBOARD_THEME_SPEC` ; version future conservée telle quelle (comme une config de widget) ; autre invalide → refus ; tailles comptées en points de code. Côté Rust : `theme` (objet JSON sérialisé, ≤ 4 096 caractères) et `themeVersion` (1 à 10 000), `deny_unknown_fields` conservé, problème `invalid_theme`. Grâce à V21, le binaire actuel refuse proprement un fichier v3 (`unsupported_version`).

### D10. Livraison sur la branche `dashboards-sidebar` et gel de V5 (décision de Marius)
- Les lots T1 à T5 s'ajoutent à la **branche `dashboards-sidebar`**, après le lot F, avant la revue de fin de phase 1 bis. Une seule fusion vers `main`, après revue de Marius.
- **V4 est figée depuis le commit 8982993** : toute correction de V4 serait une nouvelle migration. **Le texte de V5 est figé à la revue du lot T2.**
- **Aucun `npm run dev` du début du lot T2 jusqu'à sa revue** : l'app de dev appliquerait V5 à la base de dev avant le gel. Après la revue, la base de dev (déjà en V4) passe en V5 au premier lancement.
- La **vraie base** passe de V3 à V5 en un seul démarrage de l'exe release : **une** sauvegarde « Avant mise à jour » (schéma 3), puis V4 et V5 appliquées ensemble. M10 de dashboards-sidebar et la vérification de migration de cette spec ne font qu'une (§9, §10.7). Point de retour unique : cette sauvegarde et l'installateur V3 conservé (dashboards-sidebar §9).

### D11. Le tableau « (suite) » hérite du thème (décision de Marius)
`moveUnplaced` (V29) passe aussi `theme` et `themeVersion` du tableau courant (lus dans `list.dashboards()`, valeurs brutes : un thème futur ou une teinte inconnue sont recopiés tels quels). L'héritage se fait **dans l'`INSERT` de création** (`NewDashboard.theme?`, `themeVersion?`) : une seule instruction, pas de seconde écriture non atomique.

---

## 4. Conception détaillée

### 4.1 Palette et tokens (`core/theme/tokens.css`)

| id | Nom FR | Clair body | Clair header | Clair muted | Clair border | Sombre body | Sombre header | Sombre muted | Sombre border |
|---|---|---|---|---|---|---|---|---|---|
| `rose` | Rose | `#ffe4e6` | `#fecdd3` | `#9f1239` | `#fda4af` | `#230d18` | `#3c0c1c` | `#fb7185` | `#881337` |
| `peach` | Pêche | `#ffedd5` | `#fed7aa` | `#9a3412` | `#fb923c` | `#201211` | `#35160f` | `#fb923c` | `#7c2d12` |
| `vanilla` | Vanille | `#fef3c7` | `#fde68a` | `#92400e` | `#fbbf24` | `#211410` | `#371a0d` | `#fbbf24` | `#78350f` |
| `anis` | Anis | `#ecfccb` | `#d9f99d` | `#3f6212` | `#84cc16` | `#121b11` | `#19280e` | `#a3e635` | `#365314` |
| `mint` | Menthe | `#d1fae5` | `#a7f3d0` | `#065f46` | `#34d399` | `#091a1b` | `#082722` | `#34d399` | `#064e3b` |
| `lagoon` | Lagon | `#cffafe` | `#a5f3fc` | `#155e75` | `#22d3ee` | `#0b1d27` | `#0c2c3a` | `#22d3ee` | `#164e63` |
| `sky` | Ciel | `#e0f2fe` | `#bae6fd` | `#075985` | `#38bdf8` | `#0b1c29` | `#0c293e` | `#38bdf8` | `#0c4a6e` |
| `periwinkle` | Pervenche | `#e0e7ff` | `#c7d2fe` | `#3730a3` | `#a5b4fc` | `#131529` | `#1b1b3f` | `#818cf8` | `#312e81` |
| `lavender` | Lavande | `#ede9fe` | `#ddd6fe` | `#5b21b6` | `#c4b5fd` | `#191132` | `#271351` | `#a78bfa` | `#4c1d95` |
| `orchid` | Orchidée | `#fae8ff` | `#f5d0fe` | `#86198f` | `#e879f9` | `#220c2a` | `#3a0b41` | `#e879f9` | `#701a75` |
| `slate` | Ardoise | `#f1f5f9` | `#e2e8f0` | `#475569` | `#94a3b8` | `#131924` | `#1b2534` | `#94a3b8` | `#334155` |
| `sand` | Sable | `#f5f5f4` | `#e7e5e4` | `#57534e` | `#a8a29e` | `#17181c` | `#232224` | `#a8a29e` | `#44403c` |

Couleurs de sens sur un corps teinté :

| Token | Clair | Sombre (= défaut) |
|---|---|---|
| `--hb-on-tint-accent` | `#0550ae` | `#4493f8` |
| `--hb-on-tint-danger` | `#a40e26` | `#f85149` |
| `--hb-on-tint-success` | `#116329` | `#3fb950` |
| `--hb-on-tint-attention` | `#7d4e00` | `#d29922` |

Marges les plus serrées (exactes, V32) : bordure `lavender` contre son en-tête 1,33:1 ; focus sombre sur l'en-tête `lagoon` 3,15:1 ; focus clair sur l'en-tête `periwinkle` 3,48:1 ; texte secondaire minimal 5,4:1.

À ajouter à la fin de `tokens.css` (deux nouveaux blocs, après les blocs existants ; noms exacts, **ids en minuscules ASCII sans tiret**, ordre du tableau) :
```css
/* Card tints of a dashboard theme (spec dashboard-theme 4.1). Per tint: body (card body), header
   (card header, a bit stronger), muted (secondary text and icons on both), border (card frame and
   header separator). Light: steps 100/200/800/300-500 of a pastel scale (Tailwind CSS v3, MIT);
   dark: step 950 mixed into the page. Meaning colors on a tinted body: --hb-on-tint-*. Checked by
   scripts/check-contrast.mjs; adjustable here without any migration. */
:root {
  --hb-tint-rose-body: #ffe4e6;
  --hb-tint-rose-header: #fecdd3;
  --hb-tint-rose-muted: #9f1239;
  --hb-tint-rose-border: #fda4af;
  /* ... the 11 other tints, same order and roles, values of the table ... */

  --hb-on-tint-accent: #0550ae;
  --hb-on-tint-danger: #a40e26;
  --hb-on-tint-success: #116329;
  --hb-on-tint-attention: #7d4e00;
}

.app-dark {
  --hb-tint-rose-body: #230d18;
  --hb-tint-rose-header: #3c0c1c;
  --hb-tint-rose-muted: #fb7185;
  --hb-tint-rose-border: #881337;
  /* ... */

  /* Same as the default meaning colors: dark tints are dark enough. */
  --hb-on-tint-accent: #4493f8;
  --hb-on-tint-danger: #f85149;
  --hb-on-tint-success: #3fb950;
  --hb-on-tint-attention: #d29922;
}
```
Le bloc sombre redéclare **toutes** les valeurs (le script vérifie leur présence, §4.2) : rien ne doit hériter silencieusement du clair.

### 4.2 `scripts/check-contrast.mjs` et ses fixtures

Évolutions (le script reste sans dépendance, lancé par `npm run test:design`) :
1. `collect(selector)` lit aussi les alias `--hb-x: var(--hb-y);` (sans repli) ; après fusion, résolution itérative (profondeur 5 ; cycle ou cible absente → token manquant). Rend `page-bg` lisible.
2. Chaque paire porte son seuil : `[fg, bg, min]`. Constantes :
   ```js
   const TEXT = 4.5;      // WCAG AA, normal text
   const GRAPHIC = 3;     // WCAG 1.4.11: icons, focus ring
   const SEPARATOR = 1.3; // card frame and header separator: not below the default design (1.34:1)
   ```
   Les dix paires existantes passent en `TEXT`, inchangées.
3. Teintes : découvertes dans `:root` par `/--hb-tint-([a-z]+)-(body|header|muted|border)\s*:/`. Échec si une teinte n'a pas ses 4 rôles **déclarés** dans `:root` **et** dans `.app-dark` (test sur les blocs bruts, avant fusion) ; idem pour les 4 `--hb-on-tint-*`.
4. Synchronisation avec le front : lecture de `src/app/core/dashboard/dashboard-theme.ts` (chemin par défaut, ou `process.argv[3]`), extraction du littéral `CARD_TINTS = [ ... ]` par expression régulière ; échec si l'ensemble diffère des teintes découvertes, ou si une teinte vaut `default`.
5. Paires par teinte `t`, dans chaque thème :
   ```js
   const tintPairs = (t) => [
     ['fg', `tint-${t}-body`, TEXT],
     ['fg', `tint-${t}-header`, TEXT],
     [`tint-${t}-muted`, `tint-${t}-body`, TEXT],
     [`tint-${t}-muted`, `tint-${t}-header`, TEXT],
     [`tint-${t}-muted`, 'bg-subtle', TEXT],     // buttons, flash banners inside a tinted body
     [`tint-${t}-muted`, 'bg-inset', TEXT],      // fields (placeholder) inside a tinted body
     ...['accent', 'danger', 'success', 'attention'].map((m) => [`on-tint-${m}`, `tint-${t}-body`, TEXT]),
     ['focus', `tint-${t}-body`, GRAPHIC],
     ['focus', `tint-${t}-header`, GRAPHIC],
     [`tint-${t}-border`, `tint-${t}-header`, SEPARATOR],
     [`tint-${t}-border`, `tint-${t}-body`, SEPARATOR],
     [`tint-${t}-border`, 'page-bg', SEPARATOR],
     // Mixed cases (D5): the border of the tint present next to a default body or header.
     [`tint-${t}-border`, 'bg', SEPARATOR],
     [`tint-${t}-border`, 'bg-subtle', SEPARATOR],
   ];
   ```
   Plus, une fois par thème : `on-tint-*` sur `bg-subtle` et sur `bg-inset` (`TEXT`).
6. Sortie : `ok   light: --hb-tint-rose-muted on --hb-tint-rose-header = 5.40:1 (min 4.5)` ; les échecs listés (préfixe `FAIL`, message explicite pour un token manquant ou une divergence de `CARD_TINTS`) puis code 1.

**Fixtures** (modèle de `test-design-tokens.mjs`, V30) : `scripts/fixtures/contrast/<cas>/tokens.css` et `<cas>/dashboard-theme.ts`, avec deux teintes (`rose`, `sky`) aux valeurs du §4.1 :
- `ok` : tout passe ;
- `missing-dark` : `--hb-tint-sky-border` absent de `.app-dark` ;
- `tint-mismatch` : `CARD_TINTS` contient `mint` en plus ;
- `low-ratio` : `--hb-tint-rose-muted` clair à `#e11d48` (sous 4,5:1 sur l'en-tête) ;
- `default-id` : une teinte nommée `default`.

`scripts/test-check-contrast.mjs` lance le script sur chaque cas (`argv[2]` = `tokens.css`, `argv[3]` = `dashboard-theme.ts`) : `ok` → code 0 ; les autres → code 1 et un `FAIL` qui nomme le token ou la teinte en cause. Ajouté à `test:design` dans `apps/web/package.json`, juste après `check-contrast.mjs`. (Les fixtures sont hors de `src/app` : `check-design-tokens` ne les lit pas, V8.)

### 4.3 Migration V5 et couche `data/`

`apps/desktop/src-tauri/migrations/V5__dashboard_theme.sql` (texte exact, LF, sans BOM ; **figé à la revue du lot T2** ; vérifié par la revue, V33) :
```sql
-- V5__dashboard_theme : thème d'un tableau de bord (spec dashboard-theme).
-- Objet JSON versionné, comme la configuration d'un widget : la couche données ne l'interprète
-- pas ; le front le valide, le migre et tient la liste des teintes (options futures sans migration).
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

ALTER TABLE dashboards ADD COLUMN theme TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(theme) AND json_type(theme) = 'object' AND length(theme) <= 4096);
ALTER TABLE dashboards ADD COLUMN theme_version INTEGER NOT NULL DEFAULT 1
  CHECK (theme_version >= 1);
```
`src/db.rs` : `version: 5, description: "dashboard_theme"`. `checksums.json` : SHA-256 du fichier. Les `DEFAULT` sont l'exception déjà admise pour V4 (`ADD COLUMN NOT NULL` exige un défaut). `length()` compte des points de code.

Texte `CREATE TABLE dashboards` attendu après V5 (V33, S4) : le littéral figé de V4 (`validate_tests.rs` l. 895-908), dont la fin `AND icon NOT GLOB '*[^a-z0-9-]*')) STRICT` devient :
```
         AND icon NOT GLOB '*[^a-z0-9-]*'), theme TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(theme) AND json_type(theme) = 'object' AND length(theme) <= 4096), theme_version INTEGER NOT NULL DEFAULT 1
  CHECK (theme_version >= 1)) STRICT
```

`data/models.ts` :
```ts
/** Same bound as the CHECK of V5, in code points of the serialized object. */
export const MAX_DASHBOARD_THEME_CHARS = 4096;
/** Same as the DEFAULT of V5. */
export const DEFAULT_DASHBOARD_THEME_VERSION = 1;

export interface Dashboard {
  id: string;
  name: string;
  sortOrder: number;
  icon: string;
  /** Opaque versioned object (V5); interpreted by core/dashboard/dashboard-theme.ts. */
  theme: JsonObject;
  themeVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewDashboard {
  id?: string;
  name: string;
  icon?: string;
  /** Copied as is (e.g. the overflow dashboard inherits it); default {} and version 1. */
  theme?: JsonObject;
  themeVersion?: number;
}
```
`DashboardPatch` est inchangé : `update(id, { name, icon })` ne touche pas au thème (V24).

`data/repositories.ts`, dans `DashboardRepository` :
```ts
/** … (create, createIfNone) Theme defaults to {} / DEFAULT_DASHBOARD_THEME_VERSION, validated like updateTheme. */
/**
 * Replaces theme and theme_version in one statement; returns the updated dashboard. not_found
 * when absent. invalid_input when the serialized object exceeds MAX_DASHBOARD_THEME_CHARS code
 * points or when themeVersion is not an integer >= 1. The data layer never interprets it.
 */
updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard>;
```
`sqlite-dashboard.repository.ts` : un helper `validTheme(theme, version)` (objet simple, `[...JSON.stringify(theme)].length` ≤ maximum — points de code, comme SQLite —, version entière ≥ 1) partagé par `create`, `createIfNone` et `updateTheme`. SQL :
```sql
-- create
INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
SELECT $1, $2, COALESCE(MAX(sort_order) + 1, 0), $4, $5, $6, $3, $3 FROM dashboards
-- createIfNone
INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
SELECT $1, $2, 0, $4, $5, $6, $3, $3 WHERE NOT EXISTS (SELECT 1 FROM dashboards)
-- updateTheme
UPDATE dashboards SET theme = $2, theme_version = $3, updated_at = $4 WHERE id = $1
```

`data/sqlite/row-mappers.ts` : `DashboardRow` gagne `theme: string; theme_version: number` ; `DASHBOARD_COLUMNS = 'id, name, sort_order, icon, theme, theme_version, created_at, updated_at'` ; `toDashboard` : `theme: parseJsonObject(str(row.theme, 'theme'))`, `themeVersion: int(row.theme_version, 'theme_version')`.

`core/testing/fake-dashboard.repository.ts` : mêmes défauts, même validation, `theme` et `themeVersion` à la création, `updateTheme`.

### 4.4 Modèle de thème : `core/dashboard/dashboard-theme.ts`

Chargé seulement par du code paresseux (route du tableau, dialogue, import). `DashboardListStore` et `DashboardThemeFlow` (bundle initial) n'en font que des `import type`.
```ts
import * as v from 'valibot';
import type { JsonObject } from '../../data';
import { resolveConfig } from '../widgets/widget-config';
import type { WidgetConfigSpec } from '../widgets/widget-definition';

/** Tint ids, in the order of the panel. Lowercase ASCII letters only (tokens --hb-tint-<id>-*). */
export const CARD_TINTS = [
  'rose', 'peach', 'vanilla', 'anis', 'mint', 'lagoon',
  'sky', 'periwinkle', 'lavender', 'orchid', 'slate', 'sand',
] as const;
export type CardTint = (typeof CARD_TINTS)[number];

/** Stored value of a slot left to its default (body: current Box; header: follows the body). Never a tint id. */
export const TINT_DEFAULT = 'default';
/** Shape of a stored slot value: a tint of a newer build is kept as is (rendered as default). */
export const TINT_VALUE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

// Type alias (not an interface): assignable to JsonObject.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type CardTheme = { cardBody: string; cardHeader: string };
export type ThemeSlot = keyof CardTheme;
export const THEME_SLOTS: readonly ThemeSlot[] = ['cardBody', 'cardHeader'];
export const DEFAULT_CARD_THEME: CardTheme = { cardBody: TINT_DEFAULT, cardHeader: TINT_DEFAULT };

const slotValue = v.optional(v.pipe(v.string(), v.regex(TINT_VALUE_PATTERN)), TINT_DEFAULT);

/** Theme v1. A new option = version + 1 and a migration (ADR-001, like a widget config). */
export const DASHBOARD_THEME_SPEC: WidgetConfigSpec<CardTheme> = {
  version: 1,
  schema: v.strictObject({ cardBody: slotValue, cardHeader: slotValue }),
  defaults: () => ({ ...DEFAULT_CARD_THEME }),
  migrations: {},
};

export type ResolvedCardTheme =
  | { readonly status: 'ok'; readonly theme: CardTheme }
  /** Version newer than this build: shown by default, the panel is read-only. */
  | { readonly status: 'future' }
  /** Anything else: shown by default; replaced by the next save. */
  | { readonly status: 'invalid' };

/** resolveConfig(DASHBOARD_THEME_SPEC, version, data); never throws. */
export function resolveCardTheme(data: JsonObject, version: number): ResolvedCardTheme;

/** The tint when `value` is in CARD_TINTS (Array.includes, never an object lookup), else null. */
export function knownTint(value: string): CardTint | null;

/** Effective tints (D5): body = knownTint(cardBody); header = knownTint(cardHeader) ?? body. */
export function bodyTint(theme: CardTheme): CardTint | null;
export function headerTint(theme: CardTheme): CardTint | null;

/** Copy of `theme` with `slot` set to `tint` (null = TINT_DEFAULT). Never mutates its input. */
export function withTint(theme: CardTheme, slot: ThemeSlot, tint: CardTint | null): CardTheme;

/**
 * Inline custom properties of a `.card-theme` scope (4.5), from the effective tints only:
 * body tint B -> --hb-card-body-{bg,muted} = var(--hb-tint-B-{body,muted}) and
 *                --hb-card-body-{accent,danger,success,attention} = var(--hb-on-tint-<same>);
 * header tint H -> --hb-card-header-{bg,muted,border} = var(--hb-tint-H-{header,muted,border});
 * frame: --hb-card-body-border = var(--hb-tint-X-border) with X = B ?? H.
 * null or no effective tint: no property (the scope defaults apply).
 */
export function cardThemeStyle(theme: CardTheme | null): Readonly<Record<string, string>>;

/**
 * Inline style of a swatch of the panel: --hb-swatch-top (header color), --hb-swatch-fill (body
 * color), --hb-swatch-border, --hb-swatch-ink (check mark). tint null: var(--hb-bg-subtle),
 * var(--hb-bg), var(--hb-border), var(--hb-fg-muted).
 */
export function tintSwatchStyle(tint: CardTint | null): Readonly<Record<string, string>>;
```

### 4.5 Application du thème

`core/theme/components.css`, après `.box-row:last-child` :
```css
/* Card theme of a dashboard (spec dashboard-theme 4.5). The scope declares one slot per themable
   color, defaulting to the current Box rendering; the dashboard overrides the slots of its tints
   inline (var(--hb-tint-<id>-<role>)). Everything inside a card follows through the tokens.
   Never put .card-theme on a .box itself: the slots would refer to the tokens they redefine. */
.card-theme {
  --hb-card-body-bg: var(--hb-bg);
  --hb-card-body-muted: var(--hb-fg-muted);
  --hb-card-body-border: var(--hb-border);
  --hb-card-body-accent: var(--hb-accent);
  --hb-card-body-danger: var(--hb-danger);
  --hb-card-body-success: var(--hb-success);
  --hb-card-body-attention: var(--hb-attention);
  --hb-card-header-bg: var(--hb-bg-subtle);
  --hb-card-header-muted: var(--hb-fg-muted);
  --hb-card-header-border: var(--hb-border);
}
.card-theme .box {
  --hb-bg: var(--hb-card-body-bg);
  --hb-fg-muted: var(--hb-card-body-muted);
  --hb-border: var(--hb-card-body-border);
  --hb-accent: var(--hb-card-body-accent);
  --hb-danger: var(--hb-card-body-danger);
  --hb-success: var(--hb-card-body-success);
  --hb-attention: var(--hb-card-body-attention);
}
.card-theme .box-header {
  --hb-bg-subtle: var(--hb-card-header-bg);
  --hb-fg-muted: var(--hb-card-header-muted);
  --hb-border: var(--hb-card-header-border);
}
```
Pas de cycle : les créneaux sont calculés sur l'élément `.card-theme` à partir des tokens globaux, puis hérités ; les styles en ligne posés sur ce même élément l'emportent sur ses défauts (S2, cascade CSS). `--hb-fg`, `--hb-focus`, `--hb-bg-inset`, `--hb-bg-subtle` (dans le corps), `--hb-hover`, `--hb-border-muted` (translucide) restent globaux : champs et boutons gardent un fond neutre et restent identifiables comme contrôles.

`core/dashboard/dashboard.component.css` : la poignée de redimensionnement (hors de `.box`, V3) lit le créneau :
```css
app-dashboard gridster-item:hover .gridster-item-resizable-handler.handle-se {
  border-color: transparent transparent var(--hb-card-body-muted);
}
```

`core/dashboard/dashboard.component.html` :
```html
<div
  #gridArea
  class="dashboard-grid-area card-theme"
  data-testid="dashboard-grid-area"
  [style]="cardStyle()"
  [attr.data-card-body]="effectiveTints().body"
  [attr.data-card-header]="effectiveTints().header"
>
```
(`data-card-*` : teintes effectives (D5), ou absent ; tests et diagnostic, aucune règle CSS ne s'y accroche.)

`core/dashboard/dashboard.component.ts` :
```ts
private readonly themeFlow = inject(DashboardThemeFlow);

/** Theme shown on the grid: the panel's draft while editing this dashboard, else the stored one. */
private readonly displayedTheme = computed<CardTheme | null>(() => {
  const current = this.store.dashboard();
  if (!current) return null;
  const preview = this.themeFlow.preview();
  if (preview && this.themeFlow.dashboardId() === current.id) return preview;
  // The list is up to date after a save; the store keeps what was loaded (V23).
  const stored = this.list.dashboards().find((d) => d.id === current.id) ?? current;
  const resolved = resolveCardTheme(stored.theme, stored.themeVersion);
  return resolved.status === 'ok' ? resolved.theme : null;
});
protected readonly cardStyle = computed(() => cardThemeStyle(this.displayedTheme()));
/** { body, header } effective tints or null each (bodyTint / headerTint). */
protected readonly effectiveTints: Signal<{ readonly body: CardTint | null; readonly header: CardTint | null }>;
```

`moveUnplaced` (D11, V29) : `list.create({ name: this.overflowName(current.name), icon: current.icon, theme: current.theme, themeVersion: current.themeVersion })`, `current` lu dans `list.dashboards()` comme aujourd'hui.

`core/dashboard/dashboard-list.store.ts` :
```ts
/** theme/themeVersion optional, copied as is (overflow dashboard). */
create(input: {
  readonly name: string;
  readonly icon: string;
  readonly theme?: JsonObject;
  readonly themeVersion?: number;
}): Promise<Dashboard>;
/** Writes the theme (opaque object + version, see dashboard-theme.ts) and replaces the dashboard in the list. */
updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard>;
```
Pas d'import d'exécution de `dashboard-theme.ts` ni de `core/backup` dans ce fichier.

### 4.6 Flux, barre et panneau

**`core/dashboard/dashboard-theme-flow.ts`** (racine, bundle initial, `import type` seulement depuis `dashboard-theme.ts`) :
```ts
export type ThemeFlowPhase = 'unavailable' | 'idle' | 'editing';

type RawState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'editing';
      readonly session: number;
      readonly dashboardId: string;
      readonly preview: CardTheme | null;
    };

@Injectable({ providedIn: 'root' })
export class DashboardThemeFlow {
  /**
   * 'unavailable': store not ready, no current dashboard, or AppLock locked.
   * A raw 'editing' state from another session is 'idle' (D13 of dashboards-sidebar).
   */
  readonly phase: Signal<ThemeFlowPhase>;
  /** Dashboard being edited; non null only in 'editing'. */
  readonly dashboardId: Signal<string | null>;
  /** Store session of the current edit; non null only in 'editing'. */
  readonly editingSession: Signal<number | null>;
  /** Draft shown instead of the stored theme; null outside 'editing' or before the first change. */
  readonly preview: Signal<CardTheme | null>;
  /** idle -> editing for the current dashboard and session. No effect otherwise. */
  open(): void;
  /** Only in 'editing' (current session); otherwise ignored. */
  setPreview(theme: CardTheme): void;
  /**
   * editing -> idle, preview dropped, focus back to the trigger after render. With
   * `expectedSession`, no effect unless the edit still belongs to that session (D8).
   */
  close(expectedSession?: number): void;
  registerTrigger(focus: () => void): () => void;
  focusTrigger(): void;
}
```
Toute méthode commence par remettre l'état brut à `idle` s'il est d'une autre session (comme `WidgetAddFlow.dropStale`).

**Barre** (`core/layout/sidebar.component.{ts,html}`), dans le groupe du bas, **avant** le `<li>` du `+` vert :
```html
<li>
  <button
    #themeButton
    type="button"
    class="sidebar-bubble"
    data-testid="dashboard-theme"
    aria-haspopup="dialog"
    [attr.aria-expanded]="themeFlow.phase() === 'editing' ? 'true' : null"
    [attr.aria-disabled]="themeFlow.phase() === 'unavailable' ? 'true' : null"
    [attr.aria-label]="themeLabelKey() | transloco"
    (click)="onThemeButton()"
    (mouseenter)="showLabel($event, themeLabelKey())"
    (mouseleave)="hideLabel()"
    (focusin)="showLabel($event, themeLabelKey())"
    (focusout)="hideLabel()"
  >
    <i class="pi pi-palette" aria-hidden="true"></i>
  </button>
</li>
```
`themeLabelKey` : `'dashboardTheme.unavailable'` si `unavailable`, sinon `'dashboardTheme.open'`. `onThemeButton` : en `idle`, `hideLabel()`, puis si `flow.phase() === 'confirming'` → `flow.finish()` (D8), puis `themeFlow.open()` ; sinon rien. Un seul `<button>`, sans `disabled` natif (garde le focus et la bulle de texte). Le constructeur enregistre le déclencheur (`themeFlow.registerTrigger(() => this.themeButton()?.nativeElement.focus())`, désinscription au `DestroyRef`). Hors du `<nav>`, à côté du sélecteur de widgets :
```html
@if (themeFlow.phase() === 'editing') {
  @defer (on immediate) {
    <app-dashboard-theme-dialog />
  }
}
```

**Panneau** `core/layout/dashboard-theme-dialog.component.ts` (sélecteur `app-dashboard-theme-dialog`, `OnPush`, sans entrée) :
- `p-dialog` : `[visible]="true"`, `[modal]="true"`, `[closable]="false"`, `[closeOnEscape]="false"`, `[focusOnShow]="false"`, `appendTo="body"`, `position="bottomleft"`, `maskStyleClass="dialog-mask-clear"`, `[style]="{ width: '22rem', maxWidth: '92vw' }"`, `data-testid="dashboard-theme-dialog"`, en-tête `dashboardTheme.title` avec le nom du tableau. Déplacement à la souris laissé actif (défaut PrimeNG) : il permet de dégager l'aperçu. `host: { '(document:keydown.escape)': 'onEscape()' }`.
- Initialisation : tableau = entrée de `list.dashboards()` d'id `themeFlow.dashboardId()`. **Absent → `themeFlow.close()`** (le panneau se ferme, rien d'écrit). Sinon `resolveCardTheme` : `ok` → brouillon = ce thème ; `invalid` → brouillon = `DEFAULT_CARD_THEME` et bandeau `flash-attention` `dashboardTheme.invalid` ; `future` → mode lecture seule : bandeau `dashboardTheme.future`, `fieldset` désactivés, seul bouton « Fermer » (`type="button"`).
- Contenu, dans un `<form novalidate (submit)>` (`preventDefault`, CSP `form-action 'none'`) :
  - pour chaque créneau, un `<fieldset>` dont le `<legend>` ne contient que le libellé du groupe (`dashboardTheme.body`, `dashboardTheme.header`) ; juste après, hors du `legend`, `<p class="text-xs text-fg-muted" aria-hidden="true">` avec le nom de la valeur choisie (le lecteur d'écran l'obtient du radio coché) ;
  - 13 choix par groupe : la valeur par défaut puis `CARD_TINTS` dans l'ordre. Libellé du défaut : `dashboardTheme.default` (fond) et `dashboardTheme.headerDefault` (« Comme le fond », en-tête). Pastille du défaut : `tintSwatchStyle(null)` pour le fond ; pour l'en-tête, `tintSwatchStyle(bodyTint(draft()))` (montre ce que donnera « comme le fond ») ;
  - chaque choix :
    ```html
    <label class="tint-choice" [attr.title]="name" [style]="swatchStyle"
           [attr.data-slot]="slot" [attr.data-tint]="tint ?? 'default'">
      <input class="sr-only" type="radio" [name]="'dashboard-theme-' + slot"
             [checked]="draft()[slot] === (tint ?? TINT_DEFAULT)" (change)="choose(slot, tint)" />
      <i class="pi pi-check" aria-hidden="true"></i>
      <span class="sr-only">{{ name }}</span>
    </label>
    ```
    Une valeur enregistrée inconnue ne coche rien ; sous le groupe, `text-xs text-fg-muted` : `dashboardTheme.unknownTint`. Elle est conservée tant que Marius n'en choisit pas une autre ;
  - `choose(slot, tint)` : `draft.set(withTint(draft(), slot, tint))` puis `themeFlow.setPreview(draft())` ; **aucune écriture** ;
  - mini-aperçu, `aria-hidden="true"` : `<div class="card-theme" [style]="cardThemeStyle(draft())">` contenant une `section.box` (`box-header` : `pi pi-th-large`, « Aperçu », `pi pi-trash` ; `box-body` : `dashboardTheme.previewText` en `text-fg`, `dashboardTheme.previewMuted` en `text-fg-muted`, `dashboardTheme.previewLink` en `text-accent`). La classe `card-theme` est sur le `div`, jamais sur la `section.box` (D4) ;
  - erreur : `flash flash-danger` `dashboardTheme.error`, `data-testid="dashboard-theme-error"` ;
  - boutons à droite : `<button type="button" class="btn">` « Annuler » (`dashboard-theme-cancel`) et `<button type="submit" class="btn btn-primary">` « Enregistrer » (`dashboard-theme-save`), désactivés pendant l'écriture.
- Focus initial (`afterNextRender`) : le choix coché du premier groupe, sinon son premier choix ; en lecture seule, « Fermer ».
- `save` : si `busy`, lecture seule ou `themeFlow.phase() !== 'editing'` → rien. Capturer `id = themeFlow.dashboardId()` **et** `session = themeFlow.editingSession()`. `serializeConfig(DASHBOARD_THEME_SPEC, draft())` : non `ok` → traité comme un échec d'écriture (message, rien d'écrit). Sinon `await list.updateTheme(id, config, version)` : succès → `themeFlow.close(session)` (sans effet si la session a changé entre-temps, D8) ; échec → `console.error`, message, panneau ouvert avec l'aperçu. L'écriture se termine toujours sur l'id capturé.
- `cancel` et `onEscape` : sans effet pendant l'écriture ; sinon `themeFlow.close()`.

**CSS** (`core/theme/components.css`, après `.icon-choice`) :
```css
/* Tint choice of the dashboard theme panel: native radio hidden, the label is the target. The
   swatch shows the header color on top of the body color (inline --hb-swatch-*, closed list of
   tints). Selection: 2 px accent border and a check mark, never the color alone; the outline is
   reserved to the keyboard focus. */
.tint-choice {
  position: relative;
  display: inline-flex;
  width: 32px;
  height: 32px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--hb-swatch-border, var(--hb-border));
  border-radius: var(--hb-radius);
  background: linear-gradient(
    var(--hb-swatch-top, var(--hb-bg-subtle)) 0 40%,
    var(--hb-swatch-fill, var(--hb-bg)) 40% 100%
  );
  color: var(--hb-swatch-ink, var(--hb-fg-muted));
}
.tint-choice > i {
  visibility: hidden;
  font-size: 14px;
}
.tint-choice:has(input:checked) {
  border: 2px solid var(--hb-accent);
}
.tint-choice:has(input:checked) > i {
  visibility: visible;
}
.tint-choice:has(input:focus-visible) {
  outline: 2px solid var(--hb-focus);
  outline-offset: 2px;
}
.tint-choice:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Theme panel: the mask stays modal but does not dim the live preview of the grid (S3). */
.dialog-mask-clear {
  --p-mask-background: transparent;
  background: transparent;
}
```

### 4.7 Export et import (format 3)

**TS, `core/backup/config-transfer.ts`** :
- `CONFIG_FORMAT_VERSION = 3`, `SUPPORTED_FORMAT_VERSIONS = [1, 2, 3]` ; le test préalable (V21) refuse `> 3`.
- `CONFIG_LIMITS.maxThemeChars: 4_096` (identique à `MAX_DASHBOARD_THEME_CHARS` et à Rust), **mesuré en points de code** avec `codePointLength` (`hb-trim.ts`), comme les autres longueurs de `CONFIG_LIMITS`, Rust (`chars().count()`) et SQLite (`length`).
- Export : `ConfigExportDashboard.theme: { readonly version: number; readonly data: JsonObject }` ; `ConfigExportInput.dashboards[]` gagne `theme: JsonObject` et `themeVersion: number` ; valeurs brutes de la base (comme les configs de widgets). `config-transfer.service.ts` transmet `dashboard.theme` et `dashboard.themeVersion`.
- `envelopeSchema`, dashboard : `theme: v.optional(v.strictObject({ version: v.number(), data: v.unknown() }))`.
- Après l'icône, pour chaque dashboard (`dPath`) :
  - `formatVersion` 1 ou 2 : `theme` présent → `unknown_field@${dPath}.theme` ; plan = `JSON.stringify(DASHBOARD_THEME_SPEC.defaults())`, `DASHBOARD_THEME_SPEC.version` ;
  - `formatVersion` 3 : absent → `missing_field@${dPath}.theme` ; `version` hors entier `[1, maxConfigVersion]` → `invalid_value@${dPath}.theme.version` ; `data` non objet → `invalid_value@${dPath}.theme` ; `resolveConfig(DASHBOARD_THEME_SPEC, version, data)` : `ok` → `serializeConfig`, `codePointLength` du sérialisé ≤ `maxThemeChars`, sinon `invalid_value` ; `future-version` → objet brut conservé (même limite, sinon `invalid_value`) avec sa version ; autre → `invalid_value@${dPath}.theme`.
- `ParsedConfigImport.resetsThemes: boolean` (vrai pour les formats 1 et 2) ; `ImportPreview.resetsThemes` le reprend. `features/settings/config-transfer-settings.component.ts` (V31) affiche alors une ligne `configTransfer.themesReset` dans l'aperçu.
- `backup.types.ts` : `ConfigImportPlanDashboard` gagne `theme: string` (objet JSON sérialisé) et `themeVersion: number` ; `IMPORT_PROBLEMS` gagne `'invalid_theme'` ; `ImportPreview` gagne `resetsThemes`. Aucun nouveau code `ImportIssueCode`.

Exemple de dashboard exporté :
```json
{
  "id": "8a1d5f0e-2b7c-4d3e-9f10-6c2b4a8e7d01",
  "name": "Accueil",
  "sortOrder": 0,
  "icon": "th-large",
  "theme": { "version": 1, "data": { "cardBody": "lavender", "cardHeader": "default" } },
  "widgets": []
}
```

**Rust, `src/backup/config_transfer.rs`** :
```rust
const MAX_THEME_CHARS: usize = 4_096;

pub struct PlanDashboard {          // deny_unknown_fields, camelCase: unchanged
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub icon: String,
    /// Serialized JSON object (opaque: the front validates it).
    pub theme: String,
    pub theme_version: i64,
    pub widgets: Vec<PlanWidget>,
}
```
- `json_within_limit(text)` devient `json_within(text, max_chars)` (points de code, `chars().count()`) ; les appels existants passent `MAX_JSON_CHARS`.
- `validate_plan`, après l'icône : `theme_version` hors `1..=MAX_CONFIG_VERSION`, ou `json_within(&theme, MAX_THEME_CHARS)` autre que `Some(Value::Object(_))` → `ImportProblem::InvalidTheme` (`invalid_theme`, `src/backup/error.rs`).
```rust
const UPSERT_DASHBOARD: &str = "INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at) VALUES (?1, ?2, ?3, ?5, ?6, ?7, ?4, ?4) \
ON CONFLICT (id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, icon = excluded.icon, theme = excluded.theme, theme_version = excluded.theme_version, updated_at = excluded.updated_at";
```
avec `.bind(&dashboard.theme).bind(dashboard.theme_version)` après `.bind(&dashboard.icon)`.

### 4.8 i18n FR (`core/i18n/fr.json`)
```json
"dashboardTheme": {
  "open": "Thème du tableau de bord",
  "unavailable": "Ouvrez un tableau de bord pour modifier son thème",
  "title": "Thème de « {{ name }} »",
  "body": "Fond des widgets",
  "header": "En-tête des widgets",
  "default": "Par défaut",
  "headerDefault": "Comme le fond",
  "unknownTint": "Teinte d'une version plus récente : conservée tant que vous n'en choisissez pas une autre.",
  "preview": "Aperçu",
  "previewText": "Texte principal",
  "previewMuted": "Texte secondaire",
  "previewLink": "Lien",
  "save": "Enregistrer",
  "cancel": "Annuler",
  "close": "Fermer",
  "error": "Impossible d'enregistrer le thème : rien n'a été modifié.",
  "future": "Ce thème a été créé par une version plus récente de Homebase : il ne peut pas être modifié ici.",
  "invalid": "Le thème enregistré est illisible : les couleurs par défaut sont affichées et le remplaceront à l'enregistrement.",
  "tints": {
    "rose": "Rose", "peach": "Pêche", "vanilla": "Vanille", "anis": "Anis",
    "mint": "Menthe", "lagoon": "Lagon", "sky": "Ciel", "periwinkle": "Pervenche",
    "lavender": "Lavande", "orchid": "Orchidée", "slate": "Ardoise", "sand": "Sable"
  }
}
```
Et : `backup.importProblems.invalid_theme` = « thème de tableau de bord invalide. » ; `configTransfer.themesReset` = « Ce fichier vient d'une version plus ancienne de Homebase : les thèmes des tableaux seront remis par défaut. ». `fr.spec.ts` : chaque `CARD_TINTS` a sa clé `dashboardTheme.tints.*`.

### 4.9 Sécurité
- **Aucune nouvelle commande Tauri, aucune capability**, `build.rs`, `tauri.conf.json` et CSP inchangés. L'écriture passe par le plugin SQL existant (ADR-002 R1 inchangé).
- **Pas d'injection CSS** : une valeur stockée ou importée n'est jamais interpolée dans un style. Seuls les ids de `CARD_TINTS` (constante) produisent `var(--hb-tint-<id>-…)` ; `knownTint` passe par `Array.includes`, jamais par une clé d'objet (`__proto__`, `constructor` → `null`).
- Fichier importé = donnée non fiable : thème validé par un schéma strict (`v.strictObject`, motif fermé), taille ≤ 4 096 points de code, profondeur déjà bornée (`isUnrepresentable`) ; un thème futur conservé n'est jamais interprété ; Rust revérifie la forme ; le `CHECK` SQL en dernier.
- Thème hérité par le tableau « (suite) » : copie d'une valeur déjà en base, revalidée en forme et taille par le dépôt.
- Aucun secret ; rien de nouveau dans `settings`.
- Sous `AppLock` : bouton `inert` avec la barre, flux `unavailable`, écriture refusée.

### 4.10 Bundle initial

| Élément | Bundle | Estimation |
|---|---|---|
| 104 déclarations de tokens (`tokens.css`) | initial (styles) | +3,5 à +4,5 kB |
| `.card-theme`, `.tint-choice`, `.dialog-mask-clear` | initial (styles) | +1,2 à +1,6 kB |
| Bouton de la barre, `DashboardThemeFlow` | initial | +1 à +1,5 kB |
| `dashboard-theme.ts` | paresseux (route, dialogue, import) | 0 |
| Dialogue (`@defer`, `primeng/dialog` déjà paresseux) | paresseux | 0 |
| **Total** | | **≈ +6 à +8 kB** (≈ 486 à 488 kB pour une base de 480 kB) |

Valeur mesurée et rapportée à chaque lot ; ≥ 500 kB ou avertissement → arrêt (budget jamais relevé).

---

## 5. Cas limites

| # | Cas | Comportement |
|---|---|---|
| C1 | Tableaux existants à la migration | `theme = '{}'`, `theme_version = 1` : rendu actuel ; `updated_at` inchangé |
| C2 | Fond teinté, en-tête « Comme le fond » | En-tête au rôle `header` de la même teinte, cadre et séparateur à sa bordure (D5) |
| C3 | En-tête teinté, fond par défaut | Corps blanc (clair) ou `#0d1117` (sombre), couleurs de sens par défaut ; **cadre et séparateur à la bordure de la teinte de l'en-tête** (D5) |
| C4 | Fond et en-tête de deux teintes différentes | Chaque partie garde sa teinte et sa bordure ; le séparateur contraste avec son en-tête |
| C5 | Teinte inconnue (binaire plus ancien face à une palette plus récente) | Traitée comme « Par défaut » au rendu (donc l'en-tête suit le fond) ; conservée ; aucun choix coché, note sous le groupe |
| C6 | Version de thème future | Rendu par défaut ; panneau en lecture seule ; export, import et « (suite) » conservent l'objet brut |
| C7 | Thème illisible en base (schéma non respecté) | Rendu par défaut ; panneau sur « Par défaut » avec un avertissement ; l'enregistrement le remplace |
| C8 | Bascule clair/sombre (Réglages ou système), panneau ouvert ou non | Instantanée ; l'aperçu suit |
| C9 | Panneau ouvert, `Alt+←` ou `Alt+→` | Session changée : panneau fermé, brouillon abandonné, rien d'écrit ; le tableau rouvert montre le thème enregistré. `Ctrl+K` et `/` ne font rien depuis le panneau (V28) |
| C10 | Échec d'écriture, ou sérialisation refusée | Message ; panneau ouvert, aperçu conservé ; « Annuler » rétablit l'enregistré |
| C11 | Écriture en cours, puis changement de session et panneau rouvert sur un autre tableau | L'écriture se termine sur l'id capturé ; le panneau rouvert **reste ouvert** (`close(session)` sans effet) |
| C12 | Double clic sur « Enregistrer » | Une seule écriture (`busy`) |
| C13 | Échap pendant l'écriture | Ignoré |
| C14 | Tableau absent de la liste à l'ouverture du panneau | Panneau fermé aussitôt, rien d'écrit |
| C15 | Sous `AppLock` (restauration, import, suppression) | Barre `inert`, flux `unavailable` |
| C16 | Hors Tauri (`ng serve`) ou depuis Réglages | Bouton `aria-disabled`, bulle « Ouvrez un tableau de bord… » |
| C17 | V bleu affiché, clic sur la palette | L'ajout se termine (V → `+`), puis le panneau s'ouvre |
| C18 | Tableau vide | Pas de grille : la mini-carte du panneau montre l'aperçu ; l'état vide n'est pas teinté |
| C19 | Autres tableaux, Réglages, barre, dialogues | Inchangés (portée `.card-theme` sur la seule zone de grille ; dialogues attachés à `body`) |
| C20 | Placeholders (type inconnu, config invalide, erreur de chargement) | Même cadre teinté ; bandeaux lisibles (couleurs de sens « sur teinte ») |
| C21 | Popover de la recherche, mise en évidence d'une carte, carte en déplacement | Popover sur le fond teinté (même portée), lisible ; anneau en `accent` du corps ; carte déplacée comme aujourd'hui (`--hb-bg-subtle` global, bordure accent) |
| C22 | Renommage et thème du même tableau | Colonnes et instructions distinctes : aucune écriture n'écrase l'autre (V24) |
| C23 | Suppression d'un tableau | Le thème part avec la ligne |
| C24 | Tableau « (suite) » du bandeau de débordement | Hérite du thème brut et de sa version, dans le même `INSERT` (D11) |
| C25 | Import d'un fichier v1 ou v2 | Accepté ; l'aperçu annonce la remise par défaut des thèmes ; thèmes remis par défaut, y compris pour un tableau existant (remplacement par identifiant) |
| C26 | Fichier v3 au thème invalide | Refusé (`invalid_value` front, `invalid_theme` Rust), avant toute sauvegarde `pre-import` |
| C27 | Thème futur avec des caractères hors BMP | Longueur en points de code des deux côtés : 4 096 accepté et écrit, 4 097 refusé |
| C28 | Fichier v3 lu par un binaire au format 2 | `unsupported_version` (V21) |
| C29 | Thème corrompu exporté puis réimporté | Refusé à l'import, comme une config de widget corrompue (export brut) |
| C30 | Archive V3 ou V4 restaurée avec le binaire V5 | Acceptée ; migrée au démarrage suivant après `pre-migration` |
| C31 | Archive V5 restaurée avec un binaire V4 ou V3 | `schema_too_new` |
| C32 | Retour à un exe V3 après V5 | `VersionMissing` : procédure de dashboards-sidebar §9 |
| C33 | Mode contraste élevé de Windows | Les couleurs forcées remplacent les teintes ; reste lisible |
| C34 | `prefers-reduced-motion` | Aucune animation ajoutée |
| C35 | Changement d'heure, fuseaux, hors-ligne, synchronisation | Sans objet : aucune date métier, tout est local, un seul processus |

---

## 6. Tests

### 6.1 Vitest (runner Angular), par lot
| Fichier | Lot | Contenu |
|---|---|---|
| `core/dashboard/dashboard-theme.spec.ts` (nouveau) | T1, T3 | [T1] `CARD_TINTS` : 12 ids uniques, `^[a-z]+$`, aucun `default`. [T3] `resolveCardTheme` : `{}` v1 → défauts ; `{cardBody:'rose',cardHeader:'default'}` → `ok` ; `'coral'` → `ok`, conservé ; `'Rose'`, `''`, clé en plus → `invalid` ; version 2 → `future` ; 0, 1,5 → `invalid` (S1). `knownTint` : `'rose'` ; `'default'`, `'coral'`, `'__proto__'`, `'constructor'` → `null`. `bodyTint` / `headerTint` : en-tête `default` ou `coral` sous fond `rose` → `rose` ; en-tête `sky` → `sky` ; tout par défaut → `null`. `withTint` ne mute pas. `cardThemeStyle` : `null` et défauts → `{}` ; fond `rose`, en-tête par défaut → créneaux du corps (6), cadre `rose`, en-tête `rose` (3) ; fond par défaut, en-tête `sky` → en-tête `sky` et `--hb-card-body-border` = `var(--hb-tint-sky-border)`, aucun autre créneau du corps ; fond `rose`, en-tête `sky` → cadre `rose`, séparateur `sky` ; `coral` → comme par défaut. `tintSwatchStyle` : défaut et teinte. Sérialisation des défauts ≤ 4 096 |
| `core/dashboard/dashboard-theme-flow.spec.ts` (nouveau) | T3 | `unavailable` (store non prêt, pas de tableau, `AppLock`) ; `open` → `editing` avec l'id et la session courants ; `setPreview` ignoré hors édition ; changement de session (`close` puis `open`, y compris du même id) → `idle`, `preview` nul ; verrou pendant l'édition → `unavailable` ; `close()` → `idle` et `focusTrigger` après rendu ; `close(ancienneSession)` sans effet sur une édition plus récente |
| `core/dashboard/dashboard.component.spec.ts` | T3 | Zone de grille `card-theme`, jamais une `.card-theme.box` ; thème enregistré fond `rose` → `--hb-card-body-bg` = `var(--hb-tint-rose-body)`, `data-card-body="rose"`, `data-card-header="rose"` (S2) ; brouillon prioritaire seulement pour le tableau édité ; après `close` → enregistré ; `future` et `invalid` → aucune propriété ; `list.updateTheme` → style mis à jour sans rouvrir ; `moveUnplaced` → `list.create` reçoit `theme` et `themeVersion` du tableau courant (y compris un thème futur, recopié tel quel) |
| `core/dashboard/dashboard-list.store.spec.ts` | T3 | `create` transmet `theme`/`themeVersion` ; `updateTheme` remplace l'entrée ; échec propagé, liste inchangée |
| `core/layout/sidebar.component.spec.ts` | T4 | Bouton palette juste avant `add-widget` dans l'ordre du DOM ; `aria-label` et bulle par phase ; `aria-disabled` hors tableau et sous verrou ; clic → `editing`, `aria-expanded` ; clic pendant le V → `finish` puis ouverture ; dialogue rendu (`DeferBlockBehavior.Playthrough`) ; focus rendu au bouton après fermeture |
| `core/layout/dashboard-theme-dialog.component.spec.ts` (nouveau) | T4 | 2 `fieldset` × 13 radios aux noms accessibles (« Par défaut » / « Comme le fond » + 12 noms) ; `legend` sans nom de valeur ; choix initial coché ; valeur inconnue → rien de coché + note ; pastille « Comme le fond » = teinte du fond du brouillon ; `change` → `preview` mis à jour, aucune écriture ; « Enregistrer » (`type="submit"`) → un seul `updateTheme(id, {cardBody, cardHeader}, 1)`, double soumission comprise ; succès → `idle` ; échec et sérialisation refusée → message, toujours `editing`, aperçu gardé ; écriture en cours puis session changée et panneau rouvert ailleurs → le nouveau panneau reste ouvert (C11) ; tableau absent à l'ouverture → `idle` ; « Annuler » (`type="button"`) et Échap → `idle`, aucune écriture ; Échap ignoré pendant l'écriture ; `future` → radios désactivés, pas d'« Enregistrer », « Fermer » ferme ; `invalid` → message, défauts cochés ; mini-aperçu : `div.card-theme` stylé contenant la `section.box` ; `p-dialog` : `position` `bottomleft`, `maskStyleClass` `dialog-mask-clear`, `closable` faux |
| `core/backup/config-transfer.spec.ts` | T5 | `validDoc()` en v3 avec `theme` ; v1 et v2 sans `theme` → plan défauts sérialisés, version 1, `resetsThemes` vrai ; v3 → `resetsThemes` faux ; v1 ou v2 avec → `unknown_field@dashboards[0].theme` ; v3 sans → `missing_field` ; `version` 0, 1,5, 10 001 → `invalid_value@dashboards[0].theme.version` ; `data` `[]`, `"x"`, `null` → `invalid_value@dashboards[0].theme` ; `{cardBody:'Rose'}` et clé en plus → `invalid_value` ; `{cardBody:'coral'}` → accepté tel quel ; `{}` → normalisé ; version 2 → brut conservé, version 2 ; brut de 4 096 points de code avec des caractères hors BMP (plus de 4 096 unités UTF-16) → accepté, 4 097 → `invalid_value` ; champ inconnu dans `theme` → `unknown_field@dashboards[0].theme.x` ; `formatVersion` 4 avec champ inconnu → `unsupported_version` seul ; export : `theme` brut et version |
| `core/backup/config-transfer.service.spec.ts` | T5 | L'export transmet `theme` et `themeVersion` |
| `features/settings/config-transfer-settings.component.spec.ts` | T5 | Ligne `configTransfer.themesReset` présente si `resetsThemes`, absente sinon |
| `core/i18n/fr.spec.ts` | T1, T4, T5 | Clés `dashboardTheme.*` (une par teinte), `configTransfer.themesReset`, `backup.importProblems.invalid_theme` |
| Specs construisant un `Dashboard` | T2 | Ajouter `theme: {}`, `themeVersion: 1` |

### 6.2 `test:data` (lot T2)
- `migrations.spec.ts`, bloc « V5 (dashboards.theme) » : `createTestDatabase(4)`, une ligne, V5 appliquée (comme le test V4) → `theme = '{}'`, `theme_version = 1`, `icon` et `updated_at` inchangés, `integrity_check` et `foreign_key_check` propres. `CHECK` : refuse `'pas du json'`, `'[]'`, `'"x"'`, `'null'`, un objet de 4 097 caractères, `theme_version` 0 (erreur `constraint`, V33) ; accepte `'{"cardBody":"rose"}'` et un objet de 4 096 caractères.
- `sqlite-dashboard.repository.spec.ts` : `create` sans thème → `{}` et 1 ; `create` avec `theme` et `themeVersion` → recopiés ; `createIfNone` → défauts ; `updateTheme` écrit et renvoie ; `not_found` ; `invalid_input` (version 0, 1,5, objet trop long, aussi à la création) ; un objet de 4 096 points de code hors BMP accepté ; `update(name, icon)` conserve le thème ; `list`/`get` le restituent.

### 6.3 Rust
Lot T2 (`validate_tests.rs`, `sqlite.rs`) :
- `sqlite.rs` l. 70 : `5`.
- `contiguous_history_beyond_the_supported_version_is_schema_too_new` : `supported: 5` ; second cas `db_archive(&dir, 5, "INSERT … VALUES (6, 'x', 1, X'00', 0); CREATE TABLE future (a)")` → `archive: 6`.
- `v3_database_migrated_to_v4_…` (V18) devient `v3_database_migrated_to_the_supported_version_has_its_schema_and_defaults` : icône `th-large`, thème `'{}'`, version 1, `updated_at` inchangé ; schéma égal à `make_database(fresh, supported_schema_version(), false)` et à `expected_schema(supported_schema_version())`. C'est le chemin de la vraie base (V3 → V5 en un démarrage, D10).
- Nouveaux : `expected_schema_of_version_5_matches_a_real_database` (texte figé du §4.3, `assert_ne!` avec la V4) ; `v4_database_migrated_to_v5_keeps_the_icon_and_gets_the_default_theme` (base V4, icône `briefcase`, vrai migrateur ; chemin de la base de dev) ; `archive_of_version_4_is_still_accepted` ; dans `archive_at_the_supported_version_made_by_the_real_migrator_is_accepted`, thème `{"cardBody":"rose","cardHeader":"default"}` restitué. Helper `dashboard_int(path, column) -> i64` pour `theme_version`.
- Tout autre test qui suppose « 4 = à jour » : `supported_schema_version()` ; liste rapportée.

Lot T5 (`config_transfer_tests.rs`) : `"theme": "{}", "themeVersion": 1` dans **tous** les plans (V20, chaînes brutes l. 343-346 et constructeur l. 737-776 compris) ; `upsert_creates_and_replaces_the_theme` ; `invalid_theme_creates_no_backup_and_writes_nothing` (`"[]"`, `"pas du json"`, `"\"s\""`, objet de 4 097 caractères, version 0 et 10 001) ; un objet de 4 096 caractères, dont des caractères hors BMP, est accepté **et** écrit (le `CHECK` est d'accord) ; `theme_fields_are_required_and_typed` (absent, `"theme": {}` au lieu d'une chaîne, `"themeVersion": "1"` → refus de désérialisation).

### 6.4 Scripts
- `check-contrast.mjs` et `test-check-contrast.mjs` avec ses fixtures (T1, §4.2) ; `test:design` mis à jour.
- `scripts/test-dashboard-grid-css.mjs` : [T3] `.card-theme {` déclare les 10 créneaux en `var(--hb-…)` ; `.card-theme .box {` et `.card-theme .box-header {` font les correspondances du §4.5 ; la poignée `handle-se` lit `--hb-card-body-muted`. [T4] `.tint-choice:has(input:checked)` sans `outline` ; `.tint-choice:has(input:focus-visible)` avec `outline` ; `.dialog-mask-clear` a `--p-mask-background: transparent` et `background: transparent`.

---

## 7. Lots

**Règles communes** (reprises de dashboards-sidebar §7)
- Lire `CLAUDE.md`, puis cette spec. **Branche `dashboards-sidebar`**, après le lot F (D10) ; jamais `main`, jamais de `git push` sans demande. Un lot à la fois, dans l'ordre T1, T2, T3, T4, T5 ; chacun laisse l'application utilisable et le dépôt vert.
- Interdits : `any`, `Date` hors exemptions, couleur brute hors `tokens.css`, texte en dur, `CommonModule`, modification d'une migration existante (V1 à V4 ; **V4 figée depuis le commit 8982993**), modification des capabilities, de `build.rs`, de `tauri.conf.json` ou de la CSP, relèvement d'un budget.
- Composants standalone, `OnPush`, état en signals.
- **Base réelle intouchable** : jamais l'exe release ni `npm run tauri dev` ni `cargo tauri dev` (vraie base) ; seulement `npm run dev` (app « Homebase Dev », dossier `fr.mariusdev.homebase.dev`) ; **aucun `npm run dev` du début du lot T2 jusqu'à sa revue** (V5 serait appliquée à la base de dev avant le gel) ; aucun export ni archive de l'app de dev dans `%APPDATA%\fr.mariusdev.homebase\backups\`.
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
- **Conditions d'arrêt** : supposition infirmée ; test existant cassé sans lien avec le lot ; bundle initial ≥ 500 kB ou avertissement ; besoin de modifier V4, ou V5 après la revue de T2 (→ nouvelle migration, avec accord) ; une paire de contraste qui échoue hors de la règle de correction de T1 ; toute écriture constatée dans `%APPDATA%\fr.mariusdev.homebase\`.
- **Rapport de lot** : fichiers touchés, résultats des commandes, taille du bundle initial (avant et après), suppositions vérifiées, écarts.

### Lot T1 : palette, tokens, contraste
Fichiers : `core/theme/tokens.css` ; `scripts/check-contrast.mjs` ; `scripts/test-check-contrast.mjs` (créé) et `scripts/fixtures/contrast/**` (créés) ; `apps/web/package.json` (`test:design`) ; `core/dashboard/dashboard-theme.ts` (créé : `CARD_TINTS`, `CardTint`, `TINT_DEFAULT`, `TINT_VALUE_PATTERN`, `knownTint` seulement) et sa spec ; `core/i18n/fr.json` (`dashboardTheme.tints`), `fr.spec.ts`.

Étapes :
1. Mesurer et noter le bundle initial de départ (`npm run web:build`).
2. Tokens du §4.1, clair et sombre, dans l'ordre du tableau.
3. `check-contrast.mjs` (§4.2) : alias, seuils par paire, découverte des teintes, présence dans les deux blocs, synchronisation avec `CARD_TINTS`, paires, cas mixtes.
4. Fixtures et `test-check-contrast.mjs` ; `test:design`.
5. `dashboard-theme.ts` (partie T1) et sa spec ; noms FR et test.

**Règle de correction** (sans escalade, une fois par valeur, rapportée) : si une paire échoue, remplacer la seule valeur fautive par la nuance voisine de la même échelle : `muted` clair → 900 ; `border` clair → nuance suivante (400, 500, 600) ; `muted` sombre → 300 ; `border` sombre → 800. Toute autre correction (fond, en-tête, couleurs « sur teinte ») → arrêt.

Acceptation :
- T1-1 `npm run test` : les 12 teintes × 2 thèmes passent, sortie listée dans le rapport.
- T1-2 `test-check-contrast.mjs` vert : `ok` passe, `missing-dark`, `tint-mismatch`, `low-ratio`, `default-id` échouent avec le bon message.
- T1-3 Aucun hexadécimal hors de `tokens.css` sous `src/app` (`npm run lint`).
- T1-4 Rendu inchangé (aucune portée `.card-theme` encore).

### Lot T2 : V5 et couche de données (texte de V5 figé à la revue)
Fichiers à créer : `migrations/V5__dashboard_theme.sql`. À modifier : `migrations/checksums.json` ; `src/db.rs` ; `data/models.ts`, `repositories.ts`, `index.ts` si besoin, `sqlite/row-mappers.ts`, `sqlite/sqlite-dashboard.repository.ts`, leurs specs, `migrations.spec.ts` ; `core/testing/fake-dashboard.repository.ts` ; specs qui construisent un `Dashboard` ; `src/backup/sqlite.rs`, `validate_tests.rs`.

Étapes :
1. **Ne pas lancer `npm run dev` avant la fin de la revue de ce lot.**
2. Migration (texte exact du §4.3), `checksums.json`, `db.rs`.
3. `data/` (§4.3) : constantes, `Dashboard.theme`/`themeVersion`, `NewDashboard.theme?`/`themeVersion?`, `DASHBOARD_COLUMNS`, `toDashboard`, `validTheme`, `create`/`createIfNone` avec les colonnes de thème, `updateTheme`.
4. Faux dépôt ; littéraux `Dashboard` des specs.
5. Tests `test:data` (§6.2).
6. Tests Rust (§6.3, lot T2), dont V18 ; liste des tests adaptés au rapport.
7. **Revue du lot : le texte de V5 est figé ensuite** ; `npm run dev` permis à nouveau (la base de dev passe de V4 à V5).

Acceptation :
- T2-1 V1 à V4 inchangées ; `registered_migrations_match_files_exactly` et le manifeste verts.
- T2-2 Tests `data` et Rust verts, dont le vrai migrateur V3 → V5 et V4 → V5 et le texte figé (S4).
- T2-3 Aucun changement visible dans l'application.

### Lot T3 : application du thème et héritage par « (suite) »
Fichiers : `core/dashboard/dashboard-theme.ts` (complété, §4.4) et sa spec ; `core/dashboard/dashboard-theme-flow.ts` (créé) et sa spec ; `core/theme/components.css` (`.card-theme`) ; `core/dashboard/dashboard.component.{ts,html,css}` et sa spec ; `core/dashboard/dashboard-list.store.ts` et sa spec ; `scripts/test-dashboard-grid-css.mjs`.

Étapes :
1. `dashboard-theme.ts` complet (S1, D5) et spec.
2. `DashboardThemeFlow` (§4.6) et spec.
3. `.card-theme` (§4.5) ; poignée `handle-se`.
4. `DashboardComponent` : `displayedTheme`, `cardStyle`, `effectiveTints`, gabarit (S2).
5. `DashboardListStore.create` (thème optionnel) et `updateTheme` ; `moveUnplaced` (D11).
6. Script CSS.

Acceptation :
- T3-1 Un thème posé en base (spec) teinte la grille selon D5 ; les autres pages et tableaux ne changent pas.
- T3-2 `dashboard-list.store.ts` et `dashboard-theme-flow.ts` n'ont que des `import type` depuis `./dashboard-theme` (`git grep` au rapport).
- T3-3 Le tableau « (suite) » porte le thème du tableau d'origine.
- T3-4 Bundle initial < 500 kB.

### Lot T4 : bouton et panneau
Fichiers à créer : `core/layout/dashboard-theme-dialog.component.ts` et sa spec. À modifier : `core/layout/sidebar.component.{ts,html}` et sa spec ; `core/theme/components.css` (`.tint-choice`, `.dialog-mask-clear`) ; `scripts/test-dashboard-grid-css.mjs` ; `core/i18n/fr.json`, `fr.spec.ts`.

Étapes :
1. CSS (§4.6).
2. Bouton de la barre, déclencheur, fin du V avant ouverture, `@defer`.
3. Dialogue (§4.6), Échap par l'hôte, session capturée à l'écriture.
4. i18n (§4.8).
5. Specs (`DeferBlockBehavior.Playthrough`).
6. Vérifications MT1 à MT5 sur l'app de dev (`npm run dev`), captures clair et sombre au rapport.

Acceptation :
- T4-1 Parcours complet en spec : palette, choix, aperçu, Enregistrer, fermeture, focus rendu.
- T4-2 Annuler et Échap n'écrivent rien et rétablissent l'enregistré.
- T4-3 Focus clavier visible sur un choix coché (script CSS, MT4).
- T4-4 `primeng/dialog` et `dashboard-theme.ts` hors du bundle initial ; bundle < 500 kB.

### Lot T5 : export et import (format 3)
Fichiers : `core/backup/config-transfer.ts`, `config-transfer.service.ts`, `backup.types.ts`, leurs specs ; `features/settings/config-transfer-settings.component.ts` et sa spec ; `core/i18n/fr.json` ; `src/backup/config_transfer.rs`, `config_transfer_tests.rs`, `error.rs`.

Étapes :
1. TS (§4.7) et specs, dont `resetsThemes` et la ligne d'aperçu.
2. Rust (§4.7), fixtures (V20), nouveaux tests.

Acceptation :
- T5-1 Aller-retour : thème et version restitués exactement.
- T5-2 Fichiers v1 et v2 (fixtures littérales) importés, thèmes par défaut, aperçu qui l'annonce.
- T5-3 `deny_unknown_fields` conservé ; `invalid_theme` avant toute sauvegarde `pre-import`.
- T5-4 Longueurs de thème en points de code des deux côtés (C27).

---

## 8. Critères d'acceptation d'ensemble

1. Commandes de fin de lot vertes après T5.
2. V1 à V4 inchangées ; V5 présente, enregistrée, au manifeste, inchangée depuis la revue de T2.
3. Aucune couleur brute hors `tokens.css`, aucun `any`, `OnPush` partout, textes via Transloco.
4. Bundle initial < 500 kB ; budgets inchangés.
5. Capabilities, `build.rs`, `tauri.conf.json` et CSP inchangés.
6. `check-contrast` couvre les 12 teintes dans les deux thèmes (texte, secondaire, couleurs de sens, focus, bordures, cas mixtes), et ses fixtures passent.
7. MT1 à MT9 passées par Marius ; celles marquées « vraie base » le sont sur l'exe release, avec M1 à M17 de dashboards-sidebar (amendées, §10.7), juste avant la fusion de la branche.

---

## 9. Vérifications manuelles (Marius)

**Ordre.** Pendant T4 et T5 : app de dev (`npm run dev`, base `.dev` déjà en V4, passée en V5 après la revue de T2). Juste avant la fusion de `dashboards-sidebar` : l'exe release sur la vraie base, **M10 de dashboards-sidebar en premier** (il vaut aussi pour la migration V5 de cette spec), puis M1 à M17 et MT1 à MT9.

**Avant d'installer l'exe** : conserver l'installateur V3 actuellement installé (dashboards-sidebar §9). **Retour arrière** : la procédure de dashboards-sidebar §9 s'applique telle quelle ; la sauvegarde « Avant mise à jour » (schéma 3) couvre V4 et V5 à la fois.

- **MT1 Palette** (dev, puis vraie base). Tableau avec notes, tâches (une en retard, une du jour), météo, recherche, raccourcis. Pour chaque teinte en fond, en-tête « Comme le fond », en clair **puis en sombre** : titre, icône, poignée (survol), Supprimer, coin de redimensionnement, texte secondaire, dates du jour et en retard, popover de recherche, anneau de focus (Tab). Puis deux croisements : en-tête teinté + fond par défaut ; deux teintes différentes. **Juger explicitement le sombre** : les teintes y sont volontairement discrètes (V32) ; dire si elles doivent être renforcées (§12, point 1).
- **MT2 Aperçu.** Palette : le panneau s'ouvre en bas à gauche, **la grille n'est pas assombrie** (S3) ; chaque choix change la grille et la mini-carte ; Annuler et Échap rétablissent ; Enregistrer garde ; F5 et redémarrage : thème conservé.
- **MT3 Isolation.** Un autre tableau, Réglages, la barre et les dialogues gardent leur rendu ; passer d'un tableau à l'autre montre le thème de chacun. Bandeau de débordement : « Les déplacer vers un nouveau tableau » crée un tableau au même thème.
- **MT4 Clavier et Narrateur.** Tab jusqu'à la palette (bulle de texte), Entrée : focus **visible** sur le choix coché ; flèches : la grille change ; Narrateur annonce le nom de la teinte et le groupe ; Échap : focus rendu à la palette. Pendant le V bleu, clic sur la palette : le `+` vert revient, le panneau s'ouvre.
- **MT5 Session.** Panneau ouvert, `Alt+←` puis (après retour) `Alt+→` : le panneau se ferme, rien n'est enregistré ; revenir : thème enregistré. `Ctrl+K` dans le panneau : rien.
- **MT6 Migration** (vraie base) : couverte par M10 amendé de dashboards-sidebar (une seule sauvegarde « Avant mise à jour », schéma 3, avant V4 et V5) ; vérifier en plus que tous les tableaux sont au rendu par défaut.
- **MT7 Restaurations** (vraie base) : couvertes par M11 et M12 amendés ; vérifier en plus qu'un thème modifié revient après la restauration de la sauvegarde manuelle (schéma 5).
- **MT8 Export et import** (vraie base) : couvert par M17 amendé ; vérifier en plus qu'un fichier v2 montre, dans l'aperçu, la remise par défaut des thèmes.
- **MT9 Bascule système.** Panneau ouvert, passer Windows en sombre : grille, mini-carte et pastilles suivent.

---

## 10. Amendements à appliquer par le coordinateur

### 10.1 ADR-001 (`docs/adr/001-widget-contract.md`)

§3.5, exemple JSON : remplacer `"formatVersion": 2,` par `"formatVersion": 3,` et ajouter après `"icon": "th-large",` la ligne `"theme": { "version": 1, "data": { "cardBody": "default", "cardHeader": "default" } },`.

§3.5, après l'amendement dashboards-sidebar sur `formatVersion` 2, ajouter :
> *Amendement (spec dashboard-theme)* : `formatVersion` passe à 3. `dashboards[].theme = { version, data }` y est obligatoire : thème du tableau, objet versionné validé et migré par `resolveConfig` avec `DASHBOARD_THEME_SPEC` (`core/dashboard/dashboard-theme.ts`), comme une config de widget ; une version future est conservée telle quelle, toute autre valeur invalide fait refuser le fichier ; longueurs en points de code. Les formats 1 et 2 restent acceptés, sans `theme` : leurs tableaux prennent le thème par défaut, ce que l'aperçu d'import annonce.

§3.6, ajouter :
> *Amendement (spec dashboard-theme)* : le thème d'un tableau peut teinter le corps et l'en-tête des cartes. Il redéfinit les tokens sémantiques (`--hb-bg`, `--hb-fg-muted`, `--hb-border`, couleurs de sens) dans la carte : un widget qui n'emploie que les tokens et classes sémantiques (règle de DESIGN.md) le suit sans rien faire. Un widget ne suppose jamais que son fond est blanc ou neutre.

§3.7 : `Dashboard` gagne `theme` (`JsonObject`) et `themeVersion` ; `NewDashboard` gagne `theme?` et `themeVersion?` ; `DashboardRepository { list, get, create, createIfNone, update, updateTheme, remove }`.

### 10.2 ADR-002 (`docs/adr/002-data-layer.md`)

Fin de §3.4, après l'amendement V4 :
> *Amendement (spec dashboard-theme, V5)* : `dashboards.theme TEXT NOT NULL DEFAULT '{}'` (objet JSON, ≤ 4 096 caractères) et `dashboards.theme_version INTEGER NOT NULL DEFAULT 1` (≥ 1), sur le modèle de `config` / `config_version` : la couche données ne les interprète pas. Même exception justifiée à « pas de `DEFAULT` » que V4. Ajouter une option au thème ne demande ni migration ni nouveau format d'export (nouvelle version du schéma de thème, migrée côté front).

Fin de §3.5 :
> *Amendement (spec dashboard-theme)* : `Dashboard.theme` (`JsonObject`) et `Dashboard.themeVersion` ; `NewDashboard.theme?` / `themeVersion?` (recopiés tels quels dans l'`INSERT` de création, par exemple pour le tableau « (suite) ») ; `DashboardRepository.updateTheme(id, theme, themeVersion)` (une instruction ; `not_found` ; `invalid_input` au-delà de 4 096 points de code ou pour une version non entière ou < 1). `update(id, { name, icon })` ne touche pas au thème.

### 10.3 `docs/DESIGN.md`

§1, principe 3, ajouter à la fin :
> *Exception (spec dashboard-theme, décision de Marius)* : chaque tableau peut teinter ses cartes (fond et en-tête) avec une palette pastel fermée, au choix de l'utilisateur. Par défaut aucune teinte : le rendu reste neutre. Les teintes ne portent aucun sens ; dans un corps teinté, les couleurs de sens passent à leurs variantes `--hb-on-tint-*`.

Après §2.1, ajouter :
> ### 2.1 bis Teintes de cartes (thème d'un tableau)
> Douze teintes, chacune avec quatre rôles en clair et en sombre : `--hb-tint-<id>-body` (corps), `-header` (en-tête, un peu plus soutenu), `-muted` (texte secondaire et icônes sur les deux), `-border` (cadre et séparateur de l'en-tête). Ids et valeurs : `docs/specs/dashboard-theme.md` §4.1 (rose, peach, vanilla, anis, mint, lagoon, sky, periwinkle, lavender, orchid, slate, sand ; noms affichés : Rose, Pêche, Vanille, Anis, Menthe, Lagon, Ciel, Pervenche, Lavande, Orchidée, Ardoise, Sable). Clair : pastels (nuances 100 et 200) ; sombre : la teinte assourdie dans le fond, volontairement discrète. Dans un corps teinté, les couleurs de sens deviennent `--hb-on-tint-accent` / `-danger` / `-success` / `-attention` (plus profondes en clair, identiques en sombre). `--hb-fg` reste partagé. L'en-tête « par défaut » suit le fond ; cadre et séparateur prennent la bordure de la teinte présente. Contrastes vérifiés par `check-contrast` : texte et secondaire 4,5:1, icônes et focus 3:1, bordures 1,3:1 (comme le rendu par défaut), cas mixtes compris. Les valeurs s'ajustent dans `tokens.css` sans migration.

§3, puce « Barre de navigation », remplacer « De haut en bas : tableaux de bord (zone défilante), `+` neutre, espace, `+` vert (widget), Réglages tout en bas. Pas de bouton de thème (réglage dans Réglages). » par :
> De haut en bas : tableaux de bord (zone défilante), `+` neutre, espace, palette (thème du tableau courant), `+` vert (widget), Réglages tout en bas. Le thème clair/sombre se règle dans Réglages ; la palette ne règle que les couleurs des cartes du tableau courant.

§3, après « Ajout de widget », ajouter :
> - **Thème du tableau** : bulle neutre `pi pi-palette`. Dialogue modal en bas à gauche, voile transparent (`.dialog-mask-clear`) pour garder la grille visible : deux groupes de choix (« Fond des widgets » avec « Par défaut », « En-tête des widgets » avec « Comme le fond »), puis les douze teintes en pastilles de 32 px montrant l'en-tête sur le corps (`.tint-choice` : sélection par bordure d'accent de 2 px et coche, focus par l'anneau, nom dans le libellé, jamais la couleur seule), mini-carte d'aperçu ; l'aperçu s'applique aussi à la grille ; « Enregistrer » écrit, « Annuler » ou Échap rétablissent.

§4, ajouter :
> - Thème des cartes : la zone de grille porte `.card-theme` (jamais sur une `.box`), dont les créneaux (`--hb-card-body-*`, `--hb-card-header-*`) valent par défaut le rendu Box ; le tableau pose en ligne les créneaux de ses teintes, et la carte redéfinit les tokens à partir d'eux. Rien ne change hors de la grille.

§5, « Classes de composants » : ajouter `card-theme`, `tint-choice`, `dialog-mask-clear`. « Contrôles automatiques » : « `check-contrast.mjs` vérifie aussi chaque teinte de cartes dans les deux thèmes (texte 4,5:1, focus 3:1, bordures 1,3:1, cas mixtes) et sa présence dans `CARD_TINTS` ; `test-check-contrast.mjs` le vérifie sur des fixtures ».

§6, ajouter : « Chaque teinte de cartes est vérifiée en clair et en sombre sur un tableau réel (spec dashboard-theme, MT1). »

### 10.4 `docs/PLAN.md`

§4, à la fin du paragraphe « Navigation : … » :
> Chaque tableau a un thème de cartes (fond et en-tête, palette pastel fermée de douze teintes), stocké en JSON versionné dans `dashboards.theme` (V5) et exporté (`formatVersion` 3) (`docs/specs/dashboard-theme.md`).

### 10.5 `docs/ROADMAP.md`

Phase 1 bis, l. 33 : remplacer « Vérifications manuelles M1 à M17 à faire par Marius » par « Vérifications manuelles M1 à M17 (et MT1 à MT9 de `docs/specs/dashboard-theme.md`) à faire par Marius ».

Phase 1 bis, après la ligne du lot F (l. 44), insérer :
```markdown
- [ ] (S) Lot T1 (spec `dashboard-theme.md`) : palette de douze teintes, tokens clair et sombre, `check-contrast` étendu et ses fixtures
- [ ] (S) Lot T2 : migration V5 `dashboards.theme` / `theme_version`, couche de données (texte de V5 figé à la revue ; pas de `npm run dev` avant)
- [ ] (S) Lot T3 : application du thème aux cartes (`.card-theme`), flux d'édition, thème hérité par le tableau « (suite) »
- [ ] (S) Lot T4 : bouton palette et panneau avec aperçu en direct
- [ ] (S) Lot T5 : export et import (`formatVersion` 3)
```

Phase 1 bis, l. 45 : remplacer « Revue de fin de phase ; vérifications manuelles M1 à M17 à faire par Marius, juste avant la fusion » par « Revue de fin de phase (thème compris) ; vérifications manuelles M1 à M17 et MT1 à MT9 à faire par Marius, juste avant la fusion (M10 en premier : V4 et V5 appliquées ensemble) ».

### 10.6 `docs/specs/backup-restore.md`

- l. 196 : remplacer « `formatVersion` (2 ; 1 accepté en lecture) » par « `formatVersion` (3 ; 1 et 2 acceptés en lecture) ».
- l. 550 : remplacer « (supérieur à 2 → `unsupported_version` ; autre valeur que 1 ou 2 → `invalid_value`) » par « (supérieur à 3 → `unsupported_version` ; autre valeur que 1, 2 ou 3 → `invalid_value`) ».
- l. 870 (M9) : « `"formatVersion": 3` est refusé » → « `"formatVersion": 4` est refusé ».
- l. 1192 : « Refus : `formatVersion: 3` » → « Refus : `formatVersion: 4` ».
- §4.12, à la fin :
> **Amendement (spec dashboard-theme, 2026-11-09)** : `formatVersion` passe à 3. `dashboards[].theme = { version, data }` y est obligatoire ; absent en versions 1 et 2, où le plan reçoit le thème par défaut et l'aperçu l'annonce (`resetsThemes`). Analyse : `resolveConfig` avec `DASHBOARD_THEME_SPEC` ; `future-version` → objet brut conservé ; autre invalide → `invalid_value` ; objet sérialisé ≤ 4 096 points de code. `ConfigImportPlan.dashboards[]` porte toujours `theme` (objet JSON sérialisé) et `themeVersion` ; `validate_plan` contrôle objet, taille et version 1 à 10 000 (`invalid_theme`) ; `UPSERT_DASHBOARD` écrit `theme` et `theme_version`.
- §4.13 : ajouter `ImportProblem::InvalidTheme` (`invalid_theme`).

### 10.7 `docs/specs/dashboards-sidebar.md`

- D0, à la fin : « *Amendement (spec dashboard-theme)* : V4 est figée depuis le commit 8982993. La spec dashboard-theme ajoute V5 sur cette même branche, figée à la revue de son lot T2 ; aucun `npm run dev` du début de T2 jusqu'à cette revue. La vraie base passe de V3 à V5 au premier lancement de l'exe release. »
- D7, à la fin du premier paragraphe : « *Amendement (spec dashboard-theme)* : une bulle palette (thème du tableau courant) s'insère entre l'espace et le `+` vert. »
- §4.6, après le bloc de V4 : « *Note (spec dashboard-theme)* : le thème des cartes arrive par V5 (`dashboards.theme`, `theme_version`). »
- §4.7, action du bandeau : « *Amendement (spec dashboard-theme)* : le tableau « (suite) » reçoit aussi le thème du tableau courant (`theme`, `themeVersion`), dans le même `INSERT`. »
- §4.12, Lot F : « *Note* : `formatVersion` 3 depuis la spec dashboard-theme. »
- §8, point 6 : « M1 à M17 (et MT1 à MT9 de la spec dashboard-theme) passées par Marius sur l'exe release et la vraie base, juste avant la fusion. »
- §9, remplacer M10 par :
  > - **M10 Migrations V4 et V5** (première action sur la vraie base, une seule fois ; vaut aussi MT6 de la spec dashboard-theme) : une seule sauvegarde « Avant mise à jour », base seule, schéma 3, prise avant que V4 et V5 soient appliquées ensemble ; tous les widgets présents ; tableau existant à l'icône grille et au thème par défaut.
- §9, remplacer M11 par :
  > - **M11 Restauration V3.** Restaurer cette sauvegarde : acceptée, redémarrage, V4 et V5 appliquées ensemble, nouvelle sauvegarde « Avant mise à jour » (schéma 3). Données retrouvées.
- §9, remplacer M12 par :
  > - **M12 Restauration au schéma courant.** Créer une sauvegarde manuelle (schéma 5), modifier quelque chose (icône et thème compris), la restaurer : acceptée, redémarrage, état d'avant la modification, icônes et thèmes compris.
- §9, remplacer M17 par :
  > - **M17 Export et import.** Le fichier exporté a `"formatVersion": 3`, les icônes, les thèmes, et pas de `dashboard.last`. Modifier une icône et un thème, importer : ils reviennent, rechargement. Un ancien fichier v1 ou v2 : accepté ; l'aperçu annonce que les thèmes seront remis par défaut (et les icônes, pour v1). `"formatVersion": 4` : refusé. Pendant un import, barre et page figées sous le voile.
- §11, R3, colonne « Mitigation », ajouter : « ; V5 (spec dashboard-theme) figée à la revue de son lot T2, même procédure ».

---

## 11. Risques

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | V5 lancée (même sur la base de dev) puis modifiée | `VersionMismatch`, démarrage impossible | Texte figé à la revue de T2 ; aucun `npm run dev` du début de T2 à sa revue ; tests sur bases en mémoire ; texte vérifié par la revue (V33) |
| R2 | Valeurs de contraste calculées à la main | Paire sous le seuil | Recalculées par la revue (V32) ; `check-contrast` et ses fixtures font foi ; règle de correction bornée (T1) ; arrêt sinon |
| R3 | Goût : teintes jugées fades (surtout en sombre) ou trop vives | Rendu non souhaité | Aperçu réel (MT1, sombre jugé explicitement) ; ajustement dans `tokens.css` sans migration |
| R4 | Redéfinir les tokens dans la carte surprend un futur widget | Couleur incohérente | Amendement ADR-001 ; règle DESIGN existante (tokens seuls) ; `check-design-tokens` |
| R5 | `.card-theme` posé sur une `.box` | Fond transparent (cycle) | Règle écrite (D4) ; assertions dans les specs |
| R6 | Bundle initial +6 à +8 kB | Avertissement | Panneau et modèle paresseux ; mesure à chaque lot ; arrêt à 500 kB |
| R7 | Voile transparent : la grille paraît cliquable | Clic sans effet | Modal assumé ; Annuler et Échap visibles ; S3 vérifiée en MT2 |
| R8 | Import v1 ou v2 remet les thèmes à zéro | Perte de personnalisation | Comme l'icône en v1 ; annoncé dans l'aperçu ; §12, point 5 |
| R9 | Couleurs de sens plus profondes dans un corps teinté (clair) | Légère différence avec une carte neutre | Assumé : nécessaire à 4,5:1 |
| R10 | Bordures à 1,3:1 | Cadre discret | Identique au rendu par défaut ; §12, point 8 |
| R11 | V4 et V5 livrées ensemble sur `dashboards-sidebar` (décision de Marius) | Deux migrations au même démarrage, un seul point de retour ; la phase 1 bis s'allonge | Test du vrai migrateur V3 → V5 (§6.3) ; revue de T2 ; M10 amendé en première action ; sauvegarde « Avant mise à jour » (schéma 3) et installateur V3 conservé (dashboards-sidebar §9) ; revue de fin de phase sur l'ensemble |
| R12 | jsdom sans propriétés personnalisées (S2) | Test moins direct | Attributs `data-card-*` et fonctions pures testés |

---

## 12. Décisions de Marius et points restants

**Décidé (2026-11-09)**
1. **En-tête « Par défaut » sous un fond teinté : il suit le fond** (rôle `header` de la même teinte, un peu plus soutenu) ; libellé « Comme le fond » (D5).
2. **Écriture seulement à « Enregistrer »**, aperçu en direct, « Annuler » et Échap rétablissent (D7).
3. **Le tableau « (suite) » hérite du thème**, comme de l'icône (D11).
4. **Livraison sur la branche `dashboards-sidebar`**, avant sa fusion ; V4 et V5 arrivent ensemble sur la vraie base (D10).

**Restant à valider (non bloquant pour démarrer T1)**
5. **Palette** : douze teintes et leurs noms ; intensité claire (corps nuance 100, en-tête 200) ; **teintes sombres volontairement discrètes** (1,03 à 1,10:1 contre la page) : à juger en MT1, à renforcer si besoin (sans migration).
6. **Panneau** : dialogue modal en bas à gauche, sans assombrir la grille (D7).
7. **Import d'un ancien fichier (v1 ou v2)** : thèmes remis par défaut, annoncé dans l'aperçu.
8. **Bordures à 1,3:1** comme le rendu actuel, et non 3:1.
9. **Couleurs de sens** plus profondes dans un corps teinté en thème clair (liens, retards, avertissements).
10. **Icône** du bouton : `pi-palette` (elle figure aussi parmi les icônes de tableau, « Création »).
