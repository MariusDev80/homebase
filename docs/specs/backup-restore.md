# Spec : sauvegarde, restauration et export JSON de la configuration

- **Statut** : décisions de Marius actées (§12). Révisé après deux revues indépendantes ; la seconde a clos B-1, B-2 et `StartupBlocked`, puis les deux derniers points bloquants ont été traités ici.
- **Date** : 2026-10-21 (révision 3)
- **Auteur** : architect (Opus)
- **Tâche** : `docs/ROADMAP.md`, phase 1 : « Sauvegarde/restauration : archive de la base et des images, export JSON de la configuration »
- **Liens** : ADR-002 §2.7, §3.1, §3.5, R1, R4 à R6, O1, O2 ; ADR-001 §3.4, §3.5, §3.8, §7.4 ; ADR-003 §3.6, §8.8, §8.9 ; `CLAUDE.md` (sécurité)
- **Destinataire** : `implementer` (Sonnet), en 8 lots exécutés dans l'ordre **B1a → B1b → B2a → B2b → B3 → B4a → B4b → B5** (§11). Chaque lot fait environ 40 étapes et se suffit à lui-même. **Ne pas improviser** : si une supposition (§2.2) se révèle fausse ou si une condition d'arrêt du lot se présente, s'arrêter et rapporter.
- **Hors de ce fichier** (fait par le coordinateur) : amendements d'ADR et de PLAN (§10), case de la ROADMAP.

Cette spec tient aussi lieu d'ADR pour la sauvegarde : contexte, options, décisions, conséquences et risques. Elle précise, et amende parfois (§10), les décisions de principe de l'ADR-002 §2.7.

---

## 1. Contexte et périmètre

État du code au 2026-10-21 :
- **Rust** (`apps/desktop/src-tauri`) :
  - Plugins `notification`, `opener` (portée http/https), `autostart` et `sql` (`preload` de `sqlite:homebase.db`, migrations V1 à V3).
  - Modules `net` (`net::NetClient`, enregistré par `.manage(...)`) et `weather` (commandes `weather_forecast`, `weather_geocode`).
  - Commandes `get_autostart` et `set_autostart`, plus `schedule_test_notification` en debug.
  - Dépendances directes : `reqwest` 0.13 (`native-tls`), `tokio` 1 (`sync`), `serde`, `serde_json`.
  - `build.rs` déclare `AppManifest::commands` (5 commandes). `capability_tests.rs` fige les 7 permissions de la fenêtre `main`, dont `allow-weather-forecast` et `allow-weather-geocode`, et vérifie aussi l'absence de `http:*`, la CSP et la liste des fichiers de capabilities.
  - Pas de `jiff`, de `sqlx` direct, de `zip` ni de `clippy.toml`. Déjà présents dans `Cargo.lock` en dépendances transitives : `jiff` 0.2.38, `sqlx` 0.8.6, `sha2` 0.10.9, `tempfile` 3.27.
  - **Chaque lot conserve** les commandes `weather_*` dans `build.rs`, dans les **deux** listes `invoke_handler` et dans `capability_tests.rs`, ainsi que `.manage(net::NetClient::new())`.
- **Base** : `%APPDATA%\fr.mariusdev.homebase\homebase.db`, en mode WAL. Tables : `settings`, `dashboards`, `widget_instances`, `notes`, `shortcuts`, `todo_lists`, `todos`, `_sqlx_migrations`. Pas encore d'images (phase 5).
- **Front** : `data/` (repositories SQLite via `tauri-plugin-sql`), `core/time` (`TimeDisplay`, `CLOCK`), `core/widgets` (`WidgetRegistry`, `resolveConfig`, `serializeConfig`, `MAX_CONFIG_CHARS`), `features/settings/settings.page.ts`. Les invocations Tauri passent par des services de `core/` (ex. `SystemService`).

Périmètre :
1. Sauvegarde complète (base + images) en archive zip, manuelle et automatique, avec rétention.
2. Restauration depuis une sauvegarde interne ou un fichier externe, jamais à chaud, avec retour arrière.
3. Export et import JSON de la **configuration** : dashboards, instances de widgets, réglages.
4. Cartes « Sauvegardes » et « Configuration » dans Réglages, plus une alerte globale (R6).

Hors périmètre (phase 6) :
- copie vers le NAS, rétention configurable, sauvegarde planifiée quand l'application est fermée ;
- écran d'erreur natif complet en cas d'échec de migration au `preload` (seconde moitié de O1) ;
- chiffrement des archives ;
- plugin single-instance (R11).

---

## 2. Faits vérifiés et suppositions

### 2.1 Vérifiés (sources consultées le 2026-10-21 ; « revue » = constaté ou reproduit par les revues indépendantes du même jour)

| # | Fait | Source |
|---|---|---|
| V1 | `zip` : dernière version stable **9.0.5** (2026-10-17), MSRV 1.88 (projet en 1.90) | https://crates.io/api/v1/crates/zip |
| V2 | `zip` 9.0.5 : `deflate-flate2-zlib-rs = ["deflate-flate2", "flate2/zlib-rs"]`. Les features `default` ajoutent aes-crypto, bzip2, deflate64, lzma, ppmd, time, zstd (C) et xz | https://docs.rs/crate/zip/9.0.5/source/Cargo.toml.orig |
| V3 | `ZipArchive::new` lit le répertoire central ; API `len`, `by_index`, `by_index_raw`. `extract` n'est **pas atomique**. `has_overlapping_entries()` renvoie `ZipResult<bool>`. Rien de documenté sur les noms en double ni sur des limites | https://docs.rs/zip/9.0.5/zip/read/struct.ZipArchive.html ; revue |
| V4 | `ZipFile` : `name_raw`, `size`, `compression`, `encrypted`, `is_file` | https://docs.rs/zip/9.0.5/zip/read/struct.ZipFile.html |
| V5 | `ZipWriter::start_file` refuse un nom en double et ne normalise rien. `finish()` doit être appelé explicitement (un `drop` peut échouer en silence). `large_file(false)` par défaut. Sans la feature `time`, la date est le 1980-01-01 | docs.rs zip 9.0.5 |
| V6 | SQLite : « VACUUM (but not VACUUM INTO) is a write operation ». La cible ne doit pas exister ; elle peut être une expression (donc un paramètre lié). Le résultat est un instantané cohérent, synchronisé sur disque si `synchronous` vaut NORMAL ou FULL | https://www.sqlite.org/lang_vacuum.html |
| V7 | WAL : lecture seule possible si `-shm` et `-wal` existent, s'ils peuvent être créés, ou avec `immutable`. Séparer une base de son `-wal` peut perdre des transactions ou corrompre la base | https://www.sqlite.org/wal.html |
| V8 | `sqlx` 0.8.6 `SqliteConnectOptions` : `filename`, `read_only`, `immutable`, `create_if_missing` (désactivé par défaut), `foreign_keys` (ON), `busy_timeout` (5 s), `pragma(k, v)`, `connect()` | docs.rs sqlx 0.8.6 |
| V9 | `tauri-plugin-sql` v2 : le `preload` (connexion puis `migrate`) s'exécute dans le `setup` du plugin ; en cas d'erreur, ce setup échoue | source v2 |
| V10 | Tauri 2.12.4 : plugins initialisés dans l'ordre d'enregistrement, avec un `try_for_each` qui **s'arrête à la première erreur** (le `preload` SQL ne s'exécute donc jamais après un plugin en échec). Le `setup` de l'app s'exécute ensuite, à `Ready` | source tauri ; revue |
| V11 | `AppHandle::request_restart()` déclenche `ExitRequested` puis `Exit`. Les plugins reçoivent `Exit` et les pools SQL se ferment. `process::restart` lance le nouveau processus avant `exit(0)` | docs.rs tauri 2.12.4 ; revue |
| V12 | `tauri-plugin-dialog` **2.8.3**, MSRV 1.90 : `blocking_pick_file`, `blocking_save_file` (interdits sur le thread principal), `set_parent`, `add_filter`, `set_file_name`. Il dépend de `rfd` | docs.rs ; v2.tauri.app |
| V13 | Le `js_init_script` de `tauri-plugin-dialog` remplace `window.alert` et `window.confirm` par `plugin:dialog\|message`. Sans permission, l'appel est refusé par l'ACL, et `confirm()` renvoie une `Promise` toujours vraie. Le plugin n'enregistre ni `fs` ni aucune portée | source v2 ; revue |
| V14 | Les capabilities encadrent le front ; le code Rust est hors de ce modèle. Les commandes de l'app sont ouvertes sauf restriction par `AppManifest::commands` | v2.tauri.app/security/capabilities |
| V15 | `tauri-plugin-opener` 2.7.2 : les fonctions libres `open_path` et `reveal_item_in_dir` ne font aucun contrôle de portée | docs.rs |
| V16 | `jiff` 0.2.38 : `Timestamp::strftime` (UTC), `duration_since`, `now()`. `%.3f` donne 3 décimales par troncature | docs.rs |
| V17 | `sha2` 0.10.9 est déjà dans l'arbre (la 0.11.1 existe) | crates.io ; `Cargo.lock` |
| V18 | `std::fs::rename` sous Windows remplace un fichier cible existant, échoue si la cible est un dossier existant, et ne fonctionne pas entre volumes | doc.rust-lang.org |
| V19 | Le front n'utilise ni `alert`, ni `confirm`, ni `prompt` natifs. Aucune règle `no-alert` n'est active | dépôt |
| V20 | sqlx stocke le SHA-384 du texte SQL exact dans `_sqlx_migrations.checksum`. `VersionMismatch` / `VersionMissing` sont levées au démarrage | ADR-002 F4 |
| V21 | Un déclencheur renommé `sqlite_evil` via `writable_schema` est chargé et se déclenche, alors que `integrity_check` répond `ok` | revue (reproduit) |
| V22 | `VACUUM INTO` produit un fichier en journal DELETE. Les migrations sur une base restaurée tournent donc en mode rollback-journal, et un `-journal` chaud peut rester sur disque | revue |
| V23 | `rfd` exige common-controls v6. Un binaire `cargo test` sans manifeste plante en `0xc0000139` dès qu'un test fait référence au code des dialogues | revue (reproduit) |
| V24 | `sqlx` 0.9.0 existe (MSRV 1.94), alors que `tauri-plugin-sql` reste en 0.8. Le groupe Dependabot `tauri*` existe déjà | revue ; dépôt |
| V25 | `_sqlx_migrations` (sqlx 0.8.6), `pragma_table_xinfo` dans l'ordre `cid` (name, type, notnull, pk, hidden) : `(version, BIGINT, 0, 1, 0)`, `(description, TEXT, 1, 0, 0)`, `(installed_on, TIMESTAMP, 1, 0, 0)`, `(success, BOOLEAN, 1, 0, 0)`, `(checksum, BLOB, 1, 0, 0)`, `(execution_time, BIGINT, 1, 0, 0)`. `version` a bien `notnull = 0` | source `sqlx-sqlite-0.8.6/src/migrate.rs` ; revue |

### 2.2 Supposés (vérifier pendant l'implémentation ; si faux : s'arrêter et rapporter)

| # | Supposition | Vérification |
|---|---|---|
| S1 | `VACUUM INTO ?1` fonctionne sur une connexion `read_only(true)` | Test B1b. **Repli autorisé** : connexion lecture-écriture sans `create_if_missing`, à signaler dans le rapport |
| S2 | Une connexion `read_only + immutable` ouvre la sortie de `VACUUM INTO` sans créer de compagnon | Test B2a |
| S3 | `tauri::async_runtime::block_on` fonctionne en test et dans le `setup` d'un plugin (`net/mod.rs` l'utilise déjà) | Tests B1b |
| S4 | `sqlx::raw_sql(sql).execute(&mut conn)` exécute un fichier de migration multi-instructions | Test B2a |
| S5 | Appelés dans `spawn_blocking`, `blocking_pick_file` et `blocking_save_file` ouvrent un dialogue modal | M5, M6 |
| S6 | `io::ErrorKind::StorageFull` est stable en 1.90 (sinon, tester `raw_os_error()` 112 ou 39) | Compilation |
| S7 | Le `js_init_script` du dialogue n'a aucun effet visible tant que `alert`, `confirm` et `prompt` ne sont pas utilisés (garanti par `no-alert`) | M1 |
| S8 | Après `request_restart()`, il ne reste qu'un processus et qu'une icône dans la zone de notification | M7 |
| S9 | `filename()` + `immutable(true)` accepte un chemin contenant espaces et accents | Test B2a |
| S10 | `tauri_plugin_opener::open_path(<dossier>, None::<&str>)` ouvre l'Explorateur (adapter à la signature exacte, sans autre chemin) | M2 |
| S11 | Un module `dialogs` `#[cfg(not(test))]` + un **bouchon** `#[cfg(test)]` de mêmes signatures sans référence à `rfd`, plus un enregistrement du plugin hors `cfg(test)`, suffisent pour que `cargo test` ne plante pas (V23) | `rust:test` en B3. **Sinon**, repli décrit en B3 (manifeste embarqué). Si le repli échoue : s'arrêter |
| S13 | `sqlx::Connection::begin_with("BEGIN IMMEDIATE")` existe en 0.8.6 | Compilation B4a. Sinon : `BEGIN IMMEDIATE`, puis `COMMIT`/`ROLLBACK` à la main sur la connexion dédiée |
| S14 | Un `rfd::MessageDialog` synchrone (même version de `rfd` que celle tirée par `tauri-plugin-dialog`) peut s'afficher depuis le `setup` d'un plugin, avant la boucle d'événements | M11. Si l'appel bloque ou plante : s'arrêter et rapporter (garder seulement journal + marqueur) |

---

## 3. Décisions

### D1. Accès Rust à la base : connexion sqlx dédiée par opération

| Option | Pour | Contre |
|---|---|---|
| A. Pool du plugin (`DbInstances`) | Pas de nouvelle connexion | Repose sur des types internes du plugin ; indisponible avant son initialisation |
| B. `rusqlite` | API synchrone | `libsqlite3-sys` est `links = "sqlite3"` : rusqlite serait figé en ancienne version et Dependabot casserait le build |
| **C. `sqlx = { version = "0.8", default-features = false, features = ["sqlite", "runtime-tokio"] }`** | Partage `libsqlite3-sys` avec le plugin ; utilisable avant le plugin et en test | API async (fichiers via `spawn_blocking`) |

**Retenu : C.** Dependabot ignore `sqlx >= 0.9` (§10.6).

Trois réglages de connexion :
- **Instantané** : `filename(db).read_only(true)` (S1).
- **Inspection** d'une base non fiable : `filename(f).read_only(true).immutable(true)` + `pragma("trusted_schema", "OFF")`, `pragma("cell_size_check", "ON")`, `pragma("mmap_size", "0")`. Seulement des `SELECT` et des `PRAGMA` de lecture.
- **Écriture** (import de configuration) : `filename(db).create_if_missing(false)`, réglages sqlx par défaut.

### D2. Format d'archive : zip avec manifeste

`zip = { version = "9.0.5", default-features = false, features = ["deflate-flate2-zlib-rs"] }`, déjà décidé par l'ADR-002. Écartés : la copie de dossier (pas d'intégrité) et tar + zstd (illisible par l'Explorateur, code C).

Contenu fixe de l'archive :
- `homebase.db` (Deflated) ;
- `images/<uuid>.<ext>` (Stored) ;
- `manifest.json` (Deflated, écrit en dernier).

Pas d'entrée de dossier, pas de zip64. Date fixée au 1980-01-01, ce qui rend les archives reproductibles.

**Formats d'image figés** (contrainte pour l'ADR-006, §10.7). Seuls `png`, `jpg`, `jpeg`, `webp`, `gif` et `avif` sont acceptés, et la signature des premiers octets doit correspondre :

| Extension | Signature |
|---|---|
| `png` | `89 50 4E 47 0D 0A 1A 0A` |
| `jpg` / `jpeg` | `FF D8 FF` |
| `gif` | `GIF87a` ou `GIF89a` |
| `webp` | `RIFF` (octets 0 à 3) + `WEBP` (octets 8 à 11) |
| `avif` | `ftyp` (octets 4 à 7) + marque `avif` ou `avis` (octets 8 à 11) |

Ce contrôle est fait à la création (fichier ignoré et journalisé) **et** à l'extraction (archive refusée).

### D3. Emplacement, nom, rétention, atomicité

- **Emplacement** : `<racine>\backups\`, avec `<racine>` = `app_config_dir()`. L'export vers un dossier choisi par l'utilisateur couvre les autres emplacements (D5).
- **Nom** : `homebase-<stamp>-<kind>.zip`. `<stamp>` est l'instant UTC sans `-` ni `:`, en largeur fixe (`20261021T081500.123Z`) ; `<kind>` ∈ `manual`, `daily`, `pre-migration`, `pre-restore`, `pre-import`. Côté front, l'**identifiant** d'une sauvegarde est ce nom, jamais un chemin.
- **Contenu par type** : `manual`, `daily` et `pre-restore` sont complètes. `pre-migration` et `pre-import` contiennent la base seule (`includesImages: false`).
- **Rétention par réserve** :

  | Réserve | Types | Conservées |
  |---|---|---|
  | manuelle | `manual` | 10 |
  | quotidienne | `daily` | 7 |
  | sécurité | `pre-restore`, `pre-import` | 5 |
  | migration | `pre-migration` | 3 |

  Ne sont jamais supprimés : le fichier qui vient d'être créé, et les noms passés dans `protect` (par exemple l'archive source d'une restauration). La rétention est suspendue tant que l'alerte R6 est active.
- **Atomicité** : instantané dans `backups\.tmp\`, archive en `.partial` (`create_new`), puis `finish`, `sync_all`, `rename` vers le nom final (cible absente). Un garde RAII nettoie en cas d'échec ; `.tmp\` est vidé au démarrage.
- **Disque plein** : `StorageFull` donne `disk_full`, après nettoyage des fichiers temporaires.
- **Invariant** : toute archive créée passe la validation de restauration ; si une limite (§4.3) est dépassée, la création échoue avec `too_large`.

### D4. Horloge Rust : `jiff` et `time/clock.rs` dès maintenant

On reprend exactement les formes de l'ADR-003 §8.9 : `src/time/{clock,formats,error}.rs` et `clippy.toml`. Le lot B de l'ADR-003 les complétera (§10.3).

### D5. Choix d'emplacement par l'utilisateur : dialogues natifs ouverts **par Rust uniquement**

`tauri-plugin-dialog` 2.8.3 est utilisé sans aucune permission `dialog:*` ni `fs:*`. Le front ne fournit jamais de chemin. Écartés : le plugin côté JS + `fs:*` (le front verrait les chemins ; une XSS aurait une portée sur le système de fichiers) et `<input type="file">` (pas d'enregistrement possible, comportement non vérifié).

- Les dialogues sont appelés dans `spawn_blocking`, avec la fenêtre `main` pour parent.
- Ils vivent dans `backup::dialogs`, en `#[cfg(not(test))]`. Un **bouchon** `#[cfg(test)]` expose les mêmes signatures et renvoie `None`, sans référence à `rfd` (V23, S11).
- **Archive externe** : `backup_pick_external` ouvre le dialogue sans verrou. Ensuite seulement, il prend le verrou, **copie** le fichier dans une case privée unique (`backups\.incoming\picked.zip`), le valide et renvoie un résumé. `backup_restore({ kind: 'external' })` utilise cette copie, ce qui évite le TOCTOU.
- **Configuration** : `config_import_pick` ne renvoie le contenu que si c'est un objet JSON UTF-8 avec `format = homebase/dashboard-config`. Une XSS ne peut donc pas exfiltrer un fichier quelconque choisi par l'utilisateur.
- **Ouvrir le dossier** : `backup_open_folder()`, sans argument, via l'API Rust de l'opener. Aucune permission `opener:*` ajoutée.

### D6. Restauration

- **Dépôt** : un **dossier** `<racine>\restore-pending\` (amendement de l'ADR-002 §2.7), validé entièrement avant (§4.7).
- **Sauvegarde de sécurité** `pre-restore` avant le dépôt, l'archive source étant protégée de la rétention.
- **Redémarrage** : `backup_restore` appelle lui-même `request_restart()`. Le drapeau `restart_pending` refuse ensuite toute autre opération de sauvegarde, y compris le fil quotidien. Ni commande `app_restart`, ni `tauri-plugin-process`.
- **Échange au démarrage** : il est fait par le plugin interne `homebase-backup`, enregistré **avant** `tauri_plugin_sql`. Les originaux (la base et ses compagnons `-wal`, `-shm`, `-journal`, puis `images\`) sont déplacés dans `restore-rollback\`.
- **Confirmation en deux temps**, dans le `setup` de l'app et seulement si l'échange a eu lieu **dans ce processus** :
  1. **marquage atomique** : renommage de `restore-rollback\` en `restore-rollback.confirmed-<stamp>\`. S'il échoue, le setup de l'app échoue ;
  2. **suppression**. Un état confirmé n'est jamais restauré : au démarrage, on termine seulement sa suppression.
- **Sans confirmation**, le démarrage suivant revient à l'état d'origine.
- **Retour arrière impossible** : `StartupBlocked`. Message natif bloquant, puis échec du setup du plugin ; le plugin SQL ne s'exécute pas et rien n'est supprimé.

### D7. Sauvegardes automatiques en phase 1

| Déclencheur | Détail |
|---|---|
| `pre-migration` (base seule) | Base présente, avec une version ≥ 1 et inférieure à celle du binaire. **Base absente : rien, pas de marqueur.** En cas d'échec, le démarrage continue et le marqueur `pre-migration-failed` est posé |
| `pre-restore` (complète), `pre-import` (base seule) | Avant les deux opérations destructrices |
| `daily` (complète, décision de Marius) | Fil Rust : 2 min après le démarrage, puis toutes les heures. Une sauvegarde est faite si aucune archive complète **non endommagée** n'a moins de 24 h. Un échec est enregistré dans `lastAutoError` |

### D8. R6 : base absente alors que des sauvegardes existent

Détecté avant le plugin SQL : marqueur `db-missing.json`, bandeau d'alerte et rétention suspendue. Le marqueur est supprimé par `backup_acknowledge` ou par une restauration confirmée.

### D9. Export et import JSON de la configuration (décisions de Marius)

- **Périmètre** : dashboards, widgets (format de l'ADR-001 §3.5) et `settings`. Les notes, tâches et raccourcis sont exclus.
- **Champs obligatoires** : `format`, `formatVersion` (1), `exportedAt`, `dashboards` et `settings` (objet, éventuellement vide). L'enveloppe est stricte.
- **Import par remplacement par identifiant** :
  - les lignes existantes sont mises à jour en place, y compris une instance qui change de dashboard ;
  - un `widgetType` différent entraîne la suppression puis la recréation de l'instance ;
  - les dashboards et widgets absents du fichier sont **supprimés avec leurs données**, après un aperçu et une sauvegarde `pre-import` ;
  - `settings` est fusionné ;
  - le fichier doit contenir au moins un dashboard.
- **Validation** : côté front (valibot + `resolveConfig`), puis côté Rust (structure), puis par les `CHECK` SQL. L'écriture est faite par la commande Rust `config_import_apply`, dans une seule transaction `BEGIN IMMEDIATE`.
- **Après un import** : `location.reload()`.

### D10. UI

- Réglages : cartes « Sauvegardes » et « Configuration ».
- Restauration : dialogue avec case à cocher obligatoire, focus initial sur « Annuler ».
- Bandeau global d'alerte.
- `formatRelative` avec `numeric: 'always'`.
- ESLint : `no-alert` en erreur.

---

## 4. Conception détaillée

### 4.1 Arborescence de la racine (`<racine>` = `app_config_dir()`)

```
homebase.db                                             base vivante
homebase.db-wal, homebase.db-shm, homebase.db-journal   COMPAGNONS : toujours traités ensemble
images\<uuid>.<ext>                                     phase 5
backups\homebase-<stamp>-<kind>.zip                     archives (seuls fichiers listés)
backups\.tmp\                                           temporaires de création (vidé au démarrage)
backups\.incoming\picked.zip, check\                    archive externe et sa validation (vidé au démarrage)
backups\.status\db-missing.json                         marqueur R6
backups\.status\last-restore.json                       résultat de la dernière restauration
backups\.status\pre-migration-failed.json               échec de la sauvegarde avant migration
backups\.status\startup-blocked.json                    diagnostic de démarrage refusé
restore-staging.tmp\                                    préparation (supprimé au démarrage)
restore-pending\                                        restauration validée, à appliquer au prochain démarrage
restore-rollback\                                       état d'origine pendant l'échange (+ restore-info.json)
restore-rollback.confirmed-<stamp>\                     état d'origine d'une restauration CONFIRMÉE, en cours de suppression
```

Règles générales :
- Tout se trouve sur le même volume. On ne renomme jamais vers une cible existante.
- Les JSON sont écrits par `write_json_atomic` : fichier `.tmp`, puis `sync_all`, puis `rename`.
- `rename_with_retry` et `remove_with_retry` réessaient toutes les 100 ms pendant 2 s au plus sur les erreurs `raw_os_error` 32, 33 et 5.
- Ces deux fonctions **bloquent**. Depuis du code async (commandes, `create_backup`), on ne les appelle que dans `tauri::async_runtime::spawn_blocking`. Depuis les fils synchrones (setup des plugins, fil quotidien), on peut les appeler directement.

**Cycle de vie des marqueurs** :

| Marqueur | Écrit | Supprimé |
|---|---|---|
| `last-restore.json` | à la confirmation (`applied`), au retour arrière (`rolled-back`) ou à l'échec d'un échange (`failed`) ; écrasé par la restauration suivante | par `backup_acknowledge` |
| `db-missing.json` | détection R6 | par `backup_acknowledge` ou une confirmation |
| `pre-migration-failed.json` | échec d'une `pre-migration` | par `backup_acknowledge` ou la `pre-migration` réussie suivante |
| `startup-blocked.json` (`{ at, reason }`, `reason` ∈ `rollback_failed`, `rollback_info_unreadable`, `confirm_mark_failed`) | à chaque `StartupBlocked`, et par le setup de l'app si le marquage de confirmation échoue | par `startup_sequence` dès qu'un démarrage passe l'étape 2 du §4.8 sans blocage. Il n'est pas affiché dans l'UI : c'est un diagnostic disque, le message natif informe l'utilisateur |

### 4.2 Manifeste (`manifest.json`)

```json
{
  "format": "homebase/backup",
  "formatVersion": 1,
  "createdAt": "2026-10-21T08:15:00.123Z",
  "kind": "manual",
  "appVersion": "0.0.0",
  "schemaVersion": 3,
  "includesImages": true,
  "files": [
    { "path": "homebase.db", "size": 122880, "sha256": "<64 hex minuscules>" },
    { "path": "images/3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11.webp", "size": 20480, "sha256": "…" }
  ]
}
```

- Désérialisation `camelCase` avec `deny_unknown_fields`.
- `appVersion` = `env!("CARGO_PKG_VERSION")`.
- `schemaVersion` = version lue dans l'**instantané**.
- `files` est trié par chemin, `homebase.db` en premier.
- Empreintes SHA-256 en hexadécimal minuscule (`format!("{:02x}")`).

### 4.3 Limites et unités

| Constante | Valeur |
|---|---|
| `MAX_ARCHIVE_BYTES` | 3 Gio + 64 Mio |
| `MAX_ENTRIES` | 20 000 |
| `MAX_MANIFEST_BYTES` | 4 Mio |
| `MAX_DB_BYTES` | 1 Gio |
| `MAX_IMAGE_BYTES` | 64 Mio |
| `MAX_TOTAL_UNCOMPRESSED` | 3 Gio (pas de zip64) |
| `RETAIN_MANUAL` / `_DAILY` / `_SAFETY` / `_MIGRATION` | 10 / 7 / 5 / 3 |
| `DAILY_INTERVAL` / `DAILY_FIRST_CHECK` / `DAILY_CHECK_PERIOD` | 24 h / 120 s / 3 600 s |
| `MAX_CONFIG_FILE_BYTES` | 1 048 576 |
| `RENAME_RETRY_TOTAL` / `RENAME_RETRY_STEP` | 2 s / 100 ms |

Import (identique en TS et en Rust) :
- 1 à 100 dashboards ; au plus 200 widgets par dashboard et 1 000 au total ; au plus 200 réglages ;
- `grid.x` et `grid.y` dans 0..10 000, `grid.w` et `grid.h` dans 1..10 000 ;
- `sortOrder` dans 0..1 000 000 ; `configVersion` dans 1..10 000 ;
- `name` de 1 à 100, `widgetType` de 1 à 64 ;
- `config` et valeur de réglage : 65 536 au plus, une fois sérialisées.

**Longueur** = nombre de **points de code** : `chars().count()` en Rust, `[...s].length` en TS, `length()` en SQLite. Pour `config`, le front applique en plus le pré-contrôle de l'ADR-001 (unités UTF-16), plus strict.

**Trim** = suppression en tête et en fin des caractères de l'ensemble `HB_TRIM` : U+0009 à U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 à U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. C'est l'union des ensembles de JS `trim()` et de Rust `str::trim()`.
- `hbTrim` (TS) et `hb_trim` (Rust) partagent les mêmes vecteurs de test.
- Le front normalise `name` ; le Rust refuse un nom vide ou différent de `hb_trim(name)`.
- Conséquence voulue : un nom **stocké** avec des espaces de bord (créé avant cette règle, ou par un `trim` JS qui ne retire pas U+0085) sort tel quel à l'export, puis est **normalisé une fois** au premier réimport. Les réimports suivants sont idempotents.

### 4.4 Création (`create_backup(root, clock, kind, protect)`, async)

Le verrou est pris par l'**appelant** via `BackupState::try_acquire()`, qui renvoie `restart_pending` en priorité, puis `busy`.

1. `homebase.db` absent : `no_database`.
2. `name = BackupName::new(clock.now(), kind)`. Si ce nom existe déjà : `io { "AlreadyExists" }`.
3. `snapshot_into(db, .tmp\<stamp>-<kind>.db)` avec `VACUUM INTO ?1`. Au-delà de `MAX_DB_BYTES` : `too_large`.
4. Lecture de `schemaVersion` dans l'instantané. Absente : `database { "no_migrations" }`.
5. **Dans un seul `spawn_blocking`** :
   - inventaire des images (si `includes_images`) : fichiers réguliers (`symlink_metadata`), nom conforme, signature conforme, limites ;
   - `write_archive` : copie par blocs de 64 Kio avec SHA-256 au fil de l'eau ; si une taille change pendant la copie, `changed_during_backup` ; manifeste en dernier ; `finish`, `flush`, `sync_all` ;
   - `rename_with_retry` vers le nom final, puis suppression de l'instantané ;
   - `apply_retention(root, &nom, protect)`.
6. Renvoyer `BackupInfo`.

### 4.5 Rétention (`apply_retention(root, keep, protect) -> Vec<String>`, synchrone)

- Ne fait rien si `db-missing.json` existe.
- Sinon, dans la réserve de `keep` : tri par `stamp` décroissant ; on garde les N premiers, `keep` et tout nom présent dans `protect` ; on supprime le reste.
- Les fichiers dont le nom n'est pas valide ne sont jamais touchés.
- Une erreur de suppression est journalisée, jamais propagée.

### 4.6 Liste (`list_backups(root)`)

Entrées directes de `backups\` avec un nom valide, triées par `stamp` décroissant. Pour chacune : `sizeBytes`, puis `read_manifest`, qui applique les **contrôles 1 à 7 du §4.7**, sans extraction. Si `read_manifest` échoue : `damaged: true`. `createdAt` vient du nom.

`newest_full_backup` ignore les archives endommagées, `pre-migration`, `pre-import`, et celles datées de plus d'une heure dans le futur.

### 4.7 Validation et extraction (`extract_validated(archive, dest) -> Manifest`)

`dest` ne doit pas exister, et il est supprimé en cas d'échec. L'ordre est imposé. Sauf mention « (premier niveau) », le premier échec donne `invalid_archive { problem }`.

1. Taille supérieure à `MAX_ARCHIVE_BYTES` : `too_large` (premier niveau).
2. **Pré-lecture de l'EOCD**, sur les 65 557 derniers octets au plus : signature `50 4B 05 06` absente → `not_zip`. Nombre d'entrées égal à `0xFFFF`, ou localisateur zip64 `50 4B 06 07` 20 octets avant → `zip64`. Plus de `MAX_ENTRIES` entrées → `too_many_entries`.
3. `ZipArchive::new` en échec → `not_zip`. `len()` différent de l'EOCD ou supérieur à la limite → `too_many_entries`.
4. `has_overlapping_entries()` vrai ou en erreur → `overlapping_entries`.
5. Pour chaque index, via `by_index_raw` :
   - le nom doit être de l'UTF-8 et **exactement** `manifest.json`, `homebase.db` ou `images/<n>` avec `is_image_file_name(<n>)`, sinon `unexpected_entry` (liste blanche anti zip slip) ;
   - doublon → `too_many_entries` (zip 9 dédoublonne les noms à l'ouverture, donc le nombre d'entrées ne correspond plus à l'EOCD ; `duplicate_entry` ne peut pas sortir) ;
   - entrée qui n'est pas un fichier → `unexpected_entry` ; chiffrée → `encrypted_entry` ; méthode autre que Stored ou Deflated → `unsupported_compression` ;
   - tailles déclarées au-delà des limites → `entry_too_large` ; total au-delà → `total_too_large`.
6. `manifest.json` absent → `missing_manifest` ; `homebase.db` absent → `missing_database`.
7. Manifeste, lu avec `take(MAX_MANIFEST_BYTES)` :
   - lecture ou désérialisation stricte en échec, ou `createdAt` invalide → `invalid_manifest` ;
   - format ou version inattendus → `unsupported_format` ;
   - l'ensemble des `files` doit être égal à l'ensemble des entrées hors manifeste, avec les mêmes tailles ; `includesImages` doit être cohérent avec la présence d'images. Sinon → `manifest_mismatch`.
8. Extraction :
   - le chemin de sortie est construit par nous ; ouverture en `create_new` ; lecture avec `take(taille + 1)`, comptage et SHA-256 ;
   - `size_mismatch`, `checksum_mismatch`, `corrupt_entry` selon le cas ;
   - pour une image, la signature doit correspondre à l'extension, sinon `image_type_mismatch` ;
   - `manifest.json` est réécrit dans `dest`.
9. **Inspection** de `dest\homebase.db` (connexion d'inspection D1). Une erreur d'ouverture donne `not_sqlite`. L'ordre est **imposé** : lire `_sqlx_migrations` avant la comparaison de schéma est sûr, car la connexion est `immutable`, avec `trusted_schema=OFF`, et ne fait que des `SELECT`.
   1. `PRAGMA integrity_check` : une ligne unique `ok`, sinon `integrity_failed`.
   2. **Table `_sqlx_migrations`** : `SELECT type, sql FROM sqlite_schema WHERE name = '_sqlx_migrations'`.
      - Aucune ligne → `not_homebase`.
      - `type <> 'table'`, ou `sql` qui ne commence pas par `CREATE TABLE ` (ce qui exclut `CREATE VIRTUAL TABLE`) → `unexpected_schema`.
      - Colonnes : `SELECT name, type, "notnull", pk, hidden FROM pragma_table_xinfo('_sqlx_migrations') ORDER BY cid` doit être égal à la liste V25 (`version` a `notnull = 0`), sinon `unexpected_schema`.
   3. **Historique** : une ligne `success = 0` → `dirty_migration`. Versions qui ne forment pas exactement `1..=v` avec `v ≥ 1` → `unknown_migration`. **`v > supported_schema_version()` → `schema_too_new { archive: v, supported }` (premier niveau, R4)**. Checksum différent du SHA-384 du `sql` de `db::migrations()[version]` → `unknown_migration`.
   4. **Schéma complet**. Toutes les lignes de `SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name`, **sans aucun filtre de nom**, doivent être égales à `expected_schema(v)` (base `sqlite::memory:` + DDL exact de `_sqlx_migrations` de sqlx 0.8.6 (`SQLX_MIGRATIONS_DDL`) + migrations 1..v du binaire via `raw_sql`, autoindex et `sqlite_sequence` compris ; la ligne `_sqlx_migrations` et son autoindex sont donc attendus **exactement**), plus au plus ces lignes :
      - `('table', 'sqlite_stat1', 'sqlite_stat1', 'CREATE TABLE sqlite_stat1(tbl,idx,stat)')` ;
      - `('table', 'sqlite_stat4', 'sqlite_stat4', 'CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)')`.

      Toute autre différence → `unexpected_schema`, y compris un déclencheur nommé `sqlite_*` (V21) et toute variante de `_sqlx_migrations` aux mêmes colonnes (`CHECK`, `DEFAULT`, `ON CONFLICT`, `COLLATE`, `PRIMARY KEY DESC`, `REFERENCES … ON DELETE CASCADE` : pièges persistants qui casseraient les migrations suivantes). *Amendement (revue B2a, 2026-10-21)* : la vérification par préfixe et colonnes (9.2) ne sert plus qu'à la priorité des erreurs. Toute lecture de `sqlite_schema` ou de `_sqlx_migrations` utilise `try_get` (un `sql` stocké en BLOB via `writable_schema` est chargé par SQLite) → `unexpected_schema`, jamais de panique. Les erreurs SQLite sont classées par code primaire (`code & 0xFF` = 11 ou 26 → `integrity_failed`). L'ouverture de l'archive appelle `validate_header_consistency()` (en-tête local ≠ répertoire central → `corrupt_entry`).
   5. `PRAGMA foreign_key_check` doit être vide, sinon `foreign_key_violation`.
   6. `manifest.schemaVersion` différent de `v` → `manifest_mismatch`.
10. Renvoyer le manifeste.

### 4.8 Restauration : machine à états

**Préparation** (`stage_restore(root, clock, archive, protect)`, sous verrou, depuis `backup_restore`) :
1. Supprimer `restore-staging.tmp\`, puis `extract_validated(archive, restore-staging.tmp\)`.
2. `create_backup(PreRestore, protect)` ; `protect` contient l'id de la source si elle est interne. En cas d'échec : supprimer la préparation et propager l'erreur.
3. Supprimer un éventuel `restore-pending\`, puis renommer `restore-staging.tmp` → `restore-pending`.
4. Si la source est externe : supprimer `picked.zip`.
5. `restart_pending = true`, relâcher le verrou, `request_restart()`, puis `Ok(())`. La réponse peut ne jamais arriver au front.

**Démarrage** (`startup_sequence(root, clock) -> Result<StartupOutcome, StartupBlocked>`, synchrone, testable sans Tauri, appelée par le `setup` du plugin `homebase-backup` enregistré **avant** `tauri_plugin_sql`) :
1. **Nettoyage** : vider `backups\.tmp\` et `backups\.incoming\`, supprimer `restore-staging.tmp\`.
2. **Restaurations confirmées** : pour chaque `restore-rollback.confirmed-*\`, **terminer la suppression seulement**, sans jamais rien restaurer. Si un `restore-info.json` y est lisible et que `last-restore.json` ne vaut pas déjà `applied` pour ce `startedAt`, écrire `applied`. Un échec de suppression est seulement journalisé (le dossier reste en place, inerte, et on réessaie au démarrage suivant).
3. **`restore-rollback\` présent** (échange non confirmé) : `rollback()`.
   - Succès : si `restore-pending\` est absent, `last-restore.json` = `rolled-back`.
   - Échec, ou `restore-info.json` illisible alors que `restore-rollback\` contient autre chose que `restore-info.json.tmp` : **`Err(StartupBlocked)`**.
4. **`restore-pending\` présent** : le contenu doit être **exactement** `manifest.json` + les fichiers listés, sans compagnon, avec les bonnes tailles et les bons SHA-256 ; sinon, supprimer `restore-pending` et écrire `failed`. Puis l'**échange** :
   - succès : `swapped = true` ;
   - échec : `rollback()`, suppression de `restore-pending`, `failed` ; si ce `rollback()` échoue aussi : `Err(StartupBlocked)`.
5. Supprimer `startup-blocked.json` s'il existe (on a passé les étapes 3 et 4 sans blocage).
6. Détection R6 (D8).
7. **`pre-migration`** : `read_schema_version(db)` donne `None` si la base ou la table est absente ; on ne fait alors rien, pas même un marqueur. Si `Some(v)` avec `1 ≤ v < supported` : `block_on(create_backup(PreMigration, &[]))`, puis le marqueur en cas d'échec ou sa suppression en cas de succès.
8. Renvoyer `StartupOutcome { swapped }`. Le plugin appelle alors `app.manage(BackupState::new(root, clock, swapped))`.

**`StartupBlocked`** : le setup du plugin, hors `cfg(test)`, effectue dans l'ordre :
1. `eprintln!` ;
2. `write_json_atomic(startup-blocked.json)` ;
3. affichage d'un **message natif bloquant**, `rfd::MessageDialog`, niveau Error, bouton OK (S14 ; lot B3, le lot B2b se contente des étapes 1 et 2), avec le texte en français codé en dur (comme la zone de notification) :
   > « Homebase ne peut pas démarrer : une restauration n'a pu être ni terminée ni annulée. Pour protéger vos données, rien n'a été supprimé. Vos données d'origine se trouvent dans le dossier <racine>\restore-rollback (la base homebase.db et les fichiers homebase.db-wal, -shm, -journal éventuels vont ensemble). Fermez les programmes qui pourraient utiliser ce dossier (antivirus, synchronisation), puis relancez Homebase. Une sauvegarde « avant restauration » se trouve aussi dans <racine>\backups. »
4. renvoi d'une `Err`.

Le `try_for_each` de Tauri s'arrête alors avant le plugin SQL (V10). Aucune base vide n'est créée, rien n'est supprimé, et on réessaie au lancement suivant (y compris par le démarrage automatique).

**Échange** (renommages via `rename_with_retry`) :
1. `create_dir(restore-rollback)`.
2. `write_json_atomic(restore-rollback\restore-info.json)` avec `{ backupCreatedAt, backupKind, includesImages, originalHadDb, originalHadWal, originalHadShm, originalHadJournal, originalHadImages, startedAt }`.
3. `homebase.db` → `restore-rollback\`, s'il existe. Si cette étape échoue, rien n'a bougé.
4. `-wal`, `-shm` et `-journal` → `restore-rollback\`, pour ceux qui existent.
5. Si `includesImages` et que `images\` existe : → `restore-rollback\images\`.
6. `restore-pending\homebase.db` → `homebase.db`.
7. Si `includesImages` et que `restore-pending\images\` existe : → `images\`.
8. Supprimer `restore-pending\`.

**`rollback()`** est idempotent, y compris s'il est interrompu puis relancé, et piloté par `restore-info.json`.
- `restore-info.json` absent ou illisible :
  - si `restore-rollback\` est vide ou ne contient que `restore-info.json.tmp` : on le supprime et on renvoie `Ok` ;
  - sinon : `Err`, sans rien supprimer.
- Sinon, on traite les éléments **dans l'ordre** base, `-wal`, `-shm`, `-journal`, `images`. Pour chacun, d'abord la suppression de l'élément étranger, puis la remise en place de l'original :

| Élément | Règle |
|---|---|
| `homebase.db` | `originalHadDb` et `restore-rollback\homebase.db` présent → supprimer la base à la racine, puis remettre l'originale. `originalHadDb` sans copie dans `restore-rollback\` → la racine **est** l'originale, n'y toucher pas. `!originalHadDb` → supprimer la base à la racine si elle existe |
| compagnon C | `originalHadC` et `restore-rollback\C` présent → supprimer C à la racine, puis remettre l'original. `originalHadC` sans copie dans `restore-rollback\` → la racine est l'**originale**, la garder. `!originalHadC` → supprimer C à la racine s'il existe (compagnon de la base restaurée, par exemple un `-journal` chaud) |
| `images\` | Copie dans `restore-rollback\` → supprimer `images\` puis le remettre. Sinon, si `includesImages && !originalHadImages` → supprimer `images\`. Sinon → rien |

Enfin, on supprime `restore-rollback\`. Toute erreur d'E/S donne `Err`, sans autre suppression.

**Confirmation** (`confirm_restore(root, clock, swapped_this_process) -> Result<(), ConfirmError>`), **premier** appel de `.setup()`, avant `tray::setup` :
- `!swapped_this_process` : ne rien faire. Si `restore-rollback\` existe, ce qui est impossible si `startup_sequence` est correct, on journalise seulement.
- `swapped_this_process` :
  1. lire `restore-info.json` ;
  2. **marquage atomique** : `rename_with_retry(restore-rollback → restore-rollback.confirmed-<stamp du startedAt>)`. **En cas d'échec** : `write_json_atomic(startup-blocked.json { reason: "confirm_mark_failed" })`, message natif (B3), puis `Err`, et `.setup()` renvoie l'erreur. Tauri arrête alors l'application (panique « Failed to setup app »). Au lancement suivant, `restore-rollback\` n'est pas confirmé : l'étape 3 revient à l'état d'origine, et le bandeau affiche `rolled-back`. Aucune session n'a écrit sur la base restaurée, puisque le front n'a pas démarré ;
  3. `last-restore.json` = `applied`, puis suppression de `db-missing.json` ;
  4. `remove_with_retry` du dossier `restore-rollback.confirmed-*`. Un échec est seulement journalisé : l'étape 2 du démarrage suivant termine la suppression, **sans jamais restaurer**.

Conséquences assumées :
- Une panne sans lien avec la base entre l'échange et le marquage annule une restauration valide (`rolled-back`).
- Une panne pendant l'échange après l'étape 6 rend la reprise impossible : on obtient `failed` et l'état d'origine. La source est protégée et la sauvegarde `pre-restore` existe.

**Amendements (revue B2b, 2026-10-21)**

- **Verrou de processus.** Avant toute opération de démarrage, le plugin `homebase-backup` ouvre `<root>\homebase.lock` en accès exclusif (Windows : `share_mode(0)`), avec une attente maximale de 5 s pour laisser un processus précédent (redémarrage) se terminer. Le verrou est conservé dans `BackupState` pour toute la vie du processus ; l'OS le libère à la mort du processus. Si le verrou ne peut pas être pris, le setup du plugin échoue sans écrire de marqueur ni modifier le moindre fichier ; le plugin SQL ne s'initialise donc pas et la seconde instance ne démarre pas. (Scénario corrigé : deux démarrages simultanés, l'un en rollback et l'autre à l'étape 6, écrasaient la base d'origine.) Le plugin single-instance de la phase 2 devra être enregistré **avant** `homebase-backup`. `homebase.lock` n'est jamais une donnée (exclu des listings, sauvegardes et exports).
- **Renommages de l'échange.** Chaque renommage de l'échange (étapes 3 à 7) échoue (`AlreadyExists`) si la cible existe déjà au moment du renommage ; l'échec déclenche le rollback. L'info (`restore-info.json`) est lisible avant le premier déplacement et le reste tant que `restore-rollback\` contient autre chose qu'elle.
- **Résidus.** Si, après avoir remis tous les originaux, `rollback()` trouve dans `restore-rollback\` autre chose que `restore-info.json(.tmp)`, le dossier est renommé en `restore-rollback.leftover-<stamp>` (suffixe numérique si le nom est pris), jamais supprimé ni restauré automatiquement, et le démarrage continue. Seule l'info illisible avec contenu reste bloquante.
- **Restauration abandonnée.** Si l'échange échoue (ou si `restore-pending\` est invalide) et que `restore-pending\` ne peut pas être supprimé, il est renommé en `restore-pending.discarded-<stamp>` pour ne jamais être appliqué ultérieurement (si ce renommage échoue aussi : journalisé, cas résiduel accepté).
- **Confirmation.** La `RestoreInfo` de l'échange est transmise en mémoire du démarrage à la confirmation (`confirm_restore`) ; la confirmation ne relit pas le fichier. L'étape 2 du démarrage n'écrit `applied` que si `last-restore.json` est absent ou antérieur au `startedAt` du dossier confirmé.
- **Base vivante corrompue (à implémenter en B3).** Si l'instantané `pre-restore` (`VACUUM INTO`) échoue parce que la base courante est corrompue, la sauvegarde de sécurité se rabat sur une **copie brute** de `homebase.db` et de ses compagnons (`-wal`, `-shm`, `-journal`) dans `backups\homebase-<stamp>-pre-restore-raw\` (pas d'inspection, jamais proposée à la restauration automatique, conservée hors rétention jusqu'à suppression manuelle), pour que la restauration reste possible précisément quand elle est nécessaire. Un échec de la copie brute annule la préparation.

**Amendements (revue B3, 2026-10-22)**

- **Échec de confirmation (`confirm_mark_failed`).** Avant d'afficher le message, la fenêtre `main` est détruite (Tauri la crée avant `.setup()` et le plugin SQL a déjà ouvert la base restaurée ; sans cela le WebView pourrait charger l'application et accepter des données perdues au retour arrière). Le message ajoute : « Au prochain lancement, la restauration sera annulée et vos données d'origine remises en place ; vous pourrez la recommencer. »
- **`pre-migration`.** Si l'en-tête SQLite est valide mais que la base est illisible en lecture seule, le marqueur `pre-migration-failed.json` est écrit et le démarrage continue.
- **Copie brute de secours.** Déclenchée par les codes SQLite primaires 11 et 26 et les codes étendus 776 (READONLY_ROLLBACK), 264 (READONLY_RECOVERY), 1288 (READONLY_CANTINIT) et 522 (IOERR_SHORT_READ). Exclus : BUSY/LOCKED (et étendus), FULL, CANTOPEN, IOERR générique. Le `-shm` est copié au mieux (échec toléré, cache reconstruit).

### 4.9 Fil quotidien

Lancé par `on_app_ready` après `confirm_restore` (`std::thread::spawn`). Après `DAILY_FIRST_CHECK`, en boucle :
1. `try_acquire` ; si le verrou est pris (`busy` ou `restart_pending`), on saute ce tour ;
2. `newest_full_backup` ;
3. si `daily_due`, `block_on(create_backup(Daily, &[]))` ;
4. mise à jour de `last_auto_error` ;
5. pause de `DAILY_CHECK_PERIOD`.

### 4.10 Dialogues et fichiers

Les commandes appellent `backup::dialogs`, qui renvoie `Option<PathBuf>` (bouchon `None` sous `cfg(test)`), puis des fonctions testables qui reçoivent un chemin. Tout cela tourne dans `spawn_blocking`.

- **`backup_export(id)`** :
  - `BackupName::parse`, sinon `invalid_id` ; archive absente → `not_found` ;
  - dialogue d'enregistrement (nom proposé = `id`, filtre `zip`) ; s'il est annulé, `false` ;
  - `export_archive_to(src, dest)` : temporaire `.<nom>.homebase-tmp` en `create_new`, `sync_all`, `rename` vers `dest` (remplacement permis, l'utilisateur l'ayant confirmé). Renvoie `true`.
- **`backup_pick_external()`** :
  - dialogue d'ouverture sans verrou ; s'il est annulé, `null` ;
  - `try_acquire` ;
  - `copy_external_archive` : `too_large`, copie bornée vers `.partial`, puis renommage en `picked.zip` ;
  - `extract_validated(picked.zip, check\)`, puis suppression de `check\` ;
  - renvoi de `ArchiveSummary`. En cas d'échec, suppression de `picked.zip`.
- **`config_export_save`** et **`config_import_pick`** : voir §4.12.

**Amendements (revue B3, 2026-10-22)**

- **Export.** La destination doit avoir l'extension `.zip` (insensible à la casse) et un parent canonique hors de la racine des données (`bad_extension`, `destination_in_data_root`). Un temporaire `.<nom>.homebase-tmp` orphelin, s'il est un fichier régulier (`symlink_metadata`), est supprimé avant la copie ; un lien ou un dossier est refusé sans être suivi.
- **Sortie.** L'attente de sortie du fil quotidien (3 s) est strictement inférieure à l'attente du verrou de processus (5 s) (assertion à la compilation).
- **Jeton d'archive externe.** `backup_pick_external` renvoie en plus `token` (SHA-256 hex de `picked.zip`) dans `ArchiveSummary`. `backup_restore` prend `{ "kind": "external", "token": "<hex>" }` ; un jeton différent donne `Io{code:"token_mismatch"}` sans rien préparer ni supprimer. Le front (B4b/B5) transmet le jeton du résumé affiché.

### 4.11 Commandes Tauri (`src/backup/commands.rs`)

Toutes les commandes sont `async`, en camelCase, et renvoient `BackupError` en cas d'échec. **Aucune n'accepte de chemin.**

| Commande | Arguments | Résultat | Verrou | Lot |
|---|---|---|---|---|
| `backup_list` | — | `BackupOverview` | non | B1b (statut complété en B3) |
| `backup_create` | — | `BackupInfo` (`manual`) | oui | B1b |
| `backup_open_folder` | — | `()` | non | B1b |
| `backup_restore` | `source: RestoreSource` | `()`, puis redémarrage | oui | B2b (interne), B3 (externe) |
| `backup_export` | `id: String` | `bool` | non | B3 |
| `backup_pick_external` | — | `Option<ArchiveSummary>` | oui, après le dialogue | B3 |
| `backup_acknowledge` | — | `()` (supprime `last-restore`, `db-missing`, `pre-migration-failed`) | non | B3 |
| `config_export_save` | `contents: String` | `bool` | non | B4a |
| `config_import_pick` | — | `Option<String>` | non | B4a |
| `config_import_apply` | `plan: ConfigImportPlan` | `ImportOutcome` | oui | B4a |

DTO (`#[serde(rename_all = "camelCase")]`, sauf mention contraire) :
```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupKind { Manual, Daily, PreMigration, PreRestore, PreImport }
pub struct BackupInfo {
    pub id: String, pub kind: BackupKind, pub created_at: String, pub size_bytes: u64,
    pub includes_images: Option<bool>, pub schema_version: Option<i64>, pub app_version: Option<String>,
    pub image_count: Option<u32>, pub damaged: bool,
}
pub struct ArchiveSummary {
    pub kind: BackupKind, pub created_at: String, pub size_bytes: u64, pub includes_images: bool,
    pub schema_version: i64, pub app_version: String, pub image_count: u32,
}
#[serde(rename_all = "kebab-case")] pub enum RestoreOutcome { Applied, RolledBack, Failed }
pub struct RestoreReport { pub outcome: RestoreOutcome, pub at: String, pub backup_created_at: Option<String>, pub backup_kind: Option<BackupKind> }
pub struct BackupStatus { pub last_restore: Option<RestoreReport>, pub db_missing_alert: bool, pub pre_migration_failed: bool, pub last_auto_error: Option<BackupError> }
pub struct BackupOverview { pub backups: Vec<BackupInfo>, pub status: BackupStatus, pub supported_schema_version: i64 }
#[derive(Deserialize)] #[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RestoreSource { Internal { id: String }, External }
pub struct ImportOutcome { pub dashboards: u32, pub widgets: u32, pub settings: u32 } // lignes écrites
```
Les nombres de suppressions viennent de l'aperçu côté front (§4.12), pas de Rust.

### 4.12 Configuration JSON

**Export** (`ConfigTransferService.exportToFile()`) :
- `buildConfigExport`, une fonction pure, écarte les clés de réglage qui correspondent à `SECRET_KEY_PATTERN` ;
- `exportedAt` = `CLOCK.nowIso()` ; sérialisation `JSON.stringify(doc, null, 2)` ;
- au-delà de 1 Mio (`TextEncoder`) : `too_large`, sans appeler Rust.

**`config_export_save`** (Rust) :
- taille ≤ 1 Mio ;
- objet JSON avec `format = homebase/dashboard-config`, sinon `not_config` ;
- aucune clé secrète, sinon `secret_setting` ;
- dialogue (`homebase-config-<stamp>.json`) ;
- écriture dans un fichier temporaire, puis `rename`.

**`config_import_pick`** (Rust) :
- dialogue ; s'il est annulé, `null` ;
- `read_config_file` : `too_large`, `not_utf8`, BOM retiré ;
- `check_config_import_text` : objet JSON avec `format = homebase/dashboard-config`, sinon `not_config`. C'est seulement à ce stade que le contenu est renvoyé.

**Analyse** (`parseConfigImport(text, lookup)`, front) :
- `JSON.parse`, sinon `invalid_json`.
- Enveloppe en `v.strictObject` : `format` (littéral) ; `formatVersion` (supérieur à 1 → `unsupported_version`, autre valeur non valide → `invalid_value`) ; `exportedAt` obligatoire, au format `InstantIso` ; `dashboards` et `settings` obligatoires. Champ manquant → `missing_field` ; champ inconnu → `unknown_field`. Les dashboards et les widgets sont eux aussi validés en `v.strictObject`.
- Contrôles du §4.3 ; UUID en minuscules, uniques ; `name` passé par `hbTrim` avant le contrôle de longueur.
- Type de widget connu, selon le résultat de `resolveConfig` :
  - `ok` → `serializeConfig` ;
  - `future-version` → données brutes conservées (compteur) ;
  - autre `invalid` → `invalid_config` ;
  - limite `maxInstances` dépassée → `max_instances`.
- Type inconnu : un objet est attendu, conservé brut (compteur).
- `settings` : clé secrète → `secret_setting` ; clé hors `/^[a-z][a-z0-9._-]{0,127}$/` → `invalid_setting_key`.
- Jamais d'`Object.assign`, de fusion profonde, ni d'`obj[cléNonFiable] = …` : utiliser des tableaux de paires et des `Map`.
- Un seul problème suffit à refuser le fichier ; au plus 20 problèmes sont affichés.

**Aperçu** (un seul type) :
```ts
interface ImportPreview {
  dashboards: number; widgets: number; settings: number;        // contenu du fichier
  unknownTypes: readonly string[]; futureVersions: number;
  removedDashboards: number;  // dashboards actuels absents du fichier
  removedWidgets: number;     // instances actuelles absentes du fichier (y compris celles des dashboards supprimés)
  replacedWidgets: number;    // présentes des deux côtés avec un widgetType différent
}
```

**`ConfigImportPlan`** (`deny_unknown_fields`, camelCase) :
```ts
interface ConfigImportPlan {
  dashboards: { id: string; name: string; sortOrder: number;
    widgets: { id: string; widgetType: string; grid: { x: number; y: number; w: number; h: number };
               config: string /* objet JSON sérialisé */; configVersion: number }[] }[];
  settings: { key: string; value: string /* JSON sérialisé */ }[];
}
```

**`config_import_apply`** (Rust) :
1. `validate_plan` (fonction pure) : limites, unités, UUID, unicité. `name` non vide et égal à `hb_trim(name)`. `config` est une `Map`, `value` une `Value`. Clés de réglage : format, plus un motif secret écrit à la main, sans `regex` (`secret`, `token`, `password`, `passwd`, `credential`, `apikey`, `api_key`, `api-key`, `api.key`, insensible à la casse). En cas d'échec : `invalid_import { problem }`.
2. `create_backup(PreImport, &[])` (base seule), sous le même verrou.
3. Connexion d'écriture, `begin_with("BEGIN IMMEDIATE")` (S13), dans cet ordre :
   ```sql
   -- 1. Upsert de tous les dashboards du fichier
   INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, updated_at = excluded.updated_at;
   -- 2. Pour chaque instance du fichier
   DELETE FROM widget_instances WHERE id = ?1 AND widget_type <> ?2;
   INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT (id) DO UPDATE SET dashboard_id = excluded.dashboard_id, widget_type = excluded.widget_type,
       grid_x = excluded.grid_x, grid_y = excluded.grid_y, grid_w = excluded.grid_w, grid_h = excluded.grid_h,
       config = excluded.config, config_version = excluded.config_version, updated_at = excluded.updated_at;
   -- 3. Instances absentes du fichier
   DELETE FROM widget_instances WHERE id NOT IN (SELECT value FROM json_each(?1));
   -- 4. Dashboards absents (ils ne contiennent plus aucune instance du fichier)
   DELETE FROM dashboards WHERE id NOT IN (SELECT value FROM json_each(?1));
   -- 5. Pour chaque réglage
   INSERT INTO settings (key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
   ```
   Un seul `now` pour toute la transaction. En cas d'erreur, annulation et `invalid_import { constraint }` ou `database { code }`.
4. Renvoyer `ImportOutcome`. Côté front, `location.reload()`.

**Amendements (revue B4a, 2026-10-22)**

- **Export.** `config_export_save` exige une destination `.json` (insensible à la casse) dont le parent canonique est hors de la racine des données, comme l'export d'archive (§4.10) ; même gestion des temporaires orphelins. `settings` absent ou qui n'est pas un objet → `not_config`.
- **Validation.** Un U+0000 dans un nom de dashboard ou un type de widget est refusé (`invalid_name`, `invalid_widget_type`) des deux côtés : SQLite `length()` s'arrête au NUL et le CHECK échouerait après la sauvegarde `pre-import`. Une clé de réglage en double → `duplicate_id`. Le contrôle « clé secrète » passe avant le contrôle de forme. Le total de widgets (≤ 1 000) est compté avant l'analyse des configs. `config` est stocké tel quel (objet JSON valide, ≤ 65 536 points de code) ; le front aligne son aperçu sur serde_json (profondeur ≤ 128, pas de demi-substitut isolé) pour qu'une config annoncée valide ne soit pas refusée.
- **Transaction.** Après un commit réussi, une erreur de fermeture de la connexion est journalisée et l'import renvoie quand même `Ok` (sinon le front n'appellerait pas `reload` alors que la configuration est remplacée). Délai d'attente d'un autre écrivain : 5 s ; un `busy` SQLite arrive en `database { code: "5" }` (à traduire en B5).
- **Contrat IPC.** Si le plan ne se désérialise pas, Tauri rejette avec une **chaîne** et non un `BackupError` : le front la traite comme une erreur inconnue et ne l'affiche jamais brute. Avant `config_import_apply`, B5 vide ou suspend les écritures différées du front (notes, layout) pour qu'aucune écriture tardive ne touche une instance supprimée avant le `reload`.

### 4.13 Erreurs

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackupError {
    Busy, RestartPending, NotFound, InvalidId, NoDatabase, TooLarge, DiskFull,
    InvalidArchive { problem: ArchiveProblem },
    SchemaTooNew { archive: i64, supported: i64 },
    InvalidImport { problem: ImportProblem },
    Io { code: String },        // io::ErrorKind ou code interne ; jamais de chemin
    Database { code: String },  // code SQLite étendu ou "other"
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] #[serde(rename_all = "snake_case")]
pub enum ArchiveProblem { NotZip, Zip64, TooManyEntries, OverlappingEntries, UnexpectedEntry, DuplicateEntry,
    EncryptedEntry, UnsupportedCompression, EntryTooLarge, TotalTooLarge, MissingManifest, MissingDatabase,
    InvalidManifest, UnsupportedFormat, ManifestMismatch, SizeMismatch, ChecksumMismatch, CorruptEntry,
    ImageTypeMismatch, NotSqlite, IntegrityFailed, NotHomebase, UnexpectedSchema, DirtyMigration,
    UnknownMigration, ForeignKeyViolation }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] #[serde(rename_all = "snake_case")]
pub enum ImportProblem { NotConfig, NotUtf8, NoDashboard, TooManyDashboards, TooManyWidgets, TooManySettings,
    InvalidId, DuplicateId, InvalidName, InvalidWidgetType, InvalidGrid, InvalidSortOrder, InvalidConfig,
    InvalidConfigVersion, InvalidSettingKey, SecretSetting, InvalidSettingValue, Constraint }
```

- `StorageFull` → `DiskFull` (S6) ; `sqlx::Error` → `Database`.
- Messages bruts : seulement dans `eprintln!`.
- TS : `BackupErrorDto` reprend ces variantes, plus `{ kind: 'unavailable' }`.

### 4.14 Capabilities, `build.rs`, ESLint

- `build.rs` : la liste actuelle (`schedule_test_notification`, `get_autostart`, `set_autostart`, `weather_forecast`, `weather_geocode`), suivie des 10 commandes du §4.11 dans l'ordre du tableau.
- `capabilities/default.json` : la liste actuelle est conservée. On insère avant `sql:allow-execute`, au fil des lots et dans l'ordre : `allow-backup-list`, `allow-backup-create`, `allow-backup-open-folder`, `allow-backup-restore`, `allow-backup-export`, `allow-backup-pick-external`, `allow-backup-acknowledge`, `allow-config-export-save`, `allow-config-import-pick`, `allow-config-import-apply`. Ajouter à la description : « backup and config-transfer commands open native dialogs from Rust only; no dialog:*, fs:* or process:* permission ».
- Permissions **interdites** : `dialog:*`, `fs:*`, `process:*`, `shell:*`, et toute nouvelle `opener:*`.
- `capability_tests.rs` : liste exacte, plus un test `no_dialog_fs_process_or_shell_permission` sur `default.json` et `debug.json`. Les tests existants restent inchangés et verts.
- `permissions/autogenerated/*.toml` : régénérés, puis commités.
- Pas de paquets npm `@tauri-apps/plugin-dialog` ni `@tauri-apps/plugin-fs`.
- ESLint du front : `'no-alert': 'error'` (lot B3).

### 4.15 UI (Réglages et layout)

Seuls les tokens et classes de `docs/DESIGN.md` sont autorisés ; aucun texte en dur.

**Carte « Sauvegardes »** (`id="backups"`, `app-backup-settings`, `pi pi-database`) :
- texte d'introduction ;
- « Créer une sauvegarde » (`btn-primary`, désactivé pendant l'opération), « Restaurer depuis un fichier… », « Ouvrir le dossier » ;
- messages flash : `lastAutoError`, `preMigrationFailed`, erreur (`role="alert"`), succès (`role="status"`) ;
- liste en `<ul>` de `box-row` :
  - date absolue + relative, type, taille ;
  - libellés « Base seulement », « Endommagée », « Version plus récente » ;
  - « Exporter… » et « Restaurer… », ce dernier désactivé si l'archive est endommagée ou trop récente. Les `aria-label` contiennent la date ;
- état vide ; hors Tauri, boutons désactivés.

**Dialogue de restauration** (PrimeNG `Dialog` modal, `aria-labelledby`) :
- résumé, avertissement, case obligatoire ;
- focus initial sur « Annuler » ; « Restaurer et redémarrer » (`btn-danger`) reste désactivé tant que la case n'est pas cochée ou pendant l'opération ; Échap ferme, sauf pendant l'opération ;
- pendant l'appel : « Restauration en cours… » ; quand il réussit : « Redémarrage de Homebase… » ;
- en cas d'échec : message flash et case décochée.

**Carte « Configuration »** (`app-config-transfer-settings`, `pi pi-sliders-h`) :
- boutons d'export et d'import ;
- aperçu (`role="region"`, `aria-live="polite"`) avec trois avertissements distincts (dashboards supprimés, widgets supprimés, widgets recréés), la mention de la sauvegarde de sécurité, les types inconnus et les versions plus récentes ;
- « Annuler » / « Importer » (`btn-danger`) ;
- fichier invalide : message flash, puis au plus 20 problèmes.

**Bandeau** (`app-backup-alert`, au-dessus de `<router-outlet />`, `role="status"`) :
- `dbMissingAlert` (avec la date et un lien vers `/settings#backups`), `lastRestore`, `preMigrationFailed` ;
- « Ignorer » appelle `backup_acknowledge` ;
- chargement unique ; hors Tauri, rien.

**Accessibilité** : boutons réels, focus visible, `aria-busy`, annonces vocales, focus piégé dans le dialogue.

### 4.16 i18n FR (`core/i18n/fr.json`, à ajouter)

```
time.justNow                    à l'instant
backup.title                    Sauvegardes
backup.intro                    Une sauvegarde contient la base et les images. Homebase garde les 10 dernières sauvegardes manuelles, les 7 quotidiennes, les 5 de sécurité et les 3 d'avant mise à jour.
backup.create                   Créer une sauvegarde
backup.creating                 Sauvegarde en cours…
backup.created                  Sauvegarde créée.
backup.restoreFromFile          Restaurer depuis un fichier…
backup.openFolder               Ouvrir le dossier
backup.empty                    Aucune sauvegarde pour l'instant.
backup.unavailable              Disponible uniquement dans l'application Windows.
backup.export                   Exporter…
backup.exportLabel              Exporter la sauvegarde du {{ date }}
backup.exported                 Sauvegarde exportée.
backup.restore.action           Restaurer…
backup.restore.actionLabel      Restaurer la sauvegarde du {{ date }}
backup.restore.title            Restaurer une sauvegarde
backup.restore.summary          Sauvegarde du {{ date }} ({{ kind }}), Homebase {{ version }}
backup.restore.images           {{ count }} image(s)
backup.restore.dbOnly           Base seulement (les images actuelles sont conservées)
backup.restore.warning          L'état actuel sera remplacé par cette sauvegarde. Une sauvegarde de sécurité est créée avant. Homebase va redémarrer.
backup.restore.acknowledge      Je comprends que les modifications faites depuis cette sauvegarde seront perdues.
backup.restore.confirm          Restaurer et redémarrer
backup.restore.cancel           Annuler
backup.restore.inProgress       Restauration en cours…
backup.restore.restarting       Redémarrage de Homebase…
backup.kind.manual              Manuelle
backup.kind.daily               Quotidienne
backup.kind.pre-migration       Avant mise à jour
backup.kind.pre-restore         Avant restauration
backup.kind.pre-import          Avant import
backup.label.dbOnly             Base seulement
backup.label.damaged            Endommagée
backup.label.tooNew             Version plus récente
backup.status.autoError         La dernière sauvegarde automatique a échoué : {{ reason }}
backup.alert.dbMissing          Aucune base de données n'a été trouvée au démarrage alors que des sauvegardes existent (la plus récente : {{ date }}). Vos données ont peut-être été perdues.
backup.alert.seeBackups         Voir les sauvegardes
backup.alert.dismiss            Ignorer
backup.alert.restore.applied    Restauration effectuée (sauvegarde du {{ date }}).
backup.alert.restore.rolled-back La restauration n'a pas pu démarrer : l'état précédent a été rétabli.
backup.alert.restore.failed     La restauration a échoué : l'état précédent a été conservé. Vous pouvez réessayer.
backup.alert.preMigrationFailed La sauvegarde automatique avant mise à jour a échoué.
backup.errors.busy              Une autre opération de sauvegarde est en cours.
backup.errors.restart_pending   Homebase redémarre pour terminer une restauration.
backup.errors.not_found         Cette sauvegarde n'existe plus.
backup.errors.invalid_id        Sauvegarde inconnue.
backup.errors.no_database       Aucune base à sauvegarder.
backup.errors.too_large         Fichier trop volumineux.
backup.errors.disk_full         Espace disque insuffisant.
backup.errors.invalid_archive   Ce fichier n'est pas une sauvegarde Homebase valide : {{ problem }}
backup.errors.schema_too_new    Cette sauvegarde vient d'une version plus récente de Homebase (schéma {{ archive }}, version actuelle {{ supported }}). Mettez Homebase à jour d'abord.
backup.errors.invalid_import    Configuration refusée : {{ problem }}
backup.errors.io                Erreur de fichier ({{ code }}).
backup.errors.database          Erreur de base de données ({{ code }}).
backup.errors.unavailable       Disponible uniquement dans l'application Windows.
backup.archiveProblems.<chaque ArchiveProblem>   une phrase courte par motif
configTransfer.title            Configuration
configTransfer.intro            Exporte ou importe les tableaux de bord, les widgets et les réglages (sans les notes, tâches ni raccourcis).
configTransfer.export           Exporter la configuration…
configTransfer.exported         Configuration exportée.
configTransfer.import           Importer une configuration…
configTransfer.preview          Le fichier contient {{ dashboards }} tableau(x) de bord, {{ widgets }} widget(s) et {{ settings }} réglage(s).
configTransfer.removedDashboards {{ count }} tableau(x) de bord actuel(s) absent(s) du fichier seront supprimés, avec leurs widgets.
configTransfer.removedWidgets   {{ count }} widget(s) actuel(s) absent(s) du fichier seront supprimés avec leurs données (notes, tâches).
configTransfer.replacedWidgets  {{ count }} widget(s) changent de type : ils seront recréés et leurs données supprimées.
configTransfer.safetyBackup     Une sauvegarde de sécurité de la base est créée avant l'import.
configTransfer.unknownTypes     Types de widgets inconnus (conservés tels quels) : {{ types }}
configTransfer.futureVersions   {{ count }} configuration(s) créée(s) par une version plus récente (conservées telles quelles).
configTransfer.confirm          Importer
configTransfer.cancel           Annuler
configTransfer.invalid          Le fichier est invalide :
configTransfer.issues.<chaque code d'issue>      message court
```

---

## 5. Cas limites

| Cas | Comportement |
|---|---|
| Opérations simultanées / redémarrage en cours | `busy` / `restart_pending`. Le fil quotidien passe son tour |
| Même milliseconde | `AlreadyExists`, jamais d'écrasement |
| Disque plein ou panne pendant une création | `disk_full` ; les fichiers temporaires sont nettoyés (immédiatement ou au démarrage) |
| Horloge reculée | Le fichier créé et `protect` sont protégés. Une archive « du futur » est ignorée par le contrôle quotidien |
| Changement d'heure / fuseaux | Tout est en UTC ; l'affichage passe par `TimeDisplay` |
| Base absente (R6) | Marqueur, bandeau, rétention suspendue. Ni `pre-migration`, ni marqueur d'échec |
| Boucle de plantage avant une migration | Réserve « migration » de 3 : les sauvegardes de sécurité ne sont pas touchées |
| `restore-pending` altéré | `failed`, état intact |
| Schéma plus récent / plus ancien | Plus récent : refus (`schema_too_new` l'emporte, la référence n'est pas construite). Plus ancien : accepté, migré au démarrage après une `pre-migration` |
| `_sqlx_migrations` absente, vue, table virtuelle, colonnes modifiées | `not_homebase` / `unexpected_schema`, avant toute comparaison de schéma |
| Base piégée (déclencheur, vue, `sqlite_*` renommé) | `unexpected_schema` |
| Zip slip, zip bomb, zip64, millions d'entrées, doublons, chiffrement, liens | Refus avant toute écriture hors de `dest` |
| Image dont la signature ne correspond pas, ou extension interdite | `image_type_mismatch` / `unexpected_entry` |
| Autre instance qui tient `homebase.db` | Réessais pendant 2 s, puis `failed` (rien n'a bougé) |
| `preload` qui échoue sur la base restaurée | Panique ; au relancement, retour arrière (`rolled-back`) |
| Panne entre le déplacement de la base et celui du `-wal` | Le `-wal` resté à la racine est l'original : conservé |
| `-journal` chaud de la base restaurée | Supprimé au retour arrière, jamais rejoué sur l'originale |
| Panne pendant `rollback()` | `rollback()` relancé au démarrage suivant, avec le même état final (idempotence testée) |
| Échec du marquage de confirmation (fichier verrouillé) | Échec du setup de l'app et message natif. Au lancement suivant : retour arrière (`rolled-back`). Aucune écriture n'a eu lieu dans la session |
| Panne ou verrou pendant la suppression d'un dossier confirmé | Au démarrage suivant, la suppression se termine. **Jamais de restauration de l'état d'origine** |
| Retour arrière impossible / `restore-info` illisible avec un dossier non vide | `StartupBlocked` : message natif, rien n'est supprimé, nouvel essai au lancement suivant |
| Source de la restauration dans une réserve pleine | Protégée |
| Import : réimport identique | Idempotent ; un nom stocké avec un espace en bord est normalisé une fois (§4.3) |
| Import : instance déplacée hors d'un dashboard supprimé | Déplacée (upsert) avant la suppression du dashboard : données conservées |
| Import : `__proto__`, `constructor`, `prototype` | Refusé ou retiré, sans pollution |
| Import : `CHECK` violé en cours de transaction | Annulation complète |
| `config_import_pick` sur un fichier quelconque | `not_config` / `not_utf8`, contenu jamais renvoyé |
| Dialogue annulé | `false` / `null`, sans message |
| Fichiers étrangers dans `backups\` | Ignorés |

---

## 6. Sécurité

- **Surface IPC** : 10 commandes, sans aucun argument de chemin, et aucune permission de plugin côté JS.
- **XSS** (même realm JavaScript) :
  - elle peut restaurer, importer ou créer des sauvegardes. Ces actions sont récupérables via `pre-restore` / `pre-import`, et la rotation est bornée ;
  - elle ne peut lire que des fichiers de configuration Homebase choisis par l'utilisateur ;
  - elle n'a accès à aucun chemin arbitraire ;
  - risque résiduel accepté, inférieur à `sql:allow-execute` (ADR-002 R1).
- **Fichiers externes = données** :
  - noms filtrés par liste blanche, chemins de sortie construits par nous, limites, EOCD vérifiée avant l'ouverture, SHA-256, signatures d'image ;
  - inspection en `immutable` avec `trusted_schema=OFF`, `cell_size_check=ON` et `mmap_size=0` ;
  - `_sqlx_migrations` vérifiée (type, DDL, colonnes) avant de lire son contenu ;
  - comparaison de **toutes** les lignes de `sqlite_schema`.
- **Secrets** : aucun dans la base, donc aucun dans les archives. Les clés secrètes sont filtrées à l'export et refusées à l'import. Le gestionnaire d'identifiants Windows n'est pas sauvegardé (phase 6 : à ressaisir après une restauration sur un autre PC).
- **Moindre privilège** : le plugin dialog n'expose aucune permission JS ; `no-alert` empêche l'appel aux fonctions remplacées (V13) ; ni fs, ni process ; l'opener reçoit uniquement un chemin fixe ; la CSP est inchangée.
- **Erreurs** : aucun chemin ni message brut ne remonte au front. Le message natif `StartupBlocked` affiche le chemin local : il est destiné à l'utilisateur, pas à la WebView.

---

## 7. Conséquences

**Positives**
- Sauvegardes vérifiables et restaurations sûres, y compris en cas de panne à n'importe quelle étape.
- O1 traité pour sa partie sauvegarde.
- Import atomique.
- Aucune permission JS ajoutée.
- Premier accès Rust à la base (O2).

**Coûts**
- Nouvelles dépendances : `zip` (+ `flate2` / `zlib-rs`), `sha2`, `sqlx` et `jiff` (déjà compilés en transitif), `tauri-plugin-dialog` (+ `rfd`, ajouté aussi en dépendance directe pour le message natif ; la crate `tauri-plugin-fs` est compilée mais pas enregistrée) et `tempfile` (dev).
- Environ 2 000 lignes de Rust et de tests.
- Le schéma est désormais connu du Rust (import, `_sqlx_migrations`) : à maintenir quand le schéma change.
- 10 commandes IPC à maintenir.
- Le script injecté par le plugin dialog remplace `alert` et `confirm` : les dialogues natifs JS deviennent interdits (`no-alert`).
- Le code des dialogues doit être isolé des tests (S11).
- Un démarrage peut être **refusé**, avec un message natif, plutôt que de risquer une perte de données.

---

## 8. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| R-B1. Démarrage bloqué | L'application ne démarre pas tant que la cause persiste | Rien n'est supprimé en cas de doute. Le message natif donne la marche à suivre ; `startup-blocked.json` sert au diagnostic ; machine à états testée à chaque point de panne (échange, retour arrière, confirmation). Récupération manuelle : remettre ensemble à la racine la base et ses compagnons depuis `restore-rollback\` ; sauvegarde `pre-restore` dans `backups\` |
| R-B2. Images volumineuses | Limite de 3 Gio atteinte | Images stockées sans compression, `too_large`, revue en phase 5 |
| R-B3. Profil itinérant | Synchronisation des archives | Sans objet sur ce PC |
| R-B4. Horloge reculée | Rotation inattendue | Archives créées et protégées épargnées ; dates futures ignorées |
| R-B5. Deux instances | Échange impossible | Réessais puis `failed` ; single-instance en phase 2 |
| R-B6. sqlx 0.9 proposé par Dependabot | Échec du build (`links`) | `ignore` (§10.6) |
| R-B7. `rfd` dans les tests | `cargo test` plante | Bouchon `cfg(test)`, repli par manifeste (S11) |
| R-B8. Schéma Rust désynchronisé | Import ou restauration refusés | Tests sur la dernière version du schéma ; V25 |

---

## 9. Vérifications manuelles (Marius, exe release après B5, sauf mention)

- **M1** Console sans erreur liée au plugin dialog. La carte « Sauvegardes » est visible. 2 minutes après le démarrage, une sauvegarde « Quotidienne » apparaît s'il n'y en avait aucune.
- **M2** « Créer une sauvegarde » ajoute une ligne « Manuelle, à l'instant ». « Ouvrir le dossier » ouvre `…\backups`. Le zip s'ouvre dans l'Explorateur.
- **M3** Créer une sauvegarde, ajouter une tâche, puis restaurer : l'application redémarre, la tâche a disparu, le bandeau indique « Restauration effectuée », et une sauvegarde « Avant restauration » existe. Restaurer cette dernière fait revenir la tâche.
- **M4** Application quittée : déposer une archive altérée (1 octet modifié) dans `restore-pending\`, puis relancer. L'état est intact et le bandeau indique « échoué ».
- **M5** « Exporter… » vers le Bureau : le fichier est créé et l'application ne se fige pas.
- **M6** « Restaurer depuis un fichier… » avec ce fichier : le résumé s'affiche, puis la restauration fonctionne. Avec un `.zip` quelconque : message d'archive invalide.
- **M7** Après M3, un seul processus Homebase (Gestionnaire des tâches) et une seule icône dans la zone de notification. Refaire M3 après avoir masqué la fenêtre dans la zone de notification puis l'avoir rouverte : le comportement est identique.
- **M8** Quitter, renommer `homebase.db` en `homebase.db.bak`, relancer : le bandeau « Aucune base… » s'affiche, et le lien mène à la carte. Restaurer la dernière sauvegarde.
- **M9** Exporter la configuration (le JSON ne contient aucune clé de jeton), déplacer un widget, puis importer : la position d'origine revient et les tâches sont conservées. `"formatVersion": 2` est refusé. Un `.json` quelconque est refusé (`not_config`) et son contenu n'est pas affiché.
- **M10** À la migration V4 : une sauvegarde « Avant mise à jour » (base seule) est créée au premier lancement.
- **M11** Application quittée : créer `<racine>\restore-rollback\` contenant un fichier `x.txt` (sans `restore-info.json`), puis lancer. Un message natif s'affiche, l'application ne démarre pas, et aucune base n'est créée ni modifiée. Supprimer le dossier et relancer : l'application démarre normalement, et `startup-blocked.json` a disparu (S14).

---

## 10. Amendements à appliquer par le coordinateur

### 10.1 ADR-002 (§2.7 et §7)

Remplacer les puces « Sauvegarde » et « Restauration » du §2.7 par :
> - **Sauvegarde** (phase 1, `docs/specs/backup-restore.md`) : commande Rust ; instantané `VACUUM INTO` par une connexion sqlx dédiée en lecture seule (`sqlx` 0.8 direct) ; archive `backups\homebase-<stamp UTC>-<kind>.zip` (base, `images/`, `manifest.json` avec version de schéma et SHA-256), écrite en `.tmp` puis renommée. Rétention : 10 manuelles, 7 quotidiennes, 5 de sécurité, 3 avant migration. Automatiques : quotidienne (application ouverte), avant migration et avant import (base seule), avant restauration. NAS en phase 6.
> - **Restauration** : jamais à chaud. Validation complète (liste blanche, limites, SHA-256, signatures d'images, `integrity_check`, `_sqlx_migrations` vérifiée, toutes les lignes de `sqlite_schema` comparées aux migrations du binaire, version ≤ courante), sauvegarde `pre-restore`, dépôt du **dossier** `restore-pending\`, puis redémarrage. Au démarrage, un plugin interne enregistré **avant** le plugin SQL échange les fichiers ; les originaux et leurs compagnons `-wal`/`-shm`/`-journal` vont dans `restore-rollback\`. La confirmation (dans le setup de l'app, seulement si l'échange a eu lieu dans ce processus) renomme atomiquement ce dossier en `restore-rollback.confirmed-*` avant de le supprimer. Sans confirmation : retour à l'état d'origine. Si le retour arrière est impossible, le démarrage est refusé (message natif).
> - **Avant migration** : instantané (base seule) avant le `preload` quand le binaire est plus récent que la base. Rien si la base est absente.

§7 : O1 partiellement traité (sauvegarde avant migration ; l'écran d'erreur natif complet reste en phase 6). O2 : connexion sqlx dédiée par opération en place.

### 10.2 ADR-001 (§3.5 et §7)

Ajouter après l'exemple du §3.5 :
> *Amendement phase 1 (spec backup-restore)* : `exportedAt`, `dashboards` et `"settings": { "<clé>": <JsonValue> }` (éventuellement vide) sont **obligatoires**. L'enveloppe est stricte. Les clés secrètes sont exclues à l'export et refusées à l'import. Import = **remplacement par identifiant** (décision de Marius) : lignes existantes mises à jour en place, y compris une instance qui change de dashboard ; `widgetType` différent → suppression puis recréation ; dashboards et widgets absents supprimés avec leurs données, après aperçu et sauvegarde `pre-import` ; `settings` fusionné ; au moins un dashboard. Le tout est appliqué atomiquement par `config_import_apply` (`BEGIN IMMEDIATE`). `future-version` et types inconnus sont conservés tels quels ; toute autre config invalide fait refuser le fichier. Les longueurs se comptent en points de code ; `trim` = `HB_TRIM`.

§7, point 4 : clos.

### 10.3 ADR-003 (§8.8, lot B)

> `src/time/mod.rs`, `clock.rs`, `error.rs` (enum `TimeError` complète de l'ADR-003 §8.9, conformément à D4), `formats.rs` (`format_instant`, `parse_instant`) et `clippy.toml` existent déjà (spec backup-restore, B1a), ainsi que `jiff = "0.2"`. Le lot B les complète sans en changer les signatures.

### 10.4 PLAN.md (« Natif »)

> `tauri-plugin-dialog` (dialogues ouverts par Rust uniquement, aucune permission JS ; ESLint `no-alert` car son script injecté remplace `alert`/`confirm`) ; `rfd` direct pour le message natif de démarrage bloqué ; archives `zip` 9 ; accès Rust à la base via `sqlx` 0.8 (même version que `tauri-plugin-sql`).

### 10.5 ROADMAP

À la fin de B5 : cocher la tâche et ajouter « (spec `docs/specs/backup-restore.md` ; vérifications manuelles M1 à M11 à faire par Marius) ». En phase 6, « Sauvegardes automatiques » : ajouter « rétention configurable, emplacement secondaire, écran d'erreur natif complet ».

### 10.6 Dependabot (fait par l'implementer en B1b)

Dans la section `cargo` de `.github/dependabot.yml` :
```yaml
    ignore:
      # tauri-plugin-sql stays on sqlx 0.8; a direct sqlx 0.9 would link a second libsqlite3-sys.
      - dependency-name: 'sqlx'
        versions: ['>=0.9']
```

### 10.7 ADR-006 (phase 5)

Seuls les formats `png`, `jpg`, `jpeg`, `webp`, `gif` et `avif` sont acceptés, avec une signature binaire conforme. Toute écriture passe par un fichier temporaire au nom non conforme, puis un renommage.

---

## 11. Lots d'implémentation

**Règles communes**
- Lire `CLAUDE.md`, puis toute cette spec. Les chemins Rust sont relatifs à `apps/desktop/src-tauri/`, les chemins TS à `apps/web/src/app/`.
- Interdits : `unwrap()` et `expect()` hors des tests, `any`, toute nouvelle migration, toute modification de `data/`.
- À conserver : `weather_*`, `net::NetClient` et les tests de capabilities existants.
- Code ajouté mais pas encore appelé : marquer le **module** `#[allow(dead_code)] // used from lot <X>`. Le lot X retire cette annotation (c'est un critère).
- Tests Rust : `tempfile::TempDir` uniquement, jamais le vrai `%APPDATA%` ; les fonctions async passent par `block_on` ; aucun test n'atteint `rfd`.
- Fonction d'aide `test_support::make_database(path, up_to, with_sample_rows)`, écrite en B1b : base WAL, `_sqlx_migrations` créée avec le DDL **exact** recopié depuis `sqlx-sqlite-0.8.6/src/migrate.rs` (registre cargo local ; il doit donner V25), migrations exécutées par `raw_sql`, checksums SHA-384.
- **Commandes de vérification de fin de lot** (depuis la racine, toutes vertes) :
  ```
  npm run format:check
  npm run lint
  npm run test
  npm run rust:fmt:check
  npm run rust:lint
  npm run rust:test
  cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --release --all-targets -- -D warnings
  ```
  En B5, s'y ajoute `npm run web:build`.
- **Conditions d'arrêt communes** : une supposition infirmée ; un test existant qui casse sans lien avec le lot ; un second `libsqlite3-sys` ou `sqlx` dans `Cargo.lock` ; un dépassement du budget du build web. Dans ces cas : s'arrêter et rapporter.
- **Rapport de chaque lot** : fichiers touchés, résultats des commandes, suppositions vérifiées, écarts constatés.

### Lot B1a : temps, noms, utilitaires de fichiers, rétention

**Cargo.toml** : ajouter `jiff = "0.2"` ; en `[dev-dependencies]`, `tempfile = "3"`.

**Créer** :
- `clippy.toml` (ADR-003 §8.9) ;
- `src/time/mod.rs`, `clock.rs` (`Clock`, `SystemClock`, seul à porter `#[allow(clippy::disallowed_methods)]`, et `FixedClock` sous `#[cfg(test)]`), `error.rs`, `formats.rs` ;
- `src/backup/mod.rs` (constantes du §4.3, `BackupState`, `BusyGuard`), `error.rs`, `paths.rs` (`DataRoot`, §4.1), `names.rs`, `fsutil.rs`, `retention.rs`, `status.rs` (lecture et écriture des marqueurs, `BackupStatus`).

**Modifier** :
- `src/lib.rs` : `mod time; mod backup;` avec `#[allow(dead_code)] // used from lot B1b`.
- `src/db.rs` : `pub const DB_FILE_NAME`, plus un test vérifiant que `DB_URL == format!("sqlite:{DB_FILE_NAME}")`.

Signatures :
```rust
pub fn format_instant(t: jiff::Timestamp) -> String;                  // "%Y-%m-%dT%H:%M:%S%.3fZ"
pub fn parse_instant(s: &str) -> Result<jiff::Timestamp, TimeError>; // 24 car. stricts, parse, aller-retour exact, 1900..=2199
impl BackupKind { pub fn as_str(self) -> &'static str; pub fn pool(self) -> Pool; pub fn includes_images(self) -> bool; } // false : PreMigration, PreImport
pub enum Pool { Manual, Daily, Safety, Migration }
pub struct BackupName { pub created_at: jiff::Timestamp, pub kind: BackupKind }
impl BackupName { pub fn new(..) -> Self; pub fn stamp(&self) -> String; pub fn file_name(&self) -> String; pub fn parse(file_name: &str) -> Option<Self>; }
pub fn is_uuid_shape(s: &str) -> bool;
pub fn is_image_file_name(s: &str) -> bool;
pub fn hb_trim(s: &str) -> &str;
// fsutil.rs
pub fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()>;
pub fn remove_with_retry(path: &Path) -> io::Result<()>;          // fichier ou dossier ; absent = Ok
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> io::Result<()>;
pub fn image_signature_matches(ext: &str, header: &[u8]) -> bool;
// mod.rs
pub struct BackupState { pub root: DataRoot, pub clock: Arc<dyn Clock>, busy: AtomicBool, restart_pending: AtomicBool,
    pub swapped_this_process: bool, pub last_auto_error: Mutex<Option<BackupError>> }
impl BackupState { pub fn new(root: DataRoot, clock: Arc<dyn Clock>, swapped: bool) -> Self;
    pub fn try_acquire(&self) -> Result<BusyGuard<'_>, BackupError>; pub fn mark_restart_pending(&self); }
// retention.rs
pub fn apply_retention(root: &DataRoot, keep: &str, protect: &[&str]) -> Vec<String>;
```

**Tests** :
- `formats` : aller-retour, troncature, formes refusées, années 1899 et 2200 refusées.
- `names` : 5 types en aller-retour ; noms piégés, type inconnu, stamp invalide et `.ZIP` refusés ; images (6 extensions acceptées ; `svg`, `html`, `exe`, `lnk`, majuscules et `..` refusés).
- `hb_trim` : table de vecteurs U+0020, U+00A0, U+FEFF, U+0085, U+3000, caractères intérieurs conservés. Cette table est réutilisée en B4b.
- `image_signature_matches` : un cas valide et un cas invalide par extension.
- `write_json_atomic` : aucun `.tmp` ne reste.
- `rename_with_retry` (`#[cfg(windows)]`) : un fichier ouvert sans partage puis libéré après 300 ms par un autre fil est renommé avec succès ; une erreur persistante au-delà de 2 s remonte.
- Rétention : réserves indépendantes, `keep` épargné, `protect` épargné même s'il est le plus ancien, suspension par `db-missing.json`, fichiers étrangers intacts.
- `try_acquire` : `busy`, libération au `drop`, priorité de `restart_pending`.
- `status` : cycle de vie des marqueurs du §4.1, en lecture et en écriture.

**Critères**
- **CA-B1a.1** Les tests et les commandes de vérification passent.
- **CA-B1a.2** `rg "SystemTime::now|Timestamp::now" src` ne trouve que `time/clock.rs`. Ajouter temporairement `SystemTime::now()` dans `lib.rs` fait échouer `rust:lint` (vérifier puis annuler).

**Arrêt** : si `clippy.toml` déclenche une alerte sur du code existant qu'on ne peut pas adapter sans changer de comportement.

### Lot B1b : instantané, archive, création, liste, commandes de base

**Cargo.toml** : ajouter `sha2 = "0.10"`, `sqlx = { version = "0.8", default-features = false, features = ["sqlite", "runtime-tokio"] }` et `zip = { version = "9.0.5", default-features = false, features = ["deflate-flate2-zlib-rs"] }`. Vérifier ensuite qu'il n'existe qu'un seul `libsqlite3-sys` et un seul `sqlx`.

**Créer** : `src/backup/sqlite.rs` (`supported_schema_version`, `snapshot_into`, `read_schema_version`), `archive.rs` (`write_archive`, `read_manifest`), `manifest.rs`, `create.rs` (`create_backup`, async ; tout le travail sur les fichiers dans un seul `spawn_blocking`, §4.4), `list.rs` (`list_backups`, `newest_full_backup`), `commands.rs` (`backup_list`, `backup_create`, `backup_open_folder`), `test_support.rs` (`#[cfg(test)]`).

**Modifier** :
- `lib.rs` : retirer le `#[allow(dead_code)]` de B1a ; ajouter les commandes aux **deux** `invoke_handler` en gardant `weather_*` ; enregistrer `BackupState` dans `.setup()` à partir de `app.path().app_config_dir()` (B2b le déplacera dans le plugin).
- `build.rs`, `capabilities/default.json`, `capability_tests.rs` (liste exacte + `no_dialog_fs_process_or_shell_permission`), `.github/dependabot.yml` (§10.6).

**Tests** :
- `snapshot_into` : les lignes encore dans le `-wal` sont présentes (S1) ; une cible existante provoque une erreur.
- `read_schema_version` : base absente → `None`, sans créer de fichier.
- `create_backup` :
  - nom attendu (avec `FixedClock`), contenu, SHA-256, `schemaVersion = 3`, `.tmp\` vidé ;
  - images non conformes ignorées (nom, sous-dossier, signature) ;
  - `PreMigration` et `PreImport` sans images ;
  - `no_database` ; collision de nom ; faute injectée avant le renommage ;
  - `too_large` via `Limits` paramétrables en test.
- `list_backups` : tri, archives `damaged`, fichiers étrangers ignorés. `newest_full_backup` exclut les archives endommagées, `pre-*` de migration et d'import, et les dates futures.
- `test_support` : `pragma_table_xinfo('_sqlx_migrations')` est égal à V25.
- Capabilities.
- `lib.rs` (test textuel) : commandes présentes dans les deux listes, `weather_*` toujours là.

**Critères**
- **CA-B1b.1** Les tests et les commandes de vérification passent.
- **CA-B1b.2** Un seul `libsqlite3-sys` et un seul `sqlx`. `zip` est compilé sans zstd, bzip2, aes ni lzma (sortie de `cargo tree -e features -i zip` jointe au rapport). Dependabot est à jour.
- **CA-B1b.3** Aucune commande n'a d'argument de chemin. `rename_with_retry` n'est jamais appelé hors d'un `spawn_blocking` dans du code async (revue de code).

**Arrêt** : S1 (sans repli possible), S3, ou un DDL de `_sqlx_migrations` différent de V25.

### Lot B2a : validation d'archive et inspection de la base

**Créer** : `src/backup/validate.rs`. Il contient `pre_read_eocd`, `extract_validated`, `inspect_restored_database` (dans l'**ordre imposé** au §4.7, point 9), `expected_schema`, la constante des lignes supplémentaires autorisées et la liste V25. Le module porte `#[allow(dead_code)] // used from lot B2b`.

**Tests** :
- Une archive produite par `create_backup` est acceptée.
- Structure du zip : EOCD absent ; nombre d'entrées au-delà de la limite (EOCD forgé) ; marqueur zip64.
- Noms refusés : `../x`, `/x`, `C:/x`, `images/../homebase.db`, `images\x.webp`, `homebase.db:ads`, `images/sub/x.webp`, `IMAGES/…`, `images/x.svg`, entrée de dossier. Doublon refusé. Entrée chiffrée et méthode inconnue : tester si c'est faisable sans feature supplémentaire, sinon documenter et sauter.
- Tailles : limites réduites dépassées ; données plus longues que la taille déclarée.
- Manifeste : absent, invalide, `formatVersion: 2`, champ inconnu, fichier listé mais absent, fichier présent mais non listé. SHA-256 faux. Un `.png` qui contient du texte.
- **Ordre d'inspection** :
  - base non SQLite → `not_sqlite` ;
  - sans `_sqlx_migrations` → `not_homebase` (et non `unexpected_schema`) ;
  - `_sqlx_migrations` en vue, en table virtuelle, avec une colonne en plus ou une colonne générée → `unexpected_schema` ;
  - `success = 0` → `dirty_migration` ;
  - version 99 → **`schema_too_new`** (et non `unexpected_schema`) ;
  - checksum modifié → `unknown_migration`.
- **Schéma** : déclencheur ajouté, vue ajoutée, **déclencheur renommé `sqlite_evil` via `writable_schema`**, index en plus, table en plus → `unexpected_schema`. `sqlite_stat1` avec un SQL exact est acceptée, avec un autre SQL refusée.
- `foreign_key_check` non vide → `foreign_key_violation`.
- Une base V1 seule est acceptée (version 1).
- Aucun fichier n'est écrit hors de `dest`, et `dest` est supprimé en cas d'échec.
- Chemin avec espaces et accents (S9) ; aucun compagnon créé (S2) ; `expected_schema(3)` est correct (S4).

**Critères**
- **CA-B2a.1** Les tests et les commandes de vérification passent.
- **CA-B2a.2** Ni `ZipArchive::extract`, ni `enclosed_name`, ni `mangled_name` dans `src/`.
- **CA-B2a.3** Aucun filtre sur le préfixe `sqlite_` dans la comparaison de schéma.

**Arrêt** : S2, S4 ou S9 infirmées.

### Lot B2b : restauration, séquence de démarrage, confirmation

**Créer** :
- `src/backup/restore.rs` : `stage_restore`, échange, `rollback`, `confirm_restore`, `RestoreInfo`. Points de panne de test : `SwapStep` (étapes 1 à 8), `RollbackStep` (après chaque élément) et `ConfirmStep` (après le marquage, pendant la suppression).
- `src/backup/startup.rs` : `startup_sequence`, `init<R: Runtime>() -> TauriPlugin<R>` (gère `StartupBlocked` : journal, marqueur, `Err` ; le message natif arrive en B3), `on_app_ready<R: Runtime>(app)`.

**Modifier** :
- `commands.rs` : `backup_restore(Internal)`, qui appelle `request_restart()`.
- `lib.rs` :
  - `.plugin(backup::startup::init())` placé **juste avant** `tauri_plugin_sql` ; `BackupState` est géré par ce plugin ;
  - `.setup()` appelle d'abord `on_app_ready`, qui appelle `confirm_restore` et **propage son erreur**, puis `tray::setup` ;
  - retirer le `#[allow(dead_code)]` posé en B2a.
- `build.rs`, `capabilities/default.json`, `capability_tests.rs`.

En B2b, `startup_sequence` couvre les étapes 1 à 5 et 8 du §4.8. B3 ajoutera les étapes 6 et 7.

**Tests** :
- **Préparation** : contenu de `restore-pending` ; `pre-restore` créée ; source protégée ; en cas d'échec de validation, ni `restore-pending` ni `pre-restore`.
- **Cas nominal** : échange, puis `confirm_restore(true)` → `applied`, `db-missing` supprimé, plus aucun dossier `restore-rollback*`.
- `confirm_restore(false)` avec un `restore-rollback\` présent : rien n'est supprimé.
- **Pannes pendant l'échange**, après chacune des 8 étapes, avec à l'origine une base, `-wal`, `-shm`, `-journal` et des images, puis nouvel appel de `startup_sequence`. L'état final est soit l'original **octet pour octet** (base et chaque compagnon), soit la restauration. Cas particulier : panne entre les étapes 3 et 4, où le `-wal` d'origine doit être conservé.
- **Pannes pendant `rollback()`** (chaque `RollbackStep`) : nouvel appel, puis état d'origine exact (idempotence).
- **Panne pendant la suppression d'un dossier confirmé** (`ConfirmStep`, dossier `.confirmed-*` à moitié supprimé) : au démarrage suivant, la suppression se termine, la base restaurée **et son `-wal` de session** restent intacts, aucun original n'est remis, et `last-restore` vaut `applied`.
- **Fichier verrouillé pendant le marquage** (`#[cfg(windows)]`, au-delà de 2 s) : `confirm_restore` renvoie une erreur, `startup-blocked.json` contient `confirm_mark_failed`. Au démarrage suivant (verrou levé), retour à l'original, puis `rolled-back`, et `startup-blocked.json` est supprimé.
- **Fichier verrouillé pendant la suppression d'un dossier confirmé** : `Ok`, le dossier subsiste. Au démarrage suivant, il est supprimé sans restauration.
- Échange, puis lancement suivant sans confirmation, avec un `-journal` étranger déposé : retour à l'original, le `-journal` est supprimé, `rolled-back`.
- `restore-pending` altéré, avec un fichier en trop ou manquant : `failed`.
- `originalHadDb = false` ; `includesImages = false`.
- **Retour arrière impossible** (verrou au-delà de 2 s) : `Err(StartupBlocked)`, aucune suppression, marqueur écrit. `restore-info.json` absent avec un dossier non vide : `StartupBlocked`. Absent avec un dossier vide : `Ok`.
- `homebase.db` verrouillé à l'étape 3 : `failed`.
- `lib.rs` (test textuel) : `backup::startup::init()` avant `tauri_plugin_sql::Builder`, et `on_app_ready` avant `tray::setup`.

**Critères**
- **CA-B2b.1** Les tests et les commandes de vérification passent.
- **CA-B2b.2** Ni commande `app_restart` ni plugin `process`.
- **CA-B2b.3** `confirm_restore` ne supprime **jamais** `restore-rollback\` sans l'avoir d'abord renommé en `.confirmed-*` (revue de code + test).

**Arrêt** : une configuration de panne qui ne peut pas aboutir à l'état d'origine ou à l'état restauré exact.

### Lot B3 : dialogues, message natif, sauvegardes automatiques, R6, `no-alert`

**Cargo.toml** :
- ajouter `tauri-plugin-dialog = "2.8.3"` ;
- ajouter `rfd` avec **exactement** la version tirée par le plugin (relevée par `cargo tree -i rfd`, features par défaut du plugin) ;
- aucun paquet npm.

**Créer** : `src/backup/dialogs.rs`, sous `#[cfg(not(test))]` : `pick_archive`, `save_archive`, `pick_config`, `save_config`, toutes de type `-> Option<PathBuf>`, plus `show_startup_blocked(root: &Path)` (`rfd::MessageDialog`, texte du §4.8). Sous `#[cfg(test)]` : un **bouchon** de mêmes signatures, qui renvoie `None` ou ne fait rien, sans aucune référence à `rfd`.

**Modifier** :
- `lib.rs` : `register_dialog(builder)`, qui ne fait rien sous `cfg(test)`.
- `startup.rs` : appeler `dialogs::show_startup_blocked` sur `StartupBlocked` et sur `confirm_mark_failed` ; étapes 6 et 7 (R6, `pre-migration`) ; fil quotidien dans `on_app_ready`.
- `commands.rs` : `backup_export`, `backup_pick_external`, `backup_acknowledge`, `backup_list` complet.
- `restore.rs` : source `External`.
- `build.rs`, `capabilities/default.json`, `capability_tests.rs`.
- Configuration ESLint du front : `'no-alert': 'error'`.

**S11** : `npm run rust:test` doit passer. Sinon, appliquer le repli suivant, en vérifiant les API sur docs.rs :
- `build.rs` : `Attributes::new().windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())` ;
- en build-dependency, `embed_resource::compile_for_everything("app.rc", embed_resource::NONE)`, avec un `app.manifest` qui déclare la dépendance `Microsoft.Windows.Common-Controls` 6.0.0.0 et reprend les réglages DPI du manifeste Tauri.

Si le repli échoue aussi : s'arrêter.

**Fonctions testables** : `export_archive_to`, `copy_external_archive`, `detect_missing_db`, `pre_migration_needed`, `daily_due`.

**Tests** :
- Export : copie identique, remplacement, pas de temporaire restant, erreur sans fichier partiel.
- Copie externe : remplacement, `too_large`, `picked.zip` supprimé si l'archive est invalide. `backup_restore(External)` sans `picked.zip` → `not_found`.
- `detect_missing_db`.
- `pre_migration_needed` : `(Some(2), 3)` → vrai ; `(Some(3), 3)`, `(Some(4), 3)`, `(None, 3)`, `(Some(0), 3)` → faux.
- `daily_due` : seuil de 24 h, archive datée du futur, archive endommagée ignorée.
- `startup_sequence` complète :
  - base V2 → `pre-migration` sans images ;
  - base absente avec une archive → R6 sans `pre-migration` ni marqueur d'échec ;
  - restauration en attente avec une base plus ancienne → échange puis `pre-migration` ;
  - 5 démarrages en V2 → au plus 3 `pre-migration`, `pre-restore` intactes.
- Marqueurs : cycle de vie complet (§4.1).
- Capabilities.

**Critères**
- **CA-B3.1** Les tests et les commandes de vérification passent ; S11 est tranchée dans le rapport.
- **CA-B3.2** Pas de paquet npm `@tauri-apps/plugin-dialog` ni `@tauri-apps/plugin-fs`.
- **CA-B3.3** `blocking_*` et `rfd::` n'apparaissent que dans `dialogs.rs` (hors bouchon), et les appels `blocking_*` se font dans `spawn_blocking`.
- **CA-B3.4** Ajouter temporairement `window.confirm('x')` fait échouer `npm run lint` (vérifier puis annuler).

**Arrêt** : S11 (repli compris), ou S14 si `show_startup_blocked` bloque l'exécution de façon inattendue (le vérifier manuellement avec M11, avant de livrer).

### Lot B4a : configuration JSON, côté Rust

**Créer** : `src/backup/config_transfer.rs`, avec `ConfigImportPlan`, `ImportOutcome`, `validate_plan`, `apply_config_import` (ordre SQL du §4.12, `BEGIN IMMEDIATE`), `check_config_export`, `check_config_import_text`, `is_secret_setting_key` et `read_config_file`.

**Modifier** : `commands.rs` (`config_export_save`, `config_import_pick`, `config_import_apply` ; les dialogues passent par `dialogs`), `build.rs`, `capabilities/default.json`, `capability_tests.rs`.

**Tests** :
- `validate_plan` : un cas par `ImportProblem` structurel ; clés secrètes ; `hb_trim` (`" Accueil"` refusé) ; points de code (100 emojis acceptés, 101 refusés).
- `apply_config_import`, sur la dernière version du schéma avec notes et tâches :
  - réimport identique : notes conservées, `created_at` inchangé ;
  - instance absente → supprimée avec sa note ;
  - dashboard absent → supprimé ;
  - **instance déplacée d'un dashboard supprimé vers un dashboard conservé → la note est conservée** ;
  - changement de type → note supprimée ;
  - réglages fusionnés ;
  - `w = 0` sur la 3e instance (en contournant `validate_plan`) → `constraint`, et aucune table modifiée ;
  - la sauvegarde `pre-import` existe et ne contient que la base ;
  - plan invalide → ni sauvegarde ni écriture ;
  - une seconde connexion d'écriture pendant la transaction attend, ou échoue en `busy`.
- `check_config_export`, `check_config_import_text`, `read_config_file` : JSON qui n'est pas un objet, autre `format`, binaire, UTF-8 invalide, BOM, taille au-delà de 1 Mio.

**Critères**
- **CA-B4a.1** Les tests et les commandes de vérification passent.
- **CA-B4a.2** Toutes les valeurs SQL passent par des paramètres liés (revue).

**Arrêt** : S13 infirmée sans repli manuel possible.

### Lot B4b : configuration JSON, côté TS (services, sans UI)

**Créer** :
```
core/backup/backup.types.ts            DTO, BackupErrorDto, ConfigImportPlan, ImportOutcome, ImportPreview
core/backup/backup.service.ts (+ spec) BackupService (seul import de @tauri-apps/api/core dans core/backup)
core/backup/hb-trim.ts (+ spec)        hbTrim, codePointLength ; mêmes vecteurs que B1a
core/backup/config-transfer.ts (+ spec)          pur : CONFIG_FORMAT, SECRET_KEY_PATTERN, limites, buildConfigExport, parseConfigImport, buildImportPreview
core/backup/config-transfer.service.ts (+ spec)
core/backup/index.ts
```
`BackupService` compte 11 méthodes : `isAvailable()`, qui n'appelle rien, et **10 méthodes qui appellent chacune une commande** (`overview`, `create`, `openFolder`, `exportArchive`, `pickExternal`, `restore`, `acknowledge`, `saveConfigFile`, `pickConfigFile`, `applyConfigImport`). Hors Tauri, ces méthodes rejettent avec `unavailable`, sans `invoke`. Le service exporte aussi `isBackupError`. `SECRET_KEY_PATTERN` réutilise celui de `data/index.ts` s'il y est exporté ; sinon il est déclaré ici, avec un test qui vérifie que `SettingsRepository` se comporte de la même façon.

`ImportIssueCode` : `too_large`, `invalid_json`, `unknown_field`, `missing_field`, `invalid_value`, `unsupported_version`, `no_dashboard`, `too_many`, `invalid_id`, `duplicate_id`, `invalid_name`, `invalid_config`, `max_instances`, `secret_setting`, `invalid_setting_key`, `invalid_setting_value`.

**Tests** :
- Export : ordre, forme, clé secrète écartée.
- Aller-retour avec les fixtures du registre.
- Refus : `formatVersion: 2` ; champ inconnu ; `settings` ou `exportedAt` absent (`missing_field`) ; `exportedAt` mal formé ; id en majuscules ; doublon ; 0 ou 101 dashboards ; `w = 0` ; `x = 1.5` ; config invalide (chemin `dashboards[0].widgets[1].config`) ; `maxInstances` dépassé ; clé secrète ; `Bad Key`.
- Cas acceptés : type inconnu ; `future-version` ; migration v1 → v3.
- `hbTrim` (U+00A0, U+FEFF, U+0085), y compris la normalisation unique d'un nom stocké avec des espaces de bord.
- `__proto__` à la racine, dans `data` (type connu et type inconnu) et dans `settings` : `({} as Record<string, unknown>)['polluted'] === undefined`.
- Taille de 1 Mio + 1 octet.
- `buildImportPreview` : dashboards supprimés, widgets supprimés (y compris ceux d'un dashboard supprimé), widgets remplacés ; une instance déplacée n'est pas comptée.
- `BackupService` : rejet `unavailable` hors Tauri ; **commande et arguments exacts pour chacune des 10 méthodes qui appellent une commande** ; erreurs propagées.
- `ConfigTransferService`.

**Critères**
- **CA-B4b.1** Les tests et les commandes de vérification passent.
- **CA-B4b.2** Aucun `Object.assign` dans `core/backup`.
- **CA-B4b.3** Le seul import de `@tauri-apps/api/core` dans `core/backup` est celui de `backup.service.ts`.

**Arrêt** : un comportement de `resolveConfig` ou `serializeConfig` qui contredit l'ADR-001.

### Lot B5 : UI, temps relatif, i18n

**Créer** : `core/backup/backup-status.store.ts`, `core/backup/format-bytes.ts` (base 1024), `core/backup/backup-alert.component.ts`, `features/settings/backup-settings.component.ts`, `features/settings/config-transfer-settings.component.ts`, chacun avec son spec.

**Modifier** :
- `core/time/time-display.ts` (+ spec) : `formatRelative(instant, now)` avec `Intl.RelativeTimeFormat(locale, { numeric: 'always' })` et `durationBetween`. Règles :
  - Δ < 0 ou Δ ≥ 30 × 24 h → `formatInstant(instant, 'date')` ;
  - Δ < 60 s → `time.justNow` ;
  - Δ < 1 h → minutes, tronquées ;
  - Δ < 24 h → heures ;
  - sinon → jours par tranches de 24 h.
- `settings.page.ts` : ajouter les deux cartes après « Fuseau horaire ».
- `layout.component.{ts,html}` : `<app-backup-alert />`.
- `fr.json` : clés du §4.16.
- Routeur : `withInMemoryScrolling({ anchorScrolling: 'enabled' })` si l'ancre ne fait pas défiler.

**Comportements** :
- Après `restore(...)` : afficher « Restauration en cours… », puis « Redémarrage… » si la réponse arrive. Le front n'appelle aucun redémarrage.
- Après un import : appeler `RELOAD_PAGE()`, un jeton (`() => location.reload()` par défaut) remplaçable en test.
- Le « maintenant » vient de `CLOCK.nowIso()`.

**Tests** :
- `formatRelative` : 0 s, 59 s, 61 s, 59 min, 2 h, 23 h 59, 25 h (« il y a 1 jour »), 29 jours, 30 jours, date future.
- `formatBytes`.
- Le store.
- Composant Sauvegardes : liste, état vide, hors Tauri, création, `busy`, `restart_pending`, « Restaurer » désactivé ; dialogue (case, focus sur « Annuler », Échap) ; restauration interne et externe ; message `invalid_archive` traduit.
- Composant Configuration : 3 avertissements distincts, liste des problèmes, confirmation → `apply` → `RELOAD_PAGE`, annulation.
- Bandeau : les 3 messages, « Ignorer », masqué hors Tauri.
- `fr.spec.ts`.

**Critères**
- **CA-B5.1** Les tests et les commandes de vérification passent, et `web:build` respecte le budget.
- **CA-B5.2** Tokens uniquement : pas d'ombre, pas de texte en dur, pas de dialogue natif JS.
- **CA-B5.3** Utilisable au clavier (focus initial, Échap).
- **CA-B5.4** Le rapport liste M1 à M11, à faire par Marius.

**Arrêt** : budget du build web dépassé ; ne pas relever le budget.

---

## 12. Décisions de Marius (actées le 2026-10-21)

1. **Import de configuration** : les widgets et dashboards absents du fichier sont **supprimés avec leurs données** (notes, tâches, par cascade), après un aperçu et une sauvegarde de sécurité. L'export exclut notes, tâches et raccourcis.
2. **Sauvegarde quotidienne automatique** dès la phase 1 (application ouverte).
3. **Rétention** : 10 manuelles, 7 quotidiennes, 5 de sécurité.
4. **Restauration** = redémarrage immédiat, sans option « plus tard ».
5. **Limites** : archive 3 Gio, base 1 Gio, image 64 Mio.
6. **Sauvegarde avant migration sans images.**
7. **Ajout anticipé** de `jiff`, de `time/clock.rs` et du plugin dialog (côté Rust uniquement).

Précisions de l'architecte, dans le cadre de ces décisions (à signaler à Marius) :
- réserve séparée de 3 sauvegardes « avant mise à jour », pour qu'une boucle de plantage n'évince pas les 5 de sécurité ;
- la sauvegarde « avant import » ne contient que la base ;
- en cas d'état de restauration incohérent, Homebase **refuse de démarrer**, avec un message natif qui indique la marche à suivre, plutôt que de risquer une perte de données.
