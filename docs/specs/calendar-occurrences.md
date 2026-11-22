# Spec : Calendrier, occurrences des tâches répétées et habitudes

- **Statut** : acceptée (2026-11-21), avec les amendements de Marius (§0)
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§5), branche `phase-2-calendar-occurrences`, worktree `F:/Marius/Projects/homebase-calendar` (chemins en `F:/` majuscule)
- **Liens** : `CLAUDE.md` ; ADR-003 §2.4, §3.3, §3.5.4, §3.7, §3.9 ; ADR-004 §0 (D5, D6, D10), §3.2 ; `docs/specs/calendar.md` (T1, T3, T5, §4.7, §4.8, PV0) ; `docs/specs/habits.md` (D1, D2, D4, H2, H5, H6, H7, §4.4, §4.6, L13) ; `docs/DESIGN.md` §2, §4, §5

Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`. Cette spec ne modifie aucun autre document : les amendements sont **proposés** au §8.

**Demandes de Marius** (retours de tests visuels, 2026-11-21) :
1. « Une tâche qui se répète montre toutes ses occurrences dans Agenda et Mois. » Lève ADR-004 D6.
2. « Les habitudes doivent être visibles dans l'Agenda et dans Mois. » Lève ADR-004 D5.

**Hors périmètre** (ne pas improviser) :
- historique des occurrences passées d'une tâche répétée (il n'existe pas) ;
- report des tâches en retard sur « aujourd'hui » dans l'Agenda (Q3, §7 R7) ;
- jours manqués d'une habitude ;
- action depuis la fiche (cocher, reporter) ;
- couleur choisie ;
- Playwright ;
- toute modification Rust, de migration ou de capability.

---

## 0. Décisions validées par Marius (2026-11-21)

- **Validées telles que recommandées** : O1 à O7, O9, O11, O12 et O13.
- **Amendées** : O8 (ordre dans un jour) et O10 (habitude à heure). Le texte de référence est au §1.
- **Réponses aux questions** :
  - Q1 : les jours manqués d'une habitude restent des **trous**, sans événement ;
  - Q2 : le filtre (lot CO4) se fait **maintenant**, habitudes visibles par défaut ;
  - Q3 : hors périmètre, noté dans les suites (§7 R7).
- **Ajouts au lot CO1** :
  - A1 : le libellé « Journée » devient « Toute la journée » ;
  - A2 : les en-têtes de jour de l'Agenda prennent le fond de l'en-tête de carte, selon la teinte et le thème.

---

## 1. Décisions (texte de référence)

### Tâches répétées
- **O1 Stockage (constat, rien à changer)**. La répétition est `todos.rrule` (V6), sous-ensemble daté (`FREQ`, `INTERVAL`, `BYMONTHDAY=-1`), ancré sur la `due_on` **courante**. Cocher avance `due_on` (`shiftRepeatDue`), sans `completed_at` ni historique. Aucune migration.
- **O2 Expansion par le moteur Rust existant**. `RECURRENCE_ENGINE.expand` avec une ancre **datée** (`{ kind: 'date', startOn: dueOn }`), donc la commande `time_expand`, déjà autorisée. Aucune nouvelle commande ni permission.
  - Itérer `nextOccurrenceAfter` en TS est écarté : l'exception de l'ADR-003 §3.9 exclut l'expansion de plage.
  - Repli si PV-CO2 dépasse 300 ms : une commande groupée `time_expand_many`, après amendement.
- **O3 Occurrences montrées**.
  - L'**échéance courante**, comme aujourd'hui (en retard si elle est passée).
  - Les occurrences projetées **strictement après max(dueOn, aujourd'hui)** (§3.1). En retard, les périodes intermédiaires ne sont pas montrées : la coche les sautera.
  - Aucune occurrence passée. Rien pour une tâche terminée.
  - Si la règle est hors sous-ensemble (`parseDateRule` renvoie `null`) : l'échéance seule.
- **O4 Identifiants**. Toute occurrence d'une tâche répétée, échéance courante comprise, a `occurrenceKey` = sa date et l'`id` `todo:<id>:<YYYY-MM-DD>`. Une tâche non répétée garde `todo:<id>:` (clé `null`).
- **O5 Statut explicite**. `CalendarEvent` reçoit un champ optionnel `status?: 'overdue' | 'projected' | 'done' | 'planned'` (amendement ADR-004 §3.2.1). Les mentions « en retard », « répétition prévue », « fait » et « à faire » lisent le statut, jamais le ton.
- **O6 Rendu d'une projection**. Ton `neutral`, statut `projected`.
  - Agenda : titre en `text-fg-muted`.
  - Mois : `border-dashed`.
  - Fiche : en lecture seule, avec la ligne « Répétition prévue : elle deviendra l'échéance quand la précédente sera cochée. »
- **O7 Limites**.
  - Au plus 62 occurrences par tâche (`limit` = `MAX_CALENDAR_RANGE_DAYS`).
  - Au plus 1000 tâches répétées lues, 8 expansions en parallèle.
  - L'appel IPC est sauté quand aucune projection ne peut tomber dans la plage.
  - Un échec d'expansion laisse l'échéance seule.

### Ordre (amendé)
- **O8 (amendée par Marius)**. Ordre de l'agrégateur, repris par le Mois :
  1. **par jour** : jour du début dans le fuseau d'affichage ;
  2. dans un jour, **d'abord tous les événements « toute la journée »** (tâches, habitudes sans heure, tout élément sans heure), dans l'ordre stable : registre, puis ordre rendu par la source ;
  3. **puis les événements à heure**, par heure de début, toutes sources mêlées (rappels, habitudes à heure).
  - Aucun traitement spécial pour les habitudes.
  - La coupe à 2000 a lieu après ce tri : elle garde les premiers jours, toutes sources confondues.
  - Aujourd'hui, l'agrégateur place **tous** les `all-day` avant **tous** les `timed` (V11). Avec des centaines d'événements d'habitude, la coupe supprimerait d'abord les rappels ; le tri par jour corrige cela.
  - Conséquence de l'ordre du registre (V19) : dans un jour, les habitudes sans heure précèdent les tâches.

### Habitudes
- **O9 Jours montrés** (habitudes non archivées, à partir de `startOn`) :
  | Cas | Événement | Ton | Statut |
  |---|---|---|---|
  | Jour coché (prévu ou « bonus », H2) | oui | `success` | `done` |
  | Forme `days`, jour prévu ≥ aujourd'hui, non coché | oui | `neutral` | `planned` (« à faire ») |
  | Forme `days`, jour prévu passé non coché (manqué) | **non**, un trou (Q1) | — | — |
  | Forme `weekly` (N fois par semaine), jour non coché | non (aucun jour fixe) | — | — |
  | Avant `startOn` (coche comprise) | non | — | — |
- **O10 (amendée par Marius) : habitude à l'heure de son rappel**.
  - **Quand** : l'habitude a un rappel lisible, soit `habit.reminder !== null` et `habit.reminder.status !== 'invalid'`. Chacun de ses événements (fait ou à faire) devient `timed` à l'heure murale `reminder.time`, **dans le fuseau du rappel** `reminder.timeZone`.
  - **Pourquoi ce fuseau** : c'est le modèle (habits D4, ADR-003 D1), et c'est l'heure à laquelle le rappel sonne. Cas courant : il est égal au fuseau de l'utilisateur.
  - **Rappel désactivé** (`enabled: false`, par exemple après restauration) : il garde son heure, donc l'événement reste à heure.
  - **Sinon** (pas de rappel, ou rappel `invalid`) : événement `all-day`.
  - **Calcul** : instant = `resolveLocal(\`${d}T${time}:00\`, reminder.timeZone)`, de `core/time`, en désambiguïsation `compatible`. C'est la même règle que le Rust `resolve_local`, donc l'instant où le rappel sonne (ADR-003 §3.3, D3). Aucun calcul manuel.
    - heure inexistante (trou) : décalée vers l'avant ;
    - heure doublée (pli) : la première occurrence.
  - **Événement** : `time: { kind: 'timed', start, end: null, timeZone: reminder.timeZone }`. La fiche affiche « (20:00 Paris) » si ce fuseau diffère de celui d'affichage (mécanisme existant).
  - **Jours du rappel** : l'heure s'applique à tous les jours retenus par O9, que le rappel sonne ce jour-là ou non (`reminder.days` peut différer des jours de l'habitude). C'est l'heure de l'habitude, pas une sonnerie.
  - **Pas de doublon** : le rappel d'une habitude n'est pas une source à part. `reminder_list` l'exclut (H6), donc la source Rappels ne le montre pas.
- **O11 Archivées exclues**. Il n'existe pas d'état « en pause ».
- **O12 Lecture et rafraîchissement**.
  - Lecture par `HABIT_REPOSITORY` : `list()` et `checks({ from: firstOn, to: lastOn })`, en parallèle. Pas par `HabitStore`.
  - `HabitStore` prévient `CalendarChanges` après chaque succès de `create`, `update`, `setArchived`, `remove` et `setCheck`.
  - Volume au pire : 100 × 62 = 6 200 événements, absorbés par la coupe par jour.

### Filtre
- **O13 Réglage « Sources affichées » par widget Calendrier (lot CO4, maintenant)**.
  - Configuration v2 `hiddenSources`, défaut `[]` : tout est visible.
  - Un panneau dans la carte, avec un interrupteur par source.
  - Une source masquée n'est ni chargée ni comptée dans la coupe.

### Ajouts au lot CO1
- **A1 Libellé** : `widgets.calendar.allDay` devient « Toute la journée ». La colonne d'heure de l'Agenda est élargie pour le tenir sur une ligne (§3.3).
- **A2 En-têtes de jour** : ils prennent le fond, la couleur secondaire et la bordure de l'**en-tête de carte**, par les créneaux `--hb-card-header-*` (§3.3), sans couleur brute. Le contraste est vérifié par `check-contrast` (CA-CO1-9).

**Budget** : les sources restent paresseuses (`loadCalendarSource`). Le chargement initial ne gagne que la ligne `loadCalendarSource` de `habits.definition.ts` et une règle CSS (CA-CO3-7).

---

## 2. Faits vérifiés (code de `main`, 2026-11-21) et suppositions

| # | Fait | Source |
|---|---|---|
| V1 | `todos.rrule` : `NULL` ou 10 à 256 caractères `FREQ=*`, avec `due_on IS NOT NULL` | `migrations/V6__todo_details.sql` l. 12-14 |
| V2 | `parseDateRule` (sous-ensemble canonique, sinon `null`) ; `nextRepeatDue(dueOn, rule, today)` = `nextOccurrenceAfter(dueOn, rule, max(dueOn, today))` ; `date-rule.ts` n'est pas réexporté | `core/time/date-rule.ts` l. 8-9, 41-51, 118-146 |
| V3 | `checkAction` : `advance` ou `complete` (pose `completed_at`, la règle reste) | `widgets/todo/todo-repeat.ts` l. 13-21 ; `todo.component.ts` l. 199-218 |
| V4 | `shiftRepeatDue` : comparer-et-écrire de `due_on` | `data/sqlite/sqlite-todo.repository.ts` l. 198-216 |
| V5 | `ScheduleAnchor` `{ kind: 'date', startOn }` ; `Occurrence` `{ kind: 'date', key, date }` | `core/time/recurrence-engine.ts` l. 16-38 |
| V6 | `time_expand` (async) accepte `AnchorDto::Date` et renvoie `OccurrenceDto::Date` ; `allow-time-expand` déjà accordée | `src/time/commands.rs` l. 17-58, 138-197 ; `capabilities/default.json` l. 23 |
| V7 | Le moteur Rust est vérifié contre les vecteurs `dateNext`, les mêmes que `nextOccurrenceAfter` en TS | `src/time/recurrence/tests.rs` l. 172-191 ; `core/time/vectors.spec.ts` l. 43 ; `time-vectors.json` (14 ancres datées) |
| V8 | La source TODO émet un `all-day` par tâche active échue, clé `null`, `danger` si en retard | `widgets/todo/todo.calendar-source.ts` l. 20-41 |
| V9 | `listDue` : `completed_at IS NULL AND due_on BETWEEN`, tri `due_on, sort_order, id`, limite 1..1000 ; seule utilisatrice : la source TODO | `sqlite-todo.repository.ts` l. 30, 55-58, 267-289 |
| V10 | `FakeRecurrenceEngine.expand` renvoie les mêmes `occurrences` pour tout appel | `core/time/testing/fake-recurrence-engine.ts` l. 24-31 |
| V11 | `compareEvents` place tous les `all-day` avant tous les `timed`, puis par `startOn` / `start` ; tri stable ; coupe à 2000 après le tri | `core/calendar/calendar-aggregator.ts` l. 35-46, 110-117 |
| V12 | « en retard » est déduit de `tone === 'danger'` ; la fiche affiche « Occurrence d'un rappel répété » pour toute clé ; `KNOWN_SOURCES = ['reminders', 'todo']` | `widgets/calendar/calendar-label.ts` l. 25, 79 ; `calendar-day-list.component.ts` l. 66 ; `calendar-event-detail.component.ts` l. 57-58 |
| V13 | `toEventInputs` : `id`, `title`, `className` du ton ; aucun `eventOrder` dans les options du Mois | `widgets/calendar/calendar-month-options.ts` l. 22-36, 57-94 |
| V14 | `habits.definition.ts` n'a pas de `loadCalendarSource` | fichier |
| V15 | `HabitRepository.list()` inclut les habitudes archivées ; `checks({ from, to })` appelle `habit_checks` | `data/repositories.ts` l. 256-267 ; `data/tauri/tauri-habit.repository.ts` l. 34-36, 71-73 |
| V16 | `habit_checks` : `from ≤ to`, écart < 400 jours, pas de borne vers le futur | `src/schedule/habit_commands.rs` l. 610-642 |
| V17 | `HabitStore` n'importe pas `CalendarChanges` ; il écrit par `act` (l. 202-214) et `setCheck` (l. 166-185) | `core/habits/habit.store.ts` |
| V18 | `isExpected` répond `true` pour tout jour d'une habitude `weekly` | `core/habits/habit-stats.ts` l. 63-71 |
| V19 | Ordre du registre : `calendar`, `habits`, …, `reminders`, …, `todo` | `widgets/widgets.providers.ts` l. 18-28 |
| V20 | Config du calendrier en v1 ; les migrations sont indexées par la version de départ | `widgets/calendar/calendar.config.ts` ; `core/widgets/widget-config.ts` l. 92-94 |
| V21 | `invokeCommand` rejette avec `unavailable` hors Tauri | `data/tauri/invoke-command.ts` l. 34-37 |
| V22 | La classe `.switch` existe | `core/theme/components.css` l. 128-166 |
| V23 | FullCalendar `eventOrder` accepte une chaîne, un tableau ou une fonction ; un champ peut être « a non-standard field ». Défaut : `"start,-duration,allDay,title"`. `eventOrderStrict: true` empêche le réordonnancement destiné à compacter | https://fullcalendar.io/docs/eventOrder (consulté le 2026-11-21) |
| V24 | **Heure de rappel d'une habitude.** Pas de colonne dans `habits` : le rappel est une ligne de `reminders` possédée par l'habitude (`reminders.habit_id`, V8, un au plus), avec ancre `start_local` + `time_zone` et règle `FREQ=DAILY` ou `FREQ=WEEKLY;BYDAY=…`. Le front la reçoit dans `Habit.reminder: HabitReminder \| null` : `time: string` (`HH:MM`), `days`, `timeZone`, `enabled`, `status`. Rust dérive `time` de `start_local`. Une ligne illisible donne `status: 'invalid'` et `time: '00:00'` : ne **jamais** utiliser le `time` d'un rappel `invalid` | `migrations/V8__habits.sql` (`ALTER TABLE reminders ADD COLUMN habit_id`) ; `data/models.ts` l. 253-281 ; `src/schedule/habit_commands.rs` l. 129-158 ; habits.md D4 |
| V25 | `resolveLocal(local, timeZone)` = `toZonedDateTime(zone, { disambiguation: 'compatible' })` ; lève `TimeError` si le fuseau est inconnu | `core/time/zoned.ts` l. 46-51 |
| V26 | **En-tête de carte.** `.box-header` a pour fond `var(--hb-bg-subtle)`. Le thème de carte déclare les créneaux `--hb-card-header-bg` (défaut `--hb-bg-subtle`), `--hb-card-header-muted` et `--hb-card-header-border`. `.card-theme .box-header` les recopie dans `--hb-bg-subtle`, `--hb-fg-muted` et `--hb-border`. Le tableau pose `--hb-card-header-*` = `var(--hb-tint-<id>-header \| -muted \| -border)`. Dans le corps (`.card-theme .box`), `--hb-bg-subtle` n'est **pas** redéfini : l'en-tête de jour (`bg-canvas-subtle`) reste gris dans une carte teintée | `core/theme/components.css` l. 183-193, 216-241 ; `core/dashboard/dashboard-theme.ts` l. 84-104 ; DESIGN §4 l. 90 |
| V27 | `check-contrast.mjs` vérifie, par teinte et dans les deux thèmes, `fg` et `tint-*-muted` sur `tint-*-header` (texte 4,5:1) et `focus` sur l'en-tête (3:1). Il ne vérifie **ni** `accent` **ni** `on-tint-accent` sur `tint-*-header` | `apps/web/scripts/check-contrast.mjs` l. 24-60 |
| V28 | Colonne d'heure de l'Agenda : `w-12 shrink-0 text-xs tabular-nums` (3rem), texte « Journée » ; empilement sous 14rem (`@max-[14rem]:flex-col`) ; `allDay` n'est utilisé que là | `widgets/calendar/calendar-day-list.component.html` l. 48-58 ; `calendar-day-list.component.ts` l. 89-94 |

| # | Supposition | Vérifiée par |
|---|---|---|
| P1 | En v7, un champ non standard `rank` d'un `EventInput`, avec `eventOrder: 'rank'` et `eventOrderStrict: true`, impose notre ordre dans une cellule de `daygrid`. **Non bloquant** : l'ordre par défaut (V23) respecte déjà « journée avant heure, puis heure ». `rank` ne sert qu'à garder l'ordre stable des « toute la journée », sinon triés par titre | CA-CO1-6. Sinon, forme fonction `(a, b) => a.extendedProps.rank - b.extendedProps.rank` ; si elle échoue aussi, retirer `eventOrder` (ordre par défaut) et le rapporter |
| P2 | 30 tâches répétées quotidiennes, 100 rappels et 20 habitudes sur 42 jours : `listEvents` en moins de 300 ms | PV-CO2, PV-CO3 |
| P3 | 7rem (`w-28`) suffisent à afficher « Toute la journée » en `text-xs` avec la police de l'application | MO9 ; sinon élargir et le rapporter |

---

## 3. Conception

### 3.1 Pourquoi la projection depuis `dueOn` est juste (O3)
Soit D0 = `dueOn` et A = max(D0, aujourd'hui). Cocher à temps donne D1 = `nextOccurrenceAfter(D0, r, A)`, puis D2 = `nextOccurrenceAfter(D1, r, D1)`, etc. Dans le sous-ensemble, la série ancrée sur D1 est la queue de celle ancrée sur D0 :
- pas constant (`DAILY`, `WEEKLY`) ;
- même jour du mois, mois sans ce jour sautés des deux côtés (`MONTHLY`, `YEARLY`, D2) ;
- dernier jour du mois (`BYMONTHDAY=-1`).
Les occurrences de D0 après A sont donc exactement D1, D2, … Rust et TS sont tenus d'accord par les vecteurs `dateNext` (V7).

### 3.2 `core/calendar` (lot CO1 ; `exclude` au lot CO4)
```ts
// calendar-source.ts (amendment ADR-004 3.2.1: optional field, nothing existing changes)
export type CalendarEventStatus = 'overdue' | 'projected' | 'done' | 'planned';
export const CALENDAR_STATUSES: readonly CalendarEventStatus[] = ['overdue', 'projected', 'done', 'planned'];
export interface CalendarEvent {
  // ...unchanged
  /** Absent: an ordinary event. Drives the wording ("en retard", "fait"...), never the tone alone. */
  readonly status?: CalendarEventStatus;
}
```
- **Intégrité** : un `status` présent mais inconnu est écarté (`'status'`, journal en développement).
- **Tri** (`compareEvents`, O8 amendée), avec des clés calculées une fois par événement (tri décoré) :
  1. `day` : `startOn` (`all-day`) ou `toLocalDate(start, range.timeZone)` (`timed`) ;
  2. `all-day` avant `timed` ;
  3. pour `timed`, `start` (chaîne d'instant) ; pour `all-day`, **aucune autre clé** : à égalité, l'ordre de fusion (registre, puis source) est gardé.
  Le tri reste stable ; la coupe à 2000 se fait toujours après.
- **CO4** : `listEvents(range, options?: { readonly exclude?: readonly string[] })`.
  - Une source exclue n'est ni chargée ni appelée ; elle n'apparaît pas dans `failedSources`.
  - Clé de partage en vol : `from|to|timeZone|<exclude trié, joint par ','>`.
  - Un type inconnu est ignoré.

### 3.3 Vue `widgets/calendar` (lot CO1)
- **`calendar-label.ts`**
  - `KNOWN_SOURCES` gagne `'habits'`.
  - `eventName` ajoute `, {{status}}` si un statut est présent (`eventNameStatus`) ; il ne lit plus le ton.
  - `recurringKey(event)` :
    - `reminders` avec une clé → `recurring` ;
    - `todo` avec une clé et un statut autre que `projected` → `recurringTodo` ;
    - sinon `null`.
- **`calendar-day-list.component.ts/.html`**
  - `overdue` = `status === 'overdue'`.
  - Statut `projected` : titre en `text-fg-muted`.
  - Statut `done` : `pi pi-check text-success` après le titre (`aria-hidden`).
  - **A1** : colonne d'heure `w-28 shrink-0 whitespace-nowrap text-xs text-fg-muted tabular-nums` (7rem au lieu de 3rem). Le seuil d'empilement passe de 14rem à **20rem** (`@max-[20rem]:flex-col @max-[20rem]:items-start @max-[20rem]:gap-0`), pour que le titre garde au moins environ 9rem côte à côte. Texte de `allDay` : « Toute la journée ».
  - **A2** : l'en-tête de jour `<h3>` garde ses classes (`sticky top-0 z-[1] … border-y border-default bg-canvas-subtle …`) et ajoute la classe de composant `box-subheader`.
- **`core/theme/components.css`** (A2) : étendre le sélecteur existant.
  ```css
  .card-theme .box-header,
  .card-theme .box-subheader {
    --hb-bg-subtle: var(--hb-card-header-bg);
    --hb-fg-muted: var(--hb-card-header-muted);
    --hb-border: var(--hb-card-header-border);
  }
  ```
  - `bg-canvas-subtle`, `text-fg-muted` (jours passés) et `border-default` de l'en-tête de jour suivent alors l'en-tête de carte, teinte et thème compris.
  - Sans teinte, les créneaux valent leurs défauts (`--hb-bg-subtle`, etc.) : le rendu ne change pas.
  - Aucun hexadécimal. `box-subheader` est à documenter dans DESIGN §5 (§8).
- **Contraste (A2)**. `fg` et `fg-muted` sur l'en-tête sont déjà vérifiés (V27). Restent la pastille « Aujourd'hui » et le texte de l'en-tête du jour, en `text-accent`. Dans le corps, `accent` vaut `--hb-card-body-accent`, soit `--hb-accent`, soit `--hb-on-tint-accent` si le corps est teinté.
  - Ajouter à `tintPairs` de `check-contrast.mjs` : `['accent', \`tint-${t}-header\`, TEXT]` et `['on-tint-accent', \`tint-${t}-header\`, TEXT]`.
  - Si une paire échoue, ne toucher à aucun token et appliquer ce repli :
    - l'en-tête d'aujourd'hui garde `text-fg` au lieu de `text-accent` ;
    - la pastille passe en `border-accent text-fg` ;
    - ajouter `['accent', …header, GRAPHIC]` et `['on-tint-accent', …header, GRAPHIC]` pour la bordure.
    Le rapporter.
- **`calendar-event-detail.component.ts/.html`**
  - Une ligne de statut si un statut est présent :
    - `overdue` : la ligne existante ;
    - `projected` : `projectedLabel`, en `text-fg-muted` ;
    - `done` : `pi pi-check` + « Fait », en `text-success` ;
    - `planned` : « À faire », en `text-fg-muted`.
  - La ligne « répétée » suit `recurringKey`.
- **`calendar-month-options.ts`**
  - `toEventInputs` ajoute `rank: index` (index dans l'ordre de l'agrégateur) et `border-dashed` au `className` d'un événement `projected`.
  - Options `eventOrder: 'rank'` et `eventOrderStrict: true` (P1, repli au §2).
- **`testing/calendar-fixtures.ts`**
  - F4 reçoit `status: 'overdue'`.
  - Nouvelles fixtures :
    - F12 : tâche `projected`, `all-day` 2026-11-25, `neutral` ;
    - F13 : habitude `done`, `all-day` 2026-11-18, `success` ;
    - F14 : habitude `planned`, `all-day` 2026-11-20, `neutral` ;
    - F15 : habitude `planned`, `timed` `2026-11-20T07:00:00.000Z` (08:00 à Paris), `Europe/Paris` ;
    - F16 : tâche `all-day` 2026-11-20, titre « A » ;
    - F17 : rappel `timed` `2026-11-20T08:00:00.000Z` (09:00 à Paris).

### 3.4 Tâches (lot CO2)
**`data/`** : nouvelle méthode, sans migration.
```ts
/**
 * Active repeating todos (completed_at IS NULL AND rrule IS NOT NULL) whose due_on <= toOn, across
 * all lists, ordered by due_on, sort_order, id. toOn YYYY-MM-DD, limit an integer 1..1000:
 * invalid_input before any query.
 */
listRepeatingDueBy(toOn: LocalDateIso, limit: number): Promise<Todo[]>;
```
- SQL dans `sqlite-todo.repository.ts` seulement, à paramètres liés, avec le même mappeur que `listDue` :
  `SELECT ${TODO_COLUMNS} FROM todos WHERE completed_at IS NULL AND rrule IS NOT NULL AND due_on IS NOT NULL AND due_on <= $1 ORDER BY due_on, sort_order, id LIMIT $2`.
- Même sémantique dans `core/testing/fake-todo.repository.ts`.

**`widgets/todo/todo-calendar.ts`** (fonctions pures) :
```ts
/** Rule of the subset, or null (non-repeating, completed, no due date, or rule outside parseDateRule). */
export function repeatRule(todo: Todo): DateRule | null;
/** Current-due event: id todo:<id>:<dueOn> when repeatRule != null, else todo:<id>: (key null);
 *  tone danger + status 'overdue' when dueOn < today, else neutral and no status. */
export function dueEvent(todo: Todo, today: LocalDateIso): CalendarEvent;
/** max(dueOn, today): projections are strictly after it. */
export function projectionFloor(todo: Todo, today: LocalDateIso): LocalDateIso;
/** Events for the dates strictly after the floor: tone neutral, status 'projected', key = date. */
export function projectedEvents(todo: Todo, dates: readonly LocalDateIso[], today: LocalDateIso): CalendarEvent[];
```

**`todo.calendar-source.ts`** :
1. `rangeLocalDates`, puis en parallèle `listDue({ firstOn, lastOn }, 1000)` et `listRepeatingDueBy(lastOn, 1000)`. Un rejet rejette la source.
2. `dueEvent` pour chaque tâche de `listDue`.
3. Pour chaque tâche répétée avec `repeatRule ≠ null` et `projectionFloor < lastOn` : `mapLimited(…, 8, …)` sur `engine.expand({ anchor: { kind: 'date', startOn: dueOn }, rrule, exdates: [] }, { from, to, timeZone, limit: MAX_CALENDAR_RANGE_DAYS })`. On garde les occurrences `date`, puis on appelle `projectedEvents`. Un rejet ne saute que cette tâche (journal : id).
4. Renvoyer les échéances courantes, puis les projections.

**`core/time/testing/fake-recurrence-engine.ts`** : ajouter `respond?: (spec, range) => { occurrences; truncated }`, prioritaire sur les champs actuels.

### 3.5 Habitudes (lot CO3)
**`widgets/habits/habit-calendar.ts`** (fonction pure) :
```ts
export function habitEvents(
  habits: readonly Habit[],
  checks: readonly HabitCheck[],
  range: CalendarRange,
  days: { readonly firstOn: LocalDateIso; readonly lastOn: LocalDateIso },
  today: LocalDateIso,
): CalendarEvent[];
```
- **Jours et statuts** : pour chaque habitude non archivée (dans l'ordre reçu) et chaque jour d de [max(firstOn, startOn), lastOn], appliquer les règles d'O9 (événement, ton, statut).
  - Jour prévu d'une forme `days` : `schedule.days.includes(weekdayCode(d))`.
  - Jamais `isExpected` pour `weekly` (V18).
- **Heure (O10)** : `habitTime(habit)` renvoie `{ time, timeZone }` si `reminder !== null && reminder.status !== 'invalid'`, sinon `null`.
  - Si une heure existe : `start = resolveLocal(\`${d}T${time}:00\`, timeZone)`, puis `time: { kind: 'timed', start, end: null, timeZone }`.
  - L'événement n'est émis que si `start ∈ [range.from, range.to)` (contrat `CalendarSource`).
  - Si `resolveLocal` lève (fuseau illisible) : `all-day` pour cette habitude, journal en développement (id).
- **Identité** : `id` `habits:<habitId>:<d>`, `sourceType: 'habits'`, `occurrenceKey: d` (le jour, à heure ou non), `title`.
- **Imports** :
  - `core/habits/habit-stats` par son chemin direct, pas le barrel `core/habits` ;
  - `resolveLocal` depuis `core/time`.

**`widgets/habits/habits.calendar-source.ts`** : `@Injectable({ providedIn: 'root' }) HabitsCalendarSource`. Il appelle `rangeLocalDates`, puis `Promise.all([repo.list(), repo.checks({ from: firstOn, to: lastOn })])`, puis `habitEvents(…, range, …, today.date())`. Un rejet rejette la source.

**`habits.definition.ts`** : `loadCalendarSource: () => import('./habits.calendar-source').then((m) => m.HabitsCalendarSource)`.

**`core/habits/habit.store.ts`** :
- `inject(CalendarChanges)` par le chemin direct ;
- `notify('habits')` après le succès de l'action dans `act`, et après le succès de `repository.setCheck` ;
- jamais après un échec ni une relecture ;
- changer l'heure du rappel passe par `update`, donc prévient aussi.

### 3.6 Filtre (lot CO4)
- **`calendar.config.ts`** : version 2.
  - `hiddenSources: v.pipe(v.array(v.pipe(v.string(), v.regex(WIDGET_TYPE_ID_PATTERN))), v.maxLength(16))`, défaut `[]`.
  - Migration `{ 1: (prev) => isPlainObject(prev) ? { ...prev, hiddenSources: [] } : prev }`.
  - Doublons retirés à l'écriture.
- **`CalendarComponent`**
  - Signal `hiddenChoice`, gardé en mémoire.
  - L'effet de chargement le lit et recharge à **0 ms** quand il change.
  - `save` écrit `{ view, agendaDays, hiddenSources }`. En cas d'échec : `configNotSaved`, le choix est gardé.
- **`CalendarLoader.request(range, delayMs, exclude)`** transmet l'exclusion à l'agrégateur.
- **Barre d'outils**
  - Bouton `btn btn-invisible btn-icon btn-compact`, `pi pi-filter`, toujours visible.
  - Nom : `sources`, ou `sourcesActive` avec `text-accent` si au moins une source est masquée.
  - `aria-expanded` reflète l'état du panneau.
- **`calendar-sources-panel.component.ts/.html`**
  - Même mécanique que le panneau Jour : recouvrement, zone du calendrier `inert`, « Retour », Échap, focus rendu au bouton filtre.
  - Titre « Sources affichées ».
  - Une ligne par définition qui a un `loadCalendarSource` : `<label>`, `<input type="checkbox" class="switch">` coché si la source est visible, icône `aria-hidden`, libellé `sourceName.<type>` (à défaut, le `titleKey`).
  - Si tout est masqué : `allHidden` au lieu de l'état vide.

### 3.7 Textes (`widgets.calendar.*`)
- **Modifiés** :
  - `allDay` : « Toute la journée » (A1) ;
  - `description` : « Rappels, tâches et habitudes, en agenda ou par mois » ;
  - `eventNameOverdue` est remplacé par `eventNameStatus` : « {{name}}, {{status}} ».
- **Ajoutés** :
  - statuts : `projected` « répétition prévue », `done` « fait », `planned` « à faire » ;
  - fiche : `projectedLabel` « Répétition prévue : elle deviendra l'échéance quand la précédente sera cochée. », `doneLabel` « Fait », `plannedLabel` « À faire », `recurringTodo` « Échéance d'une tâche répétée » ;
  - source : `source.habits` « Habitude » ;
  - lot CO4 : `sources` « Sources affichées », `sourcesActive` « Sources affichées (filtre actif) », `sourceName.reminders` « Rappels », `sourceName.todo` « Tâches », `sourceName.habits` « Habitudes », `allHidden` « Toutes les sources sont masquées. ».
- **Exemples de noms accessibles** :
  - « Tâche : Sortir les poubelles, mercredi 25 novembre 2026, toute la journée, répétition prévue » ;
  - « Habitude : Méditer, mercredi 18 novembre 2026, 20:00, fait » ;
  - « Habitude : Lire, vendredi 20 novembre 2026, toute la journée, à faire ».

### 3.8 Sécurité
- Aucune commande, permission, migration ni ligne Rust : le diff est vide sur `build.rs`, `capabilities/**`, `src/**` et `migrations/**`.
- Lectures à paramètres liés. Entrées bornées avant toute requête ou IPC : plage ≤ 62 jours, `limit` ≤ 62 ou ≤ 1000.
- Titres rendus par interpolation, ou en texte par FullCalendar.
- `hiddenSources` est borné et sert seulement à comparer avec les types du registre.
- Journaux : identifiants seulement. CSS : tokens seulement.

---

## 4. Cas limites

| # | Cas | Attendu |
|---|---|---|
| K1 | Changement d'heure, `all-day` | Sans effet (dates murales) |
| K2 | Habitude à 02:30 `Europe/Paris` le 2027-03-28 (trou) | `start = 2027-03-28T01:30:00.000Z`, affiché 03:30 (`compatible`), comme le rappel qui sonne (ADR-003 C3) |
| K3 | Habitude à 02:30 `Europe/Paris` le 2026-10-25 (pli) | Un seul événement, `2026-10-25T00:30:00.000Z` (première occurrence, C1) |
| K4 | Habitude à 09:00 autour du 25/10 | `07:00Z` le 24, `08:00Z` le 25 (C5) ; affiché 09:00 les deux jours |
| K5 | Rappel d'habitude en `Europe/Paris`, utilisateur en `America/Santiago` | Événement à 20:00 Paris, affiché 16:00, avec « (20:00 Paris) » dans la fiche. Quand le fuseau du rappel diffère de celui d'affichage, les jours [firstOn−1, lastOn+1] sont parcourus (coches lues sur cette étendue élargie) et seuls les instants dans `[from, to)` sont gardés : le cas des bords de plage est couvert |
| K6 | Rappel d'habitude `invalid` (`time: '00:00'` factice) ; rappel désactivé | `all-day` ; à heure (O10) |
| K7 | Minuit inexistant (`America/Santiago`, 2026-09-06) | `rangeLocalDates` inclut le 06 (C23) |
| K8 | Fin de mois : `MONTHLY` ancrée le 31/01/2027 ; `BYMONTHDAY=-1` ancrée le 31/01/2028 ; `YEARLY` ancrée le 29/02/2028 | 31/03, 31/05… ; 29/02/2028, 31/03/2028 (C8) ; rien avant 2032 (C9) |
| K9 | Règle hors sous-ensemble ou illisible | Échéance seule, clé `null`, aucun `expand` |
| K10 | `expand` rejette (`expansion_limit`, `invalid_rule`) | Échéance seule, le reste intact |
| K11 | max(`dueOn`, aujourd'hui) ≥ `lastOn` ; `dueOn` > `lastOn` | Aucun `expand` ; tâche non lue |
| K12 | Tâche quotidienne en retard de 10 jours | Une ligne en retard à son échéance, puis une par jour à partir de demain |
| K13 | Cocher l'échéance courante alors que la fiche est ouverte sur la projection D | D devient courante sous le même `id` ; la fiche la suit et perd « répétition prévue » ; « Annuler » rétablit |
| K14 | Tâche répétée terminée ; règle retirée | Rien ; `todo:<id>:` |
| K15 | Changement de fuseau, passage de minuit | Dates inchangées ; plancher, `planned` / `done` et instants des habitudes recalculés au rechargement |
| K16 | Habitude : coche avant `startOn` ; coche « bonus » ; forme `weekly` | Ignorée ; `done` ; jours cochés seulement |
| K17 | Habitude archivée, restaurée, supprimée ; heure du rappel changée | Absente ; présente ; absente ; nouvelle heure (prévenu par `update`) |
| K18 | Ordre le 20/11 : tâche F16, habitude sans heure F14, habitude à 08:00 F15, rappel à 09:00 F17 | Agenda et panneau Jour : F14 puis F16 (toute la journée, registre puis source), puis F15 (08:00), puis F17 (09:00) |
| K19 | 100 habitudes quotidiennes sur 42 jours | Coupe par jour, premiers jours complets, bandeau `truncated` |
| K20 | Hors Tauri | `unavailable`, bandeau `common.desktopOnly` |
| K21 | Doublons | Impossibles par construction ; filet par `id` |
| K22 | Deux widgets Calendrier avec des filtres différents ; toutes les sources masquées ; type inconnu dans le filtre | Clés de partage distinctes ; `allHidden` ; type ignoré |
| K23 | Carte teintée (corps et en-tête différents), en clair et en sombre | En-tête de jour = fond et bordure de l'en-tête de carte ; texte lisible (CA-CO1-9) |
| K24 | Hors ligne, synchronisation | Sans objet |

---

## 5. Lots

Ordre : CO1 → CO2 → CO3 → CO4. Pour chaque lot, depuis `F:/Marius/Projects/homebase-calendar` : `npm run format:check`, `npm run lint`, `npm run test`, `npm run rust:fmt:check`, `npm run rust:lint`, `npm run rust:test`, tous verts ; puis revue `reviewer`. Un lot bloqué s'arrête et rapporte.

### Lot CO1 : statut, ordre, rendu, libellé, en-têtes de jour
Fichiers :
- `core/calendar/{calendar-source,calendar-aggregator}.ts` (+ spec) ;
- `widgets/calendar/{calendar-label,calendar-day-list.component,calendar-event-detail.component,calendar-month-options}.ts` et leurs `.html` (+ specs) ;
- `widgets/calendar/testing/calendar-fixtures.ts` ;
- `widgets/todo/todo.calendar-source.ts` (+ spec : `status: 'overdue'`) ;
- `core/theme/components.css`, `apps/web/scripts/check-contrast.mjs` ;
- `core/i18n/fr.json`.

Critères :
- **CA-CO1-1** Intégrité : un `status` inconnu est écarté ; un `status` absent est accepté.
- **CA-CO1-2 (O8)** `calendar-aggregator.spec.ts` :
  - un `timed` du 18 passe avant un `all-day` du 19 ;
  - le 20, avec F14, F15, F16 et F17 venant de sources prises dans l'ordre du registre : tous les `all-day` dans l'ordre registre puis source, puis F15 (07:00Z), puis F17 (08:00Z) ;
  - deux `timed` de sources différentes sont triés par heure ;
  - aucune règle ne dépend du statut ni de `sourceType` : `rg -n "habits|status" core/calendar/calendar-aggregator.ts` ne trouve que la règle d'intégrité ;
  - avec 1 500 `all-day` le 19 et 600 `timed` le 18 : les 600 `timed` sont gardés, `truncated` vaut vrai.
- **CA-CO1-3** `eventName` : chaque statut donne son suffixe. Un `tone: 'danger'` sans statut ne dit plus « en retard ».
- **CA-CO1-4** Agenda :
  - F4 : icône et « en retard » ;
  - F12 : titre en `text-fg-muted` ;
  - F13 : `pi pi-check` en `text-success` ;
  - ordre de K18 sous le 20/11.
- **CA-CO1-5** Fiche :
  - F12 : `projectedLabel` ;
  - F13 : « Fait » ; F14 : « À faire » ; F15 : « à 08:00 » ;
  - rappel répété : `recurring` ; tâche répétée courante : `recurringTodo` ;
  - habitude : aucune ligne « répétée ».
- **CA-CO1-6 (O8, Mois)**
  - `toEventInputs` donne `rank` = index, et `border-dashed` pour F12.
  - Options : `eventOrder: 'rank'`, `eventOrderStrict: true`.
  - Rendu jsdom du 20/11 avec F14, F15, F16, F17 et un `maxEventsPerDay` grand : l'ordre des éléments de la cellule est F14, F16, F15, F17.
  - Deux `all-day` dont l'ordre d'agrégation est l'inverse de l'ordre alphabétique : l'ordre d'agrégation est gardé (P1 ; sinon repli du §2 et rapport).
  - CA-C2-5 et CA-C2-7 restent verts.
- **CA-CO1-7** `rg -n "tone === 'danger'" apps/web/src/app/widgets/calendar` : aucun résultat.
- **CA-CO1-8 (A1)**
  - `fr.json` : `widgets.calendar.allDay` = « Toute la journée ».
  - La cellule d'heure d'une ligne `all-day` contient exactement ce texte et porte `w-28` et `whitespace-nowrap` ; une ligne `timed` garde `/^\d{2}:\d{2}$/`.
  - Le bouton de ligne porte `@max-[20rem]:flex-col`.
  - CA-C2-4 est mis à jour en conséquence.
- **CA-CO1-9 (A2)**
  - Chaque `h3` d'en-tête de jour porte `box-subheader`, en plus de `bg-canvas-subtle` et `border-default`.
  - `components.css` contient `.card-theme .box-subheader` dans le même bloc que `.card-theme .box-header`.
  - `check-design-tokens` est vert.
  - `check-contrast.mjs` contient les paires `accent` et `on-tint-accent` sur `tint-${t}-header`, et `npm run test` est vert dans les deux thèmes. En cas d'échec, appliquer le repli du §3.3 et le rapporter, sans changer de token.

### Lot CO2 : tâches répétées
Fichiers :
- modifier `data/repositories.ts`, `data/sqlite/sqlite-todo.repository.ts` (+ spec), `core/testing/fake-todo.repository.ts`, `core/time/testing/fake-recurrence-engine.ts`, `widgets/todo/todo.calendar-source.ts` (+ spec), `core/calendar/calendar-debug.ts` ;
- créer `widgets/todo/todo-calendar.ts` (+ spec).

Critères :
- **CA-CO2-1** `test:data` (`listRepeatingDueBy`) :
  - exclut les tâches non répétées, terminées, et celles dont `due_on` > `toOn` ;
  - `toOn` inclus ; deux listes ; ordre `due_on, sort_order, id` ; limite respectée ;
  - `invalid_input` sans requête pour une date mal formée et pour une limite de 0, 1001 ou non entière.
- **CA-CO2-2** `ManualClock` au 2026-11-18 (mercredi), à Paris, Mois de novembre (`2026-10-26` → `2026-12-06`). Le faux moteur (`respond`) renvoie ce que donnerait Rust depuis l'ancre.
  | Tâche | Attendu |
  |---|---|
  | T1 `FREQ=WEEKLY`, échéance 18/11 | 18/11 (`todo:T1:2026-11-18`, `neutral`, sans statut), puis 25/11 et 02/12 `projected` |
  | T2 `FREQ=DAILY`, échéance 10/11 | 10/11 `danger` `overdue`, puis du 19/11 au 06/12 `projected` (18 événements) ; rien du 11 au 18 |
  | T3 `FREQ=MONTHLY;BYMONTHDAY=-1`, échéance 31/10 | 31/10 `overdue`, puis 30/11 `projected` |
  | T4 sans règle, échéance 20/11 | `todo:T4:`, clé `null`, aucun `expand` |
  | T5 `FREQ=WEEKLY;BYDAY=MO`, échéance 23/11 | clé `null`, aucun `expand` |
  | T6 `FREQ=WEEKLY`, échéance 06/12 | 06/12 seulement, aucun `expand` |
  | T7 `FREQ=DAILY`, échéance 01/11, `expand` rejette | 01/11 `overdue` seulement ; T1 à T3 intacts |
  - Appel `expand` exact : `{ anchor: { kind: 'date', startOn: dueOn }, rrule, exdates: [] }`, plage de l'agrégateur, `limit: 62`.
  - Au plus 8 appels en vol.
  - Appels `listDue(…, 1000)` et `listRepeatingDueBy(lastOn, 1000)`.
- **CA-CO2-3** Agrégateur réel avec la source TODO : aucun événement écarté.
- **CA-CO2-4** `git diff --stat main -- apps/desktop` : vide.
- **PV-CO2** (P2) `__hbCalendar.seedRepeatingTodos(30)` crée 30 tâches `FREQ=DAILY` dues aujourd'hui (`pv-co-<i>`) dans la liste du premier widget TODO du tableau courant ; s'il n'y en a pas, rejet.
  - Lancer `measure(42)` avec et sans les 100 rappels de PV-C1.
  - `clearSeeded()` retire aussi ces tâches.
  - Au-delà de 300 ms : s'arrêter (repli O2).

### Lot CO3 : habitudes
Fichiers :
- créer `widgets/habits/{habit-calendar,habits.calendar-source}.ts` (+ specs) ;
- modifier `widgets/habits/habits.definition.ts` (+ spec), `core/habits/habit.store.ts` (+ spec), `core/calendar/calendar-debug.ts`, `core/i18n/fr.json`.

Critères :
- **CA-CO3-1 (O9)** Aujourd'hui = 2026-11-18, jours du 2026-11-09 au 2026-11-24, habitudes sans rappel :
  | Habitude | Attendu |
  |---|---|
  | H1 `days` MO, WE, FR, début 01/11 ; cochés 13, 17 (bonus), 18 | `done` 13, 17, 18 ; `planned` 20, 23 ; rien les 9, 11, 16 |
  | H2 `weekly` 3 ; coché 17 | `done` 17 seulement |
  | H3 archivée, cochée 18 | rien |
  | H4 `days` tous, début 20/11 ; coché 19 | `planned` du 20 au 24 ; rien le 19 |
  - `id` `habits:<id>:<jour>`, clé = jour, `all-day` d'un jour ; tons et statuts d'O9.
- **CA-CO3-2 (O10)**
  - H1 avec un rappel `{ time: '20:00', timeZone: 'Europe/Paris', status: 'scheduled' }` : `timed`, le 18 à `start = 2026-11-18T19:00:00.000Z`, `timeZone: 'Europe/Paris'`, statut d'O9.
  - `enabled: false` : toujours à heure.
  - `status: 'invalid'` : `all-day`.
  - Rappel à 02:30 `Europe/Paris` : le 2027-03-28 donne `2027-03-28T01:30:00.000Z` (K2) ; le 2026-10-25 donne un seul événement, à `2026-10-25T00:30:00.000Z` (K3).
  - Fuseau inconnu (faux) : `all-day`, sans exception.
  - Un `start` hors de `[from, to)` n'est pas émis (K5 : rappel à Paris, plage en `Pacific/Kiritimati`).
  - `rg -n "Date\(|getTime|86400" widgets/habits/habit-calendar.ts` : aucun résultat.
- **CA-CO3-3** Source :
  - `checks({ from: firstOn, to: lastOn })` ;
  - `list` et `checks` en parallèle ;
  - le rejet de l'un rejette la source ; `unavailable` se propage.
- **CA-CO3-4** `HabitStore` : un succès de `create`, `update`, `setArchived`, `remove` ou `setCheck` incrémente `CalendarChanges.version` une fois ; un échec ou une relecture ne l'incrémente pas.
- **CA-CO3-5** `habits.definition.spec.ts` : `loadCalendarSource` résout `HabitsCalendarSource`.
- **CA-CO3-6** Noms accessibles : « Habitude : …, 20:00, fait » (à heure) et « Habitude : …, toute la journée, à faire ».
- **CA-CO3-7** `npm run web:build` :
  - JS initial ≤ celui mesuré avant CO1, + 0,3 kB ;
  - aucun fichier « Initial » ne contient `habit-calendar`, `HabitsCalendarSource` ni `todo-calendar` (`rg`) ;
  - budget inchangé ; s'il est dépassé, s'arrêter et rapporter.
- **CA-CO3-8** `habit-calendar.ts` n'importe pas le barrel `core/habits`.
- **PV-CO3** `__hbCalendar.seedHabits(20)` crée 20 habitudes quotidiennes `pv-co-<i>`, dont 10 avec un rappel à 20:00 et 10 cochées aujourd'hui.
  - Mesure manuelle (Marius) : `__hbCalendar.seedHabits(100)` puis `measure(42)`, puis `clearSeeded()`. Rapporter la durée et le nombre d'événements (100 × 42 = 4 200 au plus ; cible P2 : moins de 300 ms).
  - `clearSeeded()` les supprime.

### Lot CO4 : filtre des sources
Fichiers :
- modifier `widgets/calendar/{calendar.config,calendar.component,calendar-loader,calendar-toolbar.component}` (`.ts`, `.html`, + specs), `core/calendar/calendar-aggregator.ts` (+ spec), `core/i18n/fr.json` ;
- créer `widgets/calendar/calendar-sources-panel.component.{ts,html}` (+ spec).

Critères :
- **CA-CO4-1** Configuration :
  - une v1 `{ view: 'month', agendaDays: 7 }` migre avec `hiddenSources: []` ;
  - le schéma refuse 17 entrées et `'Habits!'` ;
  - les valeurs par défaut sont valides.
- **CA-CO4-2** Avec `exclude: ['habits']` :
  - le `loadCalendarSource` des habitudes n'est jamais appelé ;
  - `failedSources` ne la contient pas ;
  - un appel avec et un appel sans `exclude`, simultanés, donnent deux chargements.
- **CA-CO4-3** Composant :
  - décocher « Habitudes » recharge à 0 ms avec `exclude: ['habits']`, puis appelle `updateConfig` ;
  - un échec d'enregistrement affiche `configNotSaved` et garde le choix ;
  - le bouton porte `sourcesActive` et `text-accent` ;
  - tout masquer affiche `allHidden`.
- **CA-CO4-4** Panneau :
  - la zone du calendrier est `inert` ;
  - Échap et « Retour » rendent le focus au bouton filtre ;
  - chaque interrupteur a un nom accessible ;
  - aucun texte en dur.

---

## 6. Vérifications manuelles (Marius)
En `npm run dev`, puis sur l'exe de `npm run build` pour MO8.
- **MO1** Tâche hebdomadaire due aujourd'hui.
  - Le Mois montre aujourd'hui en trait plein, les semaines suivantes en pointillés.
  - La cocher : le calendrier avance sans rechargement ; « Annuler » rétablit.
- **MO2** Tâche quotidienne due il y a 5 jours : une seule ligne rouge à sa date, puis une par jour à partir de demain.
- **MO3** Tâche « dernier jour du mois » : 30/11, puis 31/12 et 31/01 en naviguant.
- **MO4** Trois habitudes : une quotidienne sans rappel, une « lun., mer., ven. » avec rappel à 20:00, une « 3 fois par semaine ».
  - Dans l'Agenda : la première affiche « Toute la journée » ; la deuxième est à 20:00, rangée parmi les rappels selon l'heure ; la « 3 fois » n'apparaît que les jours cochés.
  - Cocher dans le widget Habitudes : l'habitude passe en « fait » sans rechargement.
  - Passer le rappel à 07:00 : l'habitude se déplace.
- **MO5 (ordre)** Un même jour, une tâche, une habitude sans heure, une habitude à 08:00 et un rappel à 09:00.
  - Agenda et panneau Jour : d'abord les deux « toute la journée », puis 08:00, puis 09:00.
  - Le Mois suit le même ordre.
  - Juger le bruit à 6 × 5.
- **MO6 (CO4)**
  - Masquer « Habitudes » : elles disparaissent, le bouton passe en accent.
  - Après relance, le choix est gardé.
  - Un second widget Calendrier n'est pas affecté.
- **MO7** Clavier et Narrateur : « Tâche : …, répétition prévue » ; « Habitude : …, 20:00, fait ».
- **MO8** Exe release : aucune violation CSP ; ouverture du Mois comparable à avant.
- **MO9 (A1)** Agenda à 3 × 3, 6 × 5 et 12 × 8, en clair et en sombre.
  - « Toute la journée » tient sur une ligne, sans coupure (P3).
  - Sous 20rem, l'heure passe au-dessus du titre.
- **MO10 (A2)** Tableau avec teintes de carte (corps et en-tête différents, puis en-tête seul), en clair et en sombre.
  - Les bandes de date de l'Agenda ont le même fond que l'en-tête de la carte.
  - La date, « Aujourd'hui » et les jours passés restent lisibles.
  - Sans teinte, le rendu est inchangé.

---

## 7. Risques et suites
| Risque | Impact | Mitigation |
|---|---|---|
| R1. Bruit des habitudes quotidiennes ; habitudes sans heure avant les tâches dans un jour (ordre du registre, O8) | Lisibilité, « +N » dans le Mois | Manqués non montrés (Q1), habitudes à heure triées avec les rappels, filtre CO4, MO5 |
| R2. Un IPC `time_expand` par tâche répétée | Ouverture lente | IPC sauté si inutile, 8 en parallèle, PV-CO2 ; repli `time_expand_many` |
| R3. `eventOrder: 'rank'` non pris en compte par la v7 (P1) | « Toute la journée » triés par titre dans le Mois | Non bloquant (l'ordre par défaut place la journée avant les heures) ; forme fonction ; rapport |
| R4. Divergence entre la projection Rust et l'avance TS | Date prévue différente de l'échéance réelle | §3.1, vecteurs `dateNext` des deux côtés |
| R5. Coupe à 2000 atteinte plus tôt | Derniers jours absents | Coupe par jour, bandeau, filtre |
| R6. Projection prise pour une échéance réelle | Confusion | Statut, pointillés ou titre atténué, nom, fiche |
| R7. Une tâche en retard n'apparaissait pas dans un Agenda qui commence aujourd'hui | Retard non vu | **Traité** (amendement 2026-11-22 ci-dessous) |
| R8. Rappel d'habitude dans un autre fuseau que l'utilisateur | Jour affiché décalé, événement en bord de plage omis | Rare (déménagement) ; « (20:00 Paris) » dans la fiche ; approximation acceptée (habits L13) |
| R9. `text-accent` sur un en-tête teinté sous 4,5:1 | « Aujourd'hui » peu lisible | Paires ajoutées à `check-contrast` ; repli `text-fg` + `border-accent` |
| R10. Colonne d'heure de 7rem à 3 × 3 | Titre plus court | Empilement sous 20rem ; MO9 |

## Amendement 2026-11-22 : retards reportés sur aujourd'hui (R7)

Validé par Marius le 2026-11-22. Il remplace, pour une tâche en retard, l'affichage à la date d'origine.

1. **Report** : une tâche active (non terminée) dont `dueOn` est avant `Today` s'affiche sur aujourd'hui (« toute la journée », `startOn = lastOn = aujourd'hui`, `status: 'overdue'`, ton `danger`), qu'elle se répète ou non.
2. **Identifiant inchangé** : `occurrenceKey` = `dueOn` d'origine (tâche répétée) ou `null`. L'agrégateur ne relie pas `occurrenceKey` à `startOn` (il vérifie seulement `id = type:sourceId:clé`) : la fiche ouverte reste liée.
3. **Plage** : le report n'a lieu que si aujourd'hui est dans la plage demandée. Sinon la tâche n'apparaît nulle part, ni à sa date d'origine ni ailleurs.
4. **Lecture** : `TodoRepository.listOverdueBefore(beforeOn, limit)` (actives, `due_on < beforeOn`, ordre `due_on, sort_order, id`, limite 1..1000, `invalid_input` sinon), appelée seulement si aujourd'hui est dans la plage. Les tâches en retard renvoyées par `listDue` sont ignorées (la lecture des retards les couvre) ; dédoublonnage par `id`. Plage entièrement passée : aucune lecture. Aujourd'hui dans la plage : `listDue` démarre à aujourd'hui. Au-delà de 1000 retards, les plus récents sont perdus (journal en dev seulement, comme pour les autres limites ; pas de drapeau).
5. **Tâches répétées** : projections inchangées (dates strictement après max(échéance, aujourd'hui)) ; seule l'échéance courante est déplacée.
6. **Ordre sur aujourd'hui** : dans la source, les reportées d'abord (`dueOn` croissant, puis `sort_order`, `id`), puis les tâches dues aujourd'hui ; l'agrégateur garde l'ordre de la source parmi les « toute la journée ».
7. **Libellés** : champ optionnel générique `CalendarEvent.originalOn?: LocalDateIso` (date locale valide et strictement antérieure à `startOn`, vérifiée par l'agrégateur ; motif `original`). Fiche : « En retard depuis le {{date}} » (`widgets.calendar.overdueSince`, date `long`). Nom accessible : « …, toute la journée, en retard depuis le 10 novembre 2026 » (`widgets.calendar.status.overdueSince`).

---

## 8. Amendements proposés (après validation, hors de cette spec)
- **ADR-004** :
  - §0 : D5 (habitudes = source, O9 à O12) ; D6 (échéance et projections, O3).
  - §3.2.1 : champ `status` (O5).
  - §3.2.2 : tri par jour, puis « toute la journée » avant « à heure », puis heure (O8) ; option `exclude` (O13).
  - §3.2.3 : sources. Tâches : `listDue` + `listRepeatingDueBy` + `time_expand` à ancre datée. Habitudes : `habit_list` + `habit_checks`, à l'heure du rappel s'il existe.
  - §3.2.6 : `HabitStore` parmi les écrivains.
  - §7 L7 : la projection suivante devient l'échéance courante.
- **ADR-003 §3.9** : « l'affichage des occurrences d'une tâche répétée passe par `time_expand` (ancre datée) ; l'exception TS reste limitée à la prochaine échéance ».
- **ADR-001 §3.2** : `habits` implémente `loadCalendarSource`.
- **Spec calendar** : §1, retirer les habitudes et la projection du hors-périmètre ; §4.8, `allDay` devient « Toute la journée ».
- **Spec habits §1** : retirer « `CalendarSource` des habitudes » du hors-périmètre.
- **DESIGN** :
  - §3 Agenda : en-tête de jour `box-subheader` (fond, texte secondaire et bordure de l'en-tête de carte) ; projection d'une tâche répétée atténuée (Agenda) ou en pointillés (Mois) ; habitude faite : `pi pi-check` `text-success`.
  - §5 : ajouter `box-subheader` aux classes de composants.
- **ROADMAP** phase 2 : lots CO1, CO2, CO3 et CO4.

## 9. Sources
- Code de `main` (2026-11-21), chemins du §2.
- https://fullcalendar.io/docs/eventOrder (consulté le 2026-11-21).
