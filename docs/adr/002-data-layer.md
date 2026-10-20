# ADR-002 : Couche de données (SQLite, migrations, repositories)

- **Statut** : proposé (à valider par Marius)
- **Date** : 2026-10-20
- **Décideur** : architect (Opus), validation Marius
- **Liens** : `docs/PLAN.md` §3, §4, §6, §9 ; `docs/ROADMAP.md` phase 0 ; ADR-001 (contrat Widget, rédigé en parallèle, non modifié ici)

---

## 1. Contexte

Homebase est une application Windows Tauri 2 + Angular 21, mono-utilisateur, sans serveur. Le PLAN fixe SQLite via `tauri-plugin-sql`, des migrations `V<n>__<nom>.sql` immuables, et une couche `data/` (interfaces `Repository`) qui isole les widgets du stockage.

La phase 0 doit livrer : une base qui se crée et migre au démarrage, un schéma minimal (réglages, dashboards, instances de widgets), des repositories testables sous Vitest/Node sur un vrai moteur SQLite qui exécute **les mêmes fichiers de migration**, et des capabilities Tauri minimales.

### 1.1 Faits vérifiés et suppositions

Sources consultées le 2026-10-20. Le code du plugin a été lu sur la branche `v2` de `plugins-workspace`, celui de sqlx sur `main`. La version de sqlx effectivement épinglée par le plugin n'a pas été vérifiée. Les comportements cités sont anciens et stables, mais cela reste supposé.

| # | Fait | Statut | Source |
|---|---|---|---|
| F1 | `Migration { version: i64, description: &'static str, sql: &'static str, kind: MigrationKind }`, enregistrée par `Builder::add_migrations(db_url, Vec<Migration>)`, avec `include_str!` pour le SQL | Vérifié (doc + source) | https://v2.tauri.app/plugin/sql/ ; https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/lib.rs |
| F2 | Seules les migrations `MigrationKind::Up` sont exécutées. `Down` n'est jamais exécutée | Vérifié (source, commentaire de `MigrationKind`) | lib.rs (idem) |
| F3 | Les migrations passent par le `Migrator` de sqlx. Chaque migration s'exécute en transaction (`no_tx = false`) | Vérifié (source). Doc Tauri : « All migrations are executed within a transaction » | lib.rs ; https://github.com/launchbadge/sqlx/blob/main/sqlx-core/src/migrate/migration.rs |
| F4 | sqlx calcule un **checksum SHA-384 du texte SQL exact**. Au démarrage : `VersionMismatch` si le SQL d'une migration déjà appliquée a changé, `VersionMissing` si la base contient une version inconnue du binaire (le plugin n'appelle pas `set_ignore_missing`), `Dirty` si une migration a échoué à moitié | Vérifié (source sqlx) | https://github.com/launchbadge/sqlx/blob/main/sqlx-core/src/migrate/migrator.rs |
| F5 | Migrations lancées soit au démarrage via `plugins.sql.preload` (`tauri.conf.json`), soit au premier `Database.load()` côté JS. Elles ne sont exécutées qu'une fois par processus (retirées de la table après usage) | Vérifié (doc + source `lib.rs` / `commands.rs`) | https://v2.tauri.app/plugin/sql/ ; https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/commands.rs |
| F6 | `sqlite:<chemin>` est résolu par rapport à `app_config_dir()`. Le dossier et le fichier sont créés si absents (`auto_create`, toujours vrai pour `preload`). Un chemin absolu remplacerait la base (sémantique de `PathBuf::join`) | Vérifié (source `wrapper.rs`) ; « remplacement par un chemin absolu » déduit | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/wrapper.rs |
| F7 | Sous Windows, `app_config_dir()` et `app_data_dir()` valent tous deux `{FOLDERID_RoamingAppData}\<identifier>` (`%APPDATA%\<identifier>`) | Vérifié | https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html |
| F8 | Le plugin ouvre un **pool** sqlx (`Pool::connect(url)`, sans options). `execute` et `select` prennent une connexion quelconque du pool | Vérifié (source `wrapper.rs`) | wrapper.rs ; issue #886 |
| F9 | **Pas de transactions multi-appels depuis JS** : un `BEGIN` / `COMMIT` envoyé par `execute()` peut partir sur des connexions différentes (« silently broken »). Issue ouverte, sans correctif | Vérifié (issue ouverte au 2026-10-20) | https://github.com/tauri-apps/plugins-workspace/issues/886 |
| F10 | Valeurs par défaut des connexions sqlx SQLite : `foreign_keys = ON`, `busy_timeout = 5 s`, `journal_mode` **non modifié** (DELETE par défaut), `synchronous` non modifié (FULL) | Vérifié (source sqlx) | https://github.com/launchbadge/sqlx/blob/main/sqlx-sqlite/src/options/mod.rs |
| F11 | L'URL de connexion SQLite n'accepte que `mode`, `cache`, `immutable` et `vfs`. Impossible d'y régler `journal_mode`, `foreign_keys` ou `busy_timeout` | Vérifié (source sqlx) | https://github.com/launchbadge/sqlx/blob/main/sqlx-sqlite/src/options/parse.rs |
| F12 | Paramètres SQL : `$N` et `?NNN` sont liés à l'argument N quel que soit leur ordre d'apparition. `:nom` et `@nom` provoquent une erreur | Vérifié (source sqlx `arguments.rs`) ; `$1` documenté par Tauri pour SQLite | https://github.com/launchbadge/sqlx/blob/main/sqlx-sqlite/src/arguments.rs |
| F13 | Liaison des valeurs par le plugin : `null` donne NULL, une chaîne donne TEXT, **tout nombre est converti en `f64`**, et les booléens, tableaux et objets sont liés comme JSON. Lecture : INTEGER renvoie un nombre, TEXT une chaîne, BLOB un tableau d'octets, et un type déclaré inconnu provoque une erreur `UnsupportedDatatype` | Vérifié (source `wrapper.rs`, `decode/sqlite.rs`) | wrapper.rs ; https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/decode/sqlite.rs |
| F14 | JS : `Database.get(path)` est synchrone et **n'appelle aucune commande** (connexion différée). `execute` / `select` renvoient `DatabaseNotLoaded` si la base n'a pas été chargée (par `preload` ou `load`). `load` sur une base déjà chargée remplace le pool | Vérifié (source `guest-js/index.ts`, `commands.rs`) | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/guest-js/index.ts |
| F15 | Permissions : `sql:allow-load`, `sql:allow-execute`, `sql:allow-select`, `sql:allow-close` (et leurs `deny-*`). `sql:default` = `allow-close` + `allow-load` + `allow-select`, sans `execute` | Vérifié (doc) | https://v2.tauri.app/plugin/sql/ |
| F16 | Le mode WAL est persistant dans le fichier. `journal_mode` ne peut pas changer pendant une transaction. `PRAGMA foreign_keys` est sans effet dans une transaction | Vérifié | https://www.sqlite.org/pragma.html |
| F17 | `VACUUM INTO` produit un instantané cohérent d'une base vivante et sert d'alternative à l'API de backup. La cible ne doit pas exister | Vérifié | https://www.sqlite.org/lang_vacuum.html |
| F18 | better-sqlite3 : `:memory:`, `exec()` multi-instructions, paramètres anonymes et nommés `@x`, `:x`, `$x`. `?NNN` n'est pas documenté | Vérifié (doc API) | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md |
| F19 | `node:sqlite` : « Release candidate » seulement depuis Node 25.7, renommage `DatabaseSync` vers `Database`. Problèmes signalés de résolution `node:sqlite` par Vite/Vitest (source tierce, non confirmé) | Vérifié (doc Node) ; partie Vite **supposée** | https://nodejs.org/api/sqlite.html |
| S1 | Le feature `sqlite` de sqlx embarque une SQLite récente (version 3.38 ou plus : STRICT, `UPDATE … FROM`, JSON intégré, `RETURNING`) | **Supposé** : à vérifier à l'exécution (critère A10) | — |
| S2 | Une erreur de migration au `preload` fait échouer le démarrage (erreur de setup du plugin, panique au `.expect` de `run`) | **Supposé** (cohérent avec la source) | lib.rs |
| S3 | Le rejet d'une commande du plugin côté JS est une chaîne qui contient le message SQLite (« UNIQUE constraint failed… ») | **Supposé** : à vérifier (critère A11) | — |
| S4 | `PRAGMA journal_mode = WAL` passe par `execute()` et `PRAGMA journal_mode` se lit par `select()` (colonne sans type déclaré, décodée en TEXT d'après la valeur) | **Supposé** : à vérifier (critère A10) | — |
| S5 | `crypto.randomUUID()` est disponible dans la WebView2 (origine `http://tauri.localhost`, traitée comme contexte sécurisé par Chromium) | **Supposé** : fallback prévu | — |
| S6 | `@angular/build:unit-test` accepte une option `exclude` pour retirer `src/app/data/**` du runner Angular | **Supposé** : l'implementer vérifie, sinon s'arrête et rapporte | — |

---

## 2. Options étudiées

### 2.1 Exécution des migrations
| Option | Pour | Contre |
|---|---|---|
| A. `preload` dans `tauri.conf.json` + `Database.get()` côté front | Migrations appliquées avant l'interface. Le front n'a besoin **ni de `sql:allow-load` ni de `sql:allow-close`** : il ne peut ni ouvrir ni créer d'autre base, ni remplacer le pool (F14) | Un échec de migration fait planter le démarrage, sans écran d'erreur (S2) |
| B. `Database.load()` depuis le front au bootstrap | Erreur de migration récupérable et affichable dans l'interface | Il faut `allow-load` : un script injecté pourrait ouvrir ou créer n'importe quel fichier `.db` (F6). Risque d'appels `load` concurrents qui remplacent le pool (F14) |
| C. Migrator maison en Rust (sqlx ou rusqlite direct) | Contrôle total (sauvegarde avant migration, message d'erreur natif) | Duplique le plugin, ajoute du Rust et des dépendances. Injustifié en phase 0 |

**Retenu : A.** Moindre privilège et ordre de démarrage simple. Un échec de migration est un bug de développement que les tests (§5) doivent attraper. L'écran d'erreur natif et la sauvegarde avant migration sont reportés en phase 1 (point ouvert O1).

### 2.2 Immutabilité des migrations
- sqlx refuse déjà au démarrage une migration appliquée dont le SQL a changé (F4). C'est un garde-fou, mais il se déclenche **sur le PC de Marius**, au lancement : trop tard.
- **Retenu** : manifeste `checksums.json` (SHA-256 par fichier) vérifié par un test Vitest en CI. Un fichier existant modifié fait échouer la CI. Une nouvelle migration doit être ajoutée au manifeste. Un test Rust vérifie en plus que les migrations enregistrées dans `db.rs` correspondent exactement aux fichiers du dossier.
- **Fins de ligne** : le checksum sqlx porte sur les octets exacts (F4). Avec `core.autocrlf=true` sous Windows, deux checkouts pourraient produire CRLF ou LF et provoquer un `VersionMismatch` entre deux builds. **Retenu** : `.gitattributes` avec `*.sql text eol=lf`, et un test qui refuse tout `\r` dans les migrations.
- Immuable **dès que la migration est sur `main`**. Avant la fusion, on peut la modifier en supprimant sa base de développement locale.

### 2.3 Transactions
| Option | Verdict |
|---|---|
| `BEGIN` / `COMMIT` via `execute()` | **Interdit** : cassé à cause du pool (F8, F9) |
| Plusieurs instructions dans un seul `execute("BEGIN; …; COMMIT;")` | Rejeté : en cas d'erreur au milieu, la connexion retourne au pool avec une transaction ouverte qui garde le verrou d'écriture |
| **Une écriture logique = une seule instruction SQL** (atomique par nature), avec cascades de clés étrangères, `INSERT … ON CONFLICT`, `INSERT … SELECT … WHERE NOT EXISTS`, `UPDATE … FROM json_each($n)` pour les lots | **Retenu pour la phase 0** : suffit pour tout le schéma V1 |
| Commande Rust dédiée (transaction sqlx) pour un cas futur inévitable | Recours documenté, décidé au cas par cas (spec Opus) |

Conséquence : l'interface des repositories **n'expose pas** de `transaction(cb)`.

### 2.4 PRAGMA
- `foreign_keys` : déjà `ON` sur chaque connexion du pool (F10). Rien à faire en production. Le pilote de test l'active explicitement.
- `busy_timeout` : déjà 5 s (F10). Suffisant.
- `journal_mode` : **WAL**. Il ne peut pas être mis dans une migration, qui s'exécute en transaction (F16), ni dans l'URL (F11). Comme il est persistant (F16), le front l'exécute au bootstrap (idempotent) puis le vérifie. Justification de ce choix plutôt que DELETE, le défaut : le pool du plugin a plusieurs connexions, et le planificateur Rust de la phase 2 lira probablement la base par une autre connexion. En WAL, les lecteurs ne bloquent pas l'écrivain. Coût : des fichiers `-wal` et `-shm`, et une sauvegarde qui ne doit pas être une simple copie de fichier (résolu par `VACUUM INTO`, §2.7).
- `synchronous` : défaut (FULL). C'est un réglage par connexion, impossible à garantir sur tout le pool. Il est aussi le plus sûr, et le volume d'écriture est faible.

### 2.5 Pilote SQLite pour les tests Vitest (Node)
| Option | Pour | Contre |
|---|---|---|
| **better-sqlite3** | Vrai moteur SQLite, synchrone, mature, très utilisé avec Vitest, binaires précompilés Windows x64 | Dépendance native en devDependency. Compilation node-gyp si aucun binaire précompilé n'existe pour la version de Node (les Build Tools C++ sont de toute façon requis par Rust MSVC) |
| `node:sqlite` | Aucune dépendance | Statut « release candidate » seulement depuis Node 25.7, API renommée, résolution par Vite incertaine (F19) |
| sql.js (WASM) | Pas de binaire natif | Initialisation asynchrone, chargement du WASM fragile selon l'environnement, liaison des paramètres différente |
| Faux repository en mémoire (Map) | Trivial | **Ne teste ni le SQL ni les migrations** : contraire à l'objectif |

**Retenu : better-sqlite3 (devDependency uniquement, jamais embarquée).** L'implémentation de test n'est pas un faux : ce sont **les mêmes classes de repository SQLite** que la production, branchées sur un autre `SqlExecutor`. Seul l'adaptateur change. Repli documenté vers `node:sqlite` si better-sqlite3 ne s'installe pas.

Les tests de `data/` tournent dans une config Vitest séparée (environnement `node`), hors du runner Angular, parce que le runner Angular construit pour le navigateur et ne doit pas résoudre de module natif. La couche `data/` reste donc du TypeScript sans Angular (sauf `data.providers.ts`).

### 2.6 Repositories génériques ou spécifiques
- `Repository<T, Id>` générique (CRUD) : rejeté. Il expose des opérations sans objet (pas de « update » arbitraire des réglages), pousse vers un SQL générique construit dynamiquement et n'apporte rien à trois agrégats.
- **Retenu** : interfaces **spécifiques par agrégat** (`DashboardRepository`, `WidgetInstanceRepository`, `SettingsRepository`) au-dessus d'un port générique minimal `SqlExecutor` (`execute`, `select`). C'est ce port qui est générique, pas les repositories.

### 2.7 Images et sauvegardes (décision de principe ; implémentation en phase 1, 5 et 6)
- **Racine des données Homebase** = dossier de la base = `app_config_dir()` = `%APPDATA%\<identifier>\` (F6, F7). Les images vont dans `<racine>\images\`, nommées `<uuid>.<ext>`, jamais modifiées sur place (une nouvelle version = un nouveau fichier). On n'utilise volontairement pas `app_data_dir()`, identique sous Windows (F7), pour garder une racine unique et une sauvegarde simple.
- En base : **chemin relatif POSIX** (`images/<uuid>.webp`), jamais absolu. Côté Rust, résolution par rapport à la racine avec refus de `..`, des chemins absolus et des lecteurs ; le chemin canonique doit rester sous `<racine>\images`. Aucune table d'images en V1 (ADR-006, phase 5).
- **Sauvegarde** : `VACUUM INTO '<racine>\backups\homebase-<horodatage UTC>.db'` exécuté par une **commande Rust** (pas par le front), puis archive zip avec `images/`, puis copie vers le NAS en phase 6, en gardant les N dernières. Une copie brute du fichier en WAL est interdite tant que l'application tourne (le fichier `-wal` contient des transactions validées).
- **Restauration** : jamais à chaud. On dépose `homebase.db.restore`. Au démarrage suivant, **avant** l'enregistrement du plugin SQL, Rust remplace `homebase.db` et supprime `-wal` et `-shm`.
- **Avant migration** (phase 1, O1) : copie de `homebase.db` (+ `-wal` si présent) avant le `preload`, quand le binaire embarque une version de schéma supérieure à celle de la base.
- Exports JSON (phase 1) : configuration seulement, jamais de secrets (aucun secret n'est stocké en base, §3.4).

---

## 3. Décision

### 3.1 Emplacement et connexion
- Chaîne de connexion unique : `sqlite:homebase.db`, d'où le fichier `%APPDATA%\<identifier>\homebase.db` (`identifier` est celui de `tauri.conf.json`, fixé à l'initialisation du monorepo, **à ne plus changer** ensuite, sinon les données « disparaissent »).
- La même constante apparaît à 3 endroits, contrôlés par test : Rust `db::DB_URL`, `tauri.conf.json` `plugins.sql.preload`, TS `DB_URL`.
- Seul le feature Cargo `sqlite` est compilé (pas de `mysql` ni de `postgres`, donc aucune connexion réseau possible via ce plugin).

### 3.2 Migrations
- Fichiers : `apps/desktop/src-tauri/migrations/V<n>__<nom>.sql`, avec `n` contigu à partir de 1 et `<nom>` en `[a-z0-9_]+`, LF uniquement, UTF-8 sans BOM.
- Enregistrées explicitement dans `src-tauri/src/db.rs` (`include_str!`), `kind: MigrationKind::Up`, `description` = `<nom>`.
- Interdit dans un fichier de migration : `BEGIN`, `COMMIT`, `ROLLBACK`, `PRAGMA journal_mode`, `PRAGMA foreign_keys` (sans effet ou en erreur dans la transaction sqlx, F16). Vérifié par test.
- Jamais de migration `Down` (non exécutée, F2). On corrige par une nouvelle migration `Up`.
- Immutabilité : manifeste `checksums.json` + test + `.gitattributes` (§2.2).
- Une modification de schéma qui exige de recréer une table SQLite (changer une contrainte) suit la procédure SQLite officielle dans **une seule** migration (créer `x_new`, copier, supprimer, renommer). La migration s'exécute en transaction et `foreign_keys` reste ON : l'ordre des opérations doit le respecter (spec Opus au cas par cas).

### 3.3 Conventions de schéma
| Sujet | Règle |
|---|---|
| Noms | tables au pluriel en `snake_case` (`widget_instances`), colonnes en `snake_case`, FK `<entité>_id`, index `<table>_<colonnes>_idx` |
| Tables | `STRICT` (types contrôlés par SQLite). Types déclarés limités à `TEXT` et `INTEGER` (`REAL`/`BLOB` si besoin réel), indispensable pour le décodeur du plugin (F13) |
| Identifiant | `id TEXT PRIMARY KEY`, UUID v4 en minuscules (36 caractères), **généré en TypeScript** (`crypto.randomUUID()`) via un `IdGenerator` injecté. Raisons : SQLite n'a pas de générateur d'UUID natif, l'id est connu avant l'insertion (utile au contrat Widget : `instanceId`), et on peut injecter des ids déterministes en test. `CHECK` de forme dans le schéma. Exception justifiée : `settings` a une clé naturelle (`key`) |
| Horodatages techniques | `created_at`, `updated_at` en `TEXT`, instant UTC au format **exact** de `Date.prototype.toISOString()` : `YYYY-MM-DDTHH:MM:SS.sssZ` (tri lexicographique = tri chronologique). Fournis par un `Clock` injecté, **sans `DEFAULT` SQL** (une seule source de vérité) et **sans trigger**. Contrôlés par `CHECK … GLOB`. Pas de `CHECK (updated_at >= created_at)` : un recul de l'horloge système ferait échouer les écritures. Les dates métier (rappels, récurrences, fuseau IANA) relèvent de l'ADR-003 |
| Booléens | `INTEGER` avec `CHECK (col IN (0, 1))`. **Jamais** de booléen JS en paramètre, car le plugin le lierait comme JSON, en texte (F13). Interdit au niveau des types (`SqlParam`) |
| Nombres | entiers exacts tant qu'ils restent sous 2^53 (le plugin passe par `f64`, F13). Une table `STRICT INTEGER` refuse un réel non entier |
| JSON | `TEXT` avec `CHECK (json_valid(col))` (et `json_type(col) = 'object'` si un objet est attendu), taille bornée. Sérialisé et désérialisé dans le repository |
| Suppression | **dure**, avec `FOREIGN KEY … ON DELETE CASCADE` pour les données possédées. Pas de suppression douce : pas de synchro, mono-utilisateur. Une « annulation » éventuelle relève de l'interface (suppression différée), et la sauvegarde couvre les erreurs. À rouvrir seulement avec un ADR de synchronisation (pierres tombales) |
| FK | toujours indexées côté enfant. Les futures tables de données d'un widget rattachées à une instance référencent `widget_instances(id) ON DELETE CASCADE` |
| Paramètres SQL | toujours liés (`$1`, `$2`…), jamais de valeur concaténée. Les identifiants dynamiques (tri) viennent d'une liste fermée en dur. Pas de `$` suivi d'un chiffre dans un littéral SQL (contrainte de l'adaptateur de test) |

### 3.4 Schéma V1 (phase 0)
Trois tables : `settings` (clé/valeur JSON), `dashboards`, `widget_instances`. Rien pour les widgets futurs. SQL exact au §6.3.

`widget_instances.config` (objet JSON opaque pour la couche données) et `config_version` (entier ≥ 1) portent la « configuration versionnée » de l'ADR-001. La couche données ne les interprète jamais : la validation et la migration de config relèvent du registre de widgets. `widget_type` reste peu contraint (1 à 64 caractères) pour ne pas préjuger du format d'identifiant de l'ADR-001. **Si l'ADR-001 impose un autre format (version dans le JSON, contraintes de taille de grille…), on aligne V1 avant sa fusion sur `main`.**

Garde-fou secrets : `SettingsRepository.set` refuse toute clé dont le nom évoque un secret (`secret`, `token`, `password`, `passwd`, `apikey`/`api_key`/`api-key`/`api.key`, `credential`) avec `DataError('forbidden')`. Les secrets vont dans le gestionnaire d'identifiants Windows.

### 3.5 Couche `data/` (TypeScript)
- Port `SqlExecutor` avec deux adaptateurs : `TauriSqlExecutor` (production, `Database.get(DB_URL)`) et `NodeSqliteExecutor` (tests, better-sqlite3 `:memory:` + application des fichiers de migration).
- Repositories SQLite **communs** à la production et aux tests.
- Erreurs normalisées en `DataError` (`kind` fermé), par correspondance de motifs dans le message SQLite (faute de mieux, S3). Le message brut n'est jamais affiché à l'utilisateur.
- Concurrence : dernier écrivain gagnant (une seule fenêtre, un seul processus). Pas de verrou optimiste.
- Bootstrap (`provideAppInitializer`) : `PRAGMA journal_mode = WAL`, puis vérification. Hors Tauri (navigateur seul), erreur claire `DataError('unavailable')`. (amendé après revue phase 0) L'initialiseur ne rejette pas : l'erreur est mémorisée et propagée par les repositories à chaque appel, afin que l'application démarre et affiche un message d'erreur.

### 3.6 Capabilities Tauri
Strict nécessaire pour le front : **`sql:allow-execute`** et **`sql:allow-select`**. **Pas** de `sql:default` (qui ajouterait `allow-load` et `allow-close`, inutiles avec `preload` + `Database.get`, F14 et F15).

---

## 4. Conséquences

Positives :
- Les widgets ne voient que des interfaces. Changer de stockage (ou ajouter une synchro) ne touche pas les widgets.
- Le SQL et les migrations réels sont testés en CI sous Node, sans Tauri.
- Les migrations sont figées par trois verrous : manifeste en CI, contrôle Rust des fichiers enregistrés, checksum sqlx à l'exécution.
- Surface du plugin réduite (pas de `load`/`close`, SQLite seul).

Négatives et coûts :
- Pas de transaction multi-instructions depuis le front. Certaines écritures demandent du SQL un peu plus riche (`UPDATE … FROM json_each`). Un besoin réel de transaction impose une commande Rust.
- Deux runners de tests côté web (Angular et `test:data`).
- Une devDependency native (better-sqlite3).
- Une erreur de migration fait planter le démarrage tant que O1 n'est pas traité.

---

## 5. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| R1. XSS dans la WebView : `execute` donne lecture et écriture complètes sur la base, et en SQL `ATTACH DATABASE '<chemin>'` ou `VACUUM INTO '<chemin>'` permettent de **créer des fichiers SQLite n'importe où** dans les dossiers accessibles en écriture | Élevé si XSS | Défense principale : CSP stricte, assainissement de tout contenu externe, aucune page distante (PLAN §6). Résiduel accepté en phase 0. À réévaluer à l'audit de la phase 6 : remplacer `execute`/`select` génériques par des commandes Rust typées (supprime la surface SQL), ou désactiver ATTACH via un autorisateur SQLite (non exposé par le plugin, nécessiterait du Rust) |
| R2. Fins de ligne CRLF sur un `.sql` : `VersionMismatch` au démarrage sur le PC de Marius | Démarrage impossible | `.gitattributes eol=lf` + test « pas de `\r` » |
| R3. Migration modifiée après application | Démarrage impossible (F4) | Manifeste de checksums en CI + revue |
| R4. Rétrogradation (ancien binaire sur une base plus récente) : `VersionMissing` | Démarrage impossible | Ne jamais rétrograder sans restaurer une sauvegarde. Le documenter en phase 6 |
| R5. Échec de migration (bug SQL non couvert) | Démarrage impossible, base intacte (transaction annulée, F3) | Tests de migration sur une base vierge **et** sur une base au schéma précédent avec données (à partir de V2). O1 : écran d'erreur natif + sauvegarde avant migration |
| R6. Fichier de base supprimé ou corrompu : le plugin recrée une base vide (`auto_create`) | Perte apparente des données | Sauvegardes (phase 1/6). Signaler à l'interface une base vide quand une sauvegarde existe (phase 1) |
| R7. Changement d'`identifier` : nouveau dossier de données | Données « perdues » | Figer l'`identifier` à l'initialisation. Le changer exige une migration de dossier |
| R8. SQLite embarquée par sqlx plus ancienne que 3.38 (S1) | V1 échoue (STRICT, `json_valid`, `UPDATE FROM`) | Critère A10 : contrôle de `sqlite_version()` au premier lancement |
| R9. better-sqlite3 sans binaire précompilé pour la version de Node | `test:data` ne s'installe pas | Build Tools C++ déjà présents. Repli `node:sqlite` (même interface `SqlExecutor`) |
| R10. Écarts entre la SQLite de better-sqlite3 et celle de sqlx | Un test passe sous Node mais échoue en production | SQL standard SQLite, versions récentes des deux côtés, critère A10 au lancement réel |
| R11. Deux instances de l'application sur la même base | Écritures concurrentes (supportées en WAL), doublons de notifications en phase 2 | Plugin single-instance à prévoir en phase 2 (hors ADR) |
| R12. Antivirus ou outil de synchro qui verrouille `homebase.db` | Erreurs `busy` | `busy_timeout` 5 s, `DataError('busy')`. Ne pas placer la base dans un dossier synchronisé (OneDrive) |
| R13. Mise en correspondance des erreurs par message (S3) fragile | Mauvaise catégorie d'erreur | Repli `unknown`. Tests de mapping sous Node. Vérification manuelle sous Tauri (A11) |

### Cas limites explicitement traités
- **Changement d'heure et fuseaux** : les horodatages techniques sont des instants UTC suffixés `Z`, insensibles à l'heure d'été. Un recul de l'horloge est toléré (pas de contrainte d'ordre). Les dates métier relèvent de l'ADR-003.
- **Hors ligne** : tout est local. Seule la copie vers le NAS (phase 6) dépend du réseau, avec nouvel essai plus tard.
- **Doublons** : ids UUID générés côté client. Le double clic sur « créer » produit deux entités : l'interface doit désactiver le bouton. `createIfNone` est atomique et idempotent. `settings.set` est un upsert idempotent. `updateLayout` refuse les ids en double dans un lot.
- **Conflits de synchronisation** : sans objet (pas de synchro, un seul processus). Dernier écrivain gagnant.
- **Suppression** : dure. La suppression d'un dashboard emporte ses instances en cascade. `remove` est idempotent (renvoie `false` si déjà absent). Une instance dont le `widget_type` n'est plus dans le registre est **conservée** (affichage « widget inconnu », voir ADR-001).
- **Mise à jour d'une ligne supprimée entre-temps** : `rename` et `updateConfig` lèvent `not_found`. `updateLayout` ignore les ids absents et renvoie le nombre réellement mis à jour.
- **Lots invalides** : une valeur invalide dans `updateLayout` fait échouer toute l'instruction (atomicité d'une instruction unique), et aucune ligne n'est modifiée.
- **Grands lots** : un seul paramètre JSON (`json_each`), donc aucune limite du nombre de paramètres SQLite.

---

## 6. Spec d'implémentation (phase 0)

> Destinataire : `implementer` (Sonnet). Cette spec est autonome. En cas d'ambiguïté ou de supposition (S1 à S6) qui se révèle fausse : **s'arrêter et rapporter**, ne pas improviser.
> Prérequis : la tâche « Init monorepo » est faite (`apps/web` Angular 21, `apps/desktop/src-tauri` Tauri 2). Adapter les commandes au gestionnaire de paquets choisi à l'initialisation, sans inventer de scripts autres que ceux listés ici.

### 6.1 Fichiers

Créer :
```
.gitattributes                                              (racine ; ou compléter s'il existe)
apps/desktop/src-tauri/migrations/V1__init.sql
apps/desktop/src-tauri/migrations/checksums.json
apps/desktop/src-tauri/src/db.rs
apps/web/src/app/data/index.ts                              (API publique de data/)
apps/web/src/app/data/data-error.ts
apps/web/src/app/data/json.ts
apps/web/src/app/data/clock.ts
apps/web/src/app/data/sql-executor.ts
apps/web/src/app/data/models.ts
apps/web/src/app/data/repositories.ts
apps/web/src/app/data/data.providers.ts                     (seul fichier de data/ qui importe @angular/*)
apps/web/src/app/data/sqlite/db-url.ts
apps/web/src/app/data/sqlite/error-mapping.ts
apps/web/src/app/data/sqlite/row-mappers.ts
apps/web/src/app/data/sqlite/sqlite-settings.repository.ts
apps/web/src/app/data/sqlite/sqlite-dashboard.repository.ts
apps/web/src/app/data/sqlite/sqlite-widget-instance.repository.ts
apps/web/src/app/data/sqlite/tauri-sql-executor.ts          (seul fichier qui importe @tauri-apps/plugin-sql)
apps/web/src/app/data/sqlite/database-bootstrap.ts
apps/web/src/app/data/testing/node-sqlite-executor.ts       (test uniquement)
apps/web/src/app/data/testing/migrations.ts                 (test uniquement)
apps/web/src/app/data/testing/fixed-clock.ts                (test uniquement)
apps/web/src/app/data/migrations.spec.ts
apps/web/src/app/data/sqlite/error-mapping.spec.ts
apps/web/src/app/data/sqlite/sqlite-settings.repository.spec.ts
apps/web/src/app/data/sqlite/sqlite-dashboard.repository.spec.ts
apps/web/src/app/data/sqlite/sqlite-widget-instance.repository.spec.ts
apps/web/vitest.data.config.ts
apps/web/tsconfig.data-test.json
```
Modifier :
```
apps/desktop/src-tauri/Cargo.toml          tauri-plugin-sql = { version = "2", features = ["sqlite"] } (2.x à jour, Rust >= 1.90)
apps/desktop/src-tauri/src/lib.rs          mod db; enregistrement du plugin
apps/desktop/src-tauri/tauri.conf.json     "plugins": { "sql": { "preload": ["sqlite:homebase.db"] } }
apps/desktop/src-tauri/capabilities/default.json   ajouter "sql:allow-execute", "sql:allow-select" (rien d'autre pour sql)
apps/web/package.json                      dep @tauri-apps/plugin-sql (même 2.x que le crate) ; devDeps better-sqlite3, @types/better-sqlite3 ; script "test:data"
apps/web/angular.json                      cible test : exclure "src/app/data/**" du runner Angular (S6)
apps/web/tsconfig.app.json                 exclure "src/app/data/testing/**" et "src/**/*.spec.ts"
config ESLint du front                     règles no-restricted-imports (§6.8)
```

### 6.2 `.gitattributes`
```
*.sql text eol=lf
```

### 6.3 `apps/desktop/src-tauri/migrations/V1__init.sql`
```sql
-- V1__init : réglages, dashboards, instances de widgets (ADR-002).
-- Immuable dès sa fusion sur main. Pas de BEGIN/COMMIT ni de PRAGMA ici :
-- sqlx exécute chaque migration dans une transaction.

CREATE TABLE settings (
  key         TEXT    NOT NULL PRIMARY KEY
              CHECK (length(key) BETWEEN 1 AND 128
                     AND key GLOB '[a-z]*'
                     AND key NOT GLOB '*[^a-z0-9._-]*'),
  value       TEXT    NOT NULL
              CHECK (json_valid(value) AND length(value) <= 65536),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TABLE dashboards (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  name        TEXT    NOT NULL
              CHECK (length(trim(name)) >= 1 AND length(name) <= 100),
  sort_order  INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TABLE widget_instances (
  id              TEXT    NOT NULL PRIMARY KEY
                  CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  dashboard_id    TEXT    NOT NULL
                  REFERENCES dashboards (id) ON DELETE CASCADE,
  widget_type     TEXT    NOT NULL CHECK (length(widget_type) BETWEEN 1 AND 64),
  grid_x          INTEGER NOT NULL CHECK (grid_x >= 0),
  grid_y          INTEGER NOT NULL CHECK (grid_y >= 0),
  grid_w          INTEGER NOT NULL CHECK (grid_w >= 1),
  grid_h          INTEGER NOT NULL CHECK (grid_h >= 1),
  config          TEXT    NOT NULL
                  CHECK (json_valid(config) AND json_type(config) = 'object' AND length(config) <= 65536),
  config_version  INTEGER NOT NULL CHECK (config_version >= 1),
  created_at      TEXT    NOT NULL
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE INDEX widget_instances_dashboard_id_idx ON widget_instances (dashboard_id);
```

`checksums.json` : `{ "V1__init.sql": "<sha256 hex en minuscules du fichier tel que commité, en LF>" }`. Le test (§6.9) affiche le hash attendu en cas d'absence, pour faciliter l'ajout.

### 6.4 Rust

`apps/desktop/src-tauri/src/db.rs` (esquisse, à compléter sans changer la forme) :
```rust
use tauri_plugin_sql::{Migration, MigrationKind};

/// Doit être identique à plugins.sql.preload (tauri.conf.json) et à DB_URL (front).
pub const DB_URL: &str = "sqlite:homebase.db";

/// Une entrée par fichier V<n>__<nom>.sql, dans l'ordre, sans trou. Jamais modifier une entrée existante.
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/V1__init.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, fs, path::Path};

    fn files() -> BTreeMap<i64, (String, String)> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(&dir).expect("migrations dir") {
            let name = entry.expect("entry").file_name().into_string().expect("utf-8 name");
            let Some(stem) = name.strip_suffix(".sql") else { continue };
            let (v, desc) = stem
                .strip_prefix('V')
                .and_then(|s| s.split_once("__"))
                .unwrap_or_else(|| panic!("bad migration file name: {name}"));
            let version: i64 = v.parse().unwrap_or_else(|_| panic!("bad version in {name}"));
            let sql = fs::read_to_string(dir.join(&name)).expect("read sql");
            assert!(out.insert(version, (desc.to_owned(), sql)).is_none(), "duplicate version {version}");
        }
        out
    }

    #[test]
    fn registered_migrations_match_files_exactly() {
        let files = files();
        let registered = migrations();
        assert_eq!(files.len(), registered.len(), "every V*.sql must be registered in db.rs and vice versa");
        for (i, m) in registered.iter().enumerate() {
            assert_eq!(m.version, i as i64 + 1, "versions must be contiguous from 1");
            let (desc, sql) = files.get(&m.version).expect("file for registered version");
            assert_eq!(m.description, desc);
            assert_eq!(m.sql, sql);
            assert!(matches!(m.kind, MigrationKind::Up));
        }
    }

    #[test]
    fn preload_contains_db_url() {
        let conf = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json")).expect("conf");
        let json: serde_json::Value = serde_json::from_str(&conf).expect("valid json");
        let preload = json["plugins"]["sql"]["preload"].as_array().expect("plugins.sql.preload");
        assert_eq!(preload.len(), 1);
        assert_eq!(preload[0].as_str(), Some(DB_URL));
    }
}
```
`serde_json` est normalement déjà une dépendance du template Tauri. Sinon, l'ajouter en `[dev-dependencies]`.

`lib.rs` : `mod db;` puis, dans le builder :
```rust
.plugin(
    tauri_plugin_sql::Builder::default()
        .add_migrations(db::DB_URL, db::migrations())
        .build(),
)
```
Ne rien ajouter d'autre (pas de commande de sauvegarde en phase 0).

### 6.5 Capabilities (`capabilities/default.json`, fenêtre principale)
Ajouter exactement `"sql:allow-execute"` et `"sql:allow-select"`. **Interdits** : `sql:default`, `sql:allow-load`, `sql:allow-close`, toute permission large.

### 6.6 Types et interfaces TypeScript (contrats à respecter)

`json.ts`
```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** JSON.parse + vérification ; lève DataError('corrupt_data') si ce n'est pas un objet. */
export function parseJsonObject(text: string): JsonObject;
export function parseJsonValue(text: string): JsonValue;
```

`data-error.ts`
```ts
export type DataErrorKind =
  | 'not_found' | 'conflict' | 'constraint' | 'busy'
  | 'corrupt_data' | 'forbidden' | 'invalid_input' | 'unavailable' | 'unknown';
export class DataError extends Error {
  constructor(readonly kind: DataErrorKind, message: string, options?: { cause?: unknown });
}
```

`clock.ts`
```ts
export interface Clock { nowIso(): string; }          // format toISOString()
export type IdGenerator = () => string;               // UUID v4 en minuscules
export const systemClock: Clock;                      // new Date().toISOString()
export const randomUuid: IdGenerator;                 // crypto.randomUUID() ; repli getRandomValues (RFC 4122 v4) si absent (S5)
```

`sql-executor.ts`
```ts
/** Pas de boolean, pas d'objet : le plugin les lierait en JSON texte (ADR-002 F13). */
export type SqlParam = string | number | null;
export type SqlRow = Record<string, string | number | null>;
export interface ExecuteResult { rowsAffected: number; }
export interface SqlExecutor {
  /** Une seule instruction par appel. Jamais BEGIN/COMMIT (ADR-002 §2.3). */
  execute(sql: string, params?: readonly SqlParam[]): Promise<ExecuteResult>;
  select<T extends SqlRow>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
}
```
Les deux adaptateurs passent toute erreur par `toDataError` (`error-mapping.ts`). Chaque adaptateur vérifie aussi, à l'exécution, que chaque paramètre est une chaîne, un nombre fini ou `null`, sinon `DataError('invalid_input')`.

`models.ts`
```ts
export interface Dashboard { id: string; name: string; sortOrder: number; createdAt: string; updatedAt: string; }
export interface GridRect { x: number; y: number; w: number; h: number; }
export interface WidgetInstanceRecord {
  id: string; dashboardId: string; widgetType: string; grid: GridRect;
  config: JsonObject; configVersion: number; createdAt: string; updatedAt: string;
}
export interface NewDashboard { id?: string; name: string; }
export interface NewWidgetInstance {
  id?: string; dashboardId: string; widgetType: string; grid: GridRect;
  config: JsonObject; configVersion: number;
}
export interface LayoutItem { id: string; grid: GridRect; }
```

`repositories.ts`
```ts
export interface SettingsRepository {
  get(key: string): Promise<JsonValue | undefined>;
  getAll(): Promise<ReadonlyMap<string, JsonValue>>;
  /** Upsert en une instruction. Ordre des contrôles : 1) clé « secrète », testée sans tenir compte de la casse
   *  avec /(secret|token|passw(or)?d|api[-_.]?key|credential)/i : forbidden ; 2) format de clé
   *  (/^[a-z][a-z0-9._-]{0,127}$/) : invalid_input. */
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<boolean>;
}
export interface DashboardRepository {
  /** ORDER BY sort_order, created_at, id */
  list(): Promise<Dashboard[]>;
  get(id: string): Promise<Dashboard | null>;
  /** sort_order = max + 1 (ou 0), calculé dans la même instruction INSERT … SELECT. */
  create(input: NewDashboard): Promise<Dashboard>;
  /** INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM dashboards) ; true si créé. */
  createIfNone(input: NewDashboard): Promise<boolean>;
  /** not_found si absent. Nom trimé, 1 à 100 caractères (invalid_input sinon). */
  rename(id: string, name: string): Promise<Dashboard>;
  /** Cascade sur widget_instances. false si déjà absent. */
  remove(id: string): Promise<boolean>;
}
export interface WidgetInstanceRepository {
  /** ORDER BY grid_y, grid_x, created_at, id */
  listByDashboard(dashboardId: string): Promise<WidgetInstanceRecord[]>;
  get(id: string): Promise<WidgetInstanceRecord | null>;
  /** FK absente : DataError('constraint'). */
  create(input: NewWidgetInstance): Promise<WidgetInstanceRecord>;
  /** not_found si absent. */
  updateConfig(id: string, config: JsonObject, configVersion: number): Promise<WidgetInstanceRecord>;
  /** Une seule instruction UPDATE … FROM json_each($2) ; renvoie le nombre de lignes modifiées.
   *  Lot vide : 0 sans requête. Ids en double ou valeurs non entières/négatives : invalid_input avant toute requête. */
  updateLayout(dashboardId: string, items: readonly LayoutItem[]): Promise<number>;
  remove(id: string): Promise<boolean>;
}
```

Constructeurs des implémentations SQLite : `new SqliteXxxRepository(executor: SqlExecutor, clock: Clock, newId: IdGenerator)` (pas d'Angular, pas d'`inject()`).

SQL de référence pour `updateLayout` (à reprendre tel quel) :
```sql
UPDATE widget_instances
SET grid_x = j.x, grid_y = j.y, grid_w = j.w, grid_h = j.h, updated_at = $3
FROM (
  SELECT json_extract(value, '$.id') AS id,
         json_extract(value, '$.x')  AS x,
         json_extract(value, '$.y')  AS y,
         json_extract(value, '$.w')  AS w,
         json_extract(value, '$.h')  AS h
  FROM json_each($2)
) AS j
WHERE widget_instances.id = j.id AND widget_instances.dashboard_id = $1
```
(`$2` = `JSON.stringify(items.map(i => ({ id: i.id, ...i.grid })))`.) Exporter ce texte en constante `UPDATE_LAYOUT_SQL` depuis `sqlite-widget-instance.repository.ts` (non réexportée par `index.ts`) pour le test d'atomicité.

`error-mapping.ts` : `toDataError(e: unknown): DataError`. Si `e` est déjà une `DataError`, la renvoyer telle quelle. Sinon, extraire le message (`Error.message`, chaîne, ou `String(e)`), puis :
- `UNIQUE constraint failed` ou `PRIMARY KEY` : `conflict` ;
- `FOREIGN KEY constraint failed`, `CHECK constraint failed`, `NOT NULL constraint failed`, `cannot store` (STRICT) : `constraint` ;
- `database is locked`, `database is busy` : `busy` ;
- `not loaded` (DatabaseNotLoaded) : `unavailable` ;
- sinon : `unknown`.

Conserver `cause`. Ne jamais journaliser les valeurs des paramètres.

`tauri-sql-executor.ts` : `Database.get(DB_URL)` (pas de `load`). `execute` renvoie `{ rowsAffected }`, `select` passe la main au plugin.

`database-bootstrap.ts` : `initDatabase(executor): Promise<void>` exécute `PRAGMA journal_mode = WAL`, puis `select` de `PRAGMA journal_mode`. Si la valeur n'est pas `wal`, `DataError('unknown')`. En développement seulement (`isDevMode`, injecté en paramètre pour rester sans Angular), `console.info` de `sqlite_version()`, du journal_mode et de `MAX(version)` de `_sqlx_migrations`.

`data.providers.ts` : `InjectionToken` `SETTINGS_REPOSITORY`, `DASHBOARD_REPOSITORY`, `WIDGET_INSTANCE_REPOSITORY`, et `provideDataLayer(): EnvironmentProviders` qui :
- crée un `TauriSqlExecutor` unique ;
- fournit les trois repositories (avec `systemClock` et `randomUuid`) ;
- enregistre `provideAppInitializer(() => initDatabase(...))`, enveloppé pour ne jamais rejeter : l'erreur est mémorisée et propagée par les repositories (amendé après revue phase 0).

Hors Tauri (`isTauri()` de `@tauri-apps/api/core` ; si absent, tester `'__TAURI_INTERNALS__' in globalThis`), l'échec `DataError('unavailable', 'Homebase doit être lancé via Tauri')` est mémorisé (l'initialiseur ne rejette pas) et levé par les repositories à chaque appel (amendé après revue phase 0). **Ne pas** brancher `provideDataLayer` dans `app.config.ts` si la tâche shell n'est pas faite : laisser une ligne dans le rapport.

`index.ts` exporte uniquement : types de `models`, `json`, `data-error`, `clock` ; interfaces de `repositories` ; tokens et `provideDataLayer`. Rien de `sqlite/` ni de `testing/`.

### 6.7 Test harness (Node)

`testing/node-sqlite-executor.ts` : classe `NodeSqliteExecutor implements SqlExecutor` sur `better-sqlite3`.
- Ouvre `:memory:`, puis `PRAGMA foreign_keys = ON` (imite sqlx, F10).
- Réécrit `$N` en `@pN` (regex `/\$(\d+)/g`) et lie un objet `{ p1: …, p2: … }` (paramètres nommés documentés, F18 ; insensible à l'ordre d'apparition, comme sqlx, F12).
- `execute` passe par `.run()`, avec `rowsAffected = changes` ; `select` passe par `.all()`.
- Mêmes validations de paramètres que l'adaptateur Tauri. Erreurs via `toDataError`.
- Méthode `close()`.

`testing/migrations.ts` :
- `migrationsDir()` : lu depuis `process.env.HOMEBASE_MIGRATIONS_DIR` (défini par la config Vitest).
- `listMigrationFiles()` : `{ version, name, file, sql }[]`, triés par version numérique.
- `createTestDatabase(): NodeSqliteExecutor` : applique chaque fichier dans `BEGIN` / `exec(sql)` / `COMMIT` (`ROLLBACK` en cas d'erreur), dans l'ordre, comme sqlx.

`testing/fixed-clock.ts` : horloge réglable et générateur d'UUID déterministe (séquence `00000000-0000-4000-8000-00000000000N`).

`vitest.data.config.ts` : `environment: 'node'`, `include: ['src/app/data/**/*.spec.ts']`, et `env.HOMEBASE_MIGRATIONS_DIR` = chemin absolu de `../desktop/src-tauri/migrations` calculé via `fileURLToPath(new URL(…, import.meta.url))`.

`tsconfig.data-test.json` : étend le tsconfig de base, `include: ["src/app/data/**/*.ts"]`, `types: ["node"]`, strict.

Script `apps/web/package.json` : `"test:data": "tsc -p tsconfig.data-test.json --noEmit && vitest run --config vitest.data.config.ts"`.

### 6.8 Règles ESLint (`no-restricted-imports`)
- `@tauri-apps/plugin-sql` autorisé seulement dans `src/app/data/sqlite/tauri-sql-executor.ts`.
- `better-sqlite3` et `node:*` autorisés seulement dans `src/app/data/testing/**` et `src/app/data/**/*.spec.ts`.
- En dehors de `src/app/data/**`, interdiction d'importer `**/data/sqlite/**` et `**/data/testing/**` : on passe par `data/index.ts`.

### 6.9 Tests à écrire (Vitest, `test:data`)
`migrations.spec.ts` :
1. Chaque fichier du dossier est `V<n>__<nom>.sql` (`/^V([1-9]\d*)__([a-z0-9_]+)\.sql$/`) ou `checksums.json`. Versions contiguës à partir de 1.
2. Aucun `\r` et pas de BOM dans les `.sql`.
3. `checksums.json` contient exactement les fichiers `.sql`, et le SHA-256 de chacun correspond (message d'échec : nom du fichier + hash calculé).
4. Aucun fichier ne contient (insensible à la casse, hors commentaires `--`) `BEGIN`, `COMMIT`, `ROLLBACK`, `PRAGMA journal_mode`, `PRAGMA foreign_keys`.
5. `createTestDatabase()` réussit. Les tables utilisateur (hors `sqlite_%`) sont exactement `dashboards`, `settings`, `widget_instances`. `PRAGMA integrity_check` renvoie `ok`, `PRAGMA foreign_key_check` est vide, et `sqlite_version()` vaut au moins 3.38.0.

`error-mapping.spec.ts` : un cas par catégorie, à partir de vraies erreurs better-sqlite3 (doublon de PK, FK absente, CHECK, NOT NULL, `cannot store`), plus chaîne brute et objet inconnu, qui donnent `unknown`.

`sqlite-settings.repository.spec.ts` : aller-retour de valeurs JSON (objet, tableau, nombre, chaîne, booléen, `null`) ; `get` d'une clé absente renvoie `undefined` ; le second `set` met à jour `value` et `updated_at` sans toucher `created_at` ; `remove` renvoie true puis false ; les clés `github.token`, `bank.apiKey`, `x.password` donnent `forbidden` ; les clés `Bad Key` et `''` donnent `invalid_input` ; une valeur sérialisée de plus de 65 536 caractères donne `constraint`.

`sqlite-dashboard.repository.spec.ts` : `create` avec id déterministe et horodatage figé ; `list` triée ; `sortOrder` incrémenté ; `createIfNone` renvoie true puis false (une seule ligne) ; `rename` (trim, `not_found`, nom vide qui donne `invalid_input`) ; `remove` fait la cascade (les instances disparaissent) et est idempotent.

`sqlite-widget-instance.repository.spec.ts` :
- `create` puis `get` : égalité profonde, `config` objet imbriqué conservé ;
- `create` sur un dashboard inexistant donne `constraint` ;
- un `config` dont le JSON stocké n'est pas un objet donne `corrupt_data` en lecture (écrire la ligne directement par l'executor) ;
- `updateConfig` met à jour la config, la version et `updated_at`, ou lève `not_found` ;
- `updateLayout` : lot de 3, renvoie 3 et les positions sont relues ;
- `updateLayout` avec un id inconnu : seuls les existants sont mis à jour ;
- `updateLayout` avec un id d'un autre dashboard : 0 ligne pour celui-ci ;
- lot vide : 0 ;
- id en double ou `w = 0` ou `x = 1.5` : `invalid_input` sans requête ;
- **atomicité** : exécuter `UPDATE_LAYOUT_SQL` directement via l'executor avec un lot de 3 dont un seul a `w = 0` (contourne la validation TS) : l'appel lève `constraint` et **aucune** des 3 lignes n'est modifiée ;
- `listByDashboard` triée.

### 6.10 Critères d'acceptation
- **A1** `test:data` est vert (type-check + Vitest) ; le lint du front est propre.
- **A2** `cargo test` est vert dans `apps/desktop/src-tauri` (2 tests de `db.rs`) ; `cargo clippy -- -D warnings` est propre si clippy est en place.
- **A3** Modifier un caractère de `V1__init.sql` fait échouer `test:data` (manifeste). Le vérifier puis annuler la modification.
- **A4** Ajouter un fichier `V2__x.sql` sans l'enregistrer dans `db.rs` fait échouer `cargo test`. Le vérifier puis supprimer le fichier.
- **A5** `capabilities/default.json` ne contient, pour sql, que `sql:allow-execute` et `sql:allow-select`. `grep -r "sql:default\|sql:allow-load\|sql:allow-close"` sur `src-tauri` ne renvoie rien.
- **A6** `Cargo.toml` : `tauri-plugin-sql` avec le seul feature `sqlite`.
- **A7** Aucun import de `@tauri-apps/plugin-sql`, `better-sqlite3` ou `node:` hors des fichiers autorisés (§6.8, vérifié par ESLint).
- **A8** Aucun `any`, aucun `BEGIN` / `COMMIT` dans `apps/web/src`, et aucune valeur concaténée dans du SQL (revue).
- **A9** `.gitattributes` contient `*.sql text eol=lf`, et `git ls-files --eol apps/desktop/src-tauri/migrations` affiche `i/lf`.
- **A10** (manuel, `tauri dev`) : `%APPDATA%\<identifier>\homebase.db` est créé, ainsi que `homebase.db-wal` après le démarrage. La console de développement affiche `journal_mode = wal`, une `sqlite_version` d'au moins 3.38.0 et la version de migration 1. Un second lancement se fait sans erreur. Si un point échoue (S1 ou S4), s'arrêter et rapporter.
- **A11** (manuel, si `provideDataLayer` est branché) : un `settings.set('ui.theme', 'dark')`, puis un redémarrage et un `get`, renvoie `'dark'`. Noter dans le rapport le texte exact d'une erreur de contrainte vue côté Tauri (S3).

### 6.11 Commandes
```
# front (depuis apps/web)
<pm> install
<pm> run test:data
<pm> run lint
# Rust (depuis la racine)
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
# manuel
<pm> run tauri dev   (ou la commande dev retenue à l'initialisation)
```
`<pm>` est le gestionnaire de paquets choisi à l'initialisation. Reporter les commandes réelles dans la section « Commandes » de `CLAUDE.md` (tâche Haiku séparée).

### 6.12 Hors périmètre
Commandes de sauvegarde et de restauration, images, écran d'erreur de démarrage, réglages typés (service au-dessus de `SettingsRepository`), branchement de la grille, ADR-001 lui-même.

---

## 7. Points ouverts
- **O1** (phase 1) : sauvegarde automatique avant migration et message d'erreur natif si une migration échoue au `preload` (au lieu d'une panique).
- **O2** (phase 2) : accès du planificateur Rust à la base (connexion sqlx séparée sur le même fichier, ou réutilisation de l'état `DbInstances` du plugin), à trancher dans la spec du planificateur.
- **O3** (phase 6, audit) : remplacer `execute`/`select` génériques par des commandes Rust typées pour fermer R1.
- **O4** (phase 6, E2E Playwright) : tests contre l'application Tauri (`tauri-driver`) ou un `SqlExecutor` navigateur (sql.js). Le front hors Tauri n'a pas de base aujourd'hui.
- **O5** : alignement avec l'ADR-001 sur le format de `widget_type` et la représentation de la config versionnée, à faire **avant** la fusion de V1 sur `main`.
