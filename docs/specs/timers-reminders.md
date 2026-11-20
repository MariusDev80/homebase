# Spec : minuteurs, pomodoro, sessions « en cours depuis X » et planificateur de rappels (Rust)

- **Statut** : acceptée (2026-11-16) ; décisions M1 à M12 validées par Marius le 2026-11-16, telles que recommandées
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§7), sur la branche `phase-2-time`
- **Liens** : `CLAUDE.md` ; `docs/PLAN.md` §2, §4 « Temps », §9 ; `docs/DESIGN.md` ; ADR-001 (§3.1, §3.2, §3.6, §3.8) ; ADR-002 (§2.3, §3.3, O2, O3, R11) ; ADR-003 (§3.1, §3.3, §3.5.3 à §3.5.5, §3.6, §3.10, D1 à D3) ; `docs/spikes/001-tray-notification-autostart.md` ; `docs/specs/backup-restore.md` (connexions sqlx dédiées, thread quotidien) ; `docs/specs/todo-details.md` (format, D10)

Cette spec vaut compte rendu de décision (contexte, options, décision, conséquences, risques). Elle ne modifie aucun autre document : les amendements à appliquer par le coordinateur sont au §10. Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`, sauf mention.

---

## 0. Décisions validées par Marius (2026-11-16)

Format de l'ADR-003 §7. Chaque ligne donne la **recommandation** de l'architecte ; la spec est écrite pour elle. Une réponse différente modifie le ou les lots cités. Marius a validé les douze recommandations telles quelles le 2026-11-16.

- **M1** Une « alarme » (sonner à 7 h) **est un rappel** (ponctuel ou récurrent), pas un objet à part. Le widget Minuteurs propose un raccourci « Alarme à HH:MM » qui crée un rappel ponctuel. *Recommandation : oui.* (W1, W3)
- **M2** Rattrapage au démarrage ou au réveil du PC : **une notification par rappel**, pour sa **dernière** occurrence manquée, avec le nombre d'occurrences précédentes sautées ; **fenêtre de 7 jours** (au-delà : enregistré « manqué », sans notification, visible dans le widget) ; au-delà de 4 notifications dans un même passage, **3 notifications + 1 résumé**. Un retard de 5 minutes au plus compte comme « à l'heure ». *Recommandation : oui (7 jours, 5 minutes, 4).* (R1, R2)
- **M3** Pomodoro **sans enchaînement automatique** : à la fin d'une phase, notification ; le widget propose la phase suivante, qu'un clic démarre. Défauts : 25 / 5 / 15 min, pause longue toutes les 4 séances. *Recommandation : oui.* (W2)
- **M4** **Pas de pause** des minuteurs en v1 : « Arrêter » termine la session (historique), « Relancer » en crée une nouvelle. *Recommandation : oui (colonne ajoutable plus tard sans casser).* (R1, W1, W2)
- **M5** **Aucune action dans la notification** (« Reporter », « Terminé ») ni clic qui ouvre Homebase en phase 2 ; tout se fait dans le widget. Pas de « Reporter » en v1. *Recommandation : oui ; à rouvrir après vérification de PV1 (§12).* (R2, W3)
- **M6** Démarrage automatique de Windows : Homebase démarre **réduit dans la zone de notification** (argument `--minimized`) ; un lancement manuel ouvre la fenêtre. *Recommandation : oui.* (R4)
- **M7** Sons : son Windows « Reminder » pour les rappels, « Alarm » (non répété) pour la fin d'un minuteur ou d'une phase de pomodoro. Les notifications ont la durée standard de Windows puis vont dans le centre de notifications ; « rester à l'écran jusqu'à fermeture » n'est pas disponible via le plugin. *Recommandation : oui.* (R2)
- **M8** Modifier un rappel récurrent agit sur **toute la série** ; on peut aussi **ignorer la prochaine occurrence**. « Cette occurrence et les suivantes » est reporté. *Recommandation : oui.* (W3)
- **M9** Rappels, minuteurs et historique sont **globaux** : ils ne sont pas rattachés à une instance de widget ; supprimer un widget ne les supprime pas ; deux widgets du même type affichent les mêmes données. *Recommandation : oui.* (R1)
- **M10** Plusieurs minuteurs ou chronos simultanés (20 au plus) ; **un seul pomodoro** en cours. *Recommandation : oui.* (R3)
- **M11** Un rappel ponctuel passé reste dans la liste, section repliée « Terminés », jusqu'à sa suppression. *Recommandation : oui.* (W3)
- **M12** Le formulaire de rappel a un bouton **« Enregistrer »** explicite (exception au pattern « au fil de l'eau » de DESIGN.md §3) : un rappel à moitié saisi pourrait sonner. *Recommandation : oui.* (W3)

---

## 1. Contexte et périmètre

Sortie de la phase 2 (ROADMAP) : **un rappel sonne à l'heure, fenêtre réduite, application lancée**. Le PLAN (§1, §4, §9) fixe : planificateur dans le processus Tauri (Rust), notifications natives, zone de notification, démarrage automatique, rattrapage des rappels manqués au lancement. L'ADR-003 fixe le modèle de temps (ancre horodatée `start_local` + `time_zone`, RRULE, `exdates`, moteur Rust unique, `next_after`, clé d'occurrence, `Clock` injectable) et renvoie ici (§3.10) : boucle, rattrapage, table des déclenchements, cache `next_fire_at`, accès Rust à la base, modèle des timers, édition des séries.

Cette spec sert de base à trois tâches de la ROADMAP (phase 2) :
1. « Timers/alarmes, pomodoro, session "en cours depuis X" + historique » : lots R1 à R3, F1, W1, W2.
2. « Rappels datés/récurrents + notifications natives + zone de notification + démarrage automatique » : lots R1 à R4, F1, W3.
3. « Habit tracker (+ rappels de mise à jour périodique) » : seulement le **point d'accroche** (§4.9) ; le modèle des habitudes demande sa propre spec.

**Hors périmètre** (ne pas improviser) : modèle des habitudes ; calendrier agrégé et `CalendarSource` des rappels (tâche « Calendrier agrégé », ADR-004) ; rappel lié à une tâche (TODO avec heure) ; « Reporter » ; actions et clic de notification ; pause des minuteurs ; enchaînement automatique du pomodoro ; changement du fuseau d'un rappel existant ; « cette occurrence et les suivantes » ; export JSON de ces données (elles sont dans les sauvegardes, pas dans l'export de configuration, comme les tâches) ; Playwright ; O3 complet (§10.2).

---

## 2. Faits vérifiés et suppositions

### 2.1 Vérifiés (sources consultées le 2026-11-16)

| # | Fait | Source |
|---|---|---|
| V1 | `time::recurrence::next_after(spec, after)` existe (strictement après, horizon 10 ans, ancre datée → `NotSchedulable`) mais porte `#[cfg_attr(not(test), expect(dead_code, reason = …))]` : l'appeler hors test rend l'`expect` insatisfait, ce qui échoue sous `-D warnings` | `src/time/recurrence/mod.rs` l. 631-691 |
| V2 | `expand(spec, req)` refuse une plage > 400 jours ou `from >= to` (`InvalidRange`), une `limit` hors 1..1000 ; trie, tronque ; exclut les `exdates` ; borne l'itération par `UNTIL` | `src/time/recurrence/mod.rs` l. 519-620 |
| V3 | `time::commands::to_spec(&RecurrenceSpecDto)` (conversion, bornes, tri et dédoublonnage des `exdates`, `validate_spec`) est **privée** ; `RecurrenceSpecDto` / `AnchorDto` sont publiques | `src/time/commands.rs` l. 75-128 |
| V4 | `Clock` / `SystemClock` / `FixedClock` (`set`, `advance`) ; `format_instant`, `parse_instant`, `parse_local_date_time`, `format_local_date_time` existent | `src/time/clock.rs`, `src/time/formats.rs` |
| V5 | Accès Rust à la base en place : connexion sqlx **dédiée par opération** (`SqliteConnectOptions::filename(db).create_if_missing(false).busy_timeout(5 s).foreign_keys(true)`), transactions `BEGIN IMMEDIATE` (`config_transfer.rs`) ; chemin par `BackupState.root.db()` | `src/backup/dashboard_delete.rs`, `src/backup/config_transfer.rs`, `src/backup/paths.rs` |
| V6 | Modèle de thread de fond : `backup::daily` (thread `std`, `Condvar::wait_timeout`, `StopSignal`, `tauri::async_runtime::block_on` pour sqlx, arrêt borné par `EXIT_JOIN_MAX` (3 s) < `lock::ACQUIRE_TOTAL` (5 s, `pub(super)`) au `RunEvent::Exit`) | `src/backup/daily.rs`, `src/backup/lock.rs` l. 19 |
| V7 | `lib.rs` : `single-instance` en premier plugin (second lancement → `show_main_window`), plugin notification enregistré (utilisé depuis Rust seulement), autostart `init(MacosLauncher::LaunchAgent, None)`, `CloseRequested` → `prevent_close` + `hide`, tray « Ouvrir Homebase » / « Quitter » (`app.exit(0)`), `.setup` : `on_app_ready` puis `tray::setup` ; deux `invoke_handler` (debug/release) contrôlés par test ; `build.rs` liste les commandes (`AppManifest`) | `src/lib.rs`, `src/tray.rs`, `build.rs` |
| V8 | `capabilities/default.json` : aucune permission `core:*`, aucune `notification:*` ; `capability_tests.rs` compare la **liste exacte** des permissions et n'autorise que `default.json` et `debug.json` | `capabilities/*.json`, `src/capability_tests.rs` |
| V9 | Dernière migration : `V6__todo_details.sql`. Tests qui figent la version : `backup/sqlite.rs` l. 70 (`== 6`), `backup/validate_tests.rs` l. 629 (`supported: 6`) et l. 1105-1144 (`expected_schema(6)`) ; `data/migrations.spec.ts` (liste des tables, blocs par version, `createTestDatabase(n)`) ; `backup::test_support::make_database(path, up_to, rows)` applique les vraies migrations | grep, fichiers cités |
| V10 | Versions résolues (`Cargo.lock`) : `tauri` 2.12.4, `tauri-plugin-notification` 2.7.0, `tauri-plugin-autostart` 2.7.0, `notify-rust` 4.18.2, `tauri-winrt-notification` 0.8.1, `tokio` 1.54.0. `Cargo.toml` : `tokio` avec la seule feature `sync` ; `sqlx` 0.8 `runtime-tokio` | `Cargo.lock`, `Cargo.toml` |
| V11 | Plugin notification : l'API Actions est « only available on mobile platforms » ; sous Windows, toasts attribués à l'app **installée** seulement (« Shows powershell name & icon in development ») ; aucune planification sur desktop. `show()` ne bloque pas (tâche sur le runtime async). L'AUMID n'est posé que si l'exe n'est pas sous `target\debug` ou `target\release` | https://v2.tauri.app/plugin/notification/ ; https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/notification/src/desktop.rs |
| V12 | `NotificationBuilder` 2.7.0 : `title`, `body`, `icon`, `sound(impl Into<String>)`, `show`, `action_type_id`, `auto_cancel`. La doc de `show` mentionne qu'« under Windows a click is only reported while the toast is on screen » (mécanisme d'actions côté desktop non documenté par ailleurs : PV1) | https://docs.rs/tauri-plugin-notification/2.7.0/tauri_plugin_notification/struct.NotificationBuilder.html |
| V13 | **Sans nom de son, le toast est muet** : `notify-rust` (Windows) convertit `sound_name` par `Sound::from_str` (`None` si absent ou inconnu) ; `tauri-winrt-notification` écrit alors `<audio silent="true"/>`. Noms acceptés : `Default`, `IM`, `Mail`, `Reminder`, `SMS`, puis les sons « bouclables » par leur nom nu (`Alarm`, `Alarm2`…`Alarm10`, `Call`…`Call10`, joués une fois avec `Sound::Single`) | https://docs.rs/crate/notify-rust/4.18.2/source/src/windows.rs ; https://docs.rs/crate/tauri-winrt-notification/0.8.1/source/src/lib.rs |
| V14 | Le XML du toast est construit par l'API DOM (`CreateElement`, `SetInnerText`, `SetAttribute`), pas par concaténation : un titre contenant `<`, `&` ou `"` ne peut pas injecter d'élément (bouton à activation par protocole, audio…) | https://docs.rs/crate/tauri-winrt-notification/0.8.1/source/src/lib.rs |
| V15 | `notify-rust` (Windows) : `Urgency::Critical` → `Scenario::Reminder` (toast qui reste à l'écran) ; non exposé par le builder du plugin | https://docs.rs/crate/notify-rust/4.18.2/source/src/windows.rs |
| V16 | Autostart 2.7.0 : `pub fn init<R: Runtime>(macos_launcher: MacosLauncher, args: Option<Vec<&'static str>>) -> TauriPlugin<R>` ; `Builder::args`, `arg`, `app_name` | https://docs.rs/tauri-plugin-autostart/2.7.0/tauri_plugin_autostart/fn.init.html ; https://docs.rs/tauri-plugin-autostart/2.7.0/tauri_plugin_autostart/struct.Builder.html |
| V17 | Événements Rust → JS : `listen` côté JS exige `core:event:allow-listen` (et `allow-unlisten`) ; les `Channel` passent par `invoke` ; la liste des permissions `core` ne mentionne aucune permission de canal (non confirmé : PV7) | https://v2.tauri.app/reference/acl/core-permissions/ ; https://v2.tauri.app/develop/calling-frontend/ |
| V18 | SQLite : `ALTER TABLE ADD COLUMN … REFERENCES …` exige un défaut `NULL` quand les clés étrangères sont actives ; un `CHECK` ajouté est testé sur les lignes existantes (≥ 3.37) | https://www.sqlite.org/lang_altertable.html |
| V19 | Front : les services adossés à des commandes Rust vivent dans `core/` (`core/backup`, `core/weather`, `core/time/recurrence-engine.ts`) ; `DataErrorKind` est fermé (`not_found`, `conflict`, `constraint`, `busy`, `corrupt_data`, `forbidden`, `invalid_input`, `unavailable`, `unknown`) ; ESLint ne restreint dans `data/` que `@tauri-apps/plugin-sql` | `core/**`, `data/data-error.ts`, `eslint.config.js` |
| V20 | `core/time` exporte `classifyLocal`, `resolveLocal`, `toLocalDateTime`, `todayIn`, `addDays`, `untilEndOfLocalDay`, `UserTimeZone`, `Today`, `TimeDisplay`, `parseRecurrenceRule`, `RECURRENCE_ENGINE` ; clés i18n `time.ambiguous`, `time.nonexistent`, `time.today`, `time.tomorrow` existent | `core/time/index.ts`, ADR-003 §8.5 |
| V21 | Le contrat Widget prévoit la permission `notifications` (documentation et garde-fou, pas une frontière de sécurité) | `core/widgets/widget-definition.ts`, ADR-001 §3.8 |

### 2.2 Supposés (à vérifier ; si faux : s'arrêter et rapporter)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Après une veille, `Condvar::wait_timeout` (horloge monotone, dont l'avancée pendant la veille n'est pas garantie) rend la main au plus `MAX_SLEEP` (30 s) après le réveil | MV6 (manuel) |
| S2 | `.sound("Reminder")` et `.sound("Alarm")` produisent un son audible dans l'app installée | MV2, MV3 |
| S3 | Fenêtre `main` déclarée `"visible": false`, puis `show()` en fin de `.setup()` : la WebView charge Angular même masquée ; pas de blocage ni d'écran blanc durable | R4, MV8 |
| S4 | `autolaunch().enable()` sur une entrée déjà présente réécrit la valeur `Run` avec le chemin courant et les arguments | R4, MV9 (regedit) |
| S5 | Une commande `async` qui tient un `tokio::sync::Mutex` et le thread du planificateur qui prend le même verrou dans `block_on` ne s'interbloquent pas (threads distincts, aucun verrou tenu à travers un `block_on` imbriqué) | tests R2/R3 |
| S6 | jsdom renvoie `HH:MM` pour `<input type="time">` et déclenche `change` | W1, W3 |

---

## 3. Décisions

### D1. Le planificateur tourne dans un **thread dédié** du processus Tauri (pas une tâche tokio)
| Option | Pour | Contre |
|---|---|---|
| A. Tâche tokio (`tokio::select!` sur `sleep` et un `Notify`) | Idiomatique en async | Features `time` et `macros` à ajouter ; aucun précédent dans le code ; `sleep` monotone, même problème de veille |
| **B. Thread `std` + `Condvar::wait_timeout` (modèle de `backup::daily`), sqlx via `tauri::async_runtime::block_on`** | Modèle déjà en place et testé ; aucune dépendance ; réveil immédiat par `notify` ; arrêt borné connu | Un thread de plus (négligeable) |
| C. Un thread par échéance (spike) | — | Rejeté par le spike lui-même (pas de rattrapage, dérive en veille) |

**Retenu : B.** Le thread ne dort jamais plus de `MAX_SLEEP` = 30 s (ADR-003 §3.10) et relit `Clock::now()` à chaque réveil : la veille, le changement d'heure système et une horloge monotone arrêtée en veille sont absorbés en 30 s au plus. Il dort `min(prochaine échéance − maintenant, 30 s)` : à l'heure près de la seconde quand le PC est éveillé.

### D2. Source de vérité : la base ; **le Rust seul lit et écrit** les nouvelles tables (commandes typées)
| Option | Pour | Contre |
|---|---|---|
| A. Le front écrit `reminders` par `tauri-plugin-sql`, puis appelle une commande « réarmer » | Repositories SQLite comme les autres | Deux écrivains ; oubli du réarmement = rappel muet ; le front devrait calculer `next_fire_at` (moteur unique en Rust) ; contraire à O3 |
| **B. Commandes Rust typées pour toute lecture et écriture des trois tables ; le planificateur est réarmé dans la même commande** | Une seule vérité, validation Rust (moteur unique, ADR-003 §2.4), réarmement impossible à oublier, va dans le sens d'O3 (ADR-002) | Pas de test `test:data` sur better-sqlite3 pour ces dépôts : les tests SQL sont en Rust (vraies migrations, fichier temporaire) |

**Retenu : B.** Le front ne contient aucun SQL sur `reminders`, `reminder_deliveries`, `time_sessions` (garde-fou par test, §6.2). Côté TS, l'interface de dépôt reste dans `data/` (règle « toute donnée utilisateur passe par `data/` ») avec une implémentation par `invoke` (`data/tauri/`).

### D3. Accès Rust à la base : connexion sqlx **dédiée par opération** + verrou asynchrone unique
Comme `backup` (V5, ADR-002 O2 partiellement traité) : chaque opération ouvre une connexion sur `root.db()` (`create_if_missing(false)`, `busy_timeout(5 s)`, `foreign_keys(true)`), puis la ferme. Un `tokio::sync::Mutex<()>` (`SchedulerCtx.gate`) sérialise **toutes** les opérations du module (commandes et passages du planificateur) : un seul écrivain Rust pour ces tables, pas de course entre une modification et un passage. Les écritures du front sur d'autres tables (plugin SQL, pool) cohabitent par WAL + `busy_timeout` (ADR-002 §2.4). Rejeté : un `SqlitePool` gardé ouvert (cycle de vie des connexions inactives et création hors runtime à vérifier, sans gain mesurable à ce débit) ; la réutilisation de l'état `DbInstances` du plugin (API interne).

### D4. Cache `next_fire_at` en base, recalculé par le Rust
Chaque rappel actif porte `next_fire_at` (instant) et `next_fire_key` (clé d'occurrence ADR-003 §3.5.4), écrits **uniquement par le Rust** : à la création ou modification (`next_after(spec, maintenant)`), après chaque traitement, et pour tous les rappels au démarrage (filet : mise à jour de la tzdb embarquée ou du moteur entre deux versions). Un passage ne lit que `WHERE enabled = 1 AND next_fire_at <= maintenant` (index partiel), et la prochaine échéance est un `MIN`. Sans cache, chaque passage rejouerait `next_after` depuis l'ancre de chaque rappel. Invariant : `enabled = 0` ⇒ `next_fire_at IS NULL` (`CHECK`).

### D5. Livraisons : table `reminder_deliveries`, clé `(reminder_id, occurrence_key)`, **au plus une fois**
- Clé primaire naturelle = clé de déduplication (ADR-003 §3.10) ; exception justifiée à « UUID » (ADR-002 §3.3), comme `settings` : l'identité de la ligne **est** l'occurrence, et le Rust n'a pas de générateur d'UUID. `created_at` / `updated_at` présents.
- Ordre : **écrire puis notifier**. Dans une transaction `BEGIN IMMEDIATE` : `INSERT … ON CONFLICT DO NOTHING` sur la livraison et avance du cache (comparer-et-écrire sur l'ancien `next_fire_at`) ; validation ; **puis** affichage du toast si l'insertion a créé la ligne. Un arrêt brutal entre les deux perd un toast mais jamais n'en double un (ADR-003 C26) ; la livraison reste visible dans le widget.
- Une seule ligne par passage et par rappel : la **dernière** occurrence échue, avec `skipped_count` = nombre d'occurrences antérieures sautées dans le même passage (M2).
- Pas de purge en v1 (≈ 365 lignes par an et par rappel quotidien).

### D6. Rattrapage et regroupement (M2)
Pour un rappel dont `next_fire_at <= now` :
1. `lo = max(next_fire_at, now − 399 j)` ; `occ = expand(spec, [lo, now + 1 ms), UTC, limit 1000)` (une occurrence par jour au plus dans le sous-ensemble ADR-003, donc ≤ 400 : jamais tronqué).
2. Si `occ` est vide (cache périmé) : pas de livraison. Sinon `last = occ.last()`, `skipped = len − 1`, issue : `now − last.at ≤ GRACE` (5 min) → `on_time` ; `≤ CATCHUP_WINDOW` (7 j) → `late` ; sinon `missed` (aucun toast).
3. Nouveau cache : `next_after(spec, now)`.
Puis, pour l'ensemble du passage (rappels et minuteurs) : avis triés (à l'heure d'abord, par échéance ; puis en retard) ; ≤ `MAX_TOASTS_PER_TICK` (4) → tous ; sinon les 3 premiers + 1 résumé.
Désactiver un rappel efface son cache ; le réactiver repart de `next_after(now)` **sans** rattrapage de la période désactivée.

### D7. Minuteurs : une table `time_sessions` pour minuteurs, chronos et pomodoro ; l'échéance est un instant tenu par le Rust
- `kind` ∈ `stopwatch` (chrono « en cours depuis X », sans fin), `countdown`, `pomodoro_work`, `pomodoro_short_break`, `pomodoro_long_break`. `started_at` et `ends_at = started_at + durée` sont calculés **par le Rust** (horloge unique), en instants (ADR-003 §3.3 : les durées se calculent entre instants, C25).
- Fin d'un minuteur : le planificateur écrit `ended_at = ends_at` (et non l'instant du traitement : l'historique reste juste même si le PC dormait) et `end_reason = 'completed'`, par un `UPDATE … WHERE ended_at IS NULL` ; toast seulement si une ligne a changé (au plus une fois, sans table de livraison). Retard > `GRACE` : texte « pendant l'absence », même fenêtre de 7 jours que les rappels, au-delà aucun toast.
- Un chrono en cours survit au redémarrage (« reprise correcte après fermeture », PLAN §5) : rien à faire, `started_at` est en base.
- Le front n'est qu'un **affichage** : décompte = `ends_at − CLOCK.now()`, recalculé à chaque seconde quand la fenêtre est visible. Le `Web Worker` prévu par PLAN §2 est **abandonné** : la WebView ralentit les minuteries d'une page masquée, mais l'échéance est tenue par le Rust et l'affichage se recalcule depuis l'horloge au retour (§10.5).

### D8. Pas d'événement Rust → front en phase 2
| Option | Pour | Contre |
|---|---|---|
| A. `emit` + `listen` | Simple | Ajoute `core:event:allow-listen` / `allow-unlisten`, première permission `core:*` (V8, V17) |
| B. `Channel` passé à une commande d'abonnement | Pas de permission `core:*` a priori | Besoin d'ACL non confirmé (PV7) ; état d'abonnement à gérer |
| **C. Aucun push : le front relit par commandes** à l'ouverture, au retour visible / focus, après chacune de ses actions, et **1 s après chaque échéance qu'il affiche** (`ends_at`, `next_fire_at`) | Aucune permission, aucun état ; le front connaît déjà toutes les échéances | Une relecture par échéance (négligeable) |

**Retenu : C.** Le seul changement fait par le Rust sans action du front survient à une échéance que le front connaît. Si un besoin de push apparaît (ex. actions de notification, PV1), B puis A, par amendement.

### D9. Notifications : plugin `tauri-plugin-notification` depuis le Rust, derrière un trait `Notifier`
- Aucune permission `notification:*` côté JS (V8) : le front n'envoie jamais de notification. Le `NotificationService` prévu par l'ADR-001 §3.8 n'est pas créé (§10.1).
- Son **toujours explicite** (V13) : `Reminder` pour un rappel, `Alarm` pour la fin d'un minuteur, `Default` pour un résumé (M7).
- Textes natifs en français, **dans un seul fichier Rust** (`schedule/notice.rs`) : i18n native hors périmètre (spike) ; un changement de langue ne touchera que ce fichier.
- Le Rust ne connaît ni le fuseau de l'utilisateur ni celui de Windows (ADR-003 §3.2) : un rappel affiche son heure **nominale dans son propre fuseau** (`next_fire_key`) ; un minuteur parle en durée relative (« il y a 2 h 5 min », au plus deux unités, cf. §4.5).
- Rejeté pour la phase 2 : `tauri-winrt-notification` en direct (boutons, `Scenario::Reminder`, clic) : déjà dans l'arbre (V10) mais il faudrait recopier la gestion de l'AUMID du plugin (V11) ; option documentée pour M5/M7 (§12).

### D10. Fenêtre, zone de notification, démarrage automatique (M6)
- Existant conservé : fermer = masquer dans la zone de notification ; « Quitter » arrête le processus (et donc les rappels) ; instance unique.
- `tauri.conf.json` : fenêtre `main` `"visible": false` ; en fin de `.setup()`, `show_main_window` sauf si `--minimized` figure dans `std::env::args()`. Le second lancement (instance unique) affiche toujours la fenêtre.
- Autostart : `init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"]))` ; au démarrage, si `is_enabled()`, `enable()` réécrit l'entrée (chemin et argument à jour, S4).
- Le planificateur démarre dans `.setup()`, que la fenêtre soit visible ou non.

### D11. Ancre horodatée uniquement pour les rappels
`reminders` n'a ni `start_on` ni contrainte d'ancre exclusive : une ancre datée ne sonne jamais (ADR-003 §3.5.5), un « rappel » sans heure n'aurait pas de sens. Les éléments « toute la journée » viendront des tâches et des habitudes. Écart assumé au fragment « ancre exclusive » (ADR-003 §3.1.3), qui vise les éléments pouvant porter l'une ou l'autre (§10.3).

### D12. Édition d'une série (M8)
« Modifier » remplace toute la série (titre, ancre, règle, exceptions, activation) et recalcule le cache. « Ignorer la prochaine occurrence » ajoute `next_fire_key` aux `exdates` (≤ 366, ADR-003 §3.5.3) par la même commande de modification. Une modification qui change l'heure crée de nouvelles clés : la nouvelle occurrence sonnera même si l'ancienne a déjà sonné le même jour (comportement voulu) ; une modification du seul titre conserve les clés (pas de doublon). Les clés d'occurrence sont des heures murales : un changement de fuseau ou d'heure de départ qui laisse la même heure murale garde la même clé, et si cette occurrence a déjà été livrée le jour du changement, la nouvelle est absorbée sans toast (cas limite accepté en v1, L36). Avant d'appliquer une modification, les commandes qui touchent une échéance traitent d'abord ce qui est déjà échu (même fonction que le passage, §4.3 étapes 1 et 2, sous le même `gate`) : modifier un rappel échu non traité le livre d'abord, démarrer une session après un minuteur expiré non complété le complète d'abord.

---

## 4. Conception détaillée

### 4.1 Migration V7

`migrations/V7__timers_reminders.sql` (texte exact, LF, sans BOM ; **figé à la revue du lot R1** ; aucun `npm run dev` entre le début de R1 et cette revue, comme todo-details D10) :

```sql
-- V7__timers_reminders : rappels, livraisons de rappels, sessions de minuteur (spec timers-reminders).
-- Ces tables ne sont lues et écrites QUE par les commandes Rust du module schedule : aucun SQL côté front.
-- Fragments temporels de l'ADR-003 3.1.3. Un rappel a toujours une ancre horodatée (start_local +
-- time_zone) : une ancre datée ne sonne jamais (ADR-003 3.5.5).
-- next_fire_at / next_fire_key : cache de la prochaine occurrence, écrit par le planificateur Rust.
-- reminder_deliveries : une ligne par occurrence traitée ; la clé (reminder_id, occurrence_key)
-- déduplique les notifications (clé naturelle, pas d'UUID).
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

CREATE TABLE reminders (
  id            TEXT    NOT NULL PRIMARY KEY
                CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  title         TEXT    NOT NULL
                CHECK (length(trim(title)) >= 1 AND length(title) <= 200
                       AND length(CAST(title AS BLOB)) <= 800),
  start_local   TEXT    NOT NULL CHECK (
                start_local GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
                AND strftime('%Y-%m-%dT%H:%M:%S', start_local, '+0 seconds') IS start_local
                AND start_local BETWEEN '1900-01-01' AND '2200-01-01'),
  time_zone     TEXT    NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64
                AND time_zone GLOB '[A-Za-z]*'
                AND time_zone NOT GLOB '*[^A-Za-z0-9_+/-]*'),
  rrule         TEXT    NULL CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*')),
  exdates       TEXT    NOT NULL CHECK (json_valid(exdates) AND json_type(exdates) = 'array'
                AND json_array_length(exdates) <= 366 AND length(exdates) <= 8192),
  enabled       INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  next_fire_at  TEXT    NULL CHECK (next_fire_at IS NULL OR (
                next_fire_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                AND strftime('%Y-%m-%dT%H:%M:%fZ', next_fire_at, '+0 seconds') IS next_fire_at
                AND next_fire_at BETWEEN '1900-01-01' AND '2200-01-01')),
  next_fire_key TEXT    NULL CHECK (next_fire_key IS NULL OR (
                next_fire_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
                AND strftime('%Y-%m-%dT%H:%M:%S', next_fire_key, '+0 seconds') IS next_fire_key
                AND next_fire_key BETWEEN '1900-01-01' AND '2200-01-01')),
  created_at    TEXT    NOT NULL
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at    TEXT    NOT NULL
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((next_fire_at IS NULL) = (next_fire_key IS NULL)),
  CHECK (enabled = 1 OR next_fire_at IS NULL)
) STRICT;

CREATE INDEX reminders_next_fire_at_idx ON reminders (next_fire_at)
  WHERE next_fire_at IS NOT NULL;

CREATE TABLE reminder_deliveries (
  reminder_id    TEXT    NOT NULL
                 REFERENCES reminders (id) ON DELETE CASCADE,
  occurrence_key TEXT    NOT NULL CHECK (
                 occurrence_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
                 AND strftime('%Y-%m-%dT%H:%M:%S', occurrence_key, '+0 seconds') IS occurrence_key
                 AND occurrence_key BETWEEN '1900-01-01' AND '2200-01-01'),
  due_at         TEXT    NOT NULL CHECK (
                 due_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                 AND strftime('%Y-%m-%dT%H:%M:%fZ', due_at, '+0 seconds') IS due_at
                 AND due_at BETWEEN '1900-01-01' AND '2200-01-01'),
  outcome        TEXT    NOT NULL CHECK (outcome IN ('on_time', 'late', 'missed')),
  skipped_count  INTEGER NOT NULL CHECK (skipped_count BETWEEN 0 AND 1000),
  seen_at        TEXT    NULL CHECK (seen_at IS NULL OR (
                 seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                 AND strftime('%Y-%m-%dT%H:%M:%fZ', seen_at, '+0 seconds') IS seen_at
                 AND seen_at BETWEEN '1900-01-01' AND '2200-01-01')),
  created_at     TEXT    NOT NULL
                 CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at     TEXT    NOT NULL
                 CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (reminder_id, occurrence_key)
) STRICT;

CREATE INDEX reminder_deliveries_unseen_idx ON reminder_deliveries (created_at)
  WHERE seen_at IS NULL;

CREATE TABLE time_sessions (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  kind        TEXT    NOT NULL CHECK (kind IN ('stopwatch', 'countdown', 'pomodoro_work',
              'pomodoro_short_break', 'pomodoro_long_break')),
  label       TEXT    NOT NULL
              CHECK (length(label) <= 100 AND length(CAST(label AS BLOB)) <= 400),
  started_at  TEXT    NOT NULL CHECK (
              started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+0 seconds') IS started_at
              AND started_at BETWEEN '1900-01-01' AND '2200-01-01'),
  ends_at     TEXT    NULL CHECK (ends_at IS NULL OR (
              ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', ends_at, '+0 seconds') IS ends_at
              AND ends_at BETWEEN '1900-01-01' AND '2200-01-01'
              AND ends_at > started_at)),
  ended_at    TEXT    NULL CHECK (ended_at IS NULL OR (
              ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', ended_at, '+0 seconds') IS ended_at
              AND ended_at BETWEEN '1900-01-01' AND '2200-01-01')),
  end_reason  TEXT    NULL CHECK (end_reason IS NULL OR end_reason IN ('completed', 'stopped')),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'stopwatch') = (ends_at IS NULL)),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (end_reason IS NOT 'completed' OR (ends_at IS NOT NULL AND ended_at IS ends_at))
) STRICT;

CREATE INDEX time_sessions_running_idx ON time_sessions (ends_at)
  WHERE ended_at IS NULL;
CREATE INDEX time_sessions_history_idx ON time_sessions (started_at, id)
  WHERE ended_at IS NOT NULL;

-- Safety net for M10 (a single pomodoro): the indexed expression is constant, so two running
-- pomodoro sessions cannot coexist even if a row is written outside insert_session.
CREATE UNIQUE INDEX time_sessions_one_pomodoro_idx ON time_sessions ((ended_at IS NULL))
  WHERE ended_at IS NULL AND kind IN ('pomodoro_work', 'pomodoro_short_break', 'pomodoro_long_break');
```
- `time_sessions_one_pomodoro_idx` est un filet de sécurité (M10) : l'index unique partiel sur une expression constante interdit deux pomodoros en cours même si une ligne est écrite hors de `insert_session`, qui garde son contrôle transactionnel et renvoie `AlreadyRunning` dans le cas normal.
- `src/db.rs` : `version: 7, description: "timers_reminders"`. `checksums.json` : SHA-256 du fichier.
- Aucune contrainte `ended_at >= started_at` (ADR-002 §3.3 : un recul d'horloge ferait échouer l'écriture) ; le Rust écrit `max(now, started_at)` à l'arrêt. `ends_at > started_at` est sûr (les deux viennent du même `now`).
- Pas de `DEFAULT` (tables neuves). Pas de rattachement à `widget_instances` (M9).
- Pièges à mettre à jour dans le même lot (V9) : `backup/sqlite.rs` (`supported_schema_version() == 7`), `backup/validate_tests.rs` (`supported: 7` ; nouveau test « base V6 migrée en V7 = `expected_schema(7)` » sur le modèle des l. 1105-1144), `data/migrations.spec.ts` (tables attendues + bloc V7).

### 4.2 Module Rust `schedule` (fichiers et types)

```
src/schedule/mod.rs        SchedulerCtx, SchedulerState, constantes, start(), shutdown()
src/schedule/error.rs      ScheduleError (sérialisable)
src/schedule/text.rs       validation des textes (titre, libellé) et des identifiants
src/schedule/store.rs      SEUL fichier qui contient du SQL sur les 3 tables (sqlx, paramètres liés)
src/schedule/reminder.rs   ligne → RecurrenceSpec, statut, plan_due (pur), next_fire (pur)
src/schedule/session.rs    SessionKind, bornes de durée, complétion
src/schedule/notice.rs     Notice, Toast, render() (textes FR), group() (pur)
src/schedule/notifier.rs   trait Notifier, TauriNotifier, RecordingNotifier (cfg(test))
src/schedule/tick.rs       tick(), next_due()
src/schedule/worker.rs     WakeSignal, run_loop(), spawn(), shutdown_within()
src/schedule/commands.rs   DTO + 12 commandes Tauri (lot R3)
src/schedule/tests/        store_tests.rs, plan_tests.rs, tick_tests.rs, worker_tests.rs, commands_tests.rs
```

```rust
// mod.rs
pub const MAX_SLEEP: Duration = Duration::from_secs(30);
pub const ERROR_RETRY: Duration = Duration::from_secs(5);
pub const WAKE_MARGIN: Duration = Duration::from_millis(20);
pub const EXIT_JOIN_MAX: Duration = Duration::from_secs(3); // < backup::lock::ACQUIRE_TOTAL (rendre pub(crate) + assert const)
pub const GRACE: SignedDuration = SignedDuration::from_mins(5);
pub const CATCHUP_WINDOW: SignedDuration = SignedDuration::from_hours(7 * 24);
pub const COUNT_WINDOW: SignedDuration = SignedDuration::from_hours(399 * 24);
pub const MAX_TOASTS_PER_TICK: usize = 4;
pub const DUE_BATCH: i64 = 200;
pub const MAX_REMINDERS: i64 = 1000;
pub const MAX_RUNNING_SESSIONS: i64 = 20;
pub const TITLE_MAX_CHARS: usize = 200;
pub const LABEL_MAX_CHARS: usize = 100;
pub const DURATION_MIN_MS: i64 = 1_000;
pub const DURATION_MAX_MS: i64 = 86_400_000;
pub const LIST_MAX_LIMIT: u32 = 200;

pub struct SchedulerCtx {
    pub db: PathBuf,
    pub clock: Arc<dyn Clock>,
    pub notifier: Arc<dyn Notifier>,
    pub gate: tokio::sync::Mutex<()>,   // sérialise toutes les opérations du module (D3)
    pub signal: WakeSignal,
}
pub struct SchedulerState { pub ctx: Arc<SchedulerCtx>, handle: Mutex<Option<JoinHandle<()>>> }

/// Appelé dans `.setup()` après `on_app_ready` : chemin = BackupState.root.db(), horloge = celle de
/// BackupState, notifier = TauriNotifier ; `app.manage(SchedulerState)` puis worker::spawn.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>>;
/// RunEvent::Exit : stop + join borné par EXIT_JOIN_MAX. Sans état (setup échoué) : rien.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>);

// error.rs
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleError {
    InvalidInput { field: String },   // nom du champ DTO en camelCase
    Time { error: TimeError },        // erreur de règle, de fuseau, d'heure murale…
    NotFound,
    Conflict,                         // identifiant déjà utilisé
    AlreadyRunning,                   // un pomodoro est déjà en cours
    LimitReached,                     // MAX_REMINDERS, MAX_RUNNING_SESSIONS
    Busy,                             // SQLITE_BUSY après busy_timeout
    Database,                         // autre erreur sqlx (journalisée sans valeurs de paramètres)
}
impl From<sqlx::Error> for ScheduleError; // code SQLite 5 → Busy ; 1555 / 2067 → Conflict ; sinon Database

// text.rs
/// trim non vide, 1..=TITLE_MAX_CHARS points de code, aucun caractère de contrôle (C0, DEL, C1) ni caractère de format invisible (U+200B à U+200F, U+202A à U+202E, U+2066 à U+2069, U+FEFF : usurpation bidi).
pub fn check_title(s: &str) -> Result<(), ScheduleError>;
/// 0..=LABEL_MAX_CHARS points de code, aucun caractère de contrôle.
pub fn check_label(s: &str) -> Result<(), ScheduleError>;
pub fn check_id(s: &str) -> Result<(), ScheduleError>; // backup::names::is_uuid_shape

// reminder.rs
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderRow { pub id: String, pub title: String, pub start_local: String, pub time_zone: String,
    pub rrule: Option<String>, pub exdates: String /* JSON */, pub enabled: bool,
    pub next_fire_at: Option<String>, pub next_fire_key: Option<String>, pub created_at: String, pub updated_at: String }
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)] #[serde(rename_all = "snake_case")]
pub enum ReminderStatus { Scheduled, Finished, Disabled, Invalid }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome { OnTime, Late, Missed }
pub struct PlannedDelivery { pub key: String, pub due_at: Timestamp, pub nominal_local: civil::DateTime, pub outcome: Outcome, pub skipped: u32 }
pub struct DuePlan { pub delivery: Option<PlannedDelivery>, pub next: Option<Occurrence> }
/// Reconstruit la spec par la même conversion que time_validate (to_spec rendu pub(crate), V3).
pub fn spec_of(row: &ReminderRow) -> Result<RecurrenceSpec, TimeError>;
pub fn status_of(row: &ReminderRow, now: Timestamp) -> ReminderStatus;   // invalid si spec_of échoue, ou si next_fire échoue pour un rappel actif sans cache (sinon finished)
pub fn outcome_for(due_at: Timestamp, now: Timestamp) -> Outcome;  // bornes inclusives (D6)
/// D6 étapes 1 à 3. `cached_next <= now` (sinon appel invalide : debug_assert).
pub fn plan_due(spec: &RecurrenceSpec, cached_next: Timestamp, now: Timestamp) -> Result<DuePlan, TimeError>;
pub fn next_fire(spec: &RecurrenceSpec, now: Timestamp) -> Result<Option<Occurrence>, TimeError>; // next_after

// session.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)] #[serde(rename_all = "snake_case")]
pub enum SessionKind { Stopwatch, Countdown, PomodoroWork, PomodoroShortBreak, PomodoroLongBreak }
impl SessionKind { pub fn is_pomodoro(self) -> bool; pub fn as_sql(self) -> &'static str; pub fn from_sql(s: &str) -> Option<Self>; }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRow { pub id: String, pub kind: SessionKind, pub label: String, pub started_at: String,
    pub ends_at: Option<String>, pub ended_at: Option<String>, pub end_reason: Option<String>, pub created_at: String, pub updated_at: String }
/// Stopwatch ⇔ duration None ; sinon DURATION_MIN_MS..=DURATION_MAX_MS.
pub fn check_duration(kind: SessionKind, duration_ms: Option<i64>) -> Result<(), ScheduleError>;

// notice.rs
pub enum Notice {
    Reminder { title: String, nominal_local: civil::DateTime, outcome: Outcome, skipped: u32, due_at: Timestamp },
    SessionEnded { kind: SessionKind, label: String, planned: SignedDuration, late_by: Option<SignedDuration>, due_at: Timestamp },
    Summary { reminders: u32, sessions: u32 },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toast { pub title: String, pub body: String, pub sound: &'static str } // "Reminder" | "Alarm" | "Default"
pub fn render(notice: &Notice) -> Toast;          // §4.5, pur
pub fn group(notices: Vec<Notice>) -> Vec<Notice>; // D6, pur ; ne reçoit jamais d'issue Missed

// notifier.rs
pub trait Notifier: Send + Sync { fn show(&self, toast: &Toast); } // erreurs journalisées, jamais propagées
pub struct TauriNotifier<R: Runtime> { app: AppHandle<R> }        // notification().builder().title().body().sound().show()
#[cfg(test)] pub struct RecordingNotifier { pub shown: Mutex<Vec<Toast>> }

// tick.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Phase { Startup, Regular }
#[derive(Debug, Default, PartialEq, Eq)]
pub struct TickReport { pub sessions_completed: usize, pub reminders_processed: usize, pub invalid: usize, pub toasts: usize, pub next_due: Option<Timestamp> }
/// Prend `ctx.gate`, lit `ctx.clock.now()` une fois, applique §4.3, notifie après les commits.
pub async fn tick(ctx: &SchedulerCtx, phase: Phase) -> Result<TickReport, ScheduleError>;

// worker.rs
#[derive(Default)] pub struct WakeSignal { /* Mutex<(stopped: bool, woken: bool)> + Condvar */ }
#[derive(Debug, PartialEq, Eq)] pub enum WaitOutcome { Stopped, Woken, TimedOut }
impl WakeSignal { pub fn wake(&self); pub fn stop(&self); pub fn wait(&self, max: Duration) -> WaitOutcome; }
/// Boucle : tick(Startup) puis tick(Regular)… ; attente = clamp(next_due − now, 0, max_sleep) + WAKE_MARGIN,
/// ERROR_RETRY après une erreur, max_sleep sans échéance ; sort sur Stopped.
pub fn run_loop(ctx: &SchedulerCtx, max_sleep: Duration);
pub fn spawn(state: &SchedulerState);                  // thread nommé "homebase-scheduler"
pub(crate) fn shutdown_within(state: &SchedulerState, max: Duration);
```
- `now` est **tronqué à la milliseconde** (`parse_instant(&format_instant(clock.now()))`) avant tout calcul, pour que ce qui est écrit soit exactement ce qui est comparé.
- `time/commands.rs` : `to_spec` passe en `pub(crate)` (aucun changement de comportement). `time/recurrence/mod.rs` : retirer l'attribut `cfg_attr(…, expect(dead_code, …))` de `next_after` (V1).
- Clippy (`clippy.toml`, ADR-003 §3.6) : aucun `Timestamp::now` ; `std::time::Instant` reste permis pour mesurer une attente.

### 4.3 Algorithme d'un passage (`tick`)

Sous `ctx.gate`, `now` lu une fois :
1. **Minuteurs échus** : `SELECT … FROM time_sessions WHERE ended_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ?1 ORDER BY ends_at, id LIMIT ?2` ; pour chacun, `UPDATE time_sessions SET ended_at = ends_at, end_reason = 'completed', updated_at = ?2 WHERE id = ?1 AND ended_at IS NULL` ; si 1 ligne et `now − ends_at ≤ CATCHUP_WINDOW` : avis `SessionEnded` (`late_by` = `Some(now − ends_at)` si > `GRACE`). Répéter tant qu'un lot est plein.
2. **Rappels échus** : `SELECT … FROM reminders WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?1 ORDER BY next_fire_at, id LIMIT ?2` ; pour chacun :
   - `spec_of(row)` en échec, ou `plan_due` en erreur : journaliser (id seulement), `UPDATE reminders SET next_fire_at = NULL, next_fire_key = NULL WHERE id = ?1 AND next_fire_at IS ?2` ; compter `invalid` ; continuer.
   - Sinon, transaction `BEGIN IMMEDIATE` : si `delivery` : `INSERT INTO reminder_deliveries (reminder_id, occurrence_key, due_at, outcome, skipped_count, seen_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6) ON CONFLICT (reminder_id, occurrence_key) DO NOTHING` ; puis `UPDATE reminders SET next_fire_at = ?2, next_fire_key = ?3 WHERE id = ?1 AND next_fire_at IS ?4` (**`updated_at` inchangé** : le cache n'est pas une modification de l'utilisateur) ; `COMMIT`. Avis `Reminder` si l'insertion a créé la ligne et que l'issue n'est pas `missed`.
   - Répéter tant qu'un lot est plein.
3. **Phase `Startup` seulement**, après 1 et 2 : pour chaque rappel `enabled = 1`, recalculer `next_fire(spec, now)` et écrire le cache s'il diffère (invalide → `NULL`). Filet tzdb / version du moteur ; aucun rattrapage n'est perdu puisque les échéances passées ont été traitées avant.
4. `group(avis)` puis `notifier.show(render(…))` pour chacun, **hors transaction**.
5. `next_due` : `SELECT MIN(t) FROM (SELECT MIN(next_fire_at) AS t FROM reminders WHERE enabled = 1 AND next_fire_at IS NOT NULL UNION ALL SELECT MIN(ends_at) FROM time_sessions WHERE ended_at IS NULL AND ends_at IS NOT NULL)`.

Garde-fous de la boucle (revue R2) : si `next_due <= now` après un passage réussi (échéance que le passage n'a pas pu faire avancer), le thread attend `ERROR_RETRY` et journalise, au lieu de `WAKE_MARGIN` ; une panique du passage (notifieur) est traitée comme une erreur (attente `ERROR_RETRY`, phase inchangée). Le `busy_timeout` est porté par `SchedulerCtx` (5 s en production). Écarts assumés : (1) un échec de `spawn` du thread est journalisé et l'application démarre sans planificateur ; (2) `fire_due_reminders` garde un `HashSet` des identifiants déjà vus dans le passage pour ne jamais retraiter en boucle un rappel dont le cache a bougé ; limite connue : un tel rappel n'est repris qu'au passage suivant, et `reminders_processed` ne compte que les compare-and-write ayant écrit.

Chaque commande qui modifie une échéance (§4.4) appelle `ctx.signal.wake()` **après** son commit ; la boucle refait alors un passage `Regular` et recalcule son attente.

### 4.4 Commandes Tauri (lot R3)

**Avant toute modification d'échéance** (`reminder_update`, `reminder_delete`, `session_start`, `session_stop`, `session_delete`), la commande exécute sous le `gate`, dans le même passage de connexion, les étapes 1 et 2 de §4.3 (minuteurs et rappels échus, fonction partagée avec `tick`), puis applique sa modification ; les toasts collectés sont affichés après libération du `gate`, hors transaction (`group` puis `render`). `reminder_create` compte et insère dans une transaction `BEGIN IMMEDIATE`.

Toutes `#[tauri::command]` sur `async fn` (hors thread principal, V16 de l'ADR-003), prennent `State<'_, SchedulerState>`, valident **toutes** les bornes avant tout accès disque, puis appellent une fonction métier `pub(crate) async fn …(ctx: &SchedulerCtx, …)` testée sans Tauri. DTO en camelCase, `#[serde(deny_unknown_fields)]` sur les entrées.

```rust
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReminderInputDto { pub title: String, pub start_local: String, pub time_zone: String,
    pub rrule: Option<String>, pub exdates: Vec<String>, pub enabled: bool }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReminderCreateDto { pub id: String, pub title: String, pub start_local: String, pub time_zone: String,
    pub rrule: Option<String>, pub exdates: Vec<String>, pub enabled: bool }
#[derive(Debug, serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct ReminderDto { pub id: String, pub title: String, pub start_local: String, pub time_zone: String,
    pub rrule: Option<String>, pub exdates: Vec<String>, pub enabled: bool, pub next_fire_at: Option<String>,
    pub next_fire_key: Option<String>, pub status: ReminderStatus, pub created_at: String, pub updated_at: String }
#[derive(Debug, serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct DeliveryDto { pub reminder_id: String, pub title: String, pub time_zone: String, pub occurrence_key: String,
    pub due_at: String, pub outcome: String /* on_time | late | missed */, pub skipped_count: u32,
    pub seen_at: Option<String>, pub created_at: String }
#[derive(serde::Deserialize)] #[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MarkSeenDto { All, #[serde(rename_all = "camelCase")] One { reminder_id: String, occurrence_key: String } }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionStartDto { pub id: String, pub kind: SessionKind, pub label: String, pub duration_ms: Option<i64> }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryCursorDto { pub started_at: String, pub id: String }
#[derive(Debug, serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct SessionDto { pub id: String, pub kind: SessionKind, pub label: String, pub started_at: String,
    pub ends_at: Option<String>, pub ended_at: Option<String>, pub end_reason: Option<String>,
    pub created_at: String, pub updated_at: String }

pub async fn reminder_list(state) -> Result<Vec<ReminderDto>, ScheduleError>;
pub async fn reminder_create(state, input: ReminderCreateDto) -> Result<ReminderDto, ScheduleError>;
pub async fn reminder_update(state, id: String, input: ReminderInputDto) -> Result<ReminderDto, ScheduleError>;
pub async fn reminder_delete(state, id: String) -> Result<bool, ScheduleError>;
pub async fn reminder_unseen_deliveries(state, limit: u32) -> Result<Vec<DeliveryDto>, ScheduleError>;
pub async fn reminder_mark_seen(state, target: MarkSeenDto) -> Result<u64, ScheduleError>;
pub async fn session_list_running(state) -> Result<Vec<SessionDto>, ScheduleError>;
pub async fn session_history(state, before: Option<HistoryCursorDto>, limit: u32) -> Result<Vec<SessionDto>, ScheduleError>;
pub async fn session_start(state, input: SessionStartDto) -> Result<SessionDto, ScheduleError>;
pub async fn session_stop(state, id: String) -> Result<SessionDto, ScheduleError>;
pub async fn session_rename(state, id: String, label: String) -> Result<SessionDto, ScheduleError>;
pub async fn session_delete(state, id: String) -> Result<bool, ScheduleError>;
```

| Commande | Contrôles (dans l'ordre) | Effet | Réveil |
|---|---|---|---|
| `reminder_list` | — | toutes les lignes, `ORDER BY next_fire_at IS NULL, next_fire_at, title COLLATE NOCASE, id` ; `status` par `status_of` ; une ligne invalide est renvoyée avec `status: invalid` (jamais d'erreur globale) | non |
| `reminder_create` | `id` (UUID), `title`, conversion par `to_spec` (anchor `date-time`, `rrule`, `exdates` ≤ 366 et ≤ 19 caractères : erreurs `Time`), `COUNT(*) < MAX_REMINDERS` sinon `LimitReached` | `INSERT` (règle et `exdates` **canoniques**), cache = `next_fire(spec, now)` si `enabled`, `created_at = updated_at = now` ; id existant → `Conflict` | oui |
| `reminder_update` | mêmes contrôles (sans limite) | remplace titre, ancre, règle, exceptions, activation ; recalcule le cache ; 0 ligne → `NotFound` | oui |
| `reminder_delete` | `id` | `DELETE` (cascade sur les livraisons) ; `false` si absent | oui |
| `reminder_unseen_deliveries` | `limit` 1..=200 | livraisons `seen_at IS NULL` jointes au titre et au fuseau, `ORDER BY d.created_at DESC, d.reminder_id, d.occurrence_key` | non |
| `reminder_mark_seen` | `One` : `id` et clé (heure murale stricte) | `UPDATE … SET seen_at = now, updated_at = now WHERE seen_at IS NULL [AND reminder_id = ?2 AND occurrence_key = ?3]` ; renvoie le nombre de lignes | non |
| `session_list_running` | — | `WHERE ended_at IS NULL ORDER BY started_at, id` | non |
| `session_history` | `limit` 1..=200 ; curseur : instant strict + UUID | `WHERE ended_at IS NOT NULL AND (?1 IS NULL OR started_at < ?1 OR (started_at = ?1 AND id < ?2)) ORDER BY started_at DESC, id DESC LIMIT ?3` | non |
| `session_start` | `id`, `label`, `check_duration` ; en transaction `BEGIN IMMEDIATE` : sessions en cours ≥ 20 → `LimitReached` ; `kind` pomodoro et un pomodoro en cours → `AlreadyRunning` | `started_at = now`, `ends_at = now + durée` (ou `NULL`) ; id existant → `Conflict` | oui |
| `session_stop` | `id` | en cours et `ends_at <= now` : complétée (`ended_at = ends_at`, `completed` ; le toast de fin est celui du traitement de l'échu qui précède, une seule fois) ; en cours sinon : `ended_at = max(now, started_at)`, `stopped` ; déjà terminée : renvoyée telle quelle (idempotent) ; absente → `NotFound` | oui |
| `session_rename` | `id`, `label` | `label`, `updated_at` ; absente → `NotFound` | non |
| `session_delete` | `id` | `DELETE` (en cours comprise : aucun toast ne suivra) ; `false` si absente | oui |

Enregistrement : `build.rs` (`AppManifest::commands`), les **deux** `invoke_handler` de `lib.rs` et `capabilities/default.json` (`allow-reminder-list`, `allow-reminder-create`, `allow-reminder-update`, `allow-reminder-delete`, `allow-reminder-unseen-deliveries`, `allow-reminder-mark-seen`, `allow-session-list-running`, `allow-session-history`, `allow-session-start`, `allow-session-stop`, `allow-session-rename`, `allow-session-delete`), plus les tests de `lib.rs` et `capability_tests.rs` (liste exacte). Aucune autre permission, aucun nouveau fichier de capability. La description de `default.json` gagne une phrase : « The schedule commands (reminder_*, session_*) read and write only the reminders, reminder_deliveries and time_sessions tables, with bounded, validated inputs; notifications are shown from Rust only (no notification:* permission). »

### 4.5 Notifications (textes exacts, `notice.rs`)

Le titre utilisateur passe par `check_title` à l'écriture ; à l'affichage, il est tronqué à 200 points de code (défense si la ligne a été écrite hors du Rust). Heures et dates formatées par `jiff` (`%H:%M`, `%d/%m`), jamais calculées.

| Avis | `title` | `body` | `sound` |
|---|---|---|---|
| Rappel, `on_time` | `{titre}` | `Prévu à {HH:MM}` | `Reminder` |
| Rappel, `late` | `Rappel manqué : {titre}` | `Prévu le {JJ/MM} à {HH:MM}` | `Reminder` |
| … avec `skipped = n > 0` (rappel `on_time` comme `late`) | idem | + ` · {n} occurrence précédente manquée` / ` · {n} occurrences précédentes manquées` | idem |
| Minuteur (`countdown`) | `Minuteur terminé` | `{libellé}` ou, si vide, `Minuteur de {durée}` | `Alarm` |
| Pomodoro, travail | `Pomodoro terminé` | `C'est l'heure de la pause.` (+ ` ({libellé})` si non vide) | `Alarm` |
| Pomodoro, pause | `Pause terminée` | `Prêt pour le prochain pomodoro ?` | `Alarm` |
| Minuteur en retard (`late_by`) | titre ci-dessus + ` pendant l'absence` | corps ci-dessus + ` · il y a {durée}` | `Alarm` |
| Résumé | `Homebase` | `{r} autre(s) rappel(s)` (certains ont pu sonner à l'heure) et/ou `{s} minuteur(s) terminé(s)`, joints par ` et `, puis `. Ouvrez Homebase pour les voir.` (singulier : `1 autre rappel`, `1 minuteur terminé` ; pluriel : `3 autres rappels`) | `Default` |

`{durée}` (fonction pure `format_duration_fr`) : `45 s`, `10 min`, `1 h`, `1 h 30 min`, `2 j 3 h` (au plus deux unités, troncature). Une session `stopwatch` ne produit jamais d'avis.

### 4.6 Démarrage, zone de notification, démarrage automatique (lot R4)

- `tauri.conf.json` : `"visible": false` sur la fenêtre `main` (seul changement ; `tauri.dev.conf.json` intact, test `dev_conf_only_overrides_identifier_and_product_name`).
- `lib.rs` `.setup()` : `on_app_ready` → `tray::setup` → `schedule::start` → `refresh_autostart` → `if !launched_minimized(std::env::args()) { show_main_window(app) }`. `pub(crate) fn launched_minimized(args: impl IntoIterator<Item = String>) -> bool` (test : `--minimized` présent ou non, argument inconnu ignoré).
- `RunEvent::Exit` : `schedule::shutdown(app)` **avant** `backup::startup::on_exit(app)`.
- Autostart : `tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"]))` ; `refresh_autostart` : `is_enabled()` vrai → `enable()` (erreurs journalisées, jamais bloquantes).
- Réglages, section « Système » : retirer « (expérimental) » ; libellé de l'interrupteur « Lancer Homebase au démarrage de Windows (réduit dans la zone de notification) » ; texte d'aide « Les rappels et les minuteurs sonnent tant que Homebase tourne, même fenêtre fermée. « Quitter » (icône de la zone de notification) les arrête. ». Le bouton de notification de test reste réservé au debug.
- Tray : inchangé.

### 4.7 Front : `data/`, `core/`

`data/models.ts` (ajouts) :
```ts
export type ReminderStatus = 'scheduled' | 'finished' | 'disabled' | 'invalid';
export interface Reminder {
  readonly id: string; readonly title: string;
  readonly startLocal: LocalDateTimeIso; readonly timeZone: TimeZoneId;
  readonly rrule: string | null; readonly exdates: readonly LocalDateTimeIso[]; readonly enabled: boolean;
  readonly nextFireAt: InstantIso | null; readonly nextFireKey: LocalDateTimeIso | null;
  readonly status: ReminderStatus; readonly createdAt: InstantIso; readonly updatedAt: InstantIso;
}
export interface ReminderInput {
  readonly title: string; readonly startLocal: LocalDateTimeIso; readonly timeZone: TimeZoneId;
  readonly rrule: string | null; readonly exdates: readonly LocalDateTimeIso[]; readonly enabled: boolean;
}
export type DeliveryOutcome = 'on_time' | 'late' | 'missed';
export interface ReminderDelivery {
  readonly reminderId: string; readonly title: string; readonly timeZone: TimeZoneId;
  readonly occurrenceKey: LocalDateTimeIso; readonly dueAt: InstantIso; readonly outcome: DeliveryOutcome;
  readonly skippedCount: number; readonly seenAt: InstantIso | null; readonly createdAt: InstantIso;
}
export type TimeSessionKind = 'stopwatch' | 'countdown' | 'pomodoro_work' | 'pomodoro_short_break' | 'pomodoro_long_break';
export interface TimeSession {
  readonly id: string; readonly kind: TimeSessionKind; readonly label: string;
  readonly startedAt: InstantIso; readonly endsAt: InstantIso | null;
  readonly endedAt: InstantIso | null; readonly endReason: 'completed' | 'stopped' | null;
  readonly createdAt: InstantIso; readonly updatedAt: InstantIso;
}
```
`data/repositories.ts` (ajouts) :
```ts
export type MarkSeenTarget =
  | { readonly kind: 'all' }
  | { readonly kind: 'one'; readonly reminderId: string; readonly occurrenceKey: LocalDateTimeIso };
export interface ReminderRepository {
  list(): Promise<Reminder[]>;
  /** id généré par IdGenerator s'il est absent. */
  create(input: ReminderInput & { readonly id?: string }): Promise<Reminder>;
  update(id: string, input: ReminderInput): Promise<Reminder>;
  remove(id: string): Promise<boolean>;
  unseenDeliveries(limit: number): Promise<ReminderDelivery[]>;
  markSeen(target: MarkSeenTarget): Promise<number>;
}
export interface TimeSessionRepository {
  listRunning(): Promise<TimeSession[]>;
  history(page: { readonly before?: { readonly startedAt: InstantIso; readonly id: string }; readonly limit: number }): Promise<TimeSession[]>;
  start(input: { readonly id?: string; readonly kind: TimeSessionKind; readonly label: string; readonly durationMs: number | null }): Promise<TimeSession>;
  stop(id: string): Promise<TimeSession>;
  rename(id: string, label: string): Promise<TimeSession>;
  remove(id: string): Promise<boolean>;
}
```
Implémentation `data/tauri/` (seul dossier de `data/` qui importe `@tauri-apps/api/core`, règle ESLint ajoutée) :
- `invoke-command.ts` : `invokeCommand<T>(name, args): Promise<T>` ; hors Tauri (`isTauriRuntime()` faux) → `DataError('unavailable')` ; erreur Rust `{ kind }` → `DataError` : `invalid_input` et `time` → `invalid_input` ; `not_found` → `not_found` ; `conflict`, `already_running` → `conflict` ; `limit_reached` → `forbidden` ; `busy` → `busy` ; autre → `unknown` ; l'objet Rust est conservé en `cause`.
- `tauri-reminder.repository.ts`, `tauri-time-session.repository.ts` : arguments exacts (`{ input }`, `{ id, input }`, `{ id }`, `{ limit }`, `{ target }`, `{ before, limit }`, `{ id, label }`).
- `data/schedule.tokens.ts` : jetons `REMINDER_REPOSITORY`, `TIME_SESSION_REPOSITORY` en `InjectionToken` `providedIn: 'root'` avec `factory` (`new TauriReminderRepository(randomUuid)`…), hors de `provideDataLayer()` et hors du barrel `data/index.ts` (qui n'exporte que les types) : les stores les importent par `../../data/schedule.tokens`, ce qui garde ces dépôts hors du bundle initial (amendement F1).

`core/` :
- `core/time/now-signal.ts` (exporté par `core/time/index.ts`) : `createNowSignal(periodMs: 1000 | 60000, destroyRef: DestroyRef): Signal<InstantIso>` : valeur = `CLOCK.nowIso()` ; prochain tick aligné sur le multiple suivant de `periodMs` ; suspendu quand `document.visibilityState === 'hidden'`, recalculé au retour visible et au `focus`.
- `core/time/duration-format.ts` : `formatClock(ms: number): string` (`0:05`, `4:32`, `1:02:03` ; négatif → `0:00` ; secondes **arrondies au supérieur** pour un décompte : paramètre `rounding: 'ceil' | 'floor'`) et `durationParts(ms): { days, hours, minutes, seconds }` (division entière d'une durée, pas d'une date). Les libellés longs (« 1 h 05 min ») passent par Transloco.
- `core/reminders/reminder.store.ts` (`providedIn: 'root'`) : signaux `reminders`, `unseen`, `loading`, `error` ; `refresh()`, `create`, `update`, `remove`, `skipNext(reminder)` (ajoute `nextFireKey` aux `exdates` triées, refuse au-delà de 366), `markSeen(target)` ; relecture automatique (D8) : au premier usage, `visibilitychange` visible, `focus`, et `setTimeout` à `min(nextFireAt) + 1 s` (borné à 15 min puis réarmé, comme `Today`) quand la fenêtre est visible.
- `core/timers/time-session.store.ts` (`providedIn: 'root'`) : `running`, `recent` (première page d'historique, 100), `hasMoreHistory`, `loadMoreHistory()`, `start`, `stop`, `rename`, `remove` ; relecture à `min(endsAt) + 1 s` et aux mêmes événements.
- **Erreurs des deux stores** : le signal `error` ne porte que les erreurs de **lecture** (`refresh`, `loadMoreHistory`). Une action en échec signale son échec uniquement en **rejetant** sa promesse (sans toucher à `error`) ; la relecture qui suit l'échec met à jour `error` si elle échoue elle-même. Chaque widget affiche son bandeau de lecture d'après `error` seul et garde un message d'action local, effacé à l'action suivante ou après une relecture réussie.
- Fakes : `core/testing/fake-reminder.repository.ts`, `core/testing/fake-time-session.repository.ts` (sémantique du §4.4, horloge `ManualClock`).

### 4.8 Widgets

Communs : dossiers autonomes (ADR-001), `ChangeDetectionStrategy.OnPush`, signaux, textes Transloco sous `widgets.<type>`, tokens et classes de DESIGN.md seulement, `permissions: ['notifications']` (documentation, V21), chiffres en `tabular-nums`, aucune donnée utilisateur en `innerHTML`. Les états vides suivent DESIGN.md §3 ; hors Tauri, bandeau `flash-danger` « Disponible uniquement dans l'application Windows. ».

**`timers`** (lot W1) — titre « Minuteurs », icône `pi pi-stopwatch`, tailles min 3×3, défaut 4×4, max 6×8, config v1 `{}`.
- « En cours » : lignes séparées (`box-row`). Minuteur : libellé (ou « Minuteur »), temps restant `formatClock(…, 'ceil')` en 24 px, fin « à 14:05 » (`TimeDisplay.formatInstant(endsAt, 'time')`), bouton « Arrêter ». Chrono : libellé (ou « Chrono »), « En cours depuis 1 h 05 » + « depuis 14:03 », bouton « Arrêter ». Un clic sur la ligne d'un chrono ouvre son **détail** (panneau, DESIGN « Panneau dans une carte ») : libellé modifiable (au fil de l'eau, 800 ms), début, durée écoulée, sessions terminées du même libellé (filtrées dans `recent`).
- « Démarrer » : préréglages 1, 5, 10, 15, 30 min (boutons compacts), champ minutes (1..1440) + secondes, champ libellé (≤ 100), « Démarrer le minuteur » (seule action primaire), « Démarrer un chrono ».
- « Alarme » (M1) : `<input type="time">` + libellé → rappel ponctuel (via `ReminderStore.create`) à la prochaine occurrence de cette heure (aujourd'hui si encore à venir, sinon demain : `todayIn`, `addDays`, `resolveLocal` dans `UserTimeZone.id()`), titre = libellé ou « Alarme ». Message `role="status"` « Alarme réglée pour demain à 07:00 ».
- « Historique » (bouton, panneau) : sessions terminées groupées par jour local (`toLocalDate` dans le fuseau utilisateur), par jour le total ; ligne : icône du type, libellé, heure de début, durée (`endedAt − startedAt`), « Arrêté » si `stopped` ; suppression avec confirmation en ligne ; « Voir plus ».
- Un minuteur qui atteint 0 affiche « Terminé » (`role="status"`) jusqu'à la relecture ; les sessions terminées depuis moins de 10 minutes forment un bloc de tête « Terminées à l'instant » dans l'historique, toutes dates de début confondues (elles n'apparaissent plus dans leur groupe de jour).
- **Alarme dans un trou ou un pli** (`alarm-time.ts`). Le message de confirmation est construit à partir du `nextFireAt` renvoyé par la commande (le Rust fait foi) ; si le rappel n'est pas `scheduled` ou si `nextFireAt` est nul, l'alarme est reprogrammée une fois pour le lendemain, puis une erreur est affichée si cela échoue encore. Une alarme **ponctuelle** dont l'heure tombe dans un trou est enregistrée à l'**heure décalée** (02:30 devient `03:30`), de sorte que `startLocal` désigne un instant qui existe ; une heure choisie après le saut mais dans la même heure décalée (02:30 demandé à 03:15) donne « aujourd'hui à 03:30 ». Un rappel **récurrent** (W3) garde au contraire l'heure **nominale** (02:30) : chaque occurrence est résolue par le Rust (`compatible`, ADR-003 §3.3), ce qui évite de figer une heure décalée valable un seul jour. Dans un pli, la première occurrence sonne.

**`pomodoro`** (lot W2) — titre « Pomodoro », icône `pi pi-clock`, tailles min 3×3, défaut 3×4, max 6×6, config v1 `{ workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 }` (bornes 1..180, 1..60, 1..60, 2..8 ; panneau « Réglages » au fil de l'eau, champs texte `inputmode="numeric"` validés par le schéma). `maxInstances: 1` (un seul pomodoro en cours, M10 : un second widget ne ferait que le dupliquer).
- Phase en cours, temps restant en 32 px, pastilles du cycle (●●○○, texte `sr-only` « 2 sur 4 »), « Arrêter ». Sans phase en cours : phase suggérée et bouton primaire « Démarrer : <phase> » ; les deux autres phases en boutons secondaires. Libellé optionnel (« Sur quoi travaillez-vous ? »). Ligne « Aujourd'hui : N pomodoros ».
- `pomodoro-cycle.ts` (pur) : `suggestNextPhase(sessions, today, timeZone, every)` : la **dernière** session pomodoro terminée, **quel que soit son jour** (amendement : un travail fini juste après minuit mérite sa pause) ; aucune, ou pause, ou travail `stopped` → `work` ; travail `completed` → nombre de travaux complétés **aujourd'hui** (fuseau utilisateur) depuis le début de la dernière pause longue d'aujourd'hui ; multiple non nul de `every` → `long_break`, sinon `short_break`. Seuls le compteur « Aujourd'hui » (`completedWorkCount(sessions, today, timeZone)`) et la position dans le cycle (pastilles, pause longue) sont filtrés par jour local. Ils reposent sur la première page d'historique du store (100 sessions) et peuvent être faux au-delà : accepté en v1.
- Zone `role="status"` : vidée au démarrage d'une phase, renseignée à chaque nouvel id de session complétée (rien au premier chargement). Boutons désactivés tant que le premier chargement n'est pas terminé. À la fin de la phase en cours, le focus (sur le corps ou dans le widget) passe au bouton « Démarrer ». Pastilles : `rounded-pill`, pleines `bg-accent-emphasis`, vides `border-fg-muted`.
- `AlreadyRunning` (`conflict`) → message « Un pomodoro est déjà en cours. » et relecture.

**`reminders`** (lot W3) — titre « Rappels », icône `pi pi-bell`, tailles min 3×3, défaut 4×5, max 8×8, config v1 `{}`.
- « Sonnés » (si non vide) : livraisons non vues : titre, « 09:00 » ou « manqué · lun. 16 nov., 09:00 », badge « +N » si `skippedCount > 0`, bouton « OK » (`markSeen one`) ; « Tout marquer comme vu ».
- « À venir » : rappels `scheduled` triés par `nextFireAt` : titre, étiquette relative de `nextFireAt` dans le fuseau utilisateur (« Aujourd'hui 09:00 », « Demain 09:00 », sinon `weekday-short` + heure jusqu'à 6 jours, au-delà `day-month` + heure), indicateur `pi pi-sync` + `sr-only` « Récurrent » ; si le fuseau du rappel diffère de celui de l'utilisateur, « (09:00 Paris) » d'après `nextFireKey` (ADR-003 C18) ; bouton [i] « Détails de <titre> ». « En pause » (désactivés, `text-fg-muted`), « Terminés » (repliée, M11), « Invalides » (bandeau `flash-attention`, suppression seule).
- Fiche (panneau) : Titre ; Date (`<input type="date">`) ; Heure (`<input type="time">`, `step="60"`, la seconde vaut toujours 00) ; Répétition : « Aucune », « Tous les jours », « Toutes les semaines » (cases L M M J V S D, au moins une, défaut = jour de la date), « Tous les mois, le <j> », « Tous les mois, le dernier jour » (proposé si la date est le dernier jour du mois), « Tous les mois, le <n>e <jour> » (n de 1 à 4, ou « dernier » si la date tombe dans les 7 derniers jours), « Tous les ans » ; Intervalle (1..max de la fréquence, ADR-003 §3.5.1) ; Fin : « Jamais », « Après <N> fois » (1..1000), « Jusqu'au <date> inclus » (`untilEndOfLocalDay`) ; « Activé » (`switch`). Fuseau : affiché en texte (« Heure de Europe/Paris ») ; nouveau rappel = `UserTimeZone.id()` ; modification = fuseau du rappel, inchangé.
- Avertissements sous les champs : `classifyLocal` `gap` / `fold` (clés `time.nonexistent` / `time.ambiguous`) ; jour > 28 en mensuel (« Les mois sans ce jour seront sautés. ») ; erreurs de règle traduites (`parseRecurrenceRule`). Refus : rappel ponctuel dans le passé (« Cette date est passée. ») ; date au-delà de 10 ans (« Au plus 10 ans à l'avance. »).
- Aperçu « Prochaines occurrences » : 3 premières par `RECURRENCE_ENGINE.expand` sur `[maintenant, maintenant + 400 j)`, `limit: 3`, affichées dans le fuseau utilisateur.
- Actions : « Enregistrer » (primaire, M12 ; `RECURRENCE_ENGINE.validate` puis `create` / `update` avec la forme canonique), « Annuler », « Ignorer la prochaine occurrence » (si `nextFireKey`), « Supprimer » (confirmation en ligne). Échap = « Annuler » ; focus rendu au [i].
- `reminder-form.ts` (pur, testé) : `formToInput(state, timeZone): { input: ReminderInput } | { error: string }`, `inputToForm(reminder): FormState` (une règle hors des choix du formulaire est affichée « Règle personnalisée » en lecture seule, conservée telle quelle), `nthWeekdayOf(date)`, `isLastDayOfMonth` (déjà dans `core/time/date-rule.ts`).
- `reminder-label.ts` (pur) : étiquette relative et suffixe de fuseau.

**Clés i18n principales** (FR) : `widgets.timers.title` « Minuteurs », `.description` « Minuteurs, chronos, alarmes et historique », `.running` « En cours », `.start` « Démarrer le minuteur », `.startStopwatch` « Démarrer un chrono », `.stop` « Arrêter », `.since` « En cours depuis {{ duration }} », `.endsAt` « Fin à {{ time }} », `.finished` « Terminé », `.label` « Libellé », `.minutes` « Minutes », `.seconds` « Secondes », `.alarm` « Alarme », `.alarmSet` « Alarme réglée pour {{ when }} », `.history` « Historique », `.stopped` « Arrêté », `.total` « Total : {{ duration }} », `.more` « Voir plus », `.empty` « Aucun minuteur en cours. » ; `widgets.pomodoro.title` « Pomodoro », `.work` « Travail », `.shortBreak` « Pause courte », `.longBreak` « Pause longue », `.startPhase` « Démarrer : {{ phase }} », `.today` « Aujourd'hui : {{ count }} pomodoros », `.alreadyRunning` « Un pomodoro est déjà en cours. », `.settings` « Réglages », `.cycle` « {{ done }} sur {{ every }} » ; `widgets.reminders.title` « Rappels », `.description` « Rappels datés et récurrents, avec notification », `.rung` « Sonnés », `.missed` « manqué », `.ok` « OK », `.markAllSeen` « Tout marquer comme vu », `.upcoming` « À venir », `.paused` « En pause », `.finishedSection` « Terminés », `.invalid` « Rappel illisible : supprimez-le et recréez-le. », `.new` « Nouveau rappel », `.save` « Enregistrer », `.cancel` « Annuler », `.skipNext` « Ignorer la prochaine occurrence », `.delete` « Supprimer », `.repeat.*` (libellés de répétition ci-dessus), `.end.*`, `.zone` « Heure de {{ zone }} », `.past` « Cette date est passée. », `.tooFar` « Au plus 10 ans à l'avance. », `.monthDaySkipped` « Les mois sans ce jour seront sautés. », `.preview` « Prochaines occurrences », `.empty` « Aucun rappel. » ; `duration.short` « {{ h }} h {{ m }} min » (et variantes) ; `settings.system.*` (§4.6) ; `common.desktopOnly` « Disponible uniquement dans l'application Windows. » (si absente).

### 4.9 Point d'accroche des habitudes (pour la spec Habit tracker)

Le planificateur ne connaît que `reminders`. Un « rappel de mise à jour périodique » d'une habitude (ex. « Mettre à jour le solde des comptes », chaque lundi à 19 h) **est une ligne de `reminders`** possédée par l'habitude :
- migration future (V8 ou suivante) : `ALTER TABLE reminders ADD COLUMN habit_id TEXT NULL REFERENCES habits (id) ON DELETE CASCADE;` (défaut `NULL` obligatoire, V18) + `CREATE INDEX reminders_habit_id_idx ON reminders (habit_id) WHERE habit_id IS NOT NULL;` ; supprimer l'habitude supprime ses rappels ;
- commandes : champ optionnel `habitId` dans `ReminderCreateDto` (existence contrôlée dans la transaction), `ReminderDto.habitId` ; `reminder_list` gagne un filtre `owner: 'standalone' | 'habit:<id>' | 'all'` ;
- widget Rappels : n'affiche que `standalone` ; le widget Habitudes édite les siens avec le même formulaire (composant de `core/` si partagé, jamais importé d'un widget à l'autre) ;
- `tick`, `notice`, `group` : **aucun changement** ; le titre du toast est celui du rappel. Un éventuel lien « jour coché » ↔ rappel (ne pas sonner si l'habitude est déjà faite) relève de la spec Habitudes : prévoir alors un filtre dans `plan_due` derrière un trait, pas de SQL d'habitudes dans `tick`.
Une habitude « tous les lundis » **sans heure** reste une ancre datée qui ne sonne jamais (ADR-003 §3.5.5). Un futur rappel de tâche (TODO avec heure) suivra le même modèle (`todo_id`).

### 4.10 Sécurité

- Surface ajoutée côté JS : 12 commandes d'app, rien d'autre (ni `core:*`, ni `notification:*`, ni `autostart:*`). Les commandes n'accèdent qu'aux trois tables, aucun chemin ni URL ne vient du front.
- Bornes avant tout travail : identifiants UUID, titre ≤ 200 et libellé ≤ 100 points de code sans caractère de contrôle, `rrule` ≤ 256, `exdates` ≤ 366 × 19 caractères (contrôles du module `time`), durée 1 s..24 h, `limit` ≤ 200, 1 000 rappels, 20 sessions en cours ; expansion bornée (400 jours, 1 000 occurrences, 100 000 itérations, horizon 10 ans).
- Lignes écrites hors du Rust (le front garde `sql:allow-execute` jusqu'à O3 ; une XSS pourrait écrire ces tables) : chaque ligne est revalidée à la lecture ; une ligne invalide est ignorée et signalée, jamais de panique ; au plus 4 toasts par passage ; une occurrence ne sonne qu'une fois (clé). Résiduel accepté (ADR-002 R1).
- Toasts : XML construit par DOM (V14), pas d'injection ; texte brut tronqué.
- Démarrage automatique : argument fixe `--minimized`, aucune saisie.
- Journaux : identifiants seulement, jamais les titres ni les valeurs liées.
- Aucun secret. Aucun réseau.

---

## 5. Cas limites

| # | Cas | Résultat attendu |
|---|---|---|
| L1 | Rappel ponctuel 09:00 Paris, `now` 08:59:59.999 puis 09:00:00.000 | Rien, puis 1 toast `on_time`, livraison, cache `NULL`, statut `finished` |
| L2 | Deux passages au même `now` | 1 seul toast (clé) |
| L3 | Horloge reculée d'1 h après le toast de 09:00 | Aucun second toast (cache déjà avancé ; et clé si recalcul) (ADR-003 C26) |
| L4 | Horloge avancée d'1 jour par erreur | Rappels du jour traités `late` ; au retour de l'horloge, aucun doublon ; un minuteur paraît fini plus tôt (instants) : accepté |
| L5 | PC éteint du 10/11 au 16/11 12:00Z, quotidien 09:00 Paris | 1 livraison `2026-11-16T09:00:00`, `late`, `skipped_count` 6, 1 toast « Rappel manqué », cache 17/11 08:00Z |
| L6 | Rappel ponctuel échu il y a 10 jours | Livraison `missed`, aucun toast, visible dans « Sonnés » |
| L7 | 6 rappels échus dans un passage | 3 toasts + 1 résumé « 3 autres rappels… » |
| L8 | Quotidien 02:30 Paris à travers le pli du 2026-10-25 | 1 seul toast à `00:30:00.000Z` ; suivant `2026-10-26T01:30:00.000Z` (ADR-003 C2) |
| L9 | Quotidien 02:30 Paris dans le trou du 2027-03-28 | Toast à `01:30:00.000Z` (03:30 CEST), clé `2027-03-28T02:30:00` (C3) |
| L10 | Quotidien 09:00 à travers le pli | 07:00Z puis 08:00Z (C5) |
| L11 | Veille du PC à travers l'échéance, réveil 3 min après | ≤ 30 s après le réveil (S1) : toast `on_time` (≤ 5 min) |
| L12 | Veille de 2 h | Toast « Rappel manqué » au réveil (≤ 30 s) |
| L13 | Fuseau Windows ou réglage `time.zone` changé | Aucun effet sur le Rust (D1 de l'ADR-003) ; affichage recalculé ; nouveaux rappels dans le nouveau fuseau |
| L14 | Exception (`exdates`) sur la prochaine occurrence | Sautée ; cache sur la suivante |
| L15 | Rappel désactivé puis réactivé après 3 occurrences | Aucune livraison pour la période désactivée |
| L16 | `COUNT` épuisé, `UNTIL` dépassé | Cache `NULL`, statut `finished` |
| L17 | Ligne modifiée hors du Rust avec `rrule` invalide | Ignorée, cache `NULL`, `status: invalid`, les autres rappels sonnent |
| L18 | Prochaine occurrence au-delà de 10 ans | `finished` (horizon de `next_after`) ; la fiche refuse une telle date |
| L18b | Rappel ponctuel en retard de plus de 399 jours | Aucune livraison enregistrée (`expand` vide, D6 étape 2), cache vidé, statut `finished` |
| L19 | Minuteur de 25 min lancé à `2026-10-25T00:50:00.000Z` | `ends_at` `01:15:00.000Z`, affiché 02:15 (C25) ; toast à l'échéance |
| L20 | Application quittée pendant un minuteur, relancée 2 h après la fin | `ended_at = ends_at`, `completed`, toast « … pendant l'absence · il y a 2 h » |
| L21 | Chrono en cours, application quittée 3 jours | Toujours en cours au redémarrage, « En cours depuis 3 j … » |
| L22 | « Arrêter » un minuteur dans la seconde de son échéance (avant le passage) | Complété (`ended_at = ends_at`), sans toast ; si le passage a gagné : renvoyé tel quel |
| L23 | Horloge reculée puis « Arrêter » un chrono | `ended_at = started_at` (durée 0), aucune erreur d'écriture |
| L24 | Deuxième pomodoro / 21e session | `AlreadyRunning` / `LimitReached`, rien n'est écrit |
| L25 | Double clic « Démarrer » (même id renvoyé) | Second appel `Conflict` ; l'interface désactive le bouton pendant l'appel |
| L26 | Suppression d'un rappel | Livraisons supprimées en cascade ; aucun toast ensuite |
| L27 | Suppression d'un widget Rappels ou Minuteurs | Données conservées (M9) |
| L28 | Deux lancements (autostart + manuel) | Instance unique : un seul planificateur |
| L29 | Restauration d'une sauvegarde plus ancienne | Au redémarrage, rattrapage des occurrences postérieures à la sauvegarde, dans la fenêtre de 7 jours (doublon possible avec une occurrence déjà notifiée avant la restauration : accepté) |
| L30 | Import de configuration | Sans effet sur ces tables (non rattachées aux widgets) |
| L31 | `npm run web:start` (hors Tauri) | Dépôts → `DataError('unavailable')`, widgets en bandeau, aucune exception non gérée |
| L32 | Mode « Ne pas déranger » / Assistant de concentration | Toast retenu dans le centre de notifications (comportement Windows) ; la livraison est quand même enregistrée |
| L33 | Fenêtre masquée pendant un décompte | Aucun calcul côté front ; au retour, décompte juste immédiatement |
| L34 | Hors-ligne, synchronisation | Sans objet (tout est local) |
| L35 | Base occupée (`busy`) pendant un passage | Erreur journalisée, nouvel essai dans 5 s, aucune livraison partielle (transaction) |
| L36 | Changement de fuseau (ou d'heure de départ) d'un rappel vers la même heure murale, alors que l'occurrence de cette heure murale a déjà été livrée le jour même | La clé d'occurrence (heure murale) est identique : la nouvelle occurrence est absorbée sans toast. Cas limite accepté en v1 (D12) |

---

## 6. Tests

### 6.1 Rust (`npm run rust:test`), base temporaire migrée par `backup::test_support::make_database(path, 7, false)`, `FixedClock`, `RecordingNotifier`
- `store_tests.rs` : aller-retour de chaque table ; `CHECK` (V7) : `enabled = 0` avec cache refusé, cache sans clé refusé, `kind = 'stopwatch'` avec `ends_at` refusé, `completed` avec `ended_at ≠ ends_at` refusé, `exdates` `'x'` refusé ; cascade de suppression ; `ON CONFLICT DO NOTHING` renvoie 0 ligne au second insert.
- `plan_tests.rs` (pur) : `outcome_for` aux bornes (5 min exactement → `OnTime`, +1 ms → `Late` ; 7 j exactement → `Late`, +1 ms → `Missed`) ; `plan_due` pour L5, L8, L9, L14, L16, comptage borné à 399 jours ; `render` : chaque ligne du §4.5 (texte exact, singulier/pluriel, son) ; `format_duration_fr` ; `group` : 4 → 4, 5 → 3 + résumé, ordre (à l'heure d'abord).
- `tick_tests.rs` : L1 à L3, L5 à L10, L14 à L17, L20, L35 (verrou tenu par une autre connexion `BEGIN IMMEDIATE`, `busy_timeout` court) ; phase `Startup` recalcule un cache faux écrit à la main ; `next_due` = minimum des deux tables ; aucune exception sur une base sans ligne.
- `worker_tests.rs` : `wake()` déclenche un passage en moins d'1 s alors que `max_sleep` vaut 1 h ; `stop()` termine la boucle et `shutdown_within` revient dans la borne ; une erreur de passage mène à `ERROR_RETRY` (durées courtes injectées).
- `commands_tests.rs` (fonctions métier) : chaque ligne du tableau du §4.4 ; DTO camelCase (`serde_json`), champ inconnu refusé ; sérialisation exacte `{"kind":"invalid_input","field":"title"}`, `{"kind":"time","error":{"kind":"invalid_rule","code":"count_and_until","part":null}}`, `{"kind":"already_running"}` ; règle et exceptions stockées sous forme canonique ; `reminder_update` d'une heure crée une nouvelle clé (D12) ; titre de 201 points de code, `"a\u{0}b"`, libellé avec `\n` refusés.
- `lib.rs` / `capability_tests.rs` / `build.rs` : 12 commandes dans les deux `invoke_handler`, dans `build.rs`, et liste exacte des permissions ; `schedule::start(` après `on_app_ready(` ; `schedule::shutdown(` avant `backup::startup::on_exit(` ; (R4) `launched_minimized`.
- `backup/sqlite.rs`, `backup/validate_tests.rs` : version 7 (V9).

### 6.2 `test:data` (Vitest, Node)
- `data/migrations.spec.ts` : tables attendues ; bloc V7 (insertion valide de chaque table, refus des `CHECK` du §6.1, cascade) ; base V6 avec données migrée en V7 sans perte.
- `data/tauri/*.spec.ts` (`vi.mock('@tauri-apps/api/core')`) : noms de commandes et arguments exacts, traduction de chaque `kind` d'erreur (§4.7), `unavailable` hors Tauri, id généré si absent.
- `data/schedule-sql-guard.spec.ts` : aucun fichier `src/app/**/*.ts` (hors `*.spec.ts`) ne contient, sans tenir compte de la casse, `from reminders`, `into reminders`, `update reminders`, `reminder_deliveries`, `time_sessions` (D2).

### 6.3 Vitest, runner Angular
- `core/time/now-signal.spec.ts` (`ManualClock`, faux minuteurs) : alignement, suspension masquée, reprise au `visibilitychange`.
- `core/time/duration-format.spec.ts` : `0:00`, `0:05`, `59:59`, `1:00:00`, arrondi `ceil` (4 001 ms → `0:05`), négatif → `0:00`.
- `core/reminders/reminder.store.spec.ts`, `core/timers/time-session.store.spec.ts` (fakes) : relecture à l'échéance + 1 s, au `focus`, après chaque action ; `skipNext` ; erreurs de lecture exposées dans `error`, action en échec rejetée sans modifier `error`, relecture en échec après une action en échec exposée dans `error`.
- `widgets/pomodoro/pomodoro-cycle.spec.ts` : aucune session → travail ; travail complété n° 1, 2, 3 → pause courte ; n° 4 → pause longue ; travail arrêté → travail ; sessions d'hier ignorées ; à cheval sur minuit dans le fuseau utilisateur.
- `widgets/reminders/reminder-form.spec.ts` : chaque choix de répétition → règle canonique attendue (ex. hebdo L+M → `FREQ=WEEKLY;BYDAY=MO,WE`, dernier jour → `FREQ=MONTHLY;BYMONTHDAY=-1`, 2e mardi → `FREQ=MONTHLY;BYDAY=2TU`, « jusqu'au 31/12/2026 » à 23:30 Paris → `UNTIL=20261231T225959Z`) ; aller-retour `inputToForm(formToInput(x))` ; règle personnalisée conservée ; date passée et > 10 ans refusées ; `gap` / `fold` signalés.
- `widgets/reminders/reminder-label.spec.ts` : aujourd'hui, demain, autre jour, fuseau différent (« 03:00 (09:00 Paris) »).
- Composants (`timers`, `pomodoro`, `reminders`) avec fakes : rendu des sections, démarrage/arrêt, décompte affiché, panneaux (Échap, focus rendu), états vides, hors Tauri, i18n (aucun texte en dur).
- `features/settings/settings.page.spec.ts` : nouveaux libellés de la section Système.

---

## 7. Lots

Ordre : R1 → R2 → R3 → F1 → (W1, W2, W3 dans cet ordre ou en parallèle sur fichiers disjoints) ; R4 après R2. Chaque lot : `npm run format:check`, `npm run lint`, `npm run test`, `npm run rust:fmt:check`, `npm run rust:lint`, `npm run rust:test` verts ; revue `reviewer` (dates et planificateur : DELEGATION). Un lot bloqué s'arrête et rapporte.

### Lot R1 : migration V7, stockage et planification pure (aucun thread, aucune commande)
Fichiers : créer `migrations/V7__timers_reminders.sql`, `src/schedule/{mod,error,text,store,reminder,session,notice,notifier}.rs`, `src/schedule/tests/{store_tests,plan_tests}.rs` ; modifier `src/db.rs`, `migrations/checksums.json`, `src/lib.rs` (`mod schedule;` seulement), `src/time/commands.rs` (`to_spec` `pub(crate)`), `src/backup/sqlite.rs`, `src/backup/validate_tests.rs`, `apps/web/src/app/data/migrations.spec.ts`. `next_after` garde son attribut tant qu'il n'est appelé qu'en test ; `#[cfg_attr(not(test), expect(dead_code))]` au niveau module autorisé dans ce lot seulement, retiré en R2.
- **CA-R1-1** Texte de V7 identique au §4.1 ; `test:data` et `rust:test` verts, dont le test de migration V6 → V7 et `expected_schema(7)`.
- **CA-R1-2** `rg -n "reminders|time_sessions|reminder_deliveries" apps/desktop/src-tauri/src --glob '!**/tests/**'` : SQL seulement dans `schedule/store.rs`.
- **CA-R1-3** `plan_tests.rs` couvre tout le §4.5 et les bornes de D6.
- **CA-R1-4** Aucun `Timestamp::now`, aucun `unwrap()` hors tests, aucune valeur concaténée dans du SQL.

### Lot R2 : passage, boucle, notifications, câblage
Fichiers : créer `src/schedule/{tick,worker}.rs`, `src/schedule/tests/{tick_tests,worker_tests}.rs` ; modifier `src/schedule/mod.rs` (`start`, `shutdown`), `src/lib.rs` (`.setup` : `schedule::start(app.handle())?` après `tray::setup` ; `RunEvent::Exit` : `schedule::shutdown(app)` avant `backup::startup::on_exit(app)` ; tests de position), `src/backup/lock.rs` (`ACQUIRE_TOTAL` `pub(crate)`), `src/time/recurrence/mod.rs` (attribut de `next_after` retiré).
- **CA-R2-1** `tick_tests.rs` et `worker_tests.rs` verts (L1 à L3, L5 à L10, L14 à L17, L20, L35).
- **CA-R2-2** `const _: () = assert!(EXIT_JOIN_MAX.as_millis() < ACQUIRE_TOTAL.as_millis());` présent.
- **CA-R2-3** Ajouter temporairement `let _ = jiff::Timestamp::now();` dans `schedule/tick.rs` fait échouer `rust:lint` ; annuler.
- **CA-R2-4** (manuel, `npm run dev`) une ligne de rappel insérée à la main dans la base de dev (sqlite3) pour dans 2 minutes, avec `enabled = 1` et un cache de prochaine occurrence `NULL`, puis l'application relancée (le démarrage calcule le cache), sonne à l'heure, fenêtre fermée (toast attribué à PowerShell en dev, V11). À défaut, cette vérification est reportée à CA-R3-4 (rappel créé par commande).

### Lot R3 : commandes Tauri
Fichiers : créer `src/schedule/commands.rs`, `src/schedule/tests/commands_tests.rs` ; modifier `build.rs`, `src/lib.rs` (deux `invoke_handler` + tests), `capabilities/default.json` (12 permissions + phrase de description), `src/capability_tests.rs`.
- **CA-R3-1** Chaque ligne du tableau §4.4 testée ; sérialisations exactes du §6.1.
- **CA-R3-2** `capabilities/default.json` ne gagne que les 12 `allow-…` ; aucun `core:`, `notification:`, `autostart:` ; toujours deux fichiers de capability.
- **CA-R3-3** Toute commande qui modifie une échéance appelle `wake()` après commit (test : compteur de réveils).
- **CA-R3-4** (manuel) Depuis la console de dev : `invoke('reminder_create', …)` pour dans 1 minute → toast ; `invoke('reminder_create', { input: { …, title: 'x'.repeat(201) } })` → `{ kind: 'invalid_input', field: 'title' }`.

### Lot R4 : démarrage réduit, autostart, Réglages
Fichiers : modifier `tauri.conf.json` (`"visible": false`), `src/lib.rs` (`launched_minimized`, `refresh_autostart`, affichage en fin de `.setup`, autostart avec `--minimized`), `features/settings/settings.page.ts` (+ spec), `core/i18n/fr.json`.
- **CA-R4-1** Tests de `launched_minimized` ; tests de `lib.rs` à jour ; `db.rs` `dev_conf_only_overrides_identifier_and_product_name` vert.
- **CA-R4-2** Manuels MV8, MV9.

### Lot F1 : front, couche de données et services
Fichiers : modifier `data/models.ts`, `data/repositories.ts`, `data/data.providers.ts`, `data/index.ts`, `eslint.config.js` (`@tauri-apps/api/*` dans `data/` limité à `data/tauri/**`) ; créer `data/tauri/{invoke-command,tauri-reminder.repository,tauri-time-session.repository}.ts` (+ specs), `data/schedule-sql-guard.spec.ts`, `core/time/{now-signal,duration-format}.ts` (+ specs, exports dans `core/time/index.ts`), `core/reminders/{reminder.store,index}.ts`, `core/timers/{time-session.store,index}.ts` (+ specs), `core/testing/{fake-reminder.repository,fake-time-session.repository}.ts`.
- **CA-F1-1** Tests du §6.2 et des services du §6.3 verts ; le garde-fou SQL échoue si l'on ajoute temporairement `'SELECT * FROM reminders'` dans un fichier de `core/` (annuler).
- **CA-F1-2** `npm run web:build` réussit **sans changer le budget** ; sinon s'arrêter et rapporter la taille.
- **CA-F1-3** Aucun `any`, aucun `Date` hors `core/time` et `data/clock.ts` (règles ADR-003).

### Lot W1 : widget Minuteurs (+ alarme)
Fichiers : `widgets/timers/{timers.definition,timers.config,timers.component(.ts|.html),timer-history.component(.ts|.html),stopwatch-detail.component(.ts|.html),alarm-time.ts}` + specs ; `widgets/widgets.providers.ts` ; `core/i18n/fr.json`.
- **CA-W1-1** Tests composants et `alarm-time.spec.ts` (aujourd'hui / demain, pli, trou) verts.
- **CA-W1-2** Manuels MV3, MV4, MV5.

### Lot W2 : widget Pomodoro
Fichiers : `widgets/pomodoro/{pomodoro.definition,pomodoro.config,pomodoro.component(.ts|.html),pomodoro-settings.component(.ts|.html),pomodoro-cycle.ts}` + specs ; `widgets/widgets.providers.ts` ; `core/i18n/fr.json`.
- **CA-W2-1** `pomodoro-cycle.spec.ts` (§6.3) et migrations de config (aucune en v1) verts.
- **CA-W2-2** Manuel MV7.

### Lot W3 : widget Rappels
Fichiers : `widgets/reminders/{reminders.definition,reminders.config,reminders.component(.ts|.html),reminder-detail.component(.ts|.html),reminder-form.ts,reminder-label.ts}` + specs ; `widgets/widgets.providers.ts` ; `core/i18n/fr.json`.
- **CA-W3-1** `reminder-form.spec.ts` et `reminder-label.spec.ts` verts (§6.3).
- **CA-W3-2** Manuels MV1, MV2, MV10 à MV13 ; **critère de sortie de phase** MV1.

---

## 8. Critères d'acceptation d'ensemble

- **CA-1** Les six commandes de vérification sont vertes (CLAUDE.md) ; `web:build` sans changement de budget.
- **CA-2** V7 n'est modifiée par aucun lot après la revue de R1 ; aucune migration existante modifiée.
- **CA-3** Aucune permission JS hors des 12 `allow-…` ; aucun SQL front sur les trois tables (garde-fou).
- **CA-4** Aucun secret ; textes d'interface via Transloco ; textes natifs dans `schedule/notice.rs` seulement.
- **CA-5** ROADMAP cochée (lots du §10.4) ; vérifications manuelles listées pour Marius.

## 9. Vérifications manuelles (Marius)

Sur l'**exe release installé** (identité des toasts, V11), sauf mention.
- **MV1 (sortie de phase)** Démarrage automatique activé, session Windows rouverte : Homebase démarre **sans fenêtre**, icône dans la zone de notification. Créer un rappel pour dans 3 minutes, fermer la fenêtre : à la minute près, toast « <titre> / Prévu à HH:MM » **avec son**, attribué à Homebase.
- **MV2** Rappel quotidien : toast le lendemain ; « Sonnés » le liste ; « OK » le retire.
- **MV3** Minuteur de 1 min, fenêtre masquée : toast « Minuteur terminé » avec son « Alarm » ; décompte juste au retour de la fenêtre.
- **MV4** Chrono démarré, « Quitter » depuis la zone de notification, relancer 5 min après : « En cours depuis 5 min » ; historique après « Arrêter ».
- **MV5** Alarme 07:00 depuis le widget Minuteurs : rappel ponctuel créé pour demain 07:00 dans le widget Rappels.
- **MV6** Veille du PC : rappel à 2 minutes, mettre en veille 10 minutes : au réveil, en 30 s au plus, toast « Rappel manqué : … » (S1).
- **MV7** Pomodoro 1 min (réglages) : fin → toast, le widget propose « Pause courte » ; la 4e séance propose « Pause longue ».
- **MV8** Lancement manuel : fenêtre visible, sans écran blanc durable ; second lancement : la fenêtre existante revient (S3).
- **MV9** `regedit` `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` : la valeur Homebase finit par `--minimized` après un lancement (entrée réécrite, S4).
- **MV10** « Quitter », attendre une occurrence d'un rappel, relancer : toast « Rappel manqué » ; 5 rappels manqués : 3 toasts + 1 résumé.
- **MV11** Changer l'heure de Windows d'1 h en arrière après un toast : aucun second toast.
- **MV12** Mode « Ne pas déranger » : toast silencieux dans le centre de notifications, livraison visible dans le widget.
- **MV13** Thèmes clair et sombre, tableau teinté : widgets lisibles (DESIGN.md §6).

---

## 10. Amendements appliqués (2026-11-16)

### 10.1 ADR-001 (`docs/adr/001-widget-contract.md`)
- §3.8, ligne `notifications` : « Pas de `NotificationService` côté front ni de permission `notification:*` : les notifications sont émises par le planificateur Rust (spec timers-reminders D9). La permission `notifications` d'un widget (`timers`, `pomodoro`, `reminders`) reste de la documentation. »
- §3.2 `loadCalendarSource` : préciser que la source des rappels sera ajoutée par la tâche « Calendrier agrégé », sur `ReminderRepository` + `RECURRENCE_ENGINE.expand`.

### 10.2 ADR-002 (`docs/adr/002-data-layer.md`)
- **O2** : « Traité (spec timers-reminders D3) : connexions sqlx dédiées par opération, sérialisées par un verrou unique du module `schedule`. »
- **O3** (avancement partiel) : « Les tables `reminders`, `reminder_deliveries`, `time_sessions` (V7) ne sont accessibles que par des commandes Rust typées ; leurs dépôts TS sont dans `data/tauri/` (garde-fou par test). »
- §3.3 : exceptions justifiées : clé naturelle `(reminder_id, occurrence_key)` de `reminder_deliveries` ; `created_at`/`updated_at` de ces tables fournis par l'horloge Rust (`time::clock::Clock`, même format).
- §3.5 : *Amendement (spec timers-reminders)* : dépôts adossés à des commandes Rust (`ReminderRepository`, `TimeSessionRepository`), erreurs Rust traduites en `DataError` (§4.7).
- R11 : clos (instance unique en place, planificateur unique).

### 10.3 ADR-003 (`docs/adr/003-time-model.md`)
- §3.10 « Spec planificateur » : « Traité par `docs/specs/timers-reminders.md` (thread borné à 30 s, rattrapage D6, table `reminder_deliveries`, cache `next_fire_at`, connexions sqlx, timers D7, édition D12). »
- §3.1.2 / §3.1.3 : *Amendement (spec timers-reminders)* : `reminders` n'admet qu'une ancre horodatée (colonnes `NOT NULL`, sans `start_on` ni contrainte d'ancre exclusive) : une ancre datée ne sonne jamais (§3.5.5).
- §3.5.5 : « `next_after` est utilisée par le planificateur ; le rattrapage compte les occurrences manquées par `expand` sur au plus 399 jours. »

### 10.4 ROADMAP (`docs/ROADMAP.md`, phase 2)
Cocher « (O) Spec timers/pomodoro et planificateur de rappels » (`docs/specs/timers-reminders.md`, décisions M1 à M12) et remplacer les deux tâches suivantes par :
```
- [ ] (S) Lot R1 (spec timers-reminders) : migration V7, stockage et planification pure (texte de V7 figé à la revue ; pas de npm run dev avant)
- [ ] (S) Lot R2 : passage du planificateur, boucle, notifications, câblage
- [ ] (S) Lot R3 : commandes Tauri reminder_* et session_*
- [ ] (S) Lot R4 : démarrage réduit, autostart --minimized, Réglages
- [ ] (S) Lot F1 : dépôts data/tauri, services core (rappels, sessions, horloge d'affichage)
- [ ] (S) Lot W1 : widget Minuteurs (minuteurs, chronos, alarme, historique)
- [ ] (S) Lot W2 : widget Pomodoro
- [ ] (S) Lot W3 : widget Rappels (vérification de sortie MV1 à faire par Marius)
```
Habit tracker : ajouter « (O) mini-spec Habitudes (s'appuie sur §4.9 de timers-reminders) » avant la tâche Sonnet.

### 10.5 PLAN (`docs/PLAN.md`)
- §2, ligne « Timers » : « Échéances tenues par le planificateur Rust (`time_sessions`), affichage recalculé depuis `CLOCK` quand la fenêtre est visible ; pas de Web Worker (spec timers-reminders D7). »
- §2, ligne « Notifications » : ajouter « depuis le Rust uniquement, son explicite (un toast sans nom de son est muet) ».
- §5 Timers/pomodoro : « pas de pause ni d'enchaînement automatique en v1 (M3, M4) ».
- §9 : « Rattrapage : une notification par rappel (dernière occurrence manquée), fenêtre de 7 jours, au-delà visible dans le widget. »

### 10.6 DESIGN (`docs/DESIGN.md` §3)
- **Décompte** : grande valeur en 24 px (32 px pour le pomodoro), `tabular-nums`, `aria-live` absent sur la valeur qui défile ; changement d'état annoncé par une zone `role="status"`.
- **Formulaire de rappel** : exception au « au fil de l'eau » : « Enregistrer » / « Annuler » explicites (M12).

### 10.7 Spike (`docs/spikes/001-tray-notification-autostart.md`)
Ajouter : « Suite : planificateur réel dans `docs/specs/timers-reminders.md` ; un toast sans nom de son est muet (V13) ; démarrage automatique avec `--minimized`. »

---

## 11. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| R1. Toast muet ou non attribué à Homebase | Rappel non entendu | Son toujours explicite (V13) ; vérification sur l'exe installé (MV1) |
| R2. Horloge monotone arrêtée en veille plus longtemps que prévu | Rappel en retard après le réveil | Attente ≤ 30 s, relecture de `Clock::now()` (S1, MV6) ; repli : écouter `WM_POWERBROADCAST` (amendement) |
| R3. Application quittée par erreur | Aucun rappel | Rattrapage au lancement ; texte d'aide dans Réglages ; démarrage automatique |
| R4. Crash entre commit et toast | Toast perdu | Au plus une fois (choix assumé) ; livraison visible dans « Sonnés » |
| R5. Ligne écrite hors du Rust (XSS, édition manuelle) | Rappel muet ou toasts parasites | Revalidation à la lecture, `invalid`, plafond de toasts ; O3 complet avant tout contenu externe |
| R6. Crate `rrule` (ADR-003 R1) | Mauvaise occurrence | Vecteurs ADR-003 ; tests DST du planificateur (L8 à L10) |
| R7. Croissance de `reminder_deliveries` | Base qui grossit | ≈ 365 lignes/an/rappel quotidien ; purge à ajouter si besoin (une migration n'est pas nécessaire) |
| R8. Budget du bundle initial (ADR-003 V17) | Build en échec | `data/tauri` léger ; widgets paresseux ; arrêt et décision de Marius (CA-F1-2) |
| R9. Fenêtre invisible au lancement si `.setup()` échoue après `on_app_ready` | Application « fantôme » dans le tray | `show` en fin de `setup` ; une erreur de `setup` arrête l'application (comportement Tauri) ; tray « Ouvrir » |
| R10. Écart de tzdb entre WebView2 et `jiff` (ADR-003 R2) | Heure affichée ≠ heure du toast pendant un temps | Le widget affiche `nextFireAt` calculé par le Rust |

## 12. Points à vérifier

- **PV1** Actions et clic de notification sous Windows avec `tauri-plugin-notification` 2.7 : la doc générale les dit mobiles seulement, mais la doc de `show` mentionne un clic signalé sous Windows (V11, V12) ; le code `v2` lance un thread qui attend la réponse quand un écouteur existe. À tester dans un spike avant de rouvrir M5 (« Reporter », ouvrir Homebase au clic). Alternative : `tauri-winrt-notification` 0.8.1 en direct (`add_button`, `on_activated`, `Scenario::Reminder`), déjà dans l'arbre.
- **PV2** Sons `Reminder` et `Alarm` audibles et distincts (S2, MV1, MV3).
- **PV3** Comportement réel après veille (S1, MV6).
- **PV4** `visible: false` + `show()` (S3, MV8).
- **PV5** Réécriture de l'entrée `Run` par `enable()` (S4, MV9).
- **PV6** Rendu des toasts avec un titre contenant `<`, `&`, guillemets (V14 : déduit de l'usage de `SetInnerText`, sérialisation non montrée).
- **PV7** Besoin d'une permission pour `Channel` (`plugin:__TAURI_CHANNEL__|fetch`) si un push Rust → front devient nécessaire (D8).
- **PV8** `make_database(path, 7, …)` produit le même schéma que le vrai migrateur (le test `expected_schema(7)` le confirme).

Sources consultées le 2026-11-16 : https://v2.tauri.app/plugin/notification/ ; https://docs.rs/tauri-plugin-notification/2.7.0/tauri_plugin_notification/struct.NotificationBuilder.html ; https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/notification/src/desktop.rs ; https://docs.rs/crate/notify-rust/4.18.2/source/src/windows.rs ; https://docs.rs/crate/tauri-winrt-notification/0.8.1/source/src/lib.rs ; https://docs.rs/tauri-winrt-notification/latest/tauri_winrt_notification/struct.Toast.html ; https://docs.rs/tauri-plugin-autostart/2.7.0/tauri_plugin_autostart/fn.init.html ; https://docs.rs/tauri-plugin-autostart/2.7.0/tauri_plugin_autostart/struct.Builder.html ; https://v2.tauri.app/develop/calling-frontend/ ; https://v2.tauri.app/reference/acl/core-permissions/ ; https://docs.rs/crate/tauri/2.8.4/source/src/ipc/channel.rs ; https://www.sqlite.org/lang_altertable.html
