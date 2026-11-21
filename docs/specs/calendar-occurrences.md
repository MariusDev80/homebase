# Spec : Calendrier, occurrences des tâches répétées et habitudes

- **Statut** : proposée (2026-11-21), décisions O1 à O13 soumises à Marius (§0)
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§6), branche `phase-2-calendar-occurrences`, worktree `F:/Marius/Projects/homebase-calendar` (chemins en `F:/` majuscule)
- **Liens** : `CLAUDE.md` ; ADR-003 §2.4, §3.5.4, §3.7, §3.9 ; ADR-004 §0 (D5, D6, D10), §3.2 ; `docs/specs/calendar.md` (T1, T3, T5, §4.7, §4.8, PV0) ; `docs/specs/habits.md` (D1, D2, H2, H5, H7, §4.6) ; `docs/specs/todo-details.md` (répétition D3, via ADR-003 §3.9)

Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`. Cette spec ne modifie aucun autre document : les amendements sont **proposés** au §8.

**Demandes de Marius** (retours de tests visuels, 2026-11-21) :
1. « Une tâche qui se répète montre toutes ses occurrences dans Agenda et Mois. » Lève ADR-004 D6.
2. « Les habitudes doivent être visibles dans l'Agenda et dans Mois. » Lève ADR-004 D5 (habitudes hors calendrier en v1).

**Hors périmètre** (ne pas improviser) : historique des occurrences passées d'une tâche répétée (il n'existe pas) ; report des tâches en retard sur « aujourd'hui » dans l'Agenda ; habitude à heure ; action depuis la fiche (cocher, reporter) ; couleur choisie ; Playwright ; toute modification Rust, de migration ou de capability.

---

## 0. Décisions à valider (O1 à O13)

Chaque ligne donne la **recommandation** de l'architecte. La spec est écrite pour elle ; une autre réponse modifie les lots cités.

### Tâches répétées
- **O1 Stockage (constat, rien à changer)**. La répétition est `todos.rrule` (V6), sous-ensemble daté (`FREQ`, `INTERVAL`, `BYMONTHDAY=-1`), ancré sur la `due_on` **courante**. Cocher avance `due_on` (`shiftRepeatDue`), sans `completed_at` ni historique. Aucune migration. (V1 à V4)
- **O2 Expansion par le moteur Rust existant**. `RECURRENCE_ENGINE.expand` avec une ancre **datée** (`{ kind: 'date', startOn: dueOn }`), donc la commande `time_expand` déjà autorisée. Pas de nouvelle commande ni de permission `allow-*`. *Alternatives* :
  - itérer `nextOccurrenceAfter` en TS : zéro IPC, mais c'est une expansion de plage hors du moteur unique, ce que l'exception de l'ADR-003 §3.9 exclut nommément (« une seule prochaine occurrence, pas une expansion de plage »). Il faudrait amender l'ADR-003 ;
  - commande Rust groupée `time_expand_many` : un seul IPC, mais une commande et une permission de plus. C'est le **repli** si la mesure PV-CO2 échoue (> 300 ms), après amendement.
  (V5 à V7)
- **O3 Occurrences montrées** :
  - l'**échéance courante**, comme aujourd'hui (rouge si elle est passée) ;
  - les **occurrences projetées strictement après max(dueOn, aujourd'hui)**. Ce sont exactement les échéances successives que produira `nextRepeatDue` si la tâche est cochée à temps (§3.1). En retard, les périodes intermédiaires ne sont pas montrées : la coche les sautera (D3 de todo-details), et une tâche quotidienne en retard de 10 jours n'affiche pas 10 lignes rouges ;
  - **aucune occurrence passée** : il n'existe aucun historique ;
  - une tâche terminée (`completed_at` non nul, même avec `rrule`) : rien, comme L7 ;
  - une règle hors sous-ensemble (`parseDateRule` renvoie `null`) : l'échéance seule. Cocher la terminerait (`checkAction`).
- **O4 Identifiants**. Toute occurrence d'une tâche répétée (sous-ensemble), échéance courante comprise, a `occurrenceKey` = sa date (ADR-003 §3.5.4 : clé d'une ancre datée) et l'`id` `todo:<id>:<YYYY-MM-DD>`. Une tâche non répétée garde `todo:<id>:` (clé `null`). Gain : cocher la tâche fait de l'occurrence projetée D l'échéance courante **sous le même id**, et une fiche ouverte sur D la suit (effet m3 existant).
- **O5 Statut explicite dans `CalendarEvent`**. Ajout d'un champ **optionnel** `status?: 'overdue' | 'projected' | 'done' | 'planned'` (amendement ADR-004 §3.2.1, ajout sans rien modifier). Les mentions « en retard », « répétition prévue », « fait » et « à faire » (nom accessible, fiche, Agenda) lisent **le statut**, plus le ton.
  - Aujourd'hui, « en retard » est déduit de `tone === 'danger'` (V12). Ce couplage casserait dès qu'une autre source utilise un ton.
  - *Alternative* : déduire du ton par source. Rejetée : fragile, et contraire à « la couleur n'est jamais le seul porteur de sens ».
- **O6 Ton et rendu d'une occurrence projetée**. Ton `neutral` et statut `projected`.
  - Agenda : titre en `text-fg-muted`.
  - Mois : bordure `border-dashed`, utilitaire sans couleur.
  - Fiche C3 : lecture seule, avec la ligne « Répétition prévue : elle deviendra l'échéance quand la précédente sera cochée. » Pas d'action, pas de rappel de la règle (le calendrier ne peut pas importer le widget TODO).
- **O7 Limites**. Au plus **62** occurrences par tâche (`limit` d'`expand` = `MAX_CALENDAR_RANGE_DAYS` ; une ancre datée donne au plus une occurrence par jour). Au plus **1000** tâches répétées lues, 8 expansions en parallèle (`mapLimited`). L'IPC est sauté quand aucune projection ne peut tomber dans la plage. Un échec d'expansion laisse l'échéance seule (journal en développement, id seulement).
- **O8 Ordre et coupure à 2000**. Aujourd'hui l'agrégateur trie **tous** les `all-day` avant **tous** les `timed` (V11). Avec des centaines d'événements d'habitude toute la journée, la coupe supprimerait d'abord les rappels. L'agrégateur trie désormais :
  1. par **jour** ;
  2. puis les événements de **suivi** (statuts `done` et `planned`, donc les habitudes) **après** les autres ;
  3. puis `all-day` avant `timed`, puis par heure ;
  4. à égalité, l'ordre actuel est gardé (tri stable, PV0).
  La coupe garde donc les premiers jours, toutes sources confondues. Le Mois reprend cet ordre (`eventOrder: 'rank'`, `eventOrderStrict: true`) : dans une cellule, tâches et rappels restent visibles, les habitudes passent derrière « +N ».

### Habitudes
- **O9 Jours montrés** (habitudes non archivées, à partir de `startOn`) :
  | Cas | Événement | Ton | Statut |
  |---|---|---|---|
  | Jour coché (prévu ou « bonus », H2) | oui | `success` | `done` |
  | Forme `days`, jour prévu ≥ aujourd'hui, non coché | oui | `neutral` | `planned` (« à faire ») |
  | Forme `days`, jour prévu **passé** non coché (manqué) | **non** (le trou suffit ; l'historique est dans le widget Habitudes) | — | — |
  | Forme `weekly` (N fois par semaine), jour non coché | non (aucun jour fixe) | — | — |
  | Avant `startOn` (coche comprise, L15 de habits) | non | — | — |
  *Alternative pour les manqués* : les montrer en `neutral`, statut `missed` (« manqué »). Plus de bruit dans le Mois ; c'est la question Q1.
- **O10 Toute la journée**. Une habitude est une date murale (habits D2) ; son rappel éventuel a ses propres jours et son fuseau, il n'en fait pas l'heure.
- **O11 Archivées exclues** : archiver = masquer (H7). Restaurer les fait revenir. Il n'existe **pas** d'état « en pause » (jours de pause hors périmètre de habits).
- **O12 Lecture et rafraîchissement**.
  - Lecture par `HABIT_REPOSITORY` : `list()` et `checks({ from: firstOn, to: lastOn })`, en parallèle. Ce sont les commandes existantes `habit_list` et `habit_checks` : aucune commande ni permission nouvelle.
  - **Pas** `HabitStore` : il lit 400 jours, pose un `DueRefresher` et un effet sur `Today`. Il serait instancié par le calendrier même sans widget Habitudes.
  - `HabitStore` prévient `CalendarChanges` après chaque **succès** de `create`, `update`, `setArchived`, `remove` et `setCheck`, jamais après un échec.
  - Volume : 100 habitudes au plus × 62 jours = 6 200 au pire. La coupe par jour (O8) et le bandeau `truncated` s'appliquent. Cas réel : 5 à 10 habitudes, 200 à 600 événements.

### Filtre
- **O13 Réglage « Sources affichées » par widget Calendrier**. Oui, dans un lot séparé (CO4) qu'on peut différer.
  - La configuration passe en v2 avec `hiddenSources: string[]` (défaut `[]` : tout visible, puisque Marius a demandé les habitudes).
  - Un bouton `pi pi-filter` dans la barre ouvre un panneau dans la carte, avec un interrupteur par source.
  - Une source masquée n'est **ni chargée ni comptée** dans la coupe (option `exclude` de l'agrégateur).
  - *Alternatives* :
    - attendre de voir le bruit réel : MO5 le mesure, mais le risque de « +N » partout dans le Mois est connu ;
    - un interrupteur « habitudes » seulement : non générique.

**Budget** (exigence, pas une décision) : les deux sources restent paresseuses (`loadCalendarSource`). Le chargement initial ne gagne que la ligne `loadCalendarSource` de `habits.definition.ts` (CA-CO3-6).

---

## 1. Questions qui exigent l'avis de Marius
- **Q1 (O9)** Les jours **manqués** d'une habitude doivent-ils apparaître (gris « manqué ») ou rester des trous ? Recommandation : des trous.
- **Q2 (O13)** Filtre maintenant (lot CO4) ou après avoir vu le Mois avec les habitudes ? Habitudes visibles par défaut : d'accord ?
- **Q3 (hors périmètre, rappel)** Une tâche répétée **en retard** n'apparaît pas dans un Agenda qui commence aujourd'hui : son échéance est avant la plage. Seules ses projections y figurent, ce qui peut tromper (« prévue mardi » sans voir le retard). Faut-il ouvrir le sujet « retards reportés sur aujourd'hui » ?

---

## 2. Faits vérifiés (code de `main`, 2026-11-21) et suppositions

| # | Fait | Source |
|---|---|---|
| V1 | `todos.rrule` : `NULL` ou 10 à 256 caractères `FREQ=*`, avec `due_on IS NOT NULL` | `migrations/V6__todo_details.sql` l. 12-14 |
| V2 | `parseDateRule` : texte canonique, sous-ensemble `FREQ`/`INTERVAL`/`BYMONTHDAY=-1`, sinon `null` ; `nextRepeatDue(dueOn, rule, today) = nextOccurrenceAfter(dueOn, rule, max(dueOn, today))` ; `date-rule.ts` n'est pas réexporté (bundle) | `core/time/date-rule.ts` l. 8-9, 41-51, 118-146 |
| V3 | `checkAction` : `advance` si active + échéance + règle reconnue + date suivante, sinon `complete` (pose `completed_at`, la règle reste) | `widgets/todo/todo-repeat.ts` l. 13-21 ; `todo.component.ts` l. 199-218 |
| V4 | `shiftRepeatDue` : comparer-et-écrire de `due_on`, `completed_at IS NULL`, `rrule IS NOT NULL` | `data/sqlite/sqlite-todo.repository.ts` l. 198-216 |
| V5 | `ScheduleAnchor` a une forme `{ kind: 'date', startOn }` ; `Occurrence` a `{ kind: 'date', key, date }` | `core/time/recurrence-engine.ts` l. 16-38 |
| V6 | `time_expand` (async) accepte `AnchorDto::Date { start_on }` et renvoie `OccurrenceDto::Date { key, date }` ; `allow-time-expand` est dans `default.json` | `src/time/commands.rs` l. 17-58, 138-197 ; `capabilities/default.json` l. 23 |
| V7 | Le moteur Rust (`floating_occurrences`) est vérifié contre les vecteurs `dateNext`, les mêmes que `nextOccurrenceAfter` en TS : la projection Rust égale les échéances successives TS | `src/time/recurrence/tests.rs` l. 172-191 ; `core/time/vectors.spec.ts` l. 43 ; `time-vectors.json` (14 ancres `"kind": "date"`) |
| V8 | La source TODO émet un `all-day` par tâche active échue dans la plage, `occurrenceKey: null`, `tone` `danger` si `dueOn < today` | `widgets/todo/todo.calendar-source.ts` l. 20-41 |
| V9 | `listDue` : `completed_at IS NULL AND due_on BETWEEN`, tri `due_on, sort_order, id`, limite 1..1000 ; utilisée seulement par la source TODO | `sqlite-todo.repository.ts` l. 30, 55-58, 267-289 ; grep |
| V10 | `FakeRecurrenceEngine.expand` renvoie les **mêmes** `occurrences` pour tout appel | `core/time/testing/fake-recurrence-engine.ts` l. 24-31 |
| V11 | `compareEvents` place tous les `all-day` avant tous les `timed`, puis par `startOn` / `start` ; tri stable ; coupe à 2000 après le tri | `core/calendar/calendar-aggregator.ts` l. 35-46, 110-117 |
| V12 | « en retard » est déduit de `tone === 'danger'` : nom accessible, ligne d'Agenda, fiche ; la fiche affiche « Occurrence d'un rappel répété » pour **toute** `occurrenceKey` non nulle ; `KNOWN_SOURCES = ['reminders', 'todo']` | `widgets/calendar/calendar-label.ts` l. 25, 79 ; `calendar-day-list.component.ts` l. 66 ; `calendar-event-detail.component.ts` l. 57-58 et `.html` l. 38-42 |
| V13 | `toEventInputs` : `id`, `title`, `className` du ton ; aucun `eventOrder` dans les options du Mois | `widgets/calendar/calendar-month-options.ts` l. 22-36, 57-94 |
| V14 | `habits.definition.ts` n'a pas de `loadCalendarSource` | fichier |
| V15 | `HabitRepository.list()` renvoie aussi les archivées ; `checks({ from, to })` → `habit_checks` | `data/repositories.ts` l. 256-267 ; `data/tauri/tauri-habit.repository.ts` l. 34-36, 71-73 |
| V16 | `habit_checks` : dates strictes, `from ≤ to`, écart < 400 jours, aucune borne « futur » ; ≤ 50 000 lignes | `src/schedule/habit_commands.rs` l. 610-642 |
| V17 | `HabitStore` n'importe pas `CalendarChanges` ; ses écritures passent par `act` (l. 202-214) et `setCheck` (l. 166-185) ; il lit 400 jours dès sa construction | `core/habits/habit.store.ts` |
| V18 | `isExpected` répond `true` pour **tout** jour d'une habitude `weekly` (affichage seulement) | `core/habits/habit-stats.ts` l. 63-71 |
| V19 | Ordre du registre : `calendar`, `habits`, …, `reminders`, …, `todo` (départage des égalités de l'agrégateur) | `widgets/widgets.providers.ts` l. 18-28 |
| V20 | Config du calendrier v1 `{ view, agendaDays }` ; migrations indexées par version de départ (`migrations[1]` : v1 → v2) | `widgets/calendar/calendar.config.ts` ; `core/widgets/widget-config.ts` l. 92-94 |
| V21 | `invokeCommand` rejette `DataError('unavailable')` hors Tauri | `data/tauri/invoke-command.ts` l. 34-37 |
| V22 | Classe `.switch` (case à cocher en interrupteur) disponible | `core/theme/components.css` l. 128-166 |
| V23 | FullCalendar `eventOrder` : chaîne, tableau ou fonction. Un nom de champ peut être « a non-standard field ». Défaut `"start,-duration,allDay,title"`. `eventOrderStrict: true` désactive le réordonnancement pour compacter | https://fullcalendar.io/docs/eventOrder (consulté le 2026-11-21) |

| # | Supposition | Vérifiée par |
|---|---|---|
| P1 | En v7, un champ non standard `rank` d'un `EventInput`, avec `eventOrder: 'rank'` et `eventOrderStrict: true`, impose l'ordre dans une cellule de `daygrid` limitée par `dayMaxEvents` | CA-CO1-6 (jsdom). Sinon, forme fonction `(a, b) => a.extendedProps.rank - b.extendedProps.rank` ; si elle échoue aussi, s'arrêter et rapporter |
| P2 | 30 tâches répétées quotidiennes + 100 rappels + 20 habitudes quotidiennes sur 42 jours : `listEvents` en moins de 300 ms | PV-CO2, PV-CO3 |

---

## 3. Conception

### 3.1 Pourquoi la projection depuis `dueOn` est juste (O3)
Soit D0 = `dueOn` et A = max(D0, aujourd'hui). Cocher à temps donne D1 = `nextOccurrenceAfter(D0, r, A)`, puis D2 = `nextOccurrenceAfter(D1, r, D1)`, etc. Pour le sous-ensemble (V2), la série ancrée sur D1 est la queue de la série ancrée sur D0 :
- `DAILY` et `WEEKLY` : pas constant ;
- `MONTHLY` et `YEARLY` : même jour du mois, et les mois sans ce jour sont sautés des deux côtés (D2 d'ADR-003) ;
- `BYMONTHDAY=-1` : toujours le dernier jour.
Donc {occurrences de la série D0} ∩ ]A, +∞[ = {D1, D2, …}. Le moteur Rust et le TS sont tenus d'accord par les vecteurs `dateNext` (V7).

### 3.2 `core/calendar` (lot CO1, et `exclude` au lot CO4)
```ts
// calendar-source.ts (amendment ADR-004 3.2.1: optional field, nothing existing changes)
export type CalendarEventStatus = 'overdue' | 'projected' | 'done' | 'planned';
export const CALENDAR_STATUSES: readonly CalendarEventStatus[] = ['overdue', 'projected', 'done', 'planned'];
/** Tracking statuses (habits): listed after the other events of their day (O8). */
export const TRACKING_STATUSES: readonly CalendarEventStatus[] = ['done', 'planned'];
export interface CalendarEvent {
  // ...unchanged
  /** Absent: an ordinary event. Drives the wording ("en retard", "fait"...), never the tone alone. */
  readonly status?: CalendarEventStatus;
}
```
- **Intégrité** : un `status` présent mais hors de `CALENDAR_STATUSES` → écarté (`'status'`, journal en développement).
- **Tri** (`compareEvents`, O8). Clé précalculée une fois par événement (tri décoré), dans cet ordre :
  1. `day` : `startOn` (all-day) ou `toLocalDate(start, range.timeZone)` (timed) ;
  2. `tracking` : 0, ou 1 si `status ∈ TRACKING_STATUSES` ;
  3. `all-day` avant `timed` ;
  4. `startOn` / `start`.
  Le tri reste stable. Coupe à 2000 inchangée, après le tri.
- **CO4** : `listEvents(range, options?: { readonly exclude?: readonly string[] })`. Une source exclue n'est ni chargée (`loadCalendarSource` non appelé) ni appelée, et ne figure pas dans `failedSources`. La clé de partage en vol devient `from|to|timeZone|<exclude trié, joint par ','>`. Un type inconnu dans `exclude` est ignoré.

### 3.3 Vue `widgets/calendar` (lot CO1)
- `calendar-label.ts` :
  - `KNOWN_SOURCES` gagne `'habits'` ;
  - `eventName` ajoute `, {{status}}` si `status` est présent (clé `eventNameStatus`, statut par `widgets.calendar.<status>`). Plus aucune lecture du ton ;
  - nouvelle `recurringKey(event): string | null` : `reminders` + clé → `widgets.calendar.recurring` ; `todo` + clé + statut ≠ `projected` → `widgets.calendar.recurringTodo` ; sinon `null`.
- `calendar-day-list` :
  - `overdue` = `status === 'overdue'` ;
  - `projected` : titre `text-fg-muted` au lieu de `text-fg` ;
  - `done` : `pi pi-check text-success` après le titre (`aria-hidden`).
  Le nom accessible de la ligne porte le statut.
- `calendar-event-detail` :
  - une ligne de statut si `status` est présent : `overdue` (existante : icône + « En retard », `text-danger`), `projected` (`projectedLabel`, `text-fg-muted`), `done` (`pi pi-check` + « Fait », `text-success`), `planned` (« À faire », `text-fg-muted`) ;
  - la ligne « répétée » suit `recurringKey`.
- `calendar-month-options.ts` :
  - `toEventInputs` ajoute `rank: index` (index dans l'ordre de l'agrégateur) ;
  - un événement `projected` ajoute `border-dashed` à son `className` ;
  - options `eventOrder: 'rank'`, `eventOrderStrict: true` (P1).
- `testing/calendar-fixtures.ts` gagne :
  - F12 : tâche `projected`, `all-day` 2026-11-25, `neutral` ;
  - F13 : habitude `done`, 2026-11-18, `success` ;
  - F14 : habitude `planned`, 2026-11-20, `neutral` ;
  - F15 : deux habitudes `planned` le 2026-11-20.
  F4 reçoit `status: 'overdue'`.

### 3.4 Tâches (lot CO2)
**`data/`** : nouvelle méthode (pas de migration ; index partiel possible plus tard, R7 de la spec calendar).
```ts
/**
 * Active repeating todos (completed_at IS NULL AND rrule IS NOT NULL) whose due_on <= toOn, across
 * all lists, ordered by due_on, sort_order, id. toOn YYYY-MM-DD, limit an integer 1..1000:
 * invalid_input before any query.
 */
listRepeatingDueBy(toOn: LocalDateIso, limit: number): Promise<Todo[]>;
```
SQL dans `sqlite-todo.repository.ts` seulement : `SELECT ${TODO_COLUMNS} FROM todos WHERE completed_at IS NULL AND rrule IS NOT NULL AND due_on IS NOT NULL AND due_on <= $1 ORDER BY due_on, sort_order, id LIMIT $2`. Paramètres liés, même mappeur. Même sémantique dans `core/testing/fake-todo.repository.ts`.

**`widgets/todo/todo-calendar.ts`** (pur, testé) :
```ts
/** Rule of the subset, or null (non-repeating, completed, no due date, or rule outside parseDateRule). */
export function repeatRule(todo: Todo): DateRule | null;
/** The current-due event: id todo:<id>:<dueOn> when repeatRule != null, else todo:<id>: (key null);
 *  tone danger + status 'overdue' when dueOn < today, else neutral, no status. */
export function dueEvent(todo: Todo, today: LocalDateIso): CalendarEvent;
/** max(dueOn, today): projections are strictly after it. */
export function projectionFloor(todo: Todo, today: LocalDateIso): LocalDateIso;
/** Events for the dates strictly after the floor: tone neutral, status 'projected', key = date. */
export function projectedEvents(todo: Todo, dates: readonly LocalDateIso[], today: LocalDateIso): CalendarEvent[];
```
**`todo.calendar-source.ts`** :
1. `rangeLocalDates`, puis en parallèle `listDue({ firstOn, lastOn }, 1000)` et `listRepeatingDueBy(lastOn, 1000)`. Un rejet de l'une rejette la source. Si une limite est atteinte : avertissement en développement.
2. Événements courants : `dueEvent` pour chaque tâche de `listDue` (ordre conservé).
3. Projections : pour chaque tâche de la seconde liste avec `repeatRule ≠ null` **et** `projectionFloor < lastOn`, `mapLimited(…, 8, …)` sur
   `engine.expand({ anchor: { kind: 'date', startOn: dueOn }, rrule, exdates: [] }, { from, to, timeZone, limit: MAX_CALENDAR_RANGE_DAYS })`.
   On garde les `Occurrence` de `kind: 'date'`, puis `projectedEvents`. Un rejet ne saute que cette tâche (journal en développement : id). `truncated` vrai : journal (ne doit pas arriver).
4. Renvoie les courants puis les projetés. Les doublons d'`id` sont impossibles par construction (date > plancher ≥ `dueOn`).
- `core/time/testing/fake-recurrence-engine.ts` : ajouter `respond?: (spec, range) => { occurrences; truncated }`, prioritaire sur les champs actuels. Les tests existants ne changent pas.

### 3.5 Habitudes (lot CO3)
**`widgets/habits/habit-calendar.ts`** (pur, testé) :
```ts
export function habitEvents(
  habits: readonly Habit[],
  checks: readonly HabitCheck[],
  days: { readonly firstOn: LocalDateIso; readonly lastOn: LocalDateIso },
  today: LocalDateIso,
): CalendarEvent[];
```
- Pour chaque habitude non archivée, dans l'ordre reçu (création), et chaque jour d de [max(firstOn, startOn), lastOn] par `addDays` (≤ 62) : règles d'O9.
- Le prévu d'une forme `days` passe par `schedule.days.includes(weekdayCode(d))`. **Jamais** `isExpected` pour `weekly` (V18).
- Événement : `id` `habits:<habitId>:<d>`, `sourceType: 'habits'`, `occurrenceKey: d`, `title`, `all-day` `d`→`d`, ton et statut d'O9.
- Importer `core/habits/habit-stats` par son chemin, **pas** le barrel `core/habits` (il tirerait `HabitStore`).

**`widgets/habits/habits.calendar-source.ts`** : `@Injectable({ providedIn: 'root' }) HabitsCalendarSource`. Il appelle `rangeLocalDates`, puis `Promise.all([repo.list(), repo.checks({ from: firstOn, to: lastOn })])`, puis `habitEvents(…, today.date())`. Un rejet rejette la source (`unavailable` hors Tauri, V21).

**`habits.definition.ts`** : `loadCalendarSource: () => import('./habits.calendar-source').then((m) => m.HabitsCalendarSource)`.

**`core/habits/habit.store.ts`** : `inject(CalendarChanges)` (chemin direct `../calendar/calendar-changes`). `notify('habits')` après le succès de l'action dans `act` (avant la relecture) et après le succès de `repository.setCheck`. Rien après un échec ni après `refresh`.

### 3.6 Filtre (lot CO4)
- `calendar.config.ts` : version **2**, `hiddenSources: v.pipe(v.array(v.pipe(v.string(), v.regex(WIDGET_TYPE_ID_PATTERN))), v.maxLength(16))`, défaut `[]`, migration `{ 1: (prev) => isPlainObject(prev) ? { ...prev, hiddenSources: [] } : prev }`. Les doublons sont retirés à l'écriture.
- `CalendarComponent` :
  - signal `hiddenChoice` (en mémoire, comme `viewChoice`) ;
  - l'effet de chargement le lit et recharge **à 0 ms** quand il change ;
  - `save` écrit `{ view, agendaDays, hiddenSources }` (échec : `configNotSaved`, choix gardé).
- `CalendarLoader.request(range, delayMs, exclude)` transmet l'exclusion à l'agrégateur.
- Barre :
  - bouton `btn btn-invisible btn-icon btn-compact`, `pi pi-filter`, toujours visible ;
  - nom `sources`, ou `sourcesActive` si au moins une source est masquée, l'icône passant alors en `text-accent` ;
  - `aria-expanded` suit le panneau.
- `calendar-sources-panel.component.ts/.html` : même mécanique que le panneau Jour (recouvrement `absolute inset-0 overflow-y-auto bg-canvas`, zone du calendrier `inert`, « Retour », Échap, focus rendu au bouton filtre). Il contient :
  - le titre « Sources affichées » ;
  - une ligne par définition qui a un `loadCalendarSource` : `<label>`, `<input type="checkbox" class="switch">` coché si visible, icône `aria-hidden`, libellé `widgets.calendar.sourceName.<type>` (sinon le `titleKey`).
- Toutes les sources masquées : à la place de l'état vide, la ligne muette `allHidden`.

### 3.7 Textes (`widgets.calendar.*`, français)
- Modifier :
  - `description` : « Rappels, tâches et habitudes, en agenda ou par mois » ;
  - remplacer `eventNameOverdue` par `eventNameStatus` « {{name}}, {{status}} ».
- Ajouter :
  - statuts : `projected` « répétition prévue », `done` « fait », `planned` « à faire » (`overdue` « en retard » existe déjà) ;
  - libellés de fiche : `projectedLabel` « Répétition prévue : elle deviendra l'échéance quand la précédente sera cochée. », `doneLabel` « Fait », `plannedLabel` « À faire » ;
  - `recurringTodo` « Échéance d'une tâche répétée » ;
  - `source.habits` « Habitude ».
- CO4 :
  - `sources` « Sources affichées », `sourcesActive` « Sources affichées (filtre actif) » ;
  - `sourceName.reminders` « Rappels », `sourceName.todo` « Tâches », `sourceName.habits` « Habitudes » ;
  - `allHidden` « Toutes les sources sont masquées. ».
- Exemples de noms :
  - « Tâche : Sortir les poubelles, mercredi 25 novembre 2026, toute la journée, répétition prévue » ;
  - « Habitude : Méditer, mercredi 18 novembre 2026, toute la journée, fait ».

### 3.8 Sécurité
- Aucune commande, permission, migration ni ligne Rust nouvelle : `build.rs`, `capabilities/*.json`, `src/**` et `migrations/**` ont un diff vide.
- `listRepeatingDueBy` est une lecture à paramètres liés. Entrées bornées avant requête et avant IPC : plage ≤ 62 jours, `limit` ≤ 62 et ≤ 1000, `habit_checks` ≤ 62 jours.
- Titres rendus par interpolation ou en texte par FullCalendar. Aucun `innerHTML`, `url` ni `eventContent`.
- `hiddenSources` est une configuration bornée (16 entrées, motif de type). Elle ne sert jamais à construire un chemin ni un import : seulement à comparer avec les types du registre.
- Journaux : identifiants seulement.

---

## 4. Cas limites

| # | Cas | Attendu |
|---|---|---|
| K1 | Changement d'heure (25/10/2026, 28/03/2027) | Sans effet : tout est `all-day` (dates murales) ; le placement d'un jour dans la plage suit ADR-003 §3.5.4 étape 4 |
| K2 | Minuit inexistant (`America/Santiago`, 2026-09-06) | `rangeLocalDates` inclut le 06 (ADR-003 C23) ; habitudes et projections de ce jour présentes |
| K3 | Fin de mois : `FREQ=MONTHLY` ancrée le 31/01/2027 | Projections : 31/03, 31/05… (février et avril sautés, D2) |
| K4 | `FREQ=MONTHLY;BYMONTHDAY=-1` ancrée le 31/01/2028 | 29/02/2028, 31/03/2028 (ADR-003 C8) |
| K5 | `FREQ=YEARLY` ancrée le 29/02/2028 | Rien avant 2032 (C9) |
| K6 | Règle hors sous-ensemble (`FREQ=WEEKLY;BYDAY=MO`, importée) ou illisible | Échéance seule, clé `null`, aucun appel `expand` |
| K7 | `expand` rejette (`expansion_limit` : ancre quotidienne en 1900, `invalid_rule`) | Échéance seule ; les autres tâches et sources sont intactes |
| K8 | `dueOn` = `lastOn` ; ou max(`dueOn`, aujourd'hui) ≥ `lastOn` | Aucun appel `expand` |
| K9 | `dueOn` > `lastOn` | Tâche non lue, aucun événement |
| K10 | Quotidienne en retard (échéance il y a 10 jours) | Une seule ligne rouge à son échéance (si elle est dans la plage) ; projections à partir de demain |
| K11 | Cocher l'échéance courante, fiche ouverte sur la projection D | Après rechargement, D devient courante (même `id`), la fiche la suit et perd « répétition prévue » ; « Annuler » rétablit |
| K12 | Tâche répétée terminée (`completed_at` posé) ; règle retirée | Rien ; non répétée (`todo:<id>:`) |
| K13 | Changement de fuseau utilisateur | Dates inchangées ; « aujourd'hui » recalculé, donc plancher et `planned` / `done` recalculés au rechargement (D9) |
| K14 | Passage de minuit | `Today` change, rechargement : un `planned` d'hier non coché disparaît (O9), le plancher avance |
| K15 | Habitude : coche avant `startOn` ; coche bonus ; forme `weekly` | Ignorée ; `done` ; seulement les jours cochés |
| K16 | Habitude archivée, restaurée, supprimée | Absente ; présente ; absente (`notify` de `HabitStore`) |
| K17 | 100 habitudes quotidiennes sur 42 jours (4 200) + rappels | Coupe par jour : les premiers jours sont complets, toutes sources confondues ; bandeau `truncated` |
| K18 | Cellule du Mois avec 2 habitudes, 1 tâche, 1 rappel, `dayMaxEvents` = 2 | Tâche et rappel visibles, habitudes derrière « +N » ; le panneau Jour les liste dans cet ordre |
| K19 | Hors Tauri | Les sources rejettent `unavailable` ; bandeau `common.desktopOnly` |
| K20 | Doublons | Impossibles par construction (`(habitude, jour)`, `(tâche, date)`) ; filet de l'agrégateur par `id` |
| K21 | Écriture rapide (coches successives) | Anti-rebond de 300 ms existant ; la dernière réponse l'emporte |
| K22 | Deux widgets Calendrier aux filtres différents | Clés de partage en vol distinctes ; chacun son résultat |
| K23 | Toutes les sources masquées ; `hiddenSources` contient un type inconnu | Ligne `allHidden`, aucun appel ; type ignoré |
| K24 | Hors-ligne, synchronisation | Sans objet : tout est local |

---

## 5. Lots

Ordre : CO1 → CO2 → CO3 → CO4 (CO4 seulement si O13 est acceptée). Chaque lot se lance depuis `F:/Marius/Projects/homebase-calendar` : `npm run format:check`, `npm run lint`, `npm run test`, `npm run rust:fmt:check`, `npm run rust:lint`, `npm run rust:test`, tous verts, puis revue `reviewer`. Un lot bloqué s'arrête et rapporte.

### Lot CO1 : statut, ordre, rendu (aucune nouvelle source)
Fichiers :
- modifier `core/calendar/{calendar-source,calendar-aggregator}.ts` (+ spec) ;
- modifier `widgets/calendar/{calendar-label,calendar-day-list.component,calendar-event-detail.component,calendar-month-options}.ts`, et leurs `.html` (+ specs) ;
- modifier `widgets/calendar/testing/calendar-fixtures.ts`, `widgets/todo/todo.calendar-source.ts` (+ spec : `status: 'overdue'`), `core/i18n/fr.json`.

Critères :
- **CA-CO1-1** Intégrité : un `status` inconnu est écarté ; un `status` absent est accepté.
- **CA-CO1-2** Tri (`calendar-aggregator.spec.ts`) :
  - un `timed` du 18 passe avant un `all-day` du 19 ;
  - le 20 : `all-day` non suivi, puis `timed`, puis suivi (F15) ;
  - à égalité, l'ordre du registre puis celui de la source ;
  - 1 500 `all-day` le 19 et 600 `timed` le 18 donnent `truncated`, et les 600 `timed` sont gardés.
- **CA-CO1-3** `eventName` : `status` `overdue`, `projected`, `done`, `planned` donnent le suffixe attendu. Un `tone: 'danger'` **sans** statut ne dit plus « en retard ».
- **CA-CO1-4** Agenda : F4 a l'icône et le `sr-only` « en retard » ; F12 a son titre en `text-fg-muted` ; F13 a `pi pi-check` en `text-success`.
- **CA-CO1-5** Fiche :
  - F12 affiche `projectedLabel` et pas `recurring` ;
  - F13 affiche « Fait », F14 « À faire » ;
  - un rappel répété affiche `recurring`, une tâche répétée courante `recurringTodo` ;
  - une habitude n'a aucune ligne « répétée ».
- **CA-CO1-6** Mois :
  - `toEventInputs` donne `rank` = index et `border-dashed` pour F12 ;
  - les options contiennent `eventOrder: 'rank'` et `eventOrderStrict: true` ;
  - rendu jsdom, `maxEventsPerDay = 2`, le 20/11 avec F15 + 1 tâche + 1 rappel : les deux événements visibles sont la tâche et le rappel (P1 ; sinon repli, ou arrêt) ;
  - les CA-C2-5 et CA-C2-7 existants restent verts.
- **CA-CO1-7** `rg -n "tone === 'danger'" apps/web/src/app/widgets/calendar` : vide.

### Lot CO2 : tâches répétées
Fichiers :
- modifier `data/repositories.ts`, `data/sqlite/sqlite-todo.repository.ts` (+ spec), `core/testing/fake-todo.repository.ts`, `core/time/testing/fake-recurrence-engine.ts`, `widgets/todo/todo.calendar-source.ts` (+ spec), `core/calendar/calendar-debug.ts` ;
- créer `widgets/todo/todo-calendar.ts` (+ spec).

Critères :
- **CA-CO2-1** `test:data` (`listRepeatingDueBy`) :
  - exclut les tâches non répétées, terminées, et celles dont `due_on` > `toOn` ;
  - `toOn` est inclus ; deux listes mêlées ; ordre `due_on, sort_order, id` ; limite respectée ;
  - `invalid_input` sans requête pour une date mal formée, une limite de 0, de 1001 ou non entière.
- **CA-CO2-2** `todo-calendar.spec.ts` et `todo.calendar-source.spec.ts`. `ManualClock` au 2026-11-18 (mercredi), Paris, plage du Mois de novembre (`2026-10-26` → `2026-12-06`). Le fake `respond` renvoie ce que donnerait Rust depuis l'ancre :
  | Tâche | Attendu |
  |---|---|
  | T1 `FREQ=WEEKLY`, échéance 18/11 | 18/11 (`todo:T1:2026-11-18`, `neutral`, sans statut), 25/11 et 02/12 `projected` |
  | T2 `FREQ=DAILY`, échéance 10/11 | 10/11 `danger` `overdue`, puis 19/11 → 06/12 `projected` (18 événements), rien du 11 au 18 |
  | T3 `FREQ=MONTHLY;BYMONTHDAY=-1`, échéance 31/10 | 31/10 `overdue`, 30/11 `projected` |
  | T4 sans règle, échéance 20/11 | `todo:T4:`, clé `null`, aucun appel `expand` |
  | T5 `FREQ=WEEKLY;BYDAY=MO`, échéance 23/11 | 23/11 clé `null`, aucun appel `expand` |
  | T6 `FREQ=WEEKLY`, échéance 06/12 (= `lastOn`) | 06/12 seulement, aucun appel `expand` (K8) |
  | T7 `FREQ=DAILY`, échéance 01/11, `expand` rejette | 01/11 `overdue` seulement ; T1 à T3 intacts |
  - Appel `expand` exact : `{ anchor: { kind: 'date', startOn: dueOn }, rrule, exdates: [] }`, plage de l'agrégateur, `limit: 62`.
  - Jamais plus de 8 appels en vol.
  - `listDue(…, 1000)` et `listRepeatingDueBy(lastOn, 1000)` sont appelées.
- **CA-CO2-3** Agrégateur réel (registre de test, source TODO + faux dépôts) : aucun événement écarté par l'intégrité.
- **CA-CO2-4** `git diff --stat main -- apps/desktop` : vide.
- **PV-CO2** (P2) En `npm run dev`, `__hbCalendar.seedRepeatingTodos(30)` crée 30 tâches `FREQ=DAILY` dues aujourd'hui (`pv-co-<i>`) dans la liste du premier widget TODO du tableau courant, ou rejette s'il n'y en a pas. Puis `measure(42)`, avec et sans les 100 rappels de PV-C1, puis `clearSeeded()` (qui retire aussi ces tâches). Rapporter les durées ; au-delà de 300 ms, s'arrêter (repli O2).

### Lot CO3 : habitudes
Fichiers :
- créer `widgets/habits/{habit-calendar,habits.calendar-source}.ts` (+ specs) ;
- modifier `widgets/habits/habits.definition.ts` (+ spec), `core/habits/habit.store.ts` (+ spec), `core/calendar/calendar-debug.ts`, `core/i18n/fr.json`.

Critères :
- **CA-CO3-1** `habit-calendar.spec.ts`. Aujourd'hui = 2026-11-18 (mercredi), jours `2026-11-09` → `2026-11-24` :
  | Habitude | Attendu |
  |---|---|
  | H1 `days` MO, WE, FR, début 01/11 ; cochés 13, 17 (bonus), 18 | `done` 13, 17, 18 ; `planned` 20, 23 ; rien les 9, 11, 16 (manqués) |
  | H2 `weekly` 3 ; coché 17 | `done` 17, rien d'autre |
  | H3 archivée, cochée 18 | rien |
  | H4 `days` tous, début 20/11 ; coché 19 | `planned` 20 → 24, rien le 19 |
  - `id` `habits:<id>:<jour>`, `occurrenceKey` = jour, `all-day` d'un jour ; tons et statuts d'O9 ; ordre : habitude, puis jour.
- **CA-CO3-2** Source :
  - `checks` reçoit `{ from: firstOn, to: lastOn }` ;
  - `list` et `checks` partent en parallèle ;
  - le rejet de l'une rejette la source ; `unavailable` se propage.
- **CA-CO3-3** `HabitStore` : un succès de `create`, `update`, `setArchived`, `remove` et `setCheck` incrémente `CalendarChanges.version` une fois ; un échec ne l'incrémente pas, une relecture non plus.
- **CA-CO3-4** `habits.definition.spec.ts` : `loadCalendarSource` résout `HabitsCalendarSource`.
- **CA-CO3-5** Le nom accessible d'une ligne d'Agenda vaut « Habitude : …, toute la journée, fait » ; la fiche montre la source « Habitude ».
- **CA-CO3-6** `npm run web:build` : le JS initial reste au plus égal à celui mesuré avant CO1, + 0,3 kB. Aucun fichier « Initial » ne contient `habit-calendar`, `HabitsCalendarSource` ni `todo-calendar` (`rg`). Budget inchangé ; s'il échoue, s'arrêter et rapporter.
- **CA-CO3-7** `rg -n "from '../../core/habits'" apps/web/src/app/widgets/habits/habit-calendar.ts` : vide (pas de barrel).
- **PV-CO3** `__hbCalendar.seedHabits(20)` (20 habitudes quotidiennes, `pv-co-<i>`, dont 10 cochées aujourd'hui), puis `measure(42)` ; rapporter la durée et le nombre d'événements ; `clearSeeded()` les supprime.

### Lot CO4 : filtre des sources (si O13 est acceptée)
Fichiers :
- modifier `widgets/calendar/{calendar.config,calendar.component,calendar-loader,calendar-toolbar.component}` (`.ts`, `.html`, + specs), `core/calendar/calendar-aggregator.ts` (+ spec), `core/i18n/fr.json` ;
- créer `widgets/calendar/calendar-sources-panel.component.{ts,html}` (+ spec).

Critères :
- **CA-CO4-1** Config :
  - une v1 `{ view: 'month', agendaDays: 7 }` est migrée en `{ …, hiddenSources: [] }` ;
  - le schéma refuse 17 entrées et `'Habits!'` ;
  - les défauts sont valides (test du registre).
- **CA-CO4-2** Agrégateur avec `exclude: ['habits']` :
  - le `loadCalendarSource` des habitudes n'est jamais appelé, et `failedSources` ne la contient pas ;
  - deux appels simultanés avec et sans `exclude` font deux chargements.
- **CA-CO4-3** Composant :
  - décocher « Habitudes » recharge à 0 ms avec `exclude: ['habits']` et appelle `updateConfig` avec `hiddenSources: ['habits']` ;
  - un échec d'enregistrement annonce `configNotSaved` et garde le choix ;
  - le bouton filtre porte `sourcesActive` et `text-accent` ;
  - tout masquer affiche `allHidden`.
- **CA-CO4-4** Panneau :
  - la zone du calendrier est `inert` ;
  - Échap et « Retour » rendent le focus au bouton filtre ;
  - chaque interrupteur a un nom accessible (son `<label>`) ;
  - aucun texte en dur.

---

## 6. Vérifications manuelles (Marius)
En `npm run dev`, puis sur l'exe de `npm run build` pour MO8.
- **MO1** Tâche « Sortir les poubelles », chaque semaine, due aujourd'hui :
  - le Mois montre aujourd'hui (plein) et les semaines suivantes (bordure pointillée) ;
  - la cocher dans le widget TODO : le calendrier avance sans rechargement ; « Annuler » rétablit.
- **MO2** Tâche quotidienne due il y a 5 jours : une seule ligne rouge à sa date, puis une par jour à partir de demain ; aucune ligne entre les deux.
- **MO3** Tâche mensuelle « dernier jour du mois » : 30/11, puis 31/12 et 31/01 en naviguant.
- **MO4** Habitudes : une quotidienne, une « lun., mer., ven. », une « 3 fois par semaine » :
  - Agenda : « à faire » aujourd'hui et les jours prévus suivants ;
  - en cocher une dans le widget Habitudes : elle passe en « fait » (vert, coche) sans rechargement ;
  - la « 3 fois » n'apparaît que les jours cochés.
- **MO5 (bruit)** Mois à 6 × 5, avec 4 habitudes quotidiennes, une tâche et un rappel le même jour :
  - tâche et rappel visibles, habitudes derrière « +N » ;
  - le panneau Jour liste tâches, rappels, puis habitudes.
  Juger le bruit (Q2).
- **MO6 (CO4)** Masquer « Habitudes » : elles disparaissent, le bouton filtre passe en accent. Relancer l'app : toujours masquées. Un second widget Calendrier n'est pas affecté.
- **MO7** Clavier et Narrateur : noms « Tâche : …, répétition prévue », « Habitude : …, fait » ; fiche d'une projection lue en entier.
- **MO8** Exe release : aucune violation CSP ; temps d'ouverture du Mois comparable à avant.

---

## 7. Risques
| Risque | Impact | Mitigation |
|---|---|---|
| R1. Bruit des habitudes quotidiennes dans le Mois et l'Agenda | Lisibilité, « +N » partout | Ordre O8 (habitudes en dernier), manqués non montrés (O9), filtre O13, MO5 |
| R2. Un IPC `time_expand` par tâche répétée | Ouverture lente | IPC sauté si inutile (K8), 8 en parallèle, PV-CO2 ; repli `time_expand_many` (amendement) |
| R3. `eventOrder` sur un champ non standard non tenu en v7 (P1) | Habitudes avant les rappels dans une cellule | Test jsdom CA-CO1-6, forme fonction en repli, sinon arrêt |
| R4. Divergence entre projection Rust et avance TS | Date prévue ≠ échéance réelle après coche | §3.1 et vecteurs `dateNext` exécutés des deux côtés (V7) ; MO1 à MO3 |
| R5. Coupe à 2000 atteinte plus tôt | Derniers jours absents | Coupe par jour (O8), bandeau `truncated`, filtre |
| R6. Une projection prise pour une échéance réelle | Confusion | Statut, pointillés ou titre atténué, nom et fiche explicites (O6) |
| R7. Tâche répétée en retard invisible dans un Agenda qui commence aujourd'hui | Retard non vu | Comportement existant ; Q3 |
| R8. Le statut optionnel oublié par une future source | Mentions absentes | Absent = événement ordinaire, sûr par défaut ; intégrité sur les valeurs |

---

## 8. Amendements proposés (à appliquer après validation, hors de cette spec)
- **ADR-004** :
  - §0 D5 : les habitudes deviennent une source (O9 à O12) ; D6 : une tâche répétée montre son échéance et ses projections (O3) ;
  - §3.2.1 : champ optionnel `status` (O5) ;
  - §3.2.2 : tri par jour puis suivi en dernier (O8), option `exclude` (O13) ;
  - §3.2.3 : tableau des sources (tâches : `listDue` + `listRepeatingDueBy` + `time_expand` à ancre datée ; habitudes : `habit_list` + `habit_checks`) ;
  - §3.2.6 : `HabitStore` parmi les écrivains ;
  - §7 L7 : « une tâche répétée cochée : sa projection suivante devient l'échéance courante ».
- **ADR-003** §3.9 : note « l'affichage des occurrences d'une tâche répétée passe par `time_expand` (ancre datée), le moteur unique ; l'exception TS reste limitée à la prochaine échéance ».
- **ADR-001** §3.2 : `habits` implémente `loadCalendarSource`.
- **Spec calendar** §1 : retirer « habitudes » et « projection des séries de tâches » du hors-périmètre, avec un renvoi à cette spec.
- **Spec habits** §1 : retirer « `CalendarSource` des habitudes » du hors-périmètre.
- **DESIGN** §3, Agenda : « projection d'une tâche répétée : titre atténué (Agenda), bordure pointillée (Mois) ; habitude faite : `pi pi-check` `text-success` ».
- **ROADMAP** phase 2 : lots CO1, CO2, CO3 et CO4 (« CO4 si O13 est acceptée »).

## 9. Sources
- Code de `main` (2026-11-21), chemins du §2.
- https://fullcalendar.io/docs/eventOrder (consulté le 2026-11-21) : types acceptés, champ non standard, `eventOrderStrict`.
