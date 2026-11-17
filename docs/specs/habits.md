# Spec : Habitudes (habit tracker) et rappels de mise à jour périodique

- **Statut** : acceptée (2026-11-17) ; décisions H1 à H10 validées par Marius le 2026-11-17, telles que recommandées
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§6), sur la branche `phase-2-habits`
- **Liens** : `CLAUDE.md` ; `docs/PLAN.md` §5 (Habits) ; `docs/DESIGN.md` §3 ; ADR-001 ; ADR-002 (§3.3, O3) ; ADR-003 (§1, §2.2, §3.1, §3.3, §3.5.3, §3.5.5) ; `docs/specs/timers-reminders.md` (§4.9 point d'accroche, D2, D3, D6, D8, D12, §4.4, §4.7, §4.8)

Cette mini-spec vaut compte rendu de décision. Elle ne modifie aucun autre document : les amendements sont **proposés** au §8. Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`.

---

## 0. Décisions validées par Marius (2026-11-17)

Chaque ligne donne la **recommandation** de l'architecte ; la spec est écrite pour elle. Une réponse différente modifie les lots cités.

- **H1** Fréquence cible : deux formes seulement, **« certains jours de la semaine »** (dont « tous les jours ») et **« N fois par semaine »** (semaine ISO, du lundi au dimanche, N de 1 à 7). Pas de mensuel ni de RRULE quelconque en v1. *Recommandation : oui.* (H1, H4)
- **H2** Valeur du jour : une **coche** (fait / pas fait), pas de quantité (« 8 verres ») en v1. On peut cocher un jour **passé** (oubli) à partir de la date de début, jamais un jour futur. Cocher un jour non prévu est permis : c'est un bonus, sans effet sur la série. *Recommandation : oui.* (H1, H4)
- **H3** Un rappel d'habitude **ne sonne pas** si le jour est déjà coché, sans modifier le planificateur (exceptions dérivées, D3). Une habitude « N fois par semaine » dont l'objectif est atteint continue de sonner les jours non cochés (v1). *Recommandation : oui (alternatives au D3).* (H1, H2)
- **H4** **Un rappel au plus** par habitude : une heure (HH:MM) et des jours de la semaine (par défaut ceux de l'habitude, ou tous pour « N fois par semaine »). Notification = titre de l'habitude, « Prévu à 20:00 » (textes existants). Pas de « Reporter ». *Recommandation : oui.* (H2, H4)
- **H5** Habitudes **globales**, comme les rappels (M9) : supprimer un widget Habitudes ne les supprime pas ; deux widgets affichent les mêmes. *Recommandation : oui.* (H1)
- **H6** Les rappels d'habitude **n'apparaissent pas** dans le widget Rappels (ni « À venir » ni « Sonnés ») : ils se règlent dans le widget Habitudes. *Recommandation : oui.* (H1, H2)
- **H7** Archiver = masquer l'habitude en gardant son historique ; son rappel est **désactivé** et le reste après restauration (à réactiver dans la fiche). Supprimer = définitif (coches et rappel compris), avec confirmation en ligne. *Recommandation : oui.* (H2, H4)
- **H8** Série et réussite (§4.6) : aujourd'hui non coché **ne casse pas** la série ; la semaine de création d'une habitude « N fois par semaine » exige `min(N, jours restants)` ; réussite affichée sur **30 jours** (jours prévus) ou **4 semaines**. *Recommandation : oui.* (H3)
- **H9** Habitudes et coches sont dans la **sauvegarde** seulement, **pas** dans l'export JSON de configuration (comme les tâches et les rappels, L30). *Recommandation : oui.* (H1)
- **H10** La fiche d'habitude a un bouton **« Enregistrer »** explicite (elle peut créer un rappel, M12) ; une coche s'enregistre **immédiatement**. *Recommandation : oui.* (H4)

---

## 1. Contexte et périmètre

PLAN §5 : « Habits : distinct de la TODO ; inclut des rappels de mise à jour périodique (ex. solde des comptes) ». Exemple de référence : habitude « Mettre à jour le solde des comptes », chaque lundi, rappel à 19:00, muet si c'est déjà fait. timers-reminders §4.9 fixe l'accroche : un rappel d'habitude est une ligne de `reminders` possédée par l'habitude (`habit_id`, cascade), sans changement de `tick`, `notice`, `group`.

**Hors périmètre** (ne pas improviser) : quantités ; mensuel ; ordre manuel des habitudes (ordre de création) ; plusieurs rappels par habitude ; silence « objectif hebdomadaire atteint » ; `CalendarSource` des habitudes (tâche « Calendrier agrégé ») ; meilleure série historique ; jours de pause (vacances) ; Playwright.

---

## 2. Faits vérifiés et suppositions

| # | Fait vérifié (2026-11-17) | Source |
|---|---|---|
| V1 | Le toast d'un rappel prend `row.title` ; `expand` exclut les `exdates` ; modifier un rappel recalcule le cache par `next_after(now)` sans rattrapage | `schedule/tick.rs` l. 212-222 ; timers-reminders V2 ; `schedule/commands.rs` l. 394-407 |
| V2 | `list_reminders`, `replace_reminder`, `delete_reminder`, `unseen_deliveries` ne filtrent que par `id` ; `reminder_select!` liste les colonnes en dur | `schedule/store.rs` l. 91-99, 229-284, 439 |
| V3 | `locked!`, `now_of`, `settle`, `prepare`, `cache_for`, `known_status`, `bounded` sont privés à `commands.rs` ; `insert_reminder_limited` ouvre sa propre transaction | `schedule/commands.rs` l. 183-324 ; `store.rs` l. 213 |
| V4 | `time::recurrence::Weekday` (`Mo`…`Su`) sans serde ; `parse_weekday` / `weekday_name` privés ; `resolve_local`, `to_local`, `parse_local_date`, `parse_time_zone` publics | `time/recurrence/mod.rs` l. 27, 151-170 ; `time/zone.rs`, `time/formats.rs` |
| V5 | L'export de configuration ne couvre que `dashboards`, `widget_instances`, `settings` | `backup/config_transfer.rs` l. 274-287 |
| V6 | `ADD COLUMN … REFERENCES` exige un défaut `NULL` (clés étrangères actives) | timers-reminders V18 |
| V7 | `core/time` exporte `addDays`, `daysBetween`, `compareLocalDates`, `Today`, `UserTimeZone`, `TimeDisplay`, `DueRefresher` ; `date-rule.ts` n'est pas réexporté (bundle) | `core/time/index.ts` |
| V8 | `--hb-success` est le token « habit fait » | `DESIGN.md` §2.1 |
| V9 | Tests qui figent la version de schéma : voir §6, lot H1 | grep, fichiers cités |

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Un enum serde à étiquette interne (`tag = "kind"`) à variantes structure refuse un champ inconnu avec `deny_unknown_fields` (précédent `MarkSeenDto`) | test H2 |
| S2 | 40 000 coches (100 habitudes × 400 jours, pire cas) passent par IPC en moins de 200 ms | PV2 |
| S3 | Le widget et `core/habits` restent hors du bundle initial | CA-H3-3 |

---

## 3. Décisions techniques

### D1. Frontière : **le Rust seul** lit et écrit `habits` et `habit_checks` (commandes typées)
| Option | Pour | Contre |
|---|---|---|
| A. `tauri-plugin-sql` + dépôts SQLite TS, comme les tâches | Outillage `test:data` en place ; aucune capability | Supprimer une habitude supprimerait ses rappels **hors du Rust** (cascade sur `reminders`, contraire à D2 de timers-reminders) ; le silence H3 demanderait au front d'appeler une commande de resynchronisation après chaque coche (oubli = rappel faux, le motif exact du rejet D2-A) ; deux tables de plus à migrer pour O3 (phase 3) |
| **B. Commandes Rust typées dans le module `schedule`, sous le même `gate`** | Un seul écrivain des rappels, cascade et silence atomiques, validation Rust, va dans le sens d'O3 | Plus de Rust ; tests SQL en Rust (vraies migrations), pas de `test:data` pour ces dépôts |

**Retenu : B**, même si Marius refuse H3 : la cascade habitude → rappel suffit à l'imposer. Le code vit dans `schedule` (partage de `SchedulerCtx`, `gate`, `settle_due`) ; le SQL sur `habits` / `habit_checks` est **seulement** dans `schedule/habit_store.rs`, celui sur `reminders` reste **seulement** dans `schedule/store.rs` (CA-R1-2). Le planificateur (`tick.rs`, `worker.rs`, `plan_due`, `next_fire`, `notice.rs`) ne change pas de logique ; seul `ReminderRow` gagne un champ.

### D2. Modèle simple plutôt que RRULE (H1)
Une RRULE ne sait pas dire « 3 fois par semaine », et le calcul de série sur une règle quelconque serait coûteux. Deux formes : `kind = 'days'` + `days_mask` (bit 0 = lundi … bit 6 = dimanche ; 127 = tous les jours) et `kind = 'weekly'` + `weekly_target` (1..7). Un masque a un `CHECK` exact (1..127), contrairement à une liste texte. Les jours sont des **dates murales** (`day_on`, ADR-003 §3.1.1) dans le fuseau de l'utilisateur au moment de la coche ; ils ne bougent jamais si le fuseau change (ADR-003 §3.2). La coche est une ligne de `habit_checks` (présence = fait), clé naturelle `(habit_id, day_on)` : l'identité de la ligne **est** le jour (exception justifiée, comme `reminder_deliveries`).

### D3. Rappel muet si le jour est coché (H3)
| Option | Pour | Contre |
|---|---|---|
| **A. Exceptions dérivées** : les `exdates` d'un rappel d'habitude ne sont jamais saisies ; elles valent, à chaque écriture de l'habitude, de son rappel ou d'une coche, l'ensemble des clés `<jour coché>T<heure du rappel>` encore **à venir**. Le cache est recalculé dans la même transaction | Planificateur intact ; mécanisme `exdates` éprouvé (D12, ADR-003 §3.5.3) ; le rattrapage (D6) l'exclut aussi ; atomique ; logique pure testable | Rattaché au jour du rappel dans **son** fuseau (approximation si Marius change de fuseau, L13) ; « objectif hebdomadaire atteint » non couvert (extension possible par le même moyen) |
| B. Filtre dans `plan_due` derrière un trait, consulté par `fire_one` | Couvre tous les cas au moment de sonner | Modifie le planificateur et ses tests ; lecture des habitudes à chaque déclenchement ; une issue « muette » demande une nouvelle valeur d'`outcome` donc la **reconstruction** de `reminder_deliveries` (V7 immuable) |
| C. Aucun silence | Le plus simple | Bruit : « Méditer » sonne à 20 h alors que c'est fait depuis 8 h |

**Retenu : A.** Ensemble borné : seules les coches des jours `[J−1, J+1]`, où J = date de `now` dans le fuseau du rappel, sont examinées (une coche porte sur un jour ≤ aujourd'hui) ; une clé dont l'instant résolu (`resolve_local`, `compatible`) est ≤ `now` est retirée (elle n'a plus d'effet, le rappel n'a ni `COUNT` ni `UNTIL`). Les `exdates` d'un rappel d'habitude comptent donc 0 à 2 éléments. Décocher retire la clé ; le cache repart de `next_after(now)` : aucune sonnerie rétroactive. Si Marius choisit C, supprimer `habit_exdates` et passer `exdates = []`.

### D4. Rappel d'habitude dérivé de l'habitude (H4)
Le front envoie `{ id, time: "HH:MM", days, timeZone, enabled }` (`id` : UUID minuscule généré par le front ; à la création il devient l'id du rappel, un id déjà pris donne `Conflict` ; si l'habitude a déjà un rappel, son id est conservé et celui reçu est ignoré) ; le Rust construit la règle (7 jours → `FREQ=DAILY`, sinon `FREQ=WEEKLY;BYDAY=<jours triés MO→SU>`), l'ancre `start_local` = date de `now` dans `timeZone` + `time` (ancre conservée si l'heure et le fuseau n'ont pas changé), le titre = titre de l'habitude, puis passe par `prepare` (validation de timers-reminders). Pas de champ `habitId` dans `ReminderCreateDto` (écart au §4.9 de timers-reminders) : un seul chemin d'écriture, celui des commandes `habit_*`. Les commandes `reminder_update` / `reminder_delete` ne voient pas les rappels d'habitude (`reminder_update` : `NotFound` ; `reminder_delete` : `Ok(false)`, comme pour un id absent) ; `reminder_list` et `reminder_unseen_deliveries` les excluent (H6). Le fuseau d'un rappel existant n'est jamais changé par le formulaire (comme W3).

### D5. Calculs dans le front, `core/habits/habit-stats.ts` (pur)
Séries et réussite dépendent d'« aujourd'hui » dans le fuseau de l'utilisateur, que le Rust ne connaît pas (ADR-003 §3.2). Calcul TS sur dates murales via `core/time` (`addDays`, `daysBetween`, `compareLocalDates`, et deux ajouts : `isoWeekday`, `startOfIsoWeek`, fondés sur `Temporal.PlainDate.dayOfWeek`). Aucune arithmétique en millisecondes, aucun `Date`. Fenêtre chargée : 400 jours se terminant aujourd'hui.

---

## 4. Conception

### 4.1 Migration V8
`migrations/V8__habits.sql` (texte exact, LF, sans BOM ; **figé à la revue du lot H1** ; aucun `npm run dev` entre le début de H1 et cette revue) :

```sql
-- V8__habits : habitudes, jours cochés, rappel possédé par une habitude (spec habits).
-- Ces tables ne sont lues et écrites QUE par les commandes Rust du module schedule : aucun SQL côté front.
-- habits.kind : 'days' (days_mask : bit 0 = lundi ... bit 6 = dimanche, 127 = tous les jours) ou
-- 'weekly' (weekly_target fois par semaine ISO, du lundi au dimanche). start_on : date murale de début.
-- habit_checks : une ligne par jour coché (date murale) ; la clé (habit_id, day_on) est l'identité
-- de la coche (clé naturelle, pas d'UUID).
-- reminders.habit_id : rappel possédé par une habitude (un au plus), supprimé avec elle ; défaut NULL
-- obligatoire pour ADD COLUMN ... REFERENCES.
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

CREATE TABLE habits (
  id            TEXT    NOT NULL PRIMARY KEY
                CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  title         TEXT    NOT NULL
                CHECK (length(trim(title)) >= 1 AND length(title) <= 200
                       AND length(CAST(title AS BLOB)) <= 800),
  kind          TEXT    NOT NULL CHECK (kind IN ('days', 'weekly')),
  days_mask     INTEGER NULL CHECK (days_mask IS NULL OR days_mask BETWEEN 1 AND 127),
  weekly_target INTEGER NULL CHECK (weekly_target IS NULL OR weekly_target BETWEEN 1 AND 7),
  start_on      TEXT    NOT NULL CHECK (
                start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                AND date(start_on) IS start_on
                AND start_on BETWEEN '1900-01-01' AND '2199-12-31'),
  archived_at   TEXT    NULL CHECK (archived_at IS NULL OR (
                archived_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                AND strftime('%Y-%m-%dT%H:%M:%fZ', archived_at, '+0 seconds') IS archived_at
                AND archived_at BETWEEN '1900-01-01' AND '2200-01-01')),
  created_at    TEXT    NOT NULL
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at    TEXT    NOT NULL
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'days') = (days_mask IS NOT NULL)),
  CHECK ((kind = 'weekly') = (weekly_target IS NOT NULL))
) STRICT;

CREATE TABLE habit_checks (
  habit_id   TEXT NOT NULL
             REFERENCES habits (id) ON DELETE CASCADE,
  day_on     TEXT NOT NULL CHECK (
             day_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             AND date(day_on) IS day_on
             AND day_on BETWEEN '1900-01-01' AND '2199-12-31'),
  created_at TEXT NOT NULL
             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL
             CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (habit_id, day_on)
) STRICT;

CREATE INDEX habit_checks_day_on_idx ON habit_checks (day_on);

ALTER TABLE reminders ADD COLUMN habit_id TEXT NULL
  REFERENCES habits (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX reminders_habit_id_idx ON reminders (habit_id)
  WHERE habit_id IS NOT NULL;
```
- `src/db.rs` : `version: 8, description: "habits"` ; `checksums.json` : SHA-256 du fichier.
- Cascade : habitude → coches ; habitude → rappel → livraisons. L'index unique partiel porte « un rappel au plus » (H4) ; plusieurs rappels plus tard = nouvelle migration qui recrée l'index sans `UNIQUE` (pas de reconstruction de table).
- Pas de `CHECK (day_on >= start_on)` inter-tables (impossible) : contrôlé par la commande.

### 4.2 Rust : fichiers et fonctions
```
src/schedule/habit.rs           types et fonctions PURES (aucun SQL, aucune horloge)
src/schedule/habit_store.rs     SEUL fichier avec du SQL sur habits / habit_checks
src/schedule/habit_commands.rs  DTO, fonctions métier pub(crate), 7 commandes (lot H2)
src/schedule/tests/{habit_plan_tests,habit_store_tests,habit_commands_tests}.rs
```
```rust
// mod.rs (ajouts)
pub const MAX_HABITS: i64 = 100;
pub const HABIT_RANGE_MAX_DAYS: i64 = 400;      // plage de habit_checks, bornes incluses
pub const HABIT_CHECKS_MAX_ROWS: i64 = 50_000;
// `locked!` déplacé de commands.rs vers mod.rs, défini AVANT les `pub mod` (portée textuelle).

// habit.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HabitSchedule { Days { mask: u8 }, Weekly { target: u8 } }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HabitRow { pub id: String, pub title: String, pub schedule: HabitSchedule, pub start_on: String,
    pub archived_at: Option<String>, pub created_at: String, pub updated_at: String }
/// 1 à 7 jeton(s) "MO".."SU" distincts (Vec de 7 au plus, contrôlé avant analyse) → masque ; sinon InvalidInput { field }.
pub fn mask_of(days: &[String], field: &str) -> Result<u8, ScheduleError>;
pub fn days_of(mask: u8) -> Vec<&'static str>;                 // ordre MO→SU
pub fn reminder_rule(mask: u8) -> String;                       // 127 → "FREQ=DAILY", sinon "FREQ=WEEKLY;BYDAY=…"
/// Règle d'un rappel d'habitude → masque ; None si hors des deux formes (DAILY ou WEEKLY, INTERVAL 1, sans fin).
pub fn reminder_mask(rule: &RecurrenceRule) -> Option<u8>;
pub fn parse_time_of_day(s: &str) -> Result<jiff::civil::Time, ScheduleError>; // ^([01]\d|2[0-3]):[0-5]\d$ strict, field "reminder.time"
/// Jours J−1..J+1, J = date de `now` dans `tz` (arithmétique jiff).
pub fn check_window(now: Timestamp, tz: &TimeZone) -> (Date, Date);
/// D3 : clés "<jour>T<HH:MM>:00" des jours cochés dont l'instant résolu est > now ; triées, uniques.
pub fn habit_exdates(checked: &[Date], time: jiff::civil::Time, tz: &TimeZone, now: Timestamp) -> Result<Vec<String>, TimeError>;
/// Dernier jour acceptable pour une coche ou un début : date UTC de `now` + 1 jour (fuseaux jusqu'à UTC+14).
pub fn latest_allowed_day(now: Timestamp) -> Date;
```
- `time/recurrence/mod.rs` : `parse_weekday` et `weekday_name` passent en `pub(crate)` (aucun changement de comportement).
- `habit_store.rs` : `insert_habit`, `count_habits`, `replace_habit` (titre, forme, début, `updated_at`), `set_archived`, `delete_habit`, `get_habit`, `list_habits` (`ORDER BY created_at, id`), `insert_check` (`ON CONFLICT (habit_id, day_on) DO NOTHING`, renvoie `bool`), `delete_check` (`bool`), `checks_between(from, to, limit)` (`WHERE day_on BETWEEN ?1 AND ?2 ORDER BY habit_id, day_on LIMIT ?3`), `checked_days(habit_id, from, to)`. Une ligne illisible (masque hors bornes écrit hors du Rust) est ignorée et journalisée (id seulement), jamais de panique.
- `schedule/store.rs` (seuls changements côté rappels) : `reminder_select!` et `ReminderRow` gagnent `habit_id` ; `insert_reminder` l'écrit ; `list_reminders` filtre `WHERE habit_id IS NULL` ; `replace_reminder` et `delete_reminder` ajoutent `AND habit_id IS NULL` ; `unseen_deliveries` ajoute `AND r.habit_id IS NULL` ; nouvelles fonctions `get_habit_reminder(habit_id)`, `list_habit_reminders()` (`WHERE habit_id IS NOT NULL`), `replace_habit_reminder(row)` (`WHERE id = ?1 AND habit_id = ?11`), `delete_habit_reminder(habit_id)`, `disable_habit_reminder(habit_id, now)` (`enabled = 0`, cache `NULL`), `write_reminder_exdates(id, exdates_json, expected_cache, new_cache)` (comparer-et-écrire sur `next_fire_at`, `updated_at` inchangé : état dérivé, comme le cache).
- `commands.rs` : `now_of`, `settle`, `prepare`, `cache_for`, `known_status`, `bounded`, `Parts`, `reminder_dto` passent en `pub(super)`. `tick::settle_due` et `tick::show_notices` restent `pub(super)` (même module).
- `sync_habit_reminder(conn, habit_id, now) -> Result<bool, ScheduleError>` (dans `habit_commands.rs`) : lit le rappel de l'habitude ; s'il est absent : `false` ; sinon `checked_days` sur `check_window`, `habit_exdates`, et si l'ensemble diffère : `prepare` avec ces exceptions, cache = `cache_for(spec, enabled, now)`, `write_reminder_exdates` ; `true` si écrit.

### 4.3 Commandes (lot H2)
Mêmes règles que timers-reminders §4.4 : `async fn`, `State<'_, SchedulerState>`, bornes contrôlées **avant** tout accès disque, fonction métier testée sans Tauri, DTO camelCase, `deny_unknown_fields` en entrée, erreurs `ScheduleError`. Toute commande qui touche un rappel prend le `gate`, exécute d'abord `settle` (D12), écrit dans **une** transaction `BEGIN IMMEDIATE` (avec `count_reminders` + `insert_reminder`, jamais `insert_reminder_limited` imbriqué), affiche les avis hors `gate`, puis `wake()` si un rappel a changé.

```rust
#[derive(serde::Serialize, serde::Deserialize)] #[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HabitScheduleDto { Days { days: Vec<String> }, Weekly { target: u8 } }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HabitReminderInputDto { pub id: String, /* UUID minuscule, généré par le front ; ignoré si l'habitude a déjà un rappel (son id est conservé) */ pub time: String, pub days: Vec<String>, pub time_zone: String, pub enabled: bool }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HabitInputDto { pub title: String, pub schedule: HabitScheduleDto, pub start_on: String,
    /// obligatoire : `null` supprime le rappel, une clé absente est une erreur de désérialisation
    #[serde(deserialize_with = "Option::deserialize")] pub reminder: Option<HabitReminderInputDto> }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HabitCreateDto { pub id: String, pub title: String, pub schedule: HabitScheduleDto, pub start_on: String,
    pub reminder: Option<HabitReminderInputDto> }
#[derive(Debug, serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct HabitReminderDto { pub reminder_id: String, pub time: String, pub days: Vec<&'static str>, pub time_zone: String,
    pub enabled: bool, pub next_fire_at: Option<String>, pub next_fire_key: Option<String>, pub status: ReminderStatus }
#[derive(Debug, serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct HabitDto { pub id: String, pub title: String, pub schedule: HabitScheduleDto, pub start_on: String,
    pub archived_at: Option<String>, pub reminder: Option<HabitReminderDto>, pub created_at: String, pub updated_at: String }
#[derive(Debug, serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct HabitCheckDto { pub habit_id: String, pub day_on: String }

pub async fn habit_list(state) -> Result<Vec<HabitDto>, ScheduleError>;
pub async fn habit_create(state, input: HabitCreateDto) -> Result<HabitDto, ScheduleError>;
pub async fn habit_update(state, id: String, input: HabitInputDto) -> Result<HabitDto, ScheduleError>;
pub async fn habit_set_archived(state, id: String, archived: bool) -> Result<HabitDto, ScheduleError>;
pub async fn habit_delete(state, id: String) -> Result<bool, ScheduleError>;
pub async fn habit_checks(state, from: String, to: String) -> Result<Vec<HabitCheckDto>, ScheduleError>;
pub async fn habit_set_check(state, habit_id: String, day_on: String, done: bool) -> Result<bool, ScheduleError>;
```

| Commande | Contrôles (dans l'ordre) | Effet | Réveil |
|---|---|---|---|
| `habit_list` | — | toutes les habitudes (archivées comprises) + leur rappel (`list_habit_reminders`, jointure en Rust) ; `status` par `status_of` hors `gate` (`spawn_blocking`) ; un rappel dont la règle sort des deux formes : `status: invalid`, `days: []` | non |
| `habit_create` | `id` ; `title` (`bounded` + `check_title`) ; forme (`mask_of`, `target` 1..7) ; `startOn` (`parse_local_date`, de 1900-01-01 à `latest_allowed_day`) ; rappel : `id`, `time`, `days`, puis `prepare` (fuseau, règle) ; en transaction : `INSERT` de l'habitude (id existant → `Conflict`, avant toute limite), puis `count_habits <= 100`, sinon `LimitReached` ; si rappel : `count_reminders < 1000` | `INSERT` habitude ; si rappel : `INSERT` rappel (id du front, `habit_id`, `exdates = []`, cache ; id déjà pris → `Conflict`) ; id d'habitude existant → `Conflict` | si rappel |
| `habit_update` | mêmes contrôles (sans limite d'habitudes) ; absente → `NotFound` | remplace titre, forme, début ; rappel : absent → `delete_habit_reminder` ; présent → crée ou remplace (titre = titre de l'habitude ; ancre D4 ; **forcé `enabled = false` si l'habitude est archivée**) puis `sync_habit_reminder` | si rappel touché |
| `habit_set_archived` | `id` ; absente → `NotFound` | `true` : `archived_at = now` (inchangé si déjà archivée) + `disable_habit_reminder` ; `false` : `archived_at = NULL` (rappel laissé désactivé, H7) | si rappel touché |
| `habit_delete` | `id` | `DELETE` (cascade coches, rappel, livraisons) ; `false` si absente | oui |
| `habit_checks` | `from`, `to` (dates strictes), `from <= to`, `to − from` < 400 jours (`Date::until`, jiff) sinon `InvalidInput { field: "to" }` | `checks_between(…, 50 000)` | non |
| `habit_set_check` | `habitId`, `dayOn` (strict, ≤ `latest_allowed_day`) ; habitude absente → `NotFound` ; `dayOn < start_on` → `InvalidInput { field: "dayOn" }` | `insert_check` / `delete_check` ; si changé : `sync_habit_reminder` ; renvoie « ligne changée » (idempotent : `false`) | si rappel touché |

Noms de champ des erreurs `InvalidInput` (camelCase, chemin pointé) : `id`, `title`, `schedule.days`, `schedule.target`, `startOn`, `reminder.id`, `reminder.time`, `reminder.days`, `reminder.timeZone`, `habitId`, `dayOn`, `from`, `to`. Toute date (`startOn`, `dayOn`) antérieure au 1900-01-01 est refusée (la contrainte `CHECK` de V8 la refuserait). Archiver une habitude déjà archivée ne touche pas le rappel et ne réveille rien. Un rappel dont le fuseau, le titre ou la règle sont refusés par le moteur (écrit hors du Rust) est « illisible » : `sync_habit_reminder` le journalise (id) et retourne `false`, la coche passe. Le réveil suit le commit même si la relecture du DTO échoue.

Enregistrement : `build.rs`, les **deux** `invoke_handler` de `lib.rs` (+ tests), `capabilities/default.json` (`allow-habit-list`, `allow-habit-create`, `allow-habit-update`, `allow-habit-set-archived`, `allow-habit-delete`, `allow-habit-checks`, `allow-habit-set-check`), `capability_tests.rs` (liste exacte). Description de `default.json`, phrase ajoutée : « The habit commands (habit_*) read and write only the habits and habit_checks tables and the reminders owned by a habit, with bounded, validated inputs. »

### 4.4 Front : `data/`, `core/`
`data/models.ts` (ajouts) :
```ts
export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type HabitSchedule =
  | { readonly kind: 'days'; readonly days: readonly WeekdayCode[] }
  | { readonly kind: 'weekly'; readonly target: number };
export interface HabitReminderInput {
  readonly time: string; /** HH:MM */ readonly days: readonly WeekdayCode[];
  readonly timeZone: TimeZoneId; readonly enabled: boolean;
}
export interface HabitReminder extends HabitReminderInput {
  readonly reminderId: string; readonly nextFireAt: InstantIso | null;
  readonly nextFireKey: LocalDateTimeIso | null; readonly status: ReminderStatus;
}
export interface HabitInput {
  readonly title: string; readonly schedule: HabitSchedule; readonly startOn: LocalDateIso;
  readonly reminder: HabitReminderInput | null;
}
export interface Habit extends Omit<HabitInput, 'reminder'> {
  readonly id: string; readonly archivedAt: InstantIso | null; readonly reminder: HabitReminder | null;
  readonly createdAt: InstantIso; readonly updatedAt: InstantIso;
}
export interface HabitCheck { readonly habitId: string; readonly dayOn: LocalDateIso }
export const HABIT_LIMITS = { maxHabits: 100, titleMaxChars: 200, historyDays: 400 } as const;
```
`data/repositories.ts` :
```ts
export interface HabitRepository {
  list(): Promise<Habit[]>;
  create(input: HabitInput & { readonly id?: string }): Promise<Habit>;
  update(id: string, input: HabitInput): Promise<Habit>;
  setArchived(id: string, archived: boolean): Promise<Habit>;
  remove(id: string): Promise<boolean>;
  checks(range: { readonly from: LocalDateIso; readonly to: LocalDateIso }): Promise<HabitCheck[]>;
  setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean>;
}
```
- `data/tauri/tauri-habit.repository.ts` : arguments exacts (`{}`, `{ input }`, `{ id, input }`, `{ id, archived }`, `{ id }`, `{ from, to }`, `{ habitId, dayOn, done }`), entrée recopiée champ par champ (`deny_unknown_fields`), id généré si absent ; erreurs par `invokeCommand` (`limit_reached` → `forbidden`).
- `data/schedule.tokens.ts` : `HABIT_REPOSITORY` (même schéma que `REMINDER_REPOSITORY`, hors barrel).
- `data/schedule-sql-guard.spec.ts` : `habits` ajouté à `SQL_ON_TABLE`, `habit_checks` à `RUST_ONLY_TABLE`.
- `core/time/local-date.ts` : `isoWeekday(date): 1..7` (`dayOfWeek`), `startOfIsoWeek(date)` (`addDays(date, 1 − isoWeekday)`), exportés par `core/time/index.ts`.
- `core/habits/habit.store.ts` (`providedIn: 'root'`) : signaux `habits`, `checks` (`ReadonlyMap<habitId, ReadonlySet<LocalDateIso>>`), `windowStart`, `loading`, `error` ; `refresh()` charge `list()` et `checks({ from: today − 399, to: today })` ; relecture au premier usage, au retour visible et au `focus` (`DueRefresher` sans échéance) et quand `Today.date()` change. Actions `create`, `update`, `setArchived`, `remove` : comme `ReminderStore.act` (action, puis relecture ; l'échec rejette sans toucher à `error`). `setCheck` : mise à jour **optimiste** de `checks`, puis appel ; en cas d'échec, relecture et rejet.
- `core/habits/habit-stats.ts` (pur, §4.6) : `isExpected(schedule, day)`, `currentStreak(habit, checked, today, windowStart): { count, unit: 'days' | 'weeks', truncated }`, `successRate(habit, checked, today): { done, expected }`, `weekProgress(habit, checked, today): { done, required } | null`.
- Fake : `core/testing/fake-habit.repository.ts` (sémantique du §4.3, horloge `ManualClock`).

### 4.5 Notifications
Aucun changement de `notice.rs` : titre = titre de l'habitude, corps `Prévu à {HH:MM}` ; en retard `Rappel manqué : {titre}` (timers-reminders §4.5). Pas de préfixe « Habitude : » stocké dans le titre du rappel (texte français figé en base).

### 4.6 Calculs (D5, H8)
T = aujourd'hui (`Today.date()`), S = `startOn`, W = début de fenêtre (T − 399). Coches < S ignorées.
- **`days`** : jour prévu = `d >= S` et jour de semaine de `d` dans `days`. Série : depuis T vers le passé, jours non prévus sautés ; prévu et coché → +1 ; prévu non coché → arrêt, **sauf** si `d = T` (en attente). Arrêt sans troncature à `d < S` ; à `d < W` avec `S < W` → `truncated` (affiché « 57+ »). Réussite : jours prévus de `[max(S, T−29), T]`, T exclu s'il n'est pas coché ; `done` = prévus cochés. Unité « jours ».
- **`weekly`** (N) : semaine = `[startOfIsoWeek(d), +6]`. Exigence = N, sauf semaine de S : `min(N, daysBetween(S, dimanche) + 1)`. Semaine courante réussie si atteinte, sinon « en cours » (ne casse pas). Série en semaines depuis la semaine courante (comptée seulement si atteinte) ; arrêt à la première semaine échouée, à la semaine de S (comprise), ou à une semaine qui commence avant W (`truncated` si S < W). Réussite : les 4 semaines finissant par la courante, comptées si elles touchent `[S, T]`, la courante seulement si atteinte. `weekProgress` = coches de la semaine courante / exigence.
- Taux affiché `Math.round(100 × done / expected)` ; `expected = 0` → « — ».

Cas chiffrés (2026-11-17 est un mardi) :
| # | Cas | Attendu |
|---|---|---|
| C1 | Tous les jours, S = 11-10, cochés 11-10…11-16, T non coché | série 7 ; T coché → 8 |
| C2 | Idem, 11-11 non coché | série 5 (11-12…11-16) |
| C3 | L/Me/V, S = lun. 11-02, cochés 02, 04, 06, 09, 11, 13, 16 + sam. 14 | série 7 (le 14 ignoré) ; sans le 13 → série 1 |
| C4 | 3 fois/sem., S = sam. 11-07 | semaine du 11-02 : exigence 2 (sam., dim.) ; 07 et 08 cochés ✓ ; semaine du 11-09 : 3 coches ✓ ; semaine courante (11-16) : 1 coche → série 2 sem., progression 1/3 ; 3e coche → série 3 |
| C5 | 2 fois/sem., cochés jeu. 2026-12-31 et sam. 2027-01-02 | même semaine ISO (lun. 2026-12-28, semaine 53 de 2026) → réussie |
| C6 | Tous les jours, S = 11-10, cochés 11-10…11-15, 11-16 non coché, T non coché | réussite 6/7 = 86 % ; T coché → 7/8 = 88 % |
| C7 | 1 fois/sem., S = T = mer. 2026-11-18, rien coché | exigence 1 ; série 0 ; réussite « — » (semaine courante non atteinte, non comptée) |
| C8 | 2026-10-25 (25 h à Paris), 2027-03-28 (23 h) | sans effet : dates murales |
| C9 | Fuseau Paris → Montréal | coches inchangées ; « aujourd'hui » recalculé ; le rappel garde son fuseau (D1 ADR-003) |

### 4.7 Widget `habits` (lots H4a, H4b)
Dossier autonome (ADR-001), `OnPush`, signaux, textes Transloco sous `widgets.habits`, tokens DESIGN.md seulement, aucune donnée en `innerHTML`, `permissions: ['notifications']` (documentation). Titre « Habitudes », icône `pi pi-check-square`, tailles min 3×3, défaut 4×4, max 8×8, config v1 `{}`. Hors Tauri : bandeau `flash-danger` `common.desktopOnly`.
- **Liste** (`box-row`, habitudes non archivées, ordre de création) : titre tronqué ; dessous en 12 px `text-fg-muted` la forme (« Tous les jours », « L · Me · V », « 3 fois par semaine ») et, si rappel actif, `pi pi-bell` + « 20:00 » (+ « (20:00 Paris) » si son fuseau diffère, comme W3) ; à droite la **bande des 7 derniers jours** (T à droite), puis « Série : 12 » (unité en `sr-only` : « 12 jours prévus d'affilée » / « 3 semaines d'affilée », suffixe « + » si `truncated`) et, pour `weekly`, « 1/3 cette semaine ». Bouton [i] « Détails de <titre> » (`pi pi-info-circle`, invisible, compact).
- **Cellule** : `<button type="button" aria-pressed>` 24 × 24, `rounded-box` ; fait : `bg-success-emphasis` + `pi pi-check` `text-fg-on-emphasis` ; prévu non fait : `border-default` vide ; non prévu : `bg-canvas-subtle` ; aujourd'hui : bordure `border-accent` en plus ; avant S : `disabled`. Nom accessible « <titre>, <jour long> <date> » (+ « , jour non prévu ») via `TimeDisplay`. En-tête de colonnes (initiales des jours) `aria-hidden`. Cellule désactivée pendant son appel.
- **Clavier** : chaque ligne est un `role="group"` (nom = titre) avec **un seul arrêt de tabulation** (tabindex mobile, cellule d'aujourd'hui par défaut) ; ←/→ changent de cellule, Début/Fin, Espace/Entrée basculent.
- **Densité** (requêtes de conteneur) : sous 20rem, seule la cellule d'aujourd'hui et la série restent ; sous 11rem, la série passe sous le titre.
- **Vide** : `empty-state` « Aucune habitude. » + bouton primaire « Créer une habitude ». Sinon pied : bouton défaut compact « Nouvelle habitude » ; section repliée « Archivées (n) » : titre, « Restaurer », « Supprimer » (confirmation en ligne).
- **Fiche** (panneau, DESIGN « Panneau dans une carte », H10) : Titre ; Fréquence (radio « Certains jours » + 7 bascules L…D avec raccourci « Tous les jours », au moins un ; ou « N fois par semaine », champ 1..7 `inputmode="numeric"`) ; Début (`<input type="date">`, ≤ T, défaut T) ; Rappel (`switch`) → Heure (`<input type="time">`, `step="60"`), Jours (7 bascules, défaut = jours de l'habitude, ou tous), « Heure de Europe/Paris » (nouveau : `UserTimeZone.id()` ; existant : son fuseau, inchangé). Avertissement `classifyLocal` si l'heure tombe dans un trou ou un pli **aujourd'hui** (clés `time.nonexistent` / `time.ambiguous`). Actions : « Enregistrer » (primaire), « Annuler », « Archiver » / « Restaurer », « Supprimer » (confirmation en ligne). Échap = Annuler ; focus rendu au [i]. Erreurs Rust par `commandErrorDetails` (`field`) sous le champ.
- **Historique** (fiche d'une habitude existante, lot H4b) : grille de 5 semaines lundi → dimanche se terminant par la semaine courante, mêmes cellules (jours futurs absents), même clavier en 2 dimensions (↑/↓ = ± 7 jours) ; « Série actuelle », « Réussite sur 30 jours : 86 % (6/7) » ou « Sur 4 semaines : 2/2 ».
- `habit-form.ts` (pur) : `newHabitForm(today, timeZone)`, `habitToForm(habit)`, `formToInput(state, today): { input } | { errors }` (titre trim non vide ≤ 200 points de code, ≥ 1 jour, cible 1..7, début valide ≤ T, heure HH:MM, ≥ 1 jour de rappel). `habit-label.ts` (pur) : libellé de forme, nom accessible de cellule.
- Zone `role="status"` : « Habitude enregistrée. », « Habitude archivée. »… ; `forbidden` → « 100 habitudes au plus. ».

**Clés i18n principales** : `widgets.habits.title` « Habitudes », `.description` « Habitudes cochées chaque jour, séries et rappels », `.empty` « Aucune habitude. », `.create` « Créer une habitude », `.new` « Nouvelle habitude », `.details` « Détails de {{ title }} », `.everyDay` « Tous les jours », `.timesPerWeek` « {{ count }} fois par semaine », `.weekProgress` « {{ done }}/{{ required }} cette semaine », `.streak` « Série : {{ count }} », `.streakDaysSr` « {{ count }} jours prévus d'affilée », `.streakWeeksSr` « {{ count }} semaines d'affilée », `.notExpected` « jour non prévu », `.rate30` « Réussite sur 30 jours : {{ rate }} ({{ done }}/{{ expected }}) », `.rate4w` « Sur 4 semaines : {{ done }}/{{ expected }} », `.noRate` « — », `.form.*` (titre, fréquence, début, rappel, heure, jours), `.zone` « Heure de {{ zone }} », `.save` « Enregistrer », `.cancel` « Annuler », `.archive` « Archiver », `.restore` « Restaurer », `.delete` « Supprimer », `.archived` « Archivées ({{ count }}) », `.limit` « 100 habitudes au plus. », `.saved` « Habitude enregistrée. ».

### 4.8 Sécurité
- Surface JS ajoutée : 7 commandes d'app, aucune permission `core:*`, `sql:*` ou autre. Aucun chemin ni URL venu du front.
- Bornes avant tout travail : UUID ; titre ≤ 200 points de code sans contrôle ni caractère bidi (`check_title`, le titre devient celui d'un toast) ; `days` ≤ 7 jetons de 2 caractères ; cible 1..7 ; dates strictes ≤ `latest_allowed_day` ; plage ≤ 400 jours ; ≤ 50 000 lignes renvoyées ; 100 habitudes ; 1 000 rappels.
- Tant qu'O3 n'est pas fait, le front garde `sql:allow-execute` : une XSS pourrait écrire ces tables. Revalidation à la lecture (ligne illisible ignorée, rappel `invalid`), `CHECK` en filet ; résiduel ADR-002 R1 accepté. Garde-fou de test côté front (§4.4).
- Journaux : identifiants seulement. Aucun secret, aucun réseau.

---

## 5. Cas limites

| # | Cas | Résultat attendu |
|---|---|---|
| L1 | Quotidienne, rappel 20:00 Paris, cochée à 08:00 | `exdates = ["<J>T20:00:00"]`, cache sur demain 20:00 ; aucun toast ce soir |
| L2 | Décochée à 10:00 | `exdates = []`, cache sur aujourd'hui 20:00 ; le toast sonne |
| L3 | Cochée à 20:03, après le toast | clé passée : aucune exception ; rien d'autre |
| L4 | Décochée à 21:00 après un jour muet | aucun toast rétroactif (cache = `next_after(now)`) |
| L5 | Cochée à 08:00, PC en veille de 19:00 à 21:00 | occurrence exclue : aucun « Rappel manqué » |
| L6 | Heure du rappel changée de 20:00 à 21:00 à 20:30, jour coché | exceptions recalculées : `<J>T21:00:00` ; muet |
| L7 | Rappel 02:30 Paris, cochée le 2027-03-28 à 01:00 | clé `2027-03-28T02:30:00` résolue 01:30Z > now : exclue (trou, ADR-003 C4) |
| L8 | Rappel 02:30, cochée le 2026-10-25 à 00:45Z (pli) | clé résolue 00:30Z ≤ now : non ajoutée (déjà sonné une fois) |
| L9 | « 3 fois/sem. », objectif atteint mercredi, rappel tous les jours | sonne jeudi à dimanche les jours non cochés (H3, v1) |
| L10 | Coche d'un jour futur (appel forgé) au-delà de `latest_allowed_day` / avant `start_on` | `InvalidInput { field: "dayOn" }` |
| L11 | Double clic sur une cellule | cellule désactivée pendant l'appel ; Rust idempotent (`false`) |
| L12 | Suppression d'une habitude | coches, rappel et livraisons supprimés ; `settle` d'abord (pas de toast perdu ni doublé) |
| L13 | Fuseau utilisateur changé après la création du rappel | les jours restent des dates ; le silence vise le jour du rappel dans **son** fuseau : approximation acceptée |
| L14 | Archivage puis restauration | rappel désactivé puis toujours désactivé ; coches conservées |
| L15 | `start_on` avancé après des coches | coches antérieures conservées, ignorées par les calculs, cellules désactivées |
| L16 | `reminder_update` / `reminder_delete` sur un rappel d'habitude | `reminder_update` : `NotFound` ; `reminder_delete` : `Ok(false)` ; absent de `reminder_list` et des livraisons non vues |
| L17 | 101e habitude ; 1001e rappel | `LimitReached`, rien n'est écrit |
| L18 | Suppression d'un widget Habitudes ; import de configuration | données conservées (H5, H9) |
| L19 | Restauration d'une sauvegarde V7 | migrée en V8 au démarrage, aucune habitude |
| L20 | Minuit passé fenêtre ouverte | `Today` change, la bande se décale, relecture |
| L21 | Hors Tauri | `DataError('unavailable')`, bandeau, aucune exception non gérée |
| L22 | Ligne d'habitude écrite hors du Rust avec `days_mask` invalide | refusée par `CHECK` ; si contournée : ignorée par `habit_list`, journalisée |
| L23 | Hors-ligne, synchronisation | sans objet (tout est local) |

---

## 6. Lots

Ordre : H1 → H2 → H3 → H4a → H4b. Chaque lot : `npm run format:check`, `npm run lint`, `npm run test`, `npm run rust:fmt:check`, `npm run rust:lint`, `npm run rust:test` verts, lancés depuis `F:/Marius/Projects/homebase` (F majuscule) ; revue `reviewer`. Un lot bloqué s'arrête et rapporte.

### Lot H1 : migration V8, stockage, logique pure (aucune commande)
Fichiers : créer `migrations/V8__habits.sql`, `src/schedule/{habit,habit_store}.rs`, `src/schedule/tests/{habit_plan_tests,habit_store_tests}.rs` ; modifier `src/db.rs`, `migrations/checksums.json`, `src/schedule/mod.rs` (modules, constantes), `src/schedule/reminder.rs` (`ReminderRow.habit_id`), `src/schedule/store.rs` (§4.2), `src/time/recurrence/mod.rs` (`pub(crate)`), `apps/web/src/app/data/migrations.spec.ts`. `#[cfg_attr(not(test), expect(dead_code, …))]` au niveau des nouveaux modules permis dans ce lot seulement.
**Tests qui figent la version, à mettre à jour ici** :
- `src/backup/sqlite.rs` l. 70 : `supported_schema_version() == 8` ;
- `src/backup/validate_tests.rs` l. 629 : `supported: 8` ; l. 634-642 : archive de base **8** + fausse migration **9**, `SchemaTooNew { archive: 9, .. }` ; l. 1144 et l. 1290 : `expected_schema(7)` → `expected_schema(supported_schema_version())` ; nouveaux tests `expected_schema_of_version_8_matches_a_real_database` (tables `habits`, `habit_checks` absentes de V7, colonne `habit_id` présente) et `v7_database_with_a_reminder_migrated_to_v8_keeps_it` (`habit_id` NULL, cache intact) ;
- `src/schedule/tests/{store,tick,worker,commands}_tests.rs` : `make_database(…, 7, …)` → `supported_schema_version()` (9 appels ; `ReminderRow` lit `habit_id`) et littéraux `ReminderRow { …, habit_id: None }` ;
- `data/migrations.spec.ts` : liste des tables (`habit_checks`, `habits`), bloc V8 (insertions valides ; refus : `kind = 'days'` sans masque, masque 0 et 128, cible 8, `day_on` `2026-02-30`, `archived_at` mal formé, deux rappels pour une habitude ; cascade habitude → coches, rappel, livraisons), base V7 avec un rappel migrée en V8 sans perte.
- **CA-H1-1** Texte de V8 identique au §4.1 ; `test:data` et `rust:test` verts.
- **CA-H1-2** `habit_plan_tests.rs` : `mask_of` (vide, doublon, `"mo"`, 8 jetons → erreur), `reminder_rule` / `reminder_mask` aller-retour pour 127, `MO`, `MO,WE,FR` ; `parse_time_of_day` (`24:00`, `7:00`, `07:00:00` refusés) ; `habit_exdates` pour L1, L3, L6, L7, L8 ; `check_window` à 23:30 et 00:30 Paris ; `latest_allowed_day`.
- **CA-H1-3** `habit_store_tests.rs` : aller-retour, `insert_check` deux fois → `false`, cascade, `list_reminders` / `unseen_deliveries` sans les rappels d'habitude, `replace_reminder` / `delete_reminder` sans effet sur eux.
- **CA-H1-4** `rg -n "habits|habit_checks" apps/desktop/src-tauri/src --glob '!**/tests/**'` : SQL seulement dans `schedule/habit_store.rs` ; aucun `Timestamp::now`, aucun `unwrap()` hors tests, aucune valeur concaténée dans du SQL.

### Lot H2 : commandes `habit_*`
Fichiers : créer `src/schedule/habit_commands.rs`, `src/schedule/tests/habit_commands_tests.rs` ; modifier `src/schedule/{mod,commands}.rs` (`locked!`, visibilités), `build.rs`, `src/lib.rs` (deux `invoke_handler` + tests), `capabilities/default.json`, `src/capability_tests.rs`, `src/schedule/tests/commands_tests.rs` (L16).
- **CA-H2-1** Chaque ligne du tableau §4.3 testée (fonctions métier, `FixedClock`, `RecordingNotifier`) ; L1, L2, L4, L5 (par `tick` après `habit_set_check`), L10 à L12, L14, L17.
- **CA-H2-2** DTO : camelCase exact, champ inconnu refusé (S1, y compris dans `schedule`), `{"kind":"days","days":["MO"]}` / `{"kind":"weekly","target":3}`.
- **CA-H2-3** `default.json` ne gagne que les 7 `allow-habit-…` ; deux fichiers de capability ; toute commande qui touche un rappel appelle `wake()` après commit (compteur de réveils).
- **CA-H2-4** `tick.rs`, `worker.rs`, `notice.rs`, `plan_due`, `next_fire` : diff vide hors lecture du champ `habit_id`.
- **CA-H2-5** (manuel, console de dev) `invoke('habit_create', …)` avec rappel dans 2 minutes → toast ; même chose puis `habit_set_check` du jour → aucun toast.

### Lot H3 : front, données et services
Fichiers : modifier `data/{models,repositories,index,schedule.tokens}.ts`, `data/schedule-sql-guard.spec.ts`, `core/time/{local-date,index}.ts` (+ spec) ; créer `data/tauri/tauri-habit.repository.ts` (+ spec), `core/habits/{habit.store,habit-stats,index}.ts` (+ specs), `core/testing/fake-habit.repository.ts`.
- **CA-H3-1** `habit-stats.spec.ts` couvre C1 à C7 et les bornes (`truncated`, `expected = 0`) ; `local-date.spec.ts` : `isoWeekday('2026-11-16') = 1`, `startOfIsoWeek('2027-01-02') = '2026-12-28'`.
- **CA-H3-2** `tauri-habit.repository.spec.ts` : noms et arguments exacts, `unavailable` hors Tauri ; `habit.store.spec.ts` : relecture au changement de jour et au `focus`, `setCheck` optimiste puis annulé sur échec.
- **CA-H3-3** `npm run web:build` réussit sans changer le budget ; sinon s'arrêter et rapporter la taille. Aucun `any`, aucun `Date`.

### Lot H4a : widget (liste, bande, fiche, archivage)
Fichiers : `widgets/habits/{habits.definition,habits.config,habits.component(.ts|.html),habit-detail.component(.ts|.html),habit-form.ts,habit-label.ts}` + specs ; `widgets/widgets.providers.ts` ; `core/i18n/fr.json`.
- **CA-H4a-1** `habit-form.spec.ts` (aller-retour `habitToForm(formToInput(x))`, chaque refus) et `habit-label.spec.ts` verts.
- **CA-H4a-2** Composants avec fake : rendu, cocher / décocher, clavier (un arrêt par ligne, flèches, Espace), panneau (Échap, focus rendu), état vide, archivées, hors Tauri, aucun texte en dur.
- **CA-H4a-3** Manuels MH1 à MH6.

### Lot H4b : historique 5 semaines et statistiques
Fichiers : `widgets/habits/habit-history.component(.ts|.html)` (+ spec), `habit-detail.component.*`, `core/i18n/fr.json`.
- **CA-H4b-1** Grille : semaines lundi → dimanche, futurs absents, ↑/↓ = ± 7 jours ; taux et série conformes à `habit-stats`.
- **CA-H4b-2** Manuels MH7, MH8.

## 7. Vérifications manuelles (Marius)
Sur l'exe release installé pour les toasts (timers-reminders V11), sinon en dev.
- **MH1** Habitude « Mettre à jour le solde des comptes », lundi seulement, rappel lundi dans 2 minutes : toast « Mettre à jour le solde des comptes / Prévu à HH:MM ».
- **MH2** Même chose, cocher aujourd'hui avant l'heure : aucun toast ; décocher avant l'heure : le toast sonne.
- **MH3** Le widget Rappels n'affiche ni ce rappel ni sa livraison.
- **MH4** Cocher et décocher des jours passés : série et « 1/3 cette semaine » à jour ; clavier seul (Tab, flèches, Espace).
- **MH5** Archiver : l'habitude disparaît, le rappel ne sonne plus ; restaurer : rappel affiché désactivé.
- **MH6** Supprimer : plus de toast ; supprimer le widget puis le rajouter : habitudes intactes.
- **MH7** Laisser la fenêtre ouverte au passage de minuit : la bande se décale.
- **MH8** Thèmes clair et sombre, tableau teinté : cellules lisibles (DESIGN §6) ; sauvegarde puis restauration : habitudes et coches présentes ; export de configuration : aucune habitude.

## 8. Amendements appliqués (2026-11-17)
- **timers-reminders §4.9** : « Remplacé par `docs/specs/habits.md` : pas de `habitId` dans `ReminderCreateDto` ni de filtre `owner` ; rappels d'habitude créés et modifiés par les commandes `habit_*` seulement, exclus de `reminder_list`, `reminder_unseen_deliveries`, `reminder_update`, `reminder_delete` ; un au plus par habitude (index unique) ; `exdates` dérivées des coches (D3), sans changement du planificateur. »
- **ADR-002** : O3, avancement : « `habits`, `habit_checks` (V8) : commandes Rust typées seulement ». §3.3 : clé naturelle `(habit_id, day_on)` de `habit_checks` ; horodatages fournis par l'horloge Rust.
- **ADR-003** : §1, ligne Habitudes : « dates murales ; jours de la semaine ou N fois par semaine ISO (pas de RRULE, spec habits D2) ». §3.5.3 : « les `exdates` d'un rappel d'habitude sont dérivées des jours cochés ». §3.6 : `isoWeekday`, `startOfIsoWeek` dans `core/time`.
- **PLAN §5**, ligne Habits : « jours précis ou N fois par semaine, coche par jour, séries ; un rappel par habitude, muet si le jour est coché (spec habits) ».
- **DESIGN §3** : « **Bande d'habitude** : cellules 24 px, fait = `bg-success-emphasis` + `pi pi-check`, aujourd'hui bordé `border-accent`, un arrêt de tabulation par ligne (flèches) ». « Formulaire d'habitude : « Enregistrer » explicite (H10) ».
- **ROADMAP** phase 2 : cocher la mini-spec ; remplacer « (S) Habit tracker » par les lots H1, H2, H3, H4a, H4b (« texte de V8 figé à la revue ; pas de npm run dev avant »).

## 9. Risques et points à vérifier
| Risque | Impact | Mitigation |
|---|---|---|
| R1. Erreur dans `habit_exdates` | Rappel muet à tort, ou bruyant | Fonction pure, cas L1 à L8 testés, `tick` réel en H2 |
| R2. Fuseau du rappel ≠ fuseau utilisateur | Silence décalé d'un jour | Rare (déménagement) ; accepté (L13) ; recréer le rappel le corrige |
| R3. Croissance de `reminder_deliveries` (livraisons d'habitude jamais vues) | ≈ 365 lignes/an/habitude | Négligeable ; purge éventuelle commune aux rappels (timers-reminders R7) |
| R4. Charge IPC de `habit_checks` | Lenteur au chargement | Bornes (400 j, 50 000 lignes) ; PV2 |
| R5. Budget du bundle | Build en échec | Widget et `core/habits` paresseux ; arrêt et décision (CA-H3-3) |
| R6. Écriture hors Rust (O3 non fait) | Données incohérentes | `CHECK`, revalidation à la lecture, O3 en phase 3 |

- **PV1** S1 : `deny_unknown_fields` sur `HabitScheduleDto` (test H2).
- **PV2** Temps d'un `habit_checks` sur 400 jours avec 20 habitudes cochées chaque jour (mesure en H3, en dev).
- **PV3** `ALTER TABLE … ADD COLUMN … REFERENCES` appliquée par le vrai migrateur sur une base V7 avec rappels (test H1).
- **PV4** Lecteur d'écran (Narrateur) : nom et état des cellules annoncés (MH4).
