# Spec : commandes Rust typées pour toutes les données du front (ADR-002 O3, fermeture de R1)

- **Statut** : acceptée (2026-11-25) ; décisions T1 à T9 validées par Marius le 2026-11-25, telles que recommandées
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§6), sur la branche `phase-3-typed-sql`
- **Liens** : `CLAUDE.md` ; `docs/PLAN.md` §2, §6 ; `docs/SECURITY-NOTES.md` ; ADR-001 §3.7 ; ADR-002 (§2.1, §2.3, §2.4, §2.5, §3.3, §3.5, §3.6, R1, R10, R13, O3) ; `docs/specs/timers-reminders.md` (D2, D3, §4.4, §4.7) ; `docs/specs/habits.md` (D1, §4.3, §4.4) ; `docs/specs/backup-restore.md` ; `docs/specs/dashboards-sidebar.md` (D10, §4.7, §4.8)

Cette spec vaut compte rendu de décision (contexte, options, décision, conséquences, risques). Elle ne modifie aucun autre document : les amendements sont **proposés** au §8. Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`, sauf mention.

---

## 0. Décisions validées par Marius (2026-11-25)

Chaque décision donne les options, la **recommandation** de l'architecte et sa justification. La spec est écrite pour les recommandations ; une autre réponse modifie les lots cités.

**T1. Granularité des commandes** (TC2, TC3)
- A. **Une commande par méthode de dépôt** (port 1:1 des interfaces de `data/repositories.ts`), 43 nouvelles commandes, une permission `allow-…` chacune, liste exacte testée.
- B. Une commande « répartiteur » par domaine (`data_call({ op: 'todo.create', … })`, enum étiqueté) : 6 permissions au lieu de 43.
- C. Commandes agrégées par écran (ex. `dashboard_open` qui renvoie tableau + instances).
- *Recommandation : A.* C'est le modèle déjà en place (`reminder_*`, `habit_*`), chaque commande a des types et des bornes propres, la revue et les tests restent locaux, et les interfaces TS ne changent pas (les widgets ne voient rien). B reconstruit un RPC générique (la surface « une requête quelconque » qu'on veut supprimer, en plus petit) sans gain de sécurité : la fenêtre `main` reçoit de toute façon toutes les permissions. C change les interfaces et les stores sans nécessité. Seule exception assumée au 1:1 : T3.

**T2. Sort du plugin `tauri-plugin-sql`** (TC4)
- A. **Garder le plugin côté Rust uniquement** (migrations au `preload`, inchangées), retirer le paquet npm `@tauri-apps/plugin-sql` et **toute** permission `sql:*`.
- B. Remplacer le plugin par un `sqlx::migrate::Migrator` propre à Homebase et retirer le crate.
- *Recommandation : A.* Sans permission `sql:*`, le routeur d'ACL de Tauri refuse les commandes `plugin:sql|*` (S1, vérifié en manuel MC1) : la surface JS disparaît. B réécrit le chemin de migration de la base réelle de Marius (table `_sqlx_migrations`, sommes SHA-384, ordre plugin de sauvegarde → migrations, validation de restauration qui lit `db::migrations()`), sans gain de sécurité supplémentaire face à un XSS. B reste pertinent avec l'écran d'erreur natif de migration (O1, phase 6) : à rouvrir là.

**T3. Suppression du tableau vide (`discardEmpty`)** (TC2)
- A. `discardEmpty` appelle `dashboard_delete` : sauvegarde `pre-delete` complète pour un tableau vide.
- B. Commande dédiée `dashboard_discard_empty(id)` : supprime seulement si le tableau n'a **aucune** instance, `updated_at = created_at` et `created_at` date de moins de 10 minutes (horloge Rust), en une instruction ; sinon `conflict`.
- C. **Rendre le débordement atomique** : une commande `dashboard_create_with_widgets` crée le tableau « (suite) » **et** y déplace les widgets dans une seule transaction. Un échec annule tout : il n'y a plus de tableau vide à nettoyer. `DashboardRepository.remove` et `WidgetInstanceRepository.moveToDashboard` disparaissent.
- *Recommandation : C.* `discardEmpty` n'existe que parce que le front ne pouvait pas faire de transaction (ADR-002 F9) : Rust le peut. Après C, **la seule suppression de tableau à la demande de l'utilisateur est `dashboard_delete`** (critère vérifiable : aucune instruction `DELETE FROM dashboards` hors de `backup/dashboard_delete.rs` et `backup/config_transfer.rs`, CA-TC2-6). A ferait évincer par un échec technique une vraie archive de la réserve de sécurité (5 archives, `pre-delete` comprises). B garde un chemin de suppression sans sauvegarde, borné mais réel.

**T4. Connexion et concurrence** (TC1)
- A. **Connexion sqlx dédiée par commande** (modèle `schedule` et `backup`), **sans verrou applicatif** : SQLite sérialise les écrivains (WAL, `busy_timeout` 5 s) ; toute transaction de plusieurs instructions commence par `BEGIN IMMEDIATE`.
- B. Un `SqlitePool` partagé (2 à 4 connexions, créé à la première commande).
- C. Passer les nouvelles commandes sous le `gate` du planificateur.
- *Recommandation : A*, avec mesure (PV1, MC7). Les tables de contenu n'ont aucune clé étrangère vers celles du planificateur et le planificateur ne les lit pas (V5) : C couplerait sans raison chaque clic à un passage du planificateur. A est éprouvé dans le code ; l'ouverture d'une connexion coûte de l'ordre de la milliseconde (supposé, PV1). Le passage à B reste local (une seule fonction `data::connect`) si PV1 échoue.

**T5. Outillage `test:data` et better-sqlite3** (TC4)
- A. **Garder `test:data` et better-sqlite3 pour les seuls tests de schéma** (`migrations.spec.ts`, `sql-time-checks.spec.ts`, en devDependency, jamais embarqués) ; tout le SQL des commandes est testé en Rust sur les vraies migrations.
- B. Porter aussi les tests de migration en Rust et retirer better-sqlite3.
- *Recommandation : A.* Les ~60 tests de schéma existants sont verts et ne touchent pas la surface d'attaque ; les porter est un coût sans gain de sécurité. Le risque R10 (écart de version SQLite) ne concerne plus que les tests de schéma, puisque le SQL de production est exécuté par la SQLite de sqlx dans `rust:test`. B peut devenir une tâche de nettoyage ultérieure.

**T6. Bornes de nombre côté Rust sur les tables exportées** (TC2)
- A. **Oui** : les créations refusent au-delà des limites de l'import de configuration (100 tableaux, 200 widgets par tableau, 1 000 widgets au total, 200 réglages), erreur `limit_reached` (→ `DataError('forbidden')`).
- B. Non : seule la limite actuelle du front (100 tableaux, `MAX_DASHBOARDS`) s'applique.
- *Recommandation : A.* Un export doit toujours pouvoir être réimporté : aujourd'hui, un tableau de 201 widgets produirait un export que l'import refuse. Les limites sont inatteignables en usage normal. Effet visible : un message d'erreur générique si on les atteint.

**T7. Écritures après l'armement d'une restauration** (TC1)
- A. **Refuser** toute commande d'écriture quand une restauration est armée (`restart_pending`) : erreur `unavailable`.
- B. Comportement actuel : l'écriture passe, puis est perdue silencieusement à l'échange des fichiers au redémarrage.
- *Recommandation : A.* Une vérification d'un booléen déjà présent dans `BackupState` ; une perte silencieuse devient une erreur visible.

**T8. Échec du passage en WAL au démarrage** (TC1)
- A. **Journaliser et continuer** : la base fonctionne en mode `DELETE` (plus de contention, aucun risque d'intégrité).
- B. Bloquer toutes les commandes de données (`unavailable`), comme le faisait `DataLayerHealth` côté front.
- *Recommandation : A.* WAL est un choix de concurrence (ADR-002 §2.4), pas d'intégrité. B rend l'application inutilisable pour un défaut non bloquant. Le WAL est réappliqué à chaque démarrage (une base restaurée en mode `DELETE` y repasse).

**T9. Extrait de la recherche globale** (TC3)
- A. **Calculé dans le front** comme aujourd'hui (`excerptAround`) : Rust renvoie le corps de la note et la description de la tâche (au plus 20 résultats par groupe).
- B. Calculé en Rust (portage de `excerptAround`, indices UTF-16 et casse ASCII compris).
- *Recommandation : A.* Le comportement reste identique et déjà testé. Charge IPC bornée (≤ 20 × 100 000 caractères dans le pire cas, quelques kilo-octets en pratique). À revoir si MC6 montre une latence perceptible.

---

## 1. Contexte, objectif, périmètre

L'ADR-002 a accordé au front `sql:allow-execute` et `sql:allow-select` (§3.6) : tout script exécuté dans la WebView peut lire et écrire toute la base, et créer des fichiers SQLite n'importe où par `ATTACH DATABASE` ou `VACUUM INTO` (R1). Marius a décidé le 2026-10-22 de fermer ce risque **avant** le premier contenu externe (RSS, Markdown). Les tables du planificateur (V7) et des habitudes (V8) ne sont déjà servies que par des commandes Rust typées ; cette spec traite **toutes les autres** (`settings`, `dashboards`, `widget_instances`, `notes`, `shortcuts`, `todo_lists`, `todos`) et retire au front toute permission `sql:*`.

**Propriétés de sécurité visées** (vérifiables) :
- **P1** Aucune permission `sql:*` dans aucun fichier de capability ; le paquet `@tauri-apps/plugin-sql` est absent de `package.json`, de `package-lock.json` et du bundle (`plugin:sql` introuvable dans `dist`).
- **P2** Aucune commande ne reçoit de texte SQL, de nom de table, de colonne, de tri ni de chemin de fichier ; toute valeur est un paramètre lié (`?N`) ; aucun `ATTACH`, `VACUUM INTO` ni `PRAGMA` n'est atteignable depuis le front.
- **P3** Chaque entrée est bornée (taille, nombre, forme) **avant** tout accès disque ; DTO `deny_unknown_fields`.
- **P4** Toute suppression de tableau demandée par l'utilisateur passe par `dashboard_delete` (sauvegarde `pre-delete`).
- **P5** Tests de capabilities durcis : liste exacte de `default.json` **et** de `debug.json`, CSP comparée en chaîne exacte.

**Ce que la spec ne règle pas** (résiduel, §4.13) : un XSS peut toujours appeler les commandes typées (lire les notes, supprimer une tâche, un widget…). Il perd l'accès SQL arbitraire et l'écriture de fichiers ; il garde ce que l'interface sait faire.

**Hors périmètre** (ne pas improviser) : retrait du crate `tauri-plugin-sql` (T2-B) ; écran d'erreur natif de migration (O1) ; nouvelles tables ; nouvelle migration ; changement de format de l'export ou des sauvegardes ; Playwright ; refonte des stores ou des widgets au-delà du §4.8 ; sauvegarde avant suppression d'un widget ; rattachement atomique note ↔ config de widget (`notes.component.ts` garde sa compensation).

---

## 2. Faits vérifiés et suppositions

### 2.1 Vérifiés (lecture du code le 2026-11-25)

| # | Fait | Source |
|---|---|---|
| V1 | Le seul fichier du front qui importe `@tauri-apps/plugin-sql` est `data/sqlite/tauri-sql-executor.ts` (`Database.get(DB_URL)`) ; le port `SqlExecutor` n'est consommé que par `data.providers.ts` (dépôts réglages, tableaux, instances) et `data/content.tokens.ts` (tâches, notes, raccourcis, chargés à la demande). Aucun composant, store ni outil de debug n'exécute de SQL : `core/calendar/calendar-debug.ts` passe par les dépôts | Grep `plugin-sql`, `SQL_EXECUTOR`, `.execute(`, `.select(` |
| V2 | Les migrations sont appliquées **par le plugin, côté Rust**, au `preload` (`tauri.conf.json` `plugins.sql.preload`, `lib.rs` `add_migrations`), jamais par le front (pas de `sql:allow-load`). Le plugin de sauvegarde est enregistré juste avant (test `backup_plugin_is_before_sql_and_confirmation_before_tray`) | `lib.rs` l. 136-143, ADR-002 §2.1 |
| V3 | Le front pose `PRAGMA journal_mode = WAL` à chaque démarrage, le relit, et en développement lit `sqlite_version()` et `MAX(version)` de `_sqlx_migrations` | `data/sqlite/database-bootstrap.ts` |
| V4 | `BackupState` (racine, horloge `Arc<dyn Clock>`, `restart_pending`) est géré dans le `setup` du plugin `homebase-backup`, avant la création de la fenêtre ; le fil principal est bloqué pendant `.setup()` de l'application et le front ne tourne pas encore | `backup/startup.rs` l. 329-372 ; `backup/mod.rs` |
| V5 | Aucune clé étrangère entre les tables de contenu (`dashboards` → `widget_instances` → `notes`, `todo_lists` → `todos`) et celles du planificateur (`reminders`, `reminder_deliveries`, `time_sessions`, `habits`, `habit_checks`) ; le Rust n'écrit `dashboards`, `widget_instances`, `settings` que dans `backup/config_transfer.rs` et `backup/dashboard_delete.rs` | `migrations/V1`…`V8` ; grep Rust |
| V6 | Outils Rust réutilisables : `backup::names::{is_uuid_shape, hb_trim}` (union des espaces de `trim()` JS et Rust), `backup::config_transfer::is_secret_setting_key` (pub), `is_setting_key_shape` et `is_dashboard_icon_shape` (privés), `time::formats::format_instant`, `time::clock::{Clock, FixedClock}`, `backup::test_support::make_database(path, version, rows)` (vraies migrations) | fichiers cités |
| V7 | `capability_tests.rs` compare la liste exacte de `default.json`, mais pas celle de `debug.json` ; la CSP n'est contrôlée que par `contains("connect-src …")` | `src/capability_tests.rs` |
| V8 | `scripts/check-initial-bundle.mjs` cherche `FROM todos`, `FROM notes`, `FROM shortcuts` et **échoue** si ces motifs n'existent nulle part dans `dist` (garde « motif obsolète ») : il cassera quand le SQL quittera le front | `apps/web/scripts/check-initial-bundle.mjs` |
| V9 | Toutes les méthodes des 6 dépôts ont au moins un appelant de production. Les widgets ne testent que `conflict` et `not_found` sur les erreurs de ces dépôts ; `constraint` et `invalid_input` ne sont distingués que dans les specs et les fakes | Grep (`'conflict'`, `'constraint'`…) hors `data/` |
| V10 | 131 cas de test dans `data/sqlite/*.spec.ts` (dont 41 pour les tâches, 17 pour la recherche) décrivent le contrat observable des dépôts | Grep `it(` |
| V11 | Budget : avertissement à 500 kB sur l'initial (`angular.json`), initial à 488,35 kB après l'arbitrage R5 ; la CI lance `web:check-bundle` après `npm run build` | `angular.json`, ROADMAP phase 2, `.github/workflows/ci.yml` |
| V12 | `invokeCommand` traduit `{ kind }` en `DataError` (`invalid_input`, `time` → `invalid_input` ; `not_found` ; `conflict`, `already_running` → `conflict` ; `limit_reached` → `forbidden` ; `busy` ; sinon `unknown`) ; hors Tauri : `unavailable` | `data/tauri/invoke-command.ts` |

### 2.2 Supposés (à vérifier ; si faux : s'arrêter et rapporter)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Sans permission `sql:*` dans une capability, `invoke('plugin:sql|select' / 'execute' / 'load' / 'close')` est refusé par l'ACL de Tauri 2 (la doc ne le dit pas en toutes lettres) | MC1 |
| S2 | Une erreur de désérialisation d'argument arrive au front sous forme de chaîne commençant par ``invalid args ` `` (affichage de `tauri::Error::InvalidArgs`) | MC1 ; si faux, l'adaptateur TS pré-valide les nombres (repli §4.3) |
| S3 | Ouvrir une connexion sqlx par commande coûte peu : médiane de `widget_list` < 15 ms sur le PC de Marius | PV1, MC7 |
| S4 | Passer en WAL depuis une connexion Rust fonctionne alors que le pool du plugin garde des connexions inactives (c'est déjà le cas aujourd'hui, par ce même pool, et les bases existantes sont déjà en WAL) | TC1, MC3 |
| S5 | Retirer le paquet npm n'a aucun effet sur le plugin Rust (preload) | TC4, MC2 |

---

## 3. Inventaire des accès SQL du front et remplacement

### 3.1 Dépôts (`data/sqlite/*.repository.ts`)

| Dépôt et méthode | SQL actuel (résumé) | Appelants de production | Commande Rust |
|---|---|---|---|
| `SettingsRepository.get(key)` | `SELECT value FROM settings WHERE key = $1` | `dashboard-list.store` (`dashboard.last`), `time/time-zone.ts`, `theme/settings-theme-preference.store` | `setting_get` |
| `.getAll()` | `SELECT key, value … ORDER BY key` | `backup/config-transfer.service` (export) | `setting_list` |
| `.set(key, value)` | `INSERT … ON CONFLICT (key) DO UPDATE` | idem `get` | `setting_set` |
| `.remove(key)` | `DELETE FROM settings WHERE key = $1` | `time-zone.ts` | `setting_delete` |
| `DashboardRepository.list()` | `SELECT … ORDER BY sort_order, created_at, id` | `dashboard-list.store`, `dashboard.store`, `config-transfer.service` | `dashboard_list` |
| `.get(id)` | `SELECT … WHERE id = $1` | `dashboard.store.open` | `dashboard_get` |
| `.create(input)` | `INSERT … SELECT COALESCE(MAX(sort_order) + 1, 0)` | `dashboard-list.store.create` (barre latérale) | `dashboard_create` |
| `.createIfNone(input)` | `INSERT … WHERE NOT EXISTS (SELECT 1 FROM dashboards)` | `dashboard-list.store.load`, `dashboard.store.open` | `dashboard_ensure_default` |
| `.update(id, patch)` | `UPDATE dashboards SET name, icon` | `dashboard-list.store.update` | `dashboard_update` |
| `.updateTheme(id, theme, v)` | `UPDATE dashboards SET theme, theme_version` | `dashboard-list.store.updateTheme` | `dashboard_update_theme` |
| `.remove(id)` | `DELETE FROM dashboards WHERE id = $1` (**sans sauvegarde**) | `dashboard-list.store.discardEmpty` ← `dashboard.component.moveUnplaced` | **supprimée** (T3) ; remplacée par `dashboard_create_with_widgets` |
| `WidgetInstanceRepository.listByDashboard(id)` | `SELECT … ORDER BY grid_y, grid_x, created_at, id` | `dashboard.store.open`, `dashboard-list.store.countWidgets`, `config-transfer.service` | `widget_list` |
| `.get(id)` | `SELECT … WHERE id = $1` | `dashboard/widget-focus.ts` | `widget_get` |
| `.create(input)` | `INSERT INTO widget_instances …` | `dashboard.store` (ajout) | `widget_create` |
| `.updateConfig(id, config, v)` | `UPDATE … SET config, config_version` | `dashboard.store` (`ctx.updateConfig` des widgets) | `widget_update_config` |
| `.updateLayout(dashboardId, items)` | `UPDATE … FROM json_each($2)` (`UPDATE_LAYOUT_SQL`) | `dashboard.store.drainLayout` | `widget_update_layout` |
| `.moveToDashboard(target, items)` | `UPDATE … FROM json_each($2)` (`MOVE_TO_DASHBOARD_SQL`) | `dashboard.store.moveUnplacedTo` | **supprimée** (T3) ; absorbée par `dashboard_create_with_widgets` |
| `.findFirstOfType(type)` | `SELECT … JOIN dashboards … LIMIT 1` | `search/search-hotkey.ts` | `widget_find_first_of_type` |
| `.remove(id)` | `DELETE FROM widget_instances WHERE id = $1` (cascade notes, listes, tâches) | `dashboard.store` ← `widget-host.component` | `widget_delete` |
| `NoteRepository.get / create / update / remove` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` sur `notes` | `widgets/notes/notes.component.ts` | `note_get`, `note_create`, `note_update`, `note_delete` |
| `.search(query, limit)` | `LIKE … ESCAPE '\'` titre/corps (`SEARCH_NOTES_SQL`) | `search/search.service.ts` | `note_search` |
| `ShortcutRepository.list / create / update / remove` | sur `shortcuts` | `widgets/shortcuts/shortcuts.component.ts` | `shortcut_list`, `shortcut_create`, `shortcut_update`, `shortcut_delete` |
| `.reorder(ids)` | `UPDATE … FROM json_each($1)` (`REORDER_SHORTCUTS_SQL`) | idem | `shortcut_reorder` |
| `.search(query, limit)` | `SEARCH_SHORTCUTS_SQL` | `search.service.ts` | `shortcut_search` |
| `TodoRepository.getListForInstance(id)` | `SELECT … FROM todo_lists WHERE widget_instance_id = $1` | `widgets/todo/todo.component.ts`, `calendar-debug.ts` | `todo_list_for_widget` |
| `.createList(input)` | `INSERT INTO todo_lists` | `todo.component.ts` | `todo_list_create` |
| `.listTodos(listId)` | `SELECT … ORDER BY (completed_at IS NOT NULL), …` | `todo.component.ts`, `calendar-debug.ts` | `todo_list_items` |
| `.create(input)` | `INSERT … SELECT COALESCE(MAX(sort_order) + 1, 0) … WHERE list_id` | `todo.component.ts`, `calendar-debug.ts` | `todo_create` |
| `.update(id, changes)` | `UPDATE … COALESCE / CASE` (une instruction) | `todo-detail.component.ts`, `calendar-debug.ts` | `todo_update` |
| `.shiftRepeatDue(id, from, to)` | `UPDATE … WHERE due_on = $2 AND rrule IS NOT NULL AND completed_at IS NULL` puis `SELECT 1` | `todo.component.ts` | `todo_shift_repeat_due` |
| `.setCompleted(id, completed)` | `UPDATE … CASE` (fin de liste si décochée) | `todo.component.ts` | `todo_set_completed` |
| `.remove(id)` | `DELETE FROM todos` | `todo.component.ts`, `todo-detail.component.ts`, `calendar-debug.ts` | `todo_delete` |
| `.listDue(range, limit)` | `LIST_DUE_SQL` | `widgets/todo/todo.calendar-source.ts` | `todo_due` |
| `.listOverdueBefore(on, limit)` | `LIST_OVERDUE_BEFORE_SQL` | idem | `todo_overdue` |
| `.listRepeatingDueBy(on, limit)` | `LIST_REPEATING_DUE_BY_SQL` | idem | `todo_repeating_due` |
| `.reorder(listId, ids)` | `REORDER_TODOS_SQL` | `todo.component.ts` | `todo_reorder` |
| `.clearCompleted(listId)` | `DELETE … WHERE list_id = $1 AND completed_at IS NOT NULL` | `todo.component.ts` | `todo_clear_completed` |
| `.search(query, limit)` | `SEARCH_TODOS_SQL` (jointure `todo_lists`) | `search.service.ts` | `todo_search` |

Total : **43 nouvelles commandes** (réglages 4, tableaux 7, instances 7, notes 5, raccourcis 6, tâches 14). `dashboard_delete` existe déjà.

### 3.2 Hors dépôts

| Accès | Aujourd'hui | Après |
|---|---|---|
| Migrations | plugin, côté Rust (`preload`) | inchangé (T2-A) ; le front n'a jamais eu `allow-load` |
| `PRAGMA journal_mode = WAL` + relecture | front, `initDatabase` au démarrage | Rust, `data::bootstrap::ensure_wal` dans `.setup()` (§4.6) |
| Journal de développement (`sqlite_version`, version de migration) | front, `console.info` si `isDevMode` | Rust, `eprintln!` en build debug seulement |
| `DataLayerHealth` / `GuardedSqlExecutor` (erreur de démarrage mémorisée) | front | supprimés ; hors Tauri, `invokeCommand` lève déjà `unavailable` |
| Recherche globale (`Ctrl+K`, widget Recherche) | 3 dépôts × `LIKE` | `note_search`, `shortcut_search`, `todo_search` ; `validSearch` et `likeContains` passent en Rust ; `excerptAround` reste dans le front (T9) |
| Outils de debug du calendrier (`calendar-debug.ts`, dev seulement) | dépôts seulement | inchangés (passent par les commandes) |
| Export de configuration | dépôts (`list`, `listByDashboard`, `getAll`) | inchangé (passe par les commandes) ; format identique |
| Import de configuration, suppression de tableau, sauvegarde, restauration | déjà Rust | inchangés |
| Rappels, sessions, habitudes | déjà Rust (`data/tauri/`) | inchangés |
| SQL de test (`data/testing/**`, `migrations.spec.ts`, `sql-time-checks.spec.ts`) | better-sqlite3, jamais embarqué | conservé (T5) |

---

## 4. Conception

### 4.1 Principes
1. **Frontière** : le front ne contient plus aucun SQL de production ; chaque dépôt TS de `data/` devient un adaptateur `data/tauri/tauri-<x>.repository.ts` sur le modèle de `tauri-habit.repository.ts`.
2. **Port à l'identique** : chaque méthode garde sa sémantique (ordre, idempotence, valeurs renvoyées, `DataErrorKind`), décrite par la JSDoc de `repositories.ts` et par les 131 cas de `data/sqlite/*.spec.ts`. Chaque cas devient un test Rust. Les seuls écarts sont la liste fermée du §4.9.
3. **Rust valide** : les contrôles TS existants sont portés tels quels en Rust (même ordre, même `kind`), plus les garde-fous IPC du §4.4. L'adaptateur TS ne fait que sérialiser (`JSON.stringify` des objets JSON opaques, liaison `true`/`false`) et désérialiser (`parseJsonObject`, `parseJsonValue`). La contrainte `CHECK` reste le filet (`constraint`).
4. **Le SQL est repris** des constantes et chaînes des dépôts TS (`$N` → `?N`), avec les mêmes tris et les mêmes instructions uniques ; il n'est pas réécrit.
5. **Identifiants** : UUID v4 minuscules générés par le front (`IdGenerator`), comme aujourd'hui (ADR-002 §3.3) et comme les habitudes ; Rust vérifie la forme (`is_uuid_shape`). **Horodatages** : horloge Rust (`BackupState.clock`, `format_instant`), comme V7/V8.

### 4.2 Rust : module `data`

```
src/data/mod.rs          DataCtx, connect/close, macro with_conn!, constantes, déclaration des sous-modules
src/data/error.rs        DataError (sérialisable) + From<sqlx::Error>
src/data/validate.rs     bornes et formes communes (§4.4) ; reçoit is_setting_key_shape, is_dashboard_icon_shape,
                         is_secret_setting_key déplacés de backup/config_transfer.rs (qui les importe)
src/data/bootstrap.rs    ensure_wal (§4.6)
src/data/search.rs       valid_search, like_contains
src/data/settings.rs     DTO, SQL, fonctions métier, 4 commandes
src/data/dashboards.rs   7 commandes (dashboard_delete reste dans backup/)
src/data/widgets.rs      7 commandes
src/data/notes.rs        5 commandes
src/data/shortcuts.rs    6 commandes
src/data/todos.rs        14 commandes
src/data/tests/{settings,dashboards,widgets,notes,shortcuts,todos,search,error,bootstrap}_tests.rs
```

Règle : le SQL sur `settings`, `dashboards`, `widget_instances` n'existe que dans `data/{settings,dashboards,widgets}.rs` et dans les fichiers `backup/` déjà existants (`config_transfer.rs`, `dashboard_delete.rs`, et en lecture seule `sqlite.rs`, `validate.rs`) ; celui sur `notes`, `shortcuts`, `todo_lists`, `todos` n'existe que dans `data/{notes,shortcuts,todos}.rs` (hors tests).

```rust
// mod.rs
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_DASHBOARDS: i64 = 100;            // T6, = import
pub const MAX_WIDGETS_PER_DASHBOARD: i64 = 200; // T6
pub const MAX_WIDGETS: i64 = 1_000;             // T6
pub const MAX_SETTINGS: i64 = 200;              // T6
pub const MAX_BATCH: usize = 1_000;             // updateLayout, reorder

pub struct DataCtx {
    pub db: PathBuf,
    pub clock: Arc<dyn Clock>,
    pub busy_timeout: Duration,
    /// false once a restoration is staged (T7): every write returns `Unavailable` before any disk access.
    pub writes_allowed: bool,
}
impl DataCtx {
    pub fn from_backup(state: &BackupState) -> Self; // db = root.db(), clock cloné, BUSY_TIMEOUT, !is_restart_pending()
    pub fn now(&self) -> String;                    // format_instant(self.clock.now())
    pub fn ensure_writable(&self) -> Result<(), DataError>;
}
/// Même options que schedule::store::connect_with_timeout : create_if_missing(false),
/// busy_timeout, foreign_keys(true) (cascades). Jamais de journal_mode ici.
pub async fn connect(ctx: &DataCtx) -> Result<SqliteConnection, DataError>;
pub async fn close(conn: SqliteConnection);
/// Comme `locked!` (schedule/mod.rs) mais sans verrou : ouvre, exécute le corps, ferme.
macro_rules! with_conn { ($ctx:expr, $conn:ident => $body:expr) => { … } }
```
- `backup/mod.rs` : ajouter `pub fn is_restart_pending(&self) -> bool` à `BackupState`.
- Chaque commande : `#[tauri::command] pub async fn x(backup: State<'_, BackupState>, …) -> Result<…, DataError>` qui construit `DataCtx::from_backup(&backup)` et appelle une fonction métier `pub(crate) async fn …(ctx: &DataCtx, …)` testée sans Tauri. Toute fonction d'écriture appelle `ctx.ensure_writable()?` **en premier**, puis valide, puis touche au disque.
- **Transactions** (T4) : une instruction unique (la règle actuelle) n'a pas besoin de transaction explicite. Toute écriture de plusieurs instructions, ou toute lecture suivie d'une écriture qui en dépend (contrôle de limite, `todo_shift_repeat_due`, `dashboard_create_with_widgets`), s'exécute dans `conn.begin_with("BEGIN IMMEDIATE")` puis `commit` ; l'erreur annule (`rollback` implicite au `drop`, explicite si la connexion est réutilisée ensuite). La relecture après écriture (DTO renvoyé) se fait sur la **même** connexion, après le `commit`.
- **Concurrence** : pas de verrou applicatif (T4). Planificateur : tables disjointes (V5). Sauvegarde `VACUUM INTO` : instantané cohérent en WAL, les écritures continuent. Import de configuration : `BEGIN IMMEDIATE` ; une commande concurrente attend jusqu'à 5 s puis `busy` ; le front recharge la page après l'import. `dashboard_delete` : inchangé (sous le drapeau de sauvegarde, garde « jamais le dernier » dans l'instruction).
- Aucun `unwrap()`, aucun `Timestamp::now()`, aucune valeur concaténée dans du SQL, aucun `PRAGMA` hors `bootstrap.rs`.

### 4.3 Erreurs

```rust
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DataError {
    InvalidInput { field: String }, // camelCase, chemin pointé (ex. "grid.w", "items")
    NotFound,
    Conflict,      // id déjà pris, index unique, comparer-et-écrire raté
    Constraint,    // FK absente, CHECK, NOT NULL, type STRICT
    Forbidden,     // clé de réglage « secrète »
    LimitReached,  // T6
    Busy,
    CorruptData,   // décodage d'une ligne impossible
    Unavailable,   // restauration armée (T7), base introuvable
    Database,      // autre ; journalisé par son code seulement
}
```
`From<sqlx::Error>` (sur le modèle de `ScheduleError`, journalisation du **code seul**, jamais du message ni des valeurs) :

| Cas sqlx | `DataError` |
|---|---|
| code étendu `& 0xFF` = 5 (BUSY) ou 6 (LOCKED) | `Busy` |
| 1555 (PRIMARYKEY), 2067 (UNIQUE) | `Conflict` |
| autre code `& 0xFF` = 19 (787 FK, 275 CHECK, 1299 NOT NULL, 3091 DATATYPE…) | `Constraint` |
| `& 0xFF` = 14 (CANTOPEN) | `Unavailable` |
| `Error::ColumnDecode`, `Decode`, `ColumnNotFound` | `CorruptData` |
| tout le reste | `Database` |

Front, `data/tauri/invoke-command.ts` : `KIND_MAP` gagne `constraint` → `constraint`, `forbidden` → `forbidden`, `corrupt_data` → `corrupt_data`, `unavailable` → `unavailable` (`limit_reached` → `forbidden` existe déjà ; `database` tombe sur `unknown`). Nouvelle règle : une erreur qui est une **chaîne** commençant par ``invalid args ` `` (désérialisation d'un argument : nombre non entier, champ inconnu, type faux, S2) devient `invalid_input`. Repli si S2 est faux : l'adaptateur TS vérifie `Number.isSafeInteger` des champs numériques avant `invoke` et lève `invalid_input` (ne pas improviser autre chose : rapporter).

### 4.4 Validation commune (`data/validate.rs`)

Les longueurs comptent les **unités UTF-16** (`s.encode_utf16().count()`) partout où le dépôt TS comptait `.length`, pour garder exactement le contrat actuel ; les plafonds IPC comptent les octets. `trim` = `backup::names::hb_trim`.

| Entrée | Règle (ordre du dépôt TS) | Erreur |
|---|---|---|
| id d'une **création** | `is_uuid_shape` | `invalid_input { field: "id" }` |
| id de lecture, mise à jour, suppression | aucune ; un id mal formé ne désigne aucune ligne : `get` → `null`, `delete` → `false`, `update` → `not_found` | — |
| nom de tableau | trim, 1..=100 | `invalid_input { field: "name" }` |
| icône | `is_dashboard_icon_shape` (`^[a-z][a-z0-9-]{0,31}$`) ; absente → `th-large` | `invalid_input { field: "icon" }` |
| thème (`themeJson`) | version entière 1..=2^53−1 ; texte commençant par `{` ; profondeur ≤ 100 (portage de `jsonDepth`) ; ≤ 4 096 points de code ; absent → `{}` / version 1 | `invalid_input { field: "theme" \| "themeVersion" }` |
| rectangle de grille | entiers, `x, y` 0..=10 000, `w, h` 1..=10 000 (bornes de l'import) | `invalid_input { field: "grid" }` |
| lot (`items`, `ids`) | vide → 0 / rien, **sans** accès disque ; ≤ 1 000 ; ids distincts | `invalid_input { field: "items" \| "ids" }` |
| `configJson`, `valueJson` | ≤ 262 144 octets (plafond IPC) ; le reste (JSON valide, objet, ≤ 65 536 caractères) est le `CHECK` | `invalid_input` au-delà du plafond, sinon `constraint` |
| clé de réglage (`setting_set`) | 1) secrète (`is_secret_setting_key`) ; 2) forme (`is_setting_key_shape`) | 1) `forbidden` ; 2) `invalid_input { field: "key" }` |
| clé de réglage (`setting_get`, `setting_delete`) | aucune ; une clé hors forme renvoie `null` / `false` | — |
| titre de note ≤ 200, corps ≤ 100 000 | unités UTF-16 ; plafond IPC 400 000 octets pour le corps | `invalid_input { field: "title" \| "body" }` |
| libellé de raccourci | trim, 1..=80 | `invalid_input { field: "label" }` |
| URL de raccourci | ≤ 2 048 et commence par `http://` ou `https://` (sensible à la casse, comme `/^https?:\/\//`) | `invalid_input { field: "url" }` |
| nom de liste | trim, 1..=80 | `invalid_input { field: "name" }` |
| titre de tâche | trim, 1..=500 | `invalid_input { field: "title" }` |
| date (`dueOn`, `fromOn`, `toOn`, `beforeOn`) | **forme** `YYYY-MM-DD` seulement ; une date bien formée mais impossible (`2026-02-30`) est refusée par le `CHECK` (`constraint`), comme aujourd'hui | `invalid_input { field }` |
| description | ≤ 10 000 unités UTF-16 (`TODO_DESCRIPTION_MAX`), conservée telle quelle (pas de trim) | `invalid_input { field: "description" }` |
| règle (`rrule`) | `null` ou 10..=256 et commence par `FREQ=` | `invalid_input { field: "rrule" }` |
| recherche | trim 1..=200 ; `limit` 1..=20 | `invalid_input { field: "query" \| "limit" }` |
| `limit` des échéances | 1..=1 000 | `invalid_input { field: "limit" }` |
| type de widget (`widget_find_first_of_type`) | aucune ; > 64 caractères → `null` | — |

### 4.5 Commandes par domaine

DTO en camelCase, `#[serde(deny_unknown_fields)]` en entrée. Les objets JSON opaques circulent **en texte** (`configJson`, `themeJson`, `valueJson`) : Rust stocke le texte reçu tel quel (octets identiques à aujourd'hui) et renvoie le texte stocké ; l'adaptateur TS sérialise et désérialise (un JSON corrompu en base donne toujours `corrupt_data` côté front). Les booléens sont liés en `1`/`0` par sqlx.

#### 4.5.1 Réglages (`data/settings.rs`)
```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct SettingDto { pub key: String, pub value_json: String }
pub async fn setting_get(backup, key: String) -> Result<Option<String>, DataError>;   // valueJson
pub async fn setting_list(backup) -> Result<Vec<SettingDto>, DataError>;             // ORDER BY key
pub async fn setting_set(backup, key: String, value_json: String) -> Result<(), DataError>;
pub async fn setting_delete(backup, key: String) -> Result<bool, DataError>;
```
`setting_set` : contrôles §4.4 ; `BEGIN IMMEDIATE` ; upsert de `SqliteSettingsRepository.set` ; puis `COUNT(*) > MAX_SETTINGS` → `LimitReached` (annulé ; une clé existante ne fait jamais dépasser). `created_at` conservé, `updated_at = now`.

#### 4.5.2 Tableaux (`data/dashboards.rs`)
```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DashboardNewDto { pub id: String, pub name: String, pub icon: Option<String>,
    pub theme_json: Option<String>, pub theme_version: Option<i64> }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct DashboardDto { pub id: String, pub name: String, pub sort_order: i64, pub icon: String,
    pub theme_json: String, pub theme_version: i64, pub created_at: String, pub updated_at: String }
#[derive(Deserialize, Serialize, Clone, Copy)] #[serde(deny_unknown_fields)]
pub struct GridDto { pub x: i64, pub y: i64, pub w: i64, pub h: i64 }
#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutItemDto { pub id: String, pub grid: GridDto }
#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DashboardWithWidgetsDto { pub dashboard: DashboardNewDto, pub source_dashboard_id: String,
    pub items: Vec<LayoutItemDto> }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct DashboardWithWidgetsResult { pub dashboard: DashboardDto, pub moved: u32 }

pub async fn dashboard_list(backup) -> Result<Vec<DashboardDto>, DataError>;
pub async fn dashboard_get(backup, id: String) -> Result<Option<DashboardDto>, DataError>;
pub async fn dashboard_create(backup, input: DashboardNewDto) -> Result<DashboardDto, DataError>;
pub async fn dashboard_ensure_default(backup, input: DashboardNewDto) -> Result<bool, DataError>;
pub async fn dashboard_update(backup, id: String, name: String, icon: String) -> Result<DashboardDto, DataError>;
pub async fn dashboard_update_theme(backup, id: String, theme_json: String, theme_version: i64) -> Result<DashboardDto, DataError>;
pub async fn dashboard_create_with_widgets(backup, input: DashboardWithWidgetsDto) -> Result<DashboardWithWidgetsResult, DataError>;
```

| Commande | Contrôles (ordre) | Effet |
|---|---|---|
| `dashboard_list`, `dashboard_get` | — | SQL de `SqliteDashboardRepository` |
| `dashboard_create` | id, nom, icône, thème | `BEGIN IMMEDIATE` ; `INSERT … SELECT COALESCE(MAX(sort_order) + 1, 0)` ; id existant → `Conflict` ; puis `COUNT(*) > 100` → `LimitReached` ; `commit` ; relecture |
| `dashboard_ensure_default` | id, nom, icône, thème (validé même si rien n'est inséré) | `INSERT … WHERE NOT EXISTS (SELECT 1 FROM dashboards)` ; `true` si créé |
| `dashboard_update` | nom, icône | une instruction ; 0 ligne → `NotFound` ; ne touche pas au thème |
| `dashboard_update_theme` | thème, version | une instruction ; 0 ligne → `NotFound` |
| `dashboard_create_with_widgets` (T3) | `dashboard` comme `dashboard_create` ; `sourceDashboardId` (forme UUID, sinon `invalid_input`) ; `items` non vide (vide → `invalid_input { field: "items" }`), ≤ 200, ids distincts, rectangles §4.4 | voir ci-dessous |

`dashboard_create_with_widgets`, dans **une** transaction `BEGIN IMMEDIATE` :
```sql
INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
SELECT ?1, ?2, COALESCE(MAX(sort_order) + 1, 0), ?3, ?4, ?5, ?6, ?6 FROM dashboards;
-- puis : SELECT COUNT(*) FROM dashboards  > 100 → LimitReached (annulation)
UPDATE widget_instances
SET dashboard_id = ?1, grid_x = j.x, grid_y = j.y, grid_w = j.w, grid_h = j.h, updated_at = ?3
FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.x') AS x, json_extract(value, '$.y') AS y,
             json_extract(value, '$.w') AS w, json_extract(value, '$.h') AS h
      FROM json_each(?2)) AS j
WHERE widget_instances.id = j.id AND widget_instances.dashboard_id = ?4;
-- 0 ligne déplacée → Conflict (annulation : aucun tableau créé)
```
Le JSON de `json_each` est produit par Rust (`serde_json::to_string`) à partir des éléments **validés**, jamais recopié de l'entrée. La restriction `dashboard_id = source` empêche de déplacer l'instance d'un autre tableau (état périmé du front). Renvoie le tableau relu et le nombre de widgets déplacés.

#### 4.5.3 Instances de widget (`data/widgets.rs`)
```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WidgetNewDto { pub id: String, pub dashboard_id: String, pub widget_type: String,
    pub grid: GridDto, pub config_json: String, pub config_version: i64 }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct WidgetDto { pub id: String, pub dashboard_id: String, pub widget_type: String, pub grid: GridDto,
    pub config_json: String, pub config_version: i64, pub created_at: String, pub updated_at: String }

pub async fn widget_list(backup, dashboard_id: String) -> Result<Vec<WidgetDto>, DataError>;
pub async fn widget_get(backup, id: String) -> Result<Option<WidgetDto>, DataError>;
pub async fn widget_create(backup, input: WidgetNewDto) -> Result<WidgetDto, DataError>;
pub async fn widget_update_config(backup, id: String, config_json: String, config_version: i64) -> Result<WidgetDto, DataError>;
pub async fn widget_update_layout(backup, dashboard_id: String, items: Vec<LayoutItemDto>) -> Result<u32, DataError>;
pub async fn widget_find_first_of_type(backup, widget_type: String) -> Result<Option<WidgetDto>, DataError>;
pub async fn widget_delete(backup, id: String) -> Result<bool, DataError>;
```

| Commande | Contrôles (ordre) | Effet |
|---|---|---|
| `widget_list`, `widget_get`, `widget_find_first_of_type` | — | SQL de `SqliteWidgetInstanceRepository` (mêmes tris) |
| `widget_create` | id ; plafond de `configJson` ; rectangle **non** contrôlé en amont (contrat actuel : le `CHECK` décide, `constraint`) | `BEGIN IMMEDIATE` ; `INSERT` (FK absente → `Constraint`, id pris → `Conflict`) ; puis instances du tableau > 200 ou total > 1 000 → `LimitReached` ; `commit` ; relecture |
| `widget_update_config` | plafond | une instruction ; 0 ligne → `NotFound` |
| `widget_update_layout` | lot §4.4 (vide → `Ok(0)` sans disque ; doublon, rectangle invalide, > 1 000 → `invalid_input`) | `UPDATE_LAYOUT_SQL` ; renvoie le nombre de lignes |
| `widget_delete` | — | une instruction (cascade notes, listes, tâches) ; `false` si absente |

#### 4.5.4 Notes (`data/notes.rs`)
```rust
pub struct NoteNewDto { pub id: String, pub widget_instance_id: Option<String>, pub title: String, pub body: String } // deny_unknown_fields
pub struct NoteDto { pub id: String, pub widget_instance_id: Option<String>, pub title: String, pub body: String,
    pub created_at: String, pub updated_at: String }
pub struct NoteHitDto { pub id: String, pub title: String, pub body: String, pub widget_instance_id: Option<String> }
note_get(id) -> Option<NoteDto>; note_create(input) -> NoteDto; note_update(id, title, body) -> NoteDto;
note_delete(id) -> bool; note_search(query, limit: u32) -> Vec<NoteHitDto>
```
Contrôles et SQL de `SqliteNoteRepository` (titre et corps par défaut `''` côté adaptateur ; instance absente → `Constraint`). `note_search` : `valid_search`, `like_contains` (échappe `\`, `%`, `_`), `SEARCH_NOTES_SQL`.

#### 4.5.5 Raccourcis (`data/shortcuts.rs`)
```rust
pub struct ShortcutNewDto { pub id: String, pub label: String, pub url: String }
pub struct ShortcutDto { pub id: String, pub label: String, pub url: String, pub sort_order: i64,
    pub created_at: String, pub updated_at: String }
shortcut_list() -> Vec<ShortcutDto>; shortcut_create(input) -> ShortcutDto;
shortcut_update(id, label, url) -> ShortcutDto; shortcut_delete(id) -> bool;
shortcut_reorder(ids: Vec<String>) -> (); shortcut_search(query, limit: u32) -> Vec<ShortcutDto>
```
SQL et contrôles de `SqliteShortcutRepository` ; `shortcut_reorder` : lot §4.4, `REORDER_SHORTCUTS_SQL` (seules les lignes dont l'ordre change sont écrites).

#### 4.5.6 Tâches (`data/todos.rs`)
```rust
pub struct TodoListNewDto { pub id: String, pub widget_instance_id: Option<String>, pub name: String }
pub struct TodoListDto { pub id: String, pub widget_instance_id: Option<String>, pub name: String,
    pub created_at: String, pub updated_at: String }
pub struct TodoNewDto { pub id: String, pub list_id: String, pub title: String, pub due_on: Option<String> }
/// Champ absent = inchangé ; `null` = effacer (dueOn, rrule). Désérialiseur « présent » :
/// fn present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error> { Option::<T>::deserialize(d).map(Some) }
pub struct TodoChangesDto {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "present")] pub due_on: Option<Option<String>>,
    pub description: Option<String>,
    #[serde(default, deserialize_with = "present")] pub rrule: Option<Option<String>>,
    pub important: Option<bool>,
}
pub struct TodoDto { pub id: String, pub list_id: String, pub title: String, pub description: String,
    pub due_on: Option<String>, pub rrule: Option<String>, pub important: bool, pub completed_at: Option<String>,
    pub sort_order: i64, pub created_at: String, pub updated_at: String }
pub struct TodoHitDto { pub id: String, pub title: String, pub description: String, pub list_id: String,
    pub widget_instance_id: Option<String>, pub completed_at: Option<String> }

todo_list_for_widget(widget_instance_id) -> Option<TodoListDto>
todo_list_create(input: TodoListNewDto) -> TodoListDto        // instance absente → Constraint ; 2e liste → Conflict
todo_list_items(list_id) -> Vec<TodoDto>
todo_create(input: TodoNewDto) -> TodoDto                     // liste absente → Constraint
todo_update(id, changes: TodoChangesDto) -> TodoDto
todo_shift_repeat_due(id, from_due_on, to_due_on) -> TodoDto
todo_set_completed(id, completed: bool) -> TodoDto
todo_delete(id) -> bool
todo_due(from_on, to_on, limit: u32) -> Vec<TodoDto>
todo_overdue(before_on, limit: u32) -> Vec<TodoDto>
todo_repeating_due(to_on, limit: u32) -> Vec<TodoDto>
todo_reorder(list_id, ids: Vec<String>) -> ()
todo_clear_completed(list_id) -> u32
todo_search(query, limit: u32) -> Vec<TodoHitDto>
```
Contrôles, ordres et SQL de `SqliteTodoRepository`, en particulier : `todo_update` en **une** instruction (règle non nulle avec `dueOn: null` explicite → `invalid_input` avant le disque ; règle écrite sur une tâche sans échéance → `constraint` ; `dueOn: null` sans règle efface la règle) ; `todo_shift_repeat_due` dans `BEGIN IMMEDIATE` (`UPDATE` comparer-et-écrire, puis si 0 ligne : absente → `NotFound`, sinon `Conflict`) ; `todo_set_completed` (date de fin conservée si déjà cochée ; décochée → fin des actives) ; `todo_due` (`fromOn > toOn` avec deux formes valides → `invalid_input`).

### 4.6 Démarrage : migrations et WAL
- Migrations : **inchangées** (plugin, `preload`, T2-A). `db.rs`, `tauri.conf.json` et le test `preload_contains_db_url` restent.
- `data/bootstrap.rs` : `pub async fn ensure_wal(db: &Path) -> Result<String, DataError>` : connexion dédiée, `PRAGMA journal_mode = WAL` (lit la valeur renvoyée), renvoie le mode. En build debug (`#[cfg(debug_assertions)]`), `eprintln!` de `journal_mode`, `sqlite_version()` et `MAX(version)` de `_sqlx_migrations`.
- `lib.rs` `.setup()` : `on_app_ready` → **`data::bootstrap::at_startup(app.handle())`** → `tray::setup` → `schedule::start` → … `at_startup` lit `BackupState.root.db()`, exécute `ensure_wal` par `tauri::async_runtime::block_on`, et **ne renvoie jamais d'erreur** : un échec ou un mode différent de `wal` est journalisé (T8). Aucune commande ne peut s'exécuter avant (V4).

### 4.7 Front : `data/`

Fichiers de production après TC4 : `index.ts`, `models.ts`, `repositories.ts`, `json.ts`, `data-error.ts`, `clock.ts`, `time-formats.ts`, `search.ts` (ne garde que `excerptAround` et les constantes `SEARCH_QUERY_MAX`, `SEARCH_LIMIT_MAX`), `dashboard-theme-input.ts`, `data.providers.ts`, `content.tokens.ts`, `schedule.tokens.ts`, `tauri/**`.

- `data/tauri/wire.ts` (nouveau) : types des DTO (`DashboardWire`, `WidgetWire`, `NoteWire`, `TodoWire`…) et conversions vers les modèles (`theme: parseJsonObject(themeJson)`, `config: parseJsonObject(configJson)`, réglage : `parseJsonValue(valueJson)`) ; `corrupt_data` en cas d'échec (comportement de `row-mappers.ts`).
- `data/tauri/tauri-{settings,dashboard,widget-instance,note,shortcut,todo}.repository.ts` (nouveaux) : constructeur `(newId: IdGenerator)` ; une méthode = un `invokeCommand` ; arguments recopiés **champ par champ** (`deny_unknown_fields`) ; id généré si absent ; objets JSON sérialisés (`JSON.stringify` ; `undefined` → `invalid_input` avant l'appel ; thème par `validTheme`) ; `TodoChanges` : seules les clés définies sont envoyées ; recherche : `excerptAround(texte, hbTrim(query))` (`hbTrim` = `hb_trim` de Rust).
- `data/repositories.ts` : `DashboardRepository` perd `remove`, gagne `createWithWidgets(input: NewDashboard, sourceDashboardId: string, items: readonly LayoutItem[]): Promise<{ readonly dashboard: Dashboard; readonly moved: number }>` ; `WidgetInstanceRepository` perd `moveToDashboard`. JSDoc : retirer les mentions « one statement », « INSERT … SELECT » ; préciser « implémenté par commandes Rust (spec typed-data-commands) » et les `DataErrorKind` possibles (inchangés).
- `data/data.providers.ts` : fournit les trois dépôts Tauri ; plus d'`SQL_EXECUTOR`, plus d'initialiseur ; commentaire de `CLOCK` corrigé (les horodatages stockés viennent de l'horloge Rust ; `CLOCK` reste la source de « maintenant » pour l'affichage et les calculs du front).
- `data/content.tokens.ts` : fabriques `new TauriTodoRepository(randomUuid)`, etc. (toujours hors du barrel, chargées à la demande).
- `data/tauri/invoke-command.ts` : §4.3.
- Supprimés : `data/sqlite/**` (tous les fichiers et specs, après portage des cas en Rust), `data/sqlite/db-url.ts`. Déplacés vers `data/testing/` (test seulement) : `sql-executor.ts`, `sqlite/error-mapping.ts` (+ spec), utilisés par `NodeSqliteExecutor`.
- ESLint (`eslint.config.js`) : `@tauri-apps/plugin-sql` interdit **partout** (supprimer l'exception de `tauri-sql-executor.ts`) ; le reste inchangé.
- `apps/web/package.json` et `package-lock.json` : retirer `@tauri-apps/plugin-sql` (`npm uninstall @tauri-apps/plugin-sql --workspace=web`).

### 4.8 Débordement et suppression de tableau (T3)
- `DashboardStore.unplacedItems(): LayoutItem[]` : le calcul actuel de `moveUnplacedTo` (`fitLayout` des widgets sans place) sans écriture ; `DashboardStore.dropMoved(ids)` : retire les instances déplacées, sans garde de `token` : les ids ne désignent que des instances du tableau source, déplacées au commit, donc sans effet sur un autre tableau affiché, et une garde dégraderait le cas A → B → A.
- `DashboardListStore.createWithWidgets(input, sourceDashboardId, items)` : `DashboardLimitError` si 100 tableaux (comme `create`) ; appelle le dépôt ; ajoute le tableau renvoyé à la liste.
- `DashboardComponent.moveUnplaced()` : items vides → rien ; sinon `createWithWidgets` puis `dropMoved` ; `DashboardLimitError` ou `forbidden` → `dashboards.limit` ; toute autre erreur (dont `conflict`) → `dashboard.moveUnplacedError`. Plus de `createdId`, plus de `discardEmpty`.
- Supprimés : `DashboardListStore.discardEmpty`, `DashboardStore.moveUnplacedTo`, `DashboardRepository.remove`, `WidgetInstanceRepository.moveToDashboard` (+ fakes `core/testing/fake-dashboard.repository.ts`, `fake-widget-instance.repository.ts` et leurs specs mis à jour).
- **Seul chemin de suppression de tableau demandé par l'utilisateur** : `BackupService.deleteDashboard` → `dashboard_delete` (inchangé). Exception documentée : l'import de configuration supprime les tableaux absents du fichier, sous sa propre sauvegarde `pre-import`.

### 4.9 Écarts de contrat assumés (liste fermée)
1. Création avec un id mal formé : `invalid_input { field: "id" }` (avant : `constraint` du `CHECK`).
2. Horodatages fournis par l'horloge Rust (un `CLOCK` fourni au front n'agit plus sur `created_at` / `updated_at`).
3. Trim par `hb_trim` : retire aussi U+0085 (NEL), que `trim()` JS gardait.
4. Limites T6 (`limit_reached` → `forbidden`).
5. `moveToDashboard` et `DashboardRepository.remove` remplacés par `createWithWidgets` (T3), qui ne déplace que des instances du tableau source.
6. Écritures refusées (`unavailable`) quand une restauration est armée (T7).
7. `widget_update_layout` : mêmes bornes de grille que l'import (`x`, `y` dans 0..=10 000, `w`, `h` dans 1..=10 000) ; une valeur hors borne ou des ids en double donnent `invalid_input` avec le champ `items` (lot trop long, doublons) ou `grid` (rectangle).
8. Bornes alignées sur l'import de configuration (principe : tout export est réimportable, donc toute valeur acceptée par une commande l'est par l'import ; validateurs partagés dans `data/validate.rs`) : `widget_create` refuse un `widgetType` hors 1..=64 points de code ou contenant NUL, une grille hors 0..=10 000 (`grid`) et un `configVersion` hors 1..=10 000 ; `widget_update_config` refuse un `configVersion` hors 1..=10 000 ; la version de thème est bornée à 10 000 (et non plus 2^53-1) ; un nom de tableau contenant NUL est refusé. Avant : le `CHECK` décidait (`constraint`), ou rien (versions, NUL).
9. Textes des notes, raccourcis et tâches (lot TC3) : les longueurs sont contrôlées en Rust (unités UTF-16) avant le disque, donc un NUL ne contourne plus le `CHECK length()` ; le NUL lui-même reste permis (le front ne l'interdit pas), sauf si `length(trim())` rendrait la valeur vide (`constraint`). L'import de configuration ne couvre pas ces données : rien à aligner.
10. Erreurs de date des tâches : la plage 1900-01-01..=2199-12-31 n'est pas un écart (le `hasLocalDateShape` du TS la bornait déjà) ; une date hors plage donne `invalid_input`, une date bien formée mais impossible (`2026-02-30`) donne `constraint`. Le seul écart est le nom du `field`, qui reprend celui de l'argument (`fromOn`, `toOn`, `beforeOn`, `fromDueOn`, `toDueOn`) ; pour `todo_due`, `fromOn > toOn` donne `field: "toOn"`.
11. `shortcut_reorder` et `todo_reorder` : les `ids` ne sont pas contrôlés en forme (comme le TS), seulement distincts, au plus 1 000, et chacun d'au plus 64 octets (un UUID en fait 36) ; au-delà, `invalid_input { field: "ids" }` avant le disque. Ils sont sérialisés par Rust avant d'être liés en paramètre.

À préserver (ce n'est pas un écart) : le texte `JSON.stringify` de `settings.value`, `config` et `theme` est stocké tel quel, octet pour octet comme aujourd'hui. Rust ne le désérialise ni ne le « normalise » : `serde_json` trierait les clés et écrirait `1.0` au lieu de `1`.

### 4.10 Enregistrement, capabilities, `build.rs`
- `build.rs` (`AppManifest::commands`), les **deux** `invoke_handler` de `lib.rs` (debug et release) et leurs tests (`commands_are_registered_in_both_invoke_handlers`, `build_rs_lists_the_commands`) : les 43 commandes du §3.1.
- `capabilities/default.json` : `allow-<commande en kebab-case>` pour chacune, dans l'ordre des domaines (réglages, tableaux, instances, notes, raccourcis, tâches), placées après `allow-habit-set-check` ; **retrait** de `sql:allow-execute` et `sql:allow-select` (TC4). Description : retirer « and the SQL plugin through invoke » ; ajouter « The data commands (setting_*, dashboard_*, widget_*, note_*, shortcut_*, todo_*) read and write only the settings, dashboards, widget_instances, notes, shortcuts, todo_lists and todos tables, with bound parameters and bounded, validated inputs. There is no sql:* permission: tauri-plugin-sql only runs the migrations from Rust (preload). »
- `capabilities/debug.json` : inchangé.
- `tauri.conf.json` : inchangé (CSP, `plugins.sql.preload`).

### 4.11 Tests et garde-fous

**Rust** (`npm run rust:test`) : base temporaire `make_database(&path, supported_schema_version(), false)`, `FixedClock`, `DataCtx` construit à la main. Pour chaque domaine, un test par cas des specs TS supprimées (correspondance listée dans le rapport de lot), plus :
- erreurs : mapping de chaque code du §4.3 à partir de vraies erreurs SQLite (doublon de PK, index unique, FK, CHECK, NOT NULL, `cannot store` STRICT), sérialisation `{"kind":"invalid_input","field":"name"}` ;
- DTO : camelCase exact, champ inconnu refusé (au moins un test par DTO d'entrée), `TodoChangesDto` (absent ≠ `null`) ;
- atomicité : `widget_update_layout` et `dashboard_create_with_widgets` avec un élément qui viole un `CHECK` (contourner la validation en appelant la fonction SQL interne) : aucune ligne modifiée, aucun tableau créé ;
- T3 : `dashboard_create_with_widgets` avec des ids d'un autre tableau → `Conflict`, aucun tableau créé ; succès → déplacés, horodatés, `moved` exact ;
- T6, T7 : chaque limite ; chaque commande d'écriture avec `writes_allowed = false` → `Unavailable`, base inchangée ;
- horodatages : `created_at` / `updated_at` = horloge fixée ;
- `bootstrap` : base créée en mode `DELETE` → `ensure_wal` renvoie `wal` ; deuxième appel idempotent ;
- `capability_tests.rs` (P1, P5) : liste exacte de `default.json` mise à jour ; **nouveau** `debug_capability_is_exact` (`windows == ["main"]`, permissions `== ["allow-schedule-test-notification", "core:webview:allow-internal-toggle-devtools"]`, ni `remote` ni `webviews`) ; **nouveau** `no_sql_plugin_permission` (aucun identifiant commençant par `sql:` et aucune sous-chaîne `"sql:` dans `default.json` et `debug.json`) ; **nouveau** `csp_is_exact` (égalité avec la chaîne actuelle de `tauri.conf.json`, et `dangerousDisableAssetCspModification == ["style-src"]`) remplace le `contains` de `csp_keeps_network_local` ; **nouveau** `front_has_no_sql_plugin_package` (`package.json` racine et `apps/web/package.json` ne contiennent pas `plugin-sql`) ; compteur des permissions de données (43) sur le modèle de `schedule_commands_add_no_plugin_permission`.

**Front** (`npm run test`) :
- `data/tauri/*.repository.spec.ts` (`vi.mock('@tauri-apps/api/core')`, modèle `tauri-habit.repository.spec.ts`) : nom et arguments exacts de chaque appel, conversion DTO → modèle, `corrupt_data` sur JSON corrompu, `unavailable` hors Tauri, `invalid_input` sur `undefined` non sérialisable ;
- `invoke-command.spec.ts` : nouvelles correspondances et chaîne ``invalid args ` `` ;
- `data/front-sql-guard.spec.ts` (remplace `schedule-sql-guard.spec.ts`, dont il garde les deux tests) : dans les sources de production (`src/**/*.ts` hors `*.spec.ts` et `data/testing/**`), aucune occurrence **sensible à la casse** de `SELECT `, `INSERT INTO`, `DELETE FROM`, `PRAGMA`, `ATTACH`, `VACUUM`, ni de `/UPDATE \w+ SET/`, ni de `plugin:sql`, ni d'import de `@tauri-apps/plugin-sql` ; test de pertinence des motifs comme l'actuel ;
- `data.providers.spec.ts`, `content.tokens.spec.ts` : réécrits sans SQL (les jetons fournissent les dépôts Tauri) ;
- stores et composants touchés par T3 (`dashboard-list.store.spec`, `dashboard.store.spec`, `dashboard.component.spec`) ;
- `test:data` (T5) : garde `migrations.spec.ts`, `sql-time-checks.spec.ts`, `testing/**`, `error-mapping.spec.ts` (déplacé), et les specs pures de `data/`.

**Bundle** (`scripts/check-initial-bundle.mjs`) : les motifs `FROM todos`, `FROM notes`, `FROM shortcuts` deviennent des noms de commandes propres aux dépôts paresseux : `todo_list_items`, `note_search`, `shortcut_reorder` (même garde « motif obsolète ») ; ajout d'une liste `FORBIDDEN_EVERYWHERE = ['plugin:sql']` cherchée dans **tous** les fichiers `.js` de `dist` (sans garde de pertinence). Commentaire d'en-tête mis à jour.

### 4.12 Bundle, exports, sauvegardes, migrations
- **Bundle** : l'initial perd `@tauri-apps/plugin-sql` et le SQL des dépôts de configuration, et gagne trois adaptateurs fins plus `invoke-command.ts` (`@tauri-apps/api/core` y est déjà, par `tauri-runtime.ts`). Effet attendu : légère baisse (supposé). Critère : initial ≤ valeur mesurée au début du lot + 1 kB, à chaque lot ; les deux valeurs dans le rapport. Les dépôts de contenu restent paresseux (garde CI).
- **Export de configuration** : même contenu, même format (`buildConfigExport` inchangé, lu par les nouvelles commandes). **Import** : inchangé (Rust) ; il partage désormais les validateurs de `data/validate.rs`.
- **Sauvegardes et restauration** : inchangées (fichiers, `VACUUM INTO`, validation de schéma) ; le WAL est réappliqué au démarrage qui suit une restauration (§4.6).
- **Migrations** : **aucune nouvelle migration**, aucun changement de `checksums.json`.

### 4.13 Sécurité (surface après TC4)
- Surface JS données : 43 + 1 commandes typées (plus celles des rappels, sessions, habitudes) ; aucune permission `sql:*`, `fs:*`, `core:*` ajoutée. Aucune entrée n'est un chemin, une URL de fichier, un nom de table ou un fragment SQL (P2). `like_contains` échappe les jokers ; tris en dur.
- Résiduel accepté : un XSS peut lire toutes les données affichables et appeler les commandes destructrices sans sauvegarde (`widget_delete` et sa cascade, `todo_delete`, `todo_clear_completed`, `note_delete`, `shortcut_delete`, `setting_delete`). Atténuations : CSP stricte, assainissement de tout contenu externe (PLAN §6), sauvegardes quotidiennes, `pre-delete` et `pre-import`.
- Journaux : codes d'erreur et identifiants seulement, jamais de valeurs. Aucun secret (la garde des clés de réglage « secrètes » passe en Rust).

---

## 5. Cas limites

| # | Cas | Résultat attendu |
|---|---|---|
| L1 | Double clic sur « créer » (tableau, widget, tâche, note, raccourci) | ids générés par le front ; le second appel avec le même id → `conflict` ; avec deux ids : deux entités (l'interface désactive le bouton, inchangé) |
| L2 | `dashboard_ensure_default` appelé en parallèle par `DashboardListStore.load` et `DashboardStore.open` | une instruction atomique : un seul tableau |
| L3 | Échec du déplacement vers le tableau « (suite) » (widgets supprimés entre-temps, `CHECK`) | transaction annulée : **aucun** tableau créé, aucune suppression, message `dashboard.moveUnplacedError` |
| L4 | Débordement alors que 100 tableaux existent | `DashboardLimitError` côté front, sinon `limit_reached` → `forbidden` → `dashboards.limit` |
| L5 | Suppression d'un tableau par l'utilisateur | `dashboard_delete` seulement (`pre-delete`, jamais le dernier) ; inchangé |
| L6 | Import de configuration pendant une écriture du front | l'écriture attend ≤ 5 s (`busy` au-delà) ; le front recharge après l'import |
| L7 | Écriture après l'armement d'une restauration | `unavailable`, rien n'est écrit (T7) ; lectures permises |
| L8 | Sauvegarde (`VACUUM INTO`) pendant une écriture | instantané cohérent (WAL), l'écriture continue |
| L9 | Passage du planificateur pendant une écriture de contenu | tables disjointes ; au pire attente `busy_timeout` |
| L10 | Base neuve (premier lancement, ou `.dev`) | le plugin crée et migre ; Rust passe en WAL ; `dashboard_ensure_default` crée le tableau par défaut |
| L11 | Base restaurée (archive) en mode `DELETE` | repassée en WAL au démarrage |
| L12 | Échec du WAL | journalisé, l'application fonctionne en `DELETE` (T8) |
| L13 | Fichier de base supprimé pendant l'exécution | `CANTOPEN` → `unavailable` (pas de recréation : `create_if_missing(false)`) |
| L14 | Id mal formé en lecture (ex. `widget-focus` depuis une URL) | `null` ; suppression → `false` ; mise à jour → `not_found` |
| L15 | Nombre non entier, négatif hors borne, champ inconnu, type faux (appel forgé) | `invalid_input` (désérialisation, S2, ou contrôle Rust) |
| L16 | Charge énorme (corps de 10 Mo) | plafond IPC → `invalid_input` avant tout parsing ou disque |
| L17 | JSON corrompu en base (écrit hors application) | renvoyé tel quel ; le front lève `corrupt_data` (inchangé) |
| L18 | Requête de recherche contenant `%`, `_`, `\` ou des accents | jokers échappés ; casse insensible en ASCII seulement (limite documentée, inchangée) |
| L19 | Clé de réglage `github.token` | `forbidden` (Rust) ; jamais écrite |
| L20 | `todo_update` avec `rrule` et `dueOn: null` | `invalid_input` avant le disque ; `rrule` seule sur une tâche sans échéance → `constraint` |
| L21 | `todo_shift_repeat_due` après une modification concurrente | `conflict` (comparer-et-écrire) ; absente → `not_found` |
| L22 | Date bien formée mais impossible (`2026-02-30`) | `constraint` (CHECK), inchangé |
| L23 | Changement d'heure, fuseaux | horodatages techniques en UTC (`Z`) ; dates murales (`due_on`) transmises sans conversion ; rien ne dépend du fuseau dans ces commandes |
| L24 | Hors Tauri (`npm run web:start`) | `invokeCommand` → `unavailable` ; mêmes bandeaux qu'aujourd'hui |
| L25 | Hors-ligne, synchronisation multi-appareils | sans objet (tout est local, une seule instance) |
| L26 | `invoke('plugin:sql|execute', …)` depuis la console ou un script injecté | refusé par l'ACL (S1, MC1) |

---

## 6. Lots

Ordre : TC1 → TC2 → TC3 → TC4. Chaque lot se termine par, depuis `F:/Marius/Projects/homebase` (**F majuscule**, sinon Vitest ne trouve pas son runner) :
```
npm run format:check
npm run lint
npm run test
npm run rust:fmt:check
npm run rust:lint
npm run rust:test
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --release --all-targets -- -D warnings
```
et, pour TC2 à TC4 : `npm run web:build` puis `npm run web:check-bundle`. Revue `reviewer` à la fin de chaque lot. Un lot bloqué (supposition fausse, test existant à affaiblir, budget dépassé) **s'arrête et rapporte**.

### Lot TC1 : socle Rust (aucune commande exposée, aucun changement du front)
Fichiers : créer `src/data/{mod,error,validate,bootstrap,search}.rs`, `src/data/tests/{error,bootstrap,search}_tests.rs` ; modifier `src/lib.rs` (`mod data;`, appel de `data::bootstrap::at_startup` dans `.setup()`, test d'ordre), `src/backup/mod.rs` (`is_restart_pending`), `src/backup/config_transfer.rs` (importe `is_secret_setting_key`, `is_setting_key_shape`, `is_dashboard_icon_shape` depuis `data::validate` ; commentaire de `WRITE_BUSY_TIMEOUT` : « another writer (the data commands) »). `#[cfg_attr(not(test), expect(dead_code, reason = …))]` permis au niveau des nouveaux modules dans ce lot seulement.
- **CA-TC1-1** `DataError` : sérialisation, mapping de chaque ligne du tableau §4.3 sur de vraies erreurs SQLite (base `make_database`).
- **CA-TC1-2** `validate.rs` : chaque règle du §4.4 testée (bornes incluses / exclues, UTF-16 avec un emoji, `hb_trim`), et `config_transfer_tests.rs` reste vert sans modification.
- **CA-TC1-3** `ensure_wal` : base en `DELETE` → `wal`, idempotent ; test d'ordre dans `lib.rs` : `on_app_ready` < `data::bootstrap::at_startup` < `tray::setup` < `schedule::start`.
- **CA-TC1-4** `like_contains` échappe `\`, `%`, `_` ; `valid_search` : trim, 1..=200, limite 1..=20.
- **CA-TC1-5** `DataCtx::ensure_writable` refuse quand `writes_allowed = false`.

### Lot TC2 : réglages, tableaux, instances (Rust + front), débordement atomique
Fichiers Rust : créer `src/data/{settings,dashboards,widgets}.rs`, `src/data/tests/{settings,dashboards,widgets}_tests.rs` ; modifier `build.rs`, `src/lib.rs` (deux `invoke_handler` + tests), `capabilities/default.json` (18 `allow-…` ajoutées ; `sql:*` **encore présentes**, retirées en TC4), `src/capability_tests.rs` (liste exacte, compteur).
Fichiers front : créer `data/tauri/{wire,tauri-settings.repository,tauri-dashboard.repository,tauri-widget-instance.repository}.ts` (+ specs) ; modifier `data/{repositories,data.providers,index}.ts`, `data/tauri/invoke-command.ts` (+ spec), `core/dashboard/{dashboard-list.store,dashboard.store,dashboard.component}.ts` (+ specs), `core/testing/fake-{dashboard,widget-instance}.repository.ts` (+ specs) ; supprimer `data/sqlite/{sqlite-settings,sqlite-dashboard,sqlite-widget-instance}.repository.ts` et leurs specs, `data/sqlite/database-bootstrap.ts`. `data.providers.ts` garde, **jusqu'à TC3**, `SQL_EXECUTOR` (exécuteur gardé, sans initialiseur) pour `content.tokens.ts`.
- **CA-TC2-1** Chaque cas de `sqlite-settings`, `sqlite-dashboard`, `sqlite-widget-instance.repository.spec.ts` a un test Rust équivalent (table de correspondance dans le rapport) ; tests §4.11 pour ces domaines (DTO, atomicité, T3, T6, T7, horodatages).
- **CA-TC2-2** Specs des trois adaptateurs : noms et arguments exacts ; `invoke-command.spec.ts` couvre les nouvelles correspondances.
- **CA-TC2-3** Débordement : specs de `dashboard.component` / stores : succès (tableau ajouté à la liste, widgets retirés), `conflict` → `dashboard.moveUnplacedError` sans appel de suppression, limite → `dashboards.limit`.
- **CA-TC2-4** `default.json` gagne exactement les 18 `allow-…` du domaine ; `build.rs` et les deux `invoke_handler` listent les 18 commandes.
- **CA-TC2-5** Bundle : initial ≤ valeur de début de lot + 1 kB (valeurs au rapport) ; `web:check-bundle` vert.
- **CA-TC2-6** Recherche : aucune instruction `DELETE FROM dashboards` hors `src/backup/dashboard_delete.rs` et `src/backup/config_transfer.rs` (Rust, hors tests) ; aucune occurrence de `discardEmpty`, `moveToDashboard` ni de `DashboardRepository.remove` dans `apps/web/src`.

### Lot TC3 : notes, raccourcis, tâches, recherche (Rust + front)
Fichiers Rust : créer `src/data/{notes,shortcuts,todos}.rs`, `src/data/tests/{notes,shortcuts,todos}_tests.rs` ; modifier `build.rs`, `src/lib.rs`, `capabilities/default.json` (25 `allow-…`), `src/capability_tests.rs`.
Fichiers front : créer `data/tauri/tauri-{note,shortcut,todo}.repository.ts` (+ specs) ; modifier `data/content.tokens.ts` (+ spec), `data/data.providers.ts` (retrait de `SQL_EXECUTOR`, `GuardedSqlExecutor`, `TauriSqlExecutor`), `data/search.ts`, `data/tauri/wire.ts`, `scripts/check-initial-bundle.mjs` (§4.11) ; supprimer `data/sqlite/{sqlite-note,sqlite-shortcut,sqlite-todo}.repository.ts`, `sqlite-search.spec.ts` et les specs associées, `guarded-sql-executor.ts` (+ spec).
- **CA-TC3-1** Chaque cas de `sqlite-note`, `sqlite-shortcut`, `sqlite-todo.repository.spec.ts` et `sqlite-search.spec.ts` a un test Rust équivalent (table de correspondance) ; `TodoChangesDto` absent / `null` testé.
- **CA-TC3-2** Specs des trois adaptateurs (dont l'extrait de recherche calculé par `excerptAround`).
- **CA-TC3-3** `default.json` gagne exactement les 25 `allow-…` ; `build.rs` et les deux `invoke_handler` à jour.
- **CA-TC3-4** `web:check-bundle` vert avec les nouveaux motifs ; initial ≤ valeur de début de lot + 1 kB.
- **CA-TC3-5** Plus aucun fichier de production du front n'importe `SqlExecutor` (recherche dans `apps/web/src` hors `data/testing/**` et `*.spec.ts`).

### Lot TC4 : verrouillage et nettoyage
Fichiers : `capabilities/default.json` (retrait de `sql:allow-execute`, `sql:allow-select` ; description §4.10), `src/capability_tests.rs` (§4.11 : `debug_capability_is_exact`, `no_sql_plugin_permission`, `csp_is_exact`, `front_has_no_sql_plugin_package`), `apps/web/package.json` et `package-lock.json` (retrait du paquet), `eslint.config.js`, `data/sqlite/` (dossier supprimé : `tauri-sql-executor.ts`, `db-url.ts`, `row-mappers.ts`, `error-mapping.ts` déplacé), `data/sql-executor.ts` → `data/testing/sql-executor.ts`, `data/testing/node-sqlite-executor.ts` (imports), `data/front-sql-guard.spec.ts` (remplace `schedule-sql-guard.spec.ts`), `scripts/check-initial-bundle.mjs` (`plugin:sql` partout).
Anticipation : le lot TC3b a déjà supprimé `data/sqlite/{tauri-sql-executor,db-url,row-mappers}.ts`. Il reste pour TC4 : l'exception ESLint visant `tauri-sql-executor.ts` (`apps/web/eslint.config.js`, deux blocs) et le déplacement de `validSearch` (`data/search.ts`, utilisé seulement par `core/testing/fake-todo.repository.ts`) vers `core/testing/`.
Réalisé (TC4) : `error-mapping.ts` (+ spec) et `sql-executor.ts` sont dans `data/testing/` ; `validSearch` (et ses deux bornes) est dans `core/testing/valid-search.ts` ; le dossier `data/sqlite/` n'existe plus ; `front-sql-guard.spec.ts` ajoute un test générique (motifs SQL, `plugin:sql`, import du plugin, `SqlExecutor`) aux deux tests du garde du planificateur ; `check-initial-bundle.mjs` a `FORBIDDEN_EVERYWHERE = ['plugin:sql']`.
- **CA-TC4-1** `default.json` et `debug.json` ne contiennent aucune permission `sql:` (test) ; la liste exacte de `debug.json` est testée ; la CSP est comparée en chaîne exacte.
- **CA-TC4-2** `@tauri-apps/plugin-sql` absent de `package.json`, `package-lock.json`, `apps/web/src` et de tout fichier de `dist` (`plugin:sql` introuvable, garde CI).
- **CA-TC4-3** `front-sql-guard.spec.ts` vert et pertinent (les motifs attrapent des exemples positifs).
- **CA-TC4-4** `npm run test` : `test:data` ne contient plus que les tests de schéma, de `testing/` et les specs pures de `data/` (T5) ; better-sqlite3 reste en devDependency seulement.
- **CA-TC4-5** Bundle : initial ≤ valeur de début de **TC2** (chantier sans régression) ; valeur finale au rapport.
- **CA-TC4-6** Vérifications manuelles MC1 à MC8 demandées à Marius (rapport : liste à cocher).

---

## 7. Vérifications manuelles (Marius)

Sur `npm run dev` (identifiant `.dev`), sauf MC2 et MC8 sur l'exe release construit par `npm run build`. **Avant MC2 : faire une sauvegarde manuelle.**
- **MC1** (S1, S2) Console de développement (Ctrl+Maj+I) : `window.__TAURI_INTERNALS__.invoke('plugin:sql|select', { db: 'sqlite:homebase.db', query: 'SELECT 1', values: [] })` puis la même chose avec `plugin:sql|execute` et `plugin:sql|load` → les trois sont **refusés** (message « not allowed »). `window.__TAURI_INTERNALS__.invoke('widget_update_layout', { dashboardId: 'x', items: [{ id: 'y', grid: { x: 1.5, y: 0, w: 1, h: 1 } }] })` → erreur commençant par ``invalid args ` `` (noter le texte exact dans le rapport).
- **MC2** Base réelle (exe release) : tableaux, widgets, notes, tâches (dont répétées), raccourcis, thème, fuseau, dernier tableau ouvert : tout est intact ; `homebase.db-wal` présent.
- **MC3** Base neuve (supprimer le dossier de données `.dev`) : le tableau par défaut est créé ; le journal du terminal affiche `journal_mode = wal`.
- **MC4** Débordement : réduire la fenêtre jusqu'à ce que des widgets n'aient plus de place, puis lancer l'action qui déplace les widgets sans place : un tableau « (suite) » est créé avec ces widgets ; **aucune** nouvelle archive `pre-delete` dans le dossier des sauvegardes.
- **MC5** Supprimer un tableau : archive `pre-delete` créée (inchangé) ; le dernier tableau ne peut pas être supprimé.
- **MC6** Recherche globale (Ctrl+K) : notes (avec extrait), tâches (avec extrait), raccourcis ; requête `50%` trouvée littéralement ; aucune latence perceptible.
- **MC7** (PV1) Console : 20 fois `const t = performance.now(); await window.__TAURI_INTERNALS__.invoke('widget_list', { dashboardId: '<id d'un tableau>' }); performance.now() - t` → médiane < 15 ms ; ouverture d'un tableau sans ralentissement perceptible.
- **MC8** Export de configuration puis import du même fichier : aperçu « aucune différence », données identiques ; sauvegarde manuelle puis restauration : tout est présent après redémarrage.

---

## 8. Amendements proposés (à appliquer par le coordinateur après validation)

### 8.1 ADR-002 (`docs/adr/002-data-layer.md`)
- **§3.6** : remplacer par « *Amendement (spec typed-data-commands)* : **aucune permission `sql:*`**. Le front accède aux données par des commandes Rust typées (`setting_*`, `dashboard_*`, `widget_*`, `note_*`, `shortcut_*`, `todo_*`, plus `reminder_*`, `session_*`, `habit_*`, `dashboard_delete`). `tauri-plugin-sql` n'est plus utilisé que côté Rust pour les migrations (`preload`). »
- **§3.5** : ajouter « *Amendement (spec typed-data-commands)* : les dépôts de `data/` sont des adaptateurs `data/tauri/` sur des commandes Rust ; `SqlExecutor`, `NodeSqliteExecutor` et `error-mapping.ts` ne servent plus qu'aux tests de schéma (`data/testing/`). La validation est faite en Rust ; les erreurs sont traduites par `invokeCommand` (code SQLite côté Rust, plus de correspondance par message). `DashboardRepository.remove` et `WidgetInstanceRepository.moveToDashboard` sont remplacés par `createWithWidgets` (transaction Rust). Plus de bootstrap front. »
- **§2.3** : ajouter « *Amendement* : les transactions sont désormais possibles côté Rust (`BEGIN IMMEDIATE` sur une connexion dédiée) ; la règle « une écriture logique = une instruction » reste la règle par défaut, une transaction n'est utilisée que pour une lecture suivie d'une écriture dépendante. »
- **§2.4** : « *Amendement* : `PRAGMA journal_mode = WAL` est posé par Rust à chaque démarrage (`data::bootstrap`), un échec est journalisé sans bloquer. »
- **§2.5** : « *Amendement* : better-sqlite3 ne sert plus qu'aux tests de schéma et de migration ; le SQL de production est testé en Rust (`rust:test`) sur les vraies migrations. »
- **§3.1** : « La constante apparaît à 2 endroits (Rust `db::DB_URL`, `plugins.sql.preload`) ; le `DB_URL` TS est supprimé. »
- **§3.3** : « *Amendement* : `created_at` / `updated_at` de **toutes** les tables sont fournis par l'horloge Rust (`format_instant`) ; les UUID restent générés par le front et vérifiés par Rust. »
- **R1** : « **Clos (spec typed-data-commands)** : plus aucune permission `sql:*` ; aucune commande ne reçoit de SQL ni de chemin. Résiduel : un XSS peut appeler les commandes typées (dont les suppressions sans sauvegarde, voir SECURITY-NOTES). »
- **R10** : « Réduit aux tests de schéma (T5). » **R13** : « Clos : correspondance par code SQLite en Rust. »
- **O3** : « **Fait (spec typed-data-commands)**. »
- **§4 Conséquences**, négatives : remplacer « Pas de transaction multi-instructions depuis le front… » par « Chaque nouvel accès aux données demande une commande Rust (DTO, bornes, permission, tests Rust) ; c'est le prix de la fermeture de R1. »

### 8.2 ADR-001 (`docs/adr/001-widget-contract.md`) §3.7
« *Amendement (spec typed-data-commands)* : `DashboardRepository { list, get, create, createIfNone, update, updateTheme, createWithWidgets }` ; `WidgetInstanceRepository { listByDashboard, get, create, updateConfig, updateLayout, findFirstOfType, remove }` ; tous implémentés par des commandes Rust typées. La suppression d'un dashboard passe uniquement par `dashboard_delete`. »

### 8.3 `docs/SECURITY-NOTES.md`
Remplacer la section « Accès SQL direct du front (ADR-002) » par :
> ## Accès aux données du front (ADR-002 O3, spec typed-data-commands)
> Le front n'a **aucune** permission `sql:*` : il lit et écrit les données par des commandes Rust typées, aux entrées bornées et validées, aux paramètres SQL liés. Aucune commande ne reçoit de SQL, de nom de table ni de chemin : `ATTACH`, `VACUUM INTO` et les `PRAGMA` sont hors d'atteinte. `tauri-plugin-sql` ne sert qu'aux migrations, côté Rust. Garde-fous : `capability_tests.rs` (aucune permission `sql:`, listes exactes de `default.json` et `debug.json`, CSP exacte), `front-sql-guard.spec.ts`, `check-initial-bundle.mjs` (`plugin:sql` absent du bundle).
> - **Résiduel accepté** : un script injecté peut appeler les commandes typées : lire les données affichables, supprimer un widget (et ses notes ou tâches), une tâche, une note, un raccourci ou un réglage **sans** sauvegarde. Les suppressions de tableau (`dashboard_delete`) et l'import de configuration prennent une sauvegarde avant. Atténuations : CSP stricte, assainissement de tout contenu externe, sauvegardes quotidiennes.

### 8.4 `docs/ROADMAP.md`, phase 3
Remplacer la première tâche par :
```
- [x] (O) Spec O3 de l'ADR-002 (`docs/specs/typed-data-commands.md`, décisions T1 à T9 validées par Marius le <date>)
- [ ] (S) Lot TC1 : socle Rust `data` (erreurs, validation, connexion), WAL posé par Rust au démarrage
- [ ] (S) Lot TC2 : commandes setting_*, dashboard_*, widget_* et dépôts front ; débordement atomique (`dashboard_create_with_widgets`) : `discardEmpty` et `DashboardRepository.remove` supprimés, toute suppression de tableau passe par `dashboard_delete`
- [ ] (S) Lot TC3 : commandes note_*, shortcut_*, todo_* (recherche comprise) et dépôts front ; garde du bundle sur les noms de commandes
- [ ] (S) Lot TC4 : verrouillage : aucune permission `sql:*`, paquet `@tauri-apps/plugin-sql` retiré, tests de capabilities durcis (CSP exacte, liste exacte de `debug.json`) ; vérifications manuelles MC1 à MC8 (Marius)
```

### 8.5 `docs/PLAN.md`
- l. 29 : « SQLite via `tauri-plugin-sql` (migrations au démarrage, côté Rust seulement) ; le front passe par des commandes Rust typées (spec typed-data-commands) ».
- l. 86 : « capacités au strict minimum (aucune permission `sql:*` : commandes Rust typées ; plugins de lancement/ouverture limités … ) ».

### 8.6 `CLAUDE.md` (à faire valider par Marius : fichier d'instructions)
- Stack, « Données » : « SQLite locale (`tauri-plugin-sql` pour les migrations, côté Rust) ; le front lit et écrit par des commandes Rust typées ».
- Commandes, « Tests » : « `test:data` : schéma et migrations sur better-sqlite3 en mémoire ; le SQL des commandes est testé par `rust:test` ».
- Conventions : « Toute donnée utilisateur passe par la couche `data/` (interfaces de repository, implémentées par des commandes Rust typées). Aucun SQL dans le front. »
- Sécurité : ajouter « Aucune permission `sql:*` côté front (ADR-002 O3). »

---

## 9. Risques et points à vérifier

| Risque | Impact | Mitigation |
|---|---|---|
| R1. S1 faux (le plugin accepterait un appel JS sans permission) | Surface SQL intacte | MC1 avant fusion ; sinon T2-B (retirer le crate) avant tout contenu externe |
| R2. Latence par connexion (S3) | Interface plus lente (ouverture d'un tableau, recherche) | PV1 / MC7 ; repli local vers un pool (T4-B) dans `data::connect` |
| R3. Écart de contrat non repéré lors du portage | Régression silencieuse d'un widget | Portage **cas par cas** des 131 tests TS (table de correspondance obligatoire) ; specs des stores et widgets inchangées et vertes |
| R4. Désérialisation (S2) non traduite en `invalid_input` | Erreurs `unknown` au lieu de `invalid_input` | MC1 ; repli TS (§4.3) |
| R5. Budget du bundle | Avertissement CI | Critère par lot ; arrêt et décision si dépassé |
| R6. Lot TC2 volumineux (Rust + front + T3) | Revue difficile | Découpage interne autorisé (TC2a : Rust ; TC2b : front), mêmes CA |
| R7. Commandes destructrices accessibles à un XSS | Perte de données | Résiduel documenté (§4.13) ; sauvegardes ; à réévaluer à l'audit de phase 6 (sauvegarde avant `widget_delete` ?) |
| R8. Transition TC2–TC3 : deux chemins d'accès coexistent | Incohérence temporaire | Branche unique `phase-3-typed-sql`, fusion sur `main` seulement après TC4 et MC1 à MC8 |
| R9. Une écriture acceptée pendant la préparation d'une restauration (avant `mark_restart_pending`) est perdue au redémarrage | Perte de la dernière modification | Résiduel assumé ; suivi possible : poser le drapeau d'écritures refusées au début de `backup_restore` |

Points à vérifier : **PV1** latence (MC7) ; **PV2** texte exact de l'erreur de désérialisation (MC1, S2) ; **PV3** valeur de l'initial avant TC2 et après TC4 (CA-TC4-5).
