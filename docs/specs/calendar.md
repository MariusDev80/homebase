# Spec : Calendrier agrégé (widget `calendar`)

- **Statut** : acceptée (2026-11-21). Fondée sur l'ADR-004 **accepté** (D1 à D10). D11, le champ `unavailable` et PV0 (ordre des tâches conservé) validés par Marius le 2026-11-21, tels que recommandés.
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§6), sur la branche `phase-2-calendar`, dans `F:/Marius/Projects/homebase-calendar`
- **Liens** : `CLAUDE.md` ; ADR-004 (§3.1 relevé et défauts, §3.2 figé, §4.1 fixtures F1 à F11, §7 cas limites) ; ADR-001 §3.1, §3.2 ; ADR-003 §3.2, §3.4, §3.6, §3.7 ; `docs/DESIGN.md` §2, §3 (« Panneau dans une carte »), §5 ; `docs/specs/habits.md` (H6) ; `docs/specs/timers-reminders.md` (M9, D8)

Chemins TS relatifs à `apps/web/src/app/`. Cette spec ne modifie aucun autre document : les amendements sont **proposés** au §8.

---

## 0. Décision validée par Marius (2026-11-21)

- **D11** **Agenda rendu par nous** (liste groupée par jour, composant Angular), FullCalendar réservé à la vue **Mois**. Le module `fullcalendar/list` n'est pas utilisé. Raisons :
  1. Défaut 1 corrigé par construction : un en-tête de jour visible, « Aujourd'hui » et « Demain », la hiérarchie des bordures en tokens.
  2. La vue liste de FullCalendar v7 fixe sa colonne d'heure à **165 px** (ADR-004 V24) : à 3 × 3, il ne resterait qu'environ 100 px pour le titre.
  3. Le **même composant** sert le panneau « Jour » du Mois (défaut 2) : un seul modèle de liste à tester.
  4. Heures en HH:MM par `TimeDisplay`, comme le reste de l'application ; moins de surface FullCalendar à thématiser (risque R2).
  5. Coût faible : la liste d'un jour est nécessaire pour le panneau « Jour » de toute façon.
  - Aspect visuel : Marius a validé l'Agenda de l'essai à ces deux défauts près. L'Agenda maison sera différent, et donc **revu en MC1**.
  - Si D11 est refusée, l'Agenda devient une vue liste de FullCalendar (repli au §3, T1 bis) ; le panneau « Jour » reste le nôtre.
  - *Recommandation : oui.*

Les deux défauts relevés par Marius sont tranchés par l'architecte (T1, T2) ; ils n'appellent pas d'autre décision.

---

## 1. Contexte et périmètre

Widget `calendar` en lecture seule. Il agrège les rappels (développés par le moteur Rust) et les échéances des tâches. Il a deux vues : Agenda (7, 14 ou 31 jours) et Mois (6 semaines). Un clic ouvre une fiche dans la carte (D4).

**Hors périmètre** (ne pas improviser) : habitudes et objectifs comme sources ; vue horaire ; glisser-déposer ; lien vers l'élément ; couleur choisie ; page dédiée ; projection des séries de tâches (D6) ; tâches en retard reportées sur « aujourd'hui » en Agenda ; Playwright.

---

## 2. Faits vérifiés et suppositions

| # | Fait vérifié (2026-11-20) | Source |
|---|---|---|
| V1 | Options FullCalendar v7 citées dans cette spec : `dayMaxEvents`, `moreLinkClick` (fonction), `moreLinkHint`, `popoverClass`, `eventInteractive`, `eventClick`, `eventTimeFormat`, `defaultTimedEventDuration`, `headerToolbar`, `height`, `fixedWeekCount`, `now`, `timeZone`, `calendar.formatIso`, `className` d'un événement, vue personnalisée `{ type, duration }` | ADR-004 V21 à V27 et §8 (pages de la doc v7) |
| V2 | `temporal-polyfill` est déjà en `^1.0.8` dans `apps/web/package.json` : rien à changer pour le peer `^1.0.7` | `apps/web/package.json` l. 35 |
| V3 | Aucun store TODO : les écritures sont faites par `todo.component.ts` (l. 168, 199, 213, 235, 328) et `todo-detail.component.ts` (l. 395, 448) | grep |
| V4 | `ReminderStore.act` enveloppe `create`, `update`, `remove`, `markSeen` (et `skipNext` par `update`) | `core/reminders/reminder.store.ts` l. 90-144 |
| V5 | `core/time` fournit `addDays`, `daysBetween`, `compareLocalDates`, `isoWeekday`, `startOfIsoWeek`, `startOfDay`, `toLocalDate`, `todayIn`, `zoneCity`, `Today`, `UserTimeZone`, `TimeDisplay`, `DueRefresher` ; **pas** de `startOfMonth`, `addMonths`, ni de style « mois année » | `core/time/index.ts`, `local-date.ts`, `time-display.ts` l. 9-27 |
| V6 | `WidgetContext` : `config`, `size` (en colonnes), `updateConfig(next)` | `core/widgets/widget-context.ts` l. 13-23 |
| V7 | Bandeau hors Tauri : `flash flash-danger` + `common.desktopOnly`, sur `DataError('unavailable')` | `widgets/habits/habits.component.html` l. 7-9 |
| V8 | Le script de frontières permet `core → core`, `widgets → core` ; il interdit `core → widgets` et un widget qui en importe un autre | `apps/web/scripts/check-widget-boundaries.mjs` l. 77-97 |

| # | Supposition | Vérifiée par |
|---|---|---|
| P1 | `now: clock.nowIso()` (chaîne ISO) place « aujourd'hui » selon `CLOCK` (vrai à la création) ; `setOption('now', …)` ne le met pas à jour (voir P4) | CA-C2-7 |
| P2 | Entrée sur un événement focalisé (`eventInteractive: true`) déclenche `eventClick` ; Entrée sur « +N » déclenche `moreLinkClick` | MC2, MC5 |
| P3 | Le build résout `"fullcalendar/skeleton.css"` (nom de paquet) dans `styles`, et le fichier non injecté garde le nom `calendar-lib.css` malgré `outputHashing: all` (l'essai a produit `spike-fc.css`) | CA-C2-2 |
| P4 | `setOption` met à jour `events`, `now` et `timeZone` sans recréer le calendrier | CA-C2-7 ; sinon recréer, et le noter. **Vérifié au lot C2 : faux pour `now`** (l'option change mais la cellule « aujourd'hui » reste) : le calendrier est recréé au changement de jour ; `events` et `timeZone` passent par `setOption`. |
| P5 | 100 rappels quotidiens sur 42 jours : `listEvents` en moins de 300 ms (ADR-004 S9) | PV-C1 |

**Note** : l'architecte n'a pas pu relire le code de l'essai (pas d'accès shell). Avant de supprimer la branche `spike/calendar-lib`, le coordinateur relève par `git show spike/calendar-lib:apps/web/src/app/widgets/spike-fc/…` (et `apps/web/angular.json`) le montage validé, et le joint à la mission de C2 :
- imports des plugins et de la locale ;
- correspondance des classes de thème ;
- mise à jour des événements ;
- chemin du CSS.
L'implémenteur de C2 reprend ce montage et signale tout écart avec cette spec.

---

## 3. Décisions techniques

### T1. Agenda : liste groupée par jour, rendue par nous (D11, défaut 1)
- **Une section par jour** qui a au moins un événement : `<section aria-labelledby>` qui contient un en-tête de jour et une `<ul>` d'événements. Les événements de deux jours ne partagent jamais une liste.
- **En-tête de jour** (`<h3>`, ou le niveau qui suit le titre de la carte : PV2) :
  - classes `sticky top-0 z-[1] bg-canvas-subtle border-y border-default px-3 py-1 text-xs font-semibold` ;
  - date visible courte (`weekday-day-month`, « mer. 18 nov. », `aria-hidden`) et date longue en `sr-only` (`weekday-long`) ;
  - à droite, une pastille `rounded-pill border px-2` : « Aujourd'hui » (`border-accent text-accent`, et l'en-tête passe en `text-accent`), ou « Demain » (`border-default text-fg-muted`) ;
  - jour passé : en-tête en `text-fg-muted`.
- **Hiérarchie** : les jours sont séparés par `border-default` et le fond de l'en-tête ; les événements d'un même jour par `border-muted` (`border-b`, `last:border-b-0`). Aucune ombre.
- **Ligne** : `<button type="button">` pleine largeur, `hover:bg-hover`. Elle contient :
  - une colonne d'heure `w-12 shrink-0 tabular-nums text-xs text-fg-muted` : « 09:00 » (`TimeDisplay.formatInstant(start, 'time')`), ou « Journée » ;
  - l'icône de la source (`icon` de sa définition), `aria-hidden`, en classe de ton ;
  - le titre `truncate text-sm text-fg` ;
  - pour une tâche en retard : `pi pi-exclamation-circle text-danger` et « en retard » en `sr-only`.
  Sous **14rem** de large, l'heure passe au-dessus du titre (`@max-[14rem]:flex-col`).
- **Aujourd'hui sans événement**, quand la plage le contient : la section s'affiche quand même, avec la ligne muette « Rien de prévu aujourd'hui. ». Les autres jours vides sont omis. Plage entièrement vide : `empty-state` « Rien de prévu du {{from}} au {{to}}. ».
- **Événement sur plusieurs jours** (F5) : il est listé sous chacun de ses jours, avec « Journée ».
- **Défilement** : la liste défile dans le corps de la carte ; l'en-tête collant indique toujours le jour en cours de lecture.

### T1 bis. Repli si D11 est refusée
Vue personnalisée `views: { agenda: { type: 'list', duration: { days: N } } }` (doc « custom view with settings »). Réglages :
- `listDayClass: 'border-t border-default'` ;
- `listDayHeaderClass` (fonction ; `isToday` ajoute `text-accent`), avec les mêmes classes d'en-tête que T1 ;
- `listDayHeaderContent` : au niveau 1, « Aujourd'hui » si `isToday` ;
- `eventTimeFormat` comme au Mois ;
- ajouter `fullcalendar/list`.
Limite connue : la colonne d'heure de 165 px (V24), à juger en MC1. Le panneau « Jour » (T2) reste le nôtre.

### T2. Mois : « +N » ouvre notre panneau « Jour » dans la carte (défaut 2)
| Option | Pour | Contre |
|---|---|---|
| Popover de FullCalendar borné (`max-height`, `overflow-y: auto`) | Peu de code | Rendu dans `<body>`, hors de la carte : la teinte est perdue et c'est contraire à D4 ; hauteur et défilement non documentés (ADR-004 V23) ; Échap et retour du focus hors de notre contrôle |
| **Panneau « Jour » à nous** | Dans la carte, comme la fiche (D4, DESIGN « Panneau dans une carte ») ; il défile ; même liste que l'Agenda (T1) ; clavier et focus maîtrisés ; testable sans mise en page | Un composant de plus (léger, il réutilise la liste) |
| Basculer vers l'Agenda du jour | Aucun composant | Perte du contexte du mois ; le retour au Mois demande une navigation |

**Retenu : le panneau.** Fonctionnement :
- `dayMaxEvents: true` : la limite suit la hauteur de la cellule. Le composant accepte une entrée `maxEventsPerDay: number | true`, fixée à 2 dans les tests.
- `moreLinkClick` est une **fonction qui ne renvoie rien** (V22, **infirmé** : voir l'interception ci-dessous). Elle lit le jour par `calendar.formatIso(info.date, true)`, le valide (`isValidLocalDate`) et ouvre le panneau pour ce jour. Elle retient `info.jsEvent.currentTarget`, pour y rendre le focus.
- **Interception en capture (vérifié au lot C2)** : le retour `undefined` ne suffit pas, car FullCalendar ouvre son popover pour toute valeur de retour fausse (`!moreLinkClick`). Le composant Mois pose donc sa classe `hb-fc-more` sur le lien (`moreLinkClass`) et des écouteurs `click` et `keydown` (Entrée, Espace) en phase de capture sur son conteneur : `preventDefault` + `stopPropagation`, puis le jour est lu dans `closest('[data-date]')` et validé par `isValidLocalDate`. `moreLinkClick` reste en filet.
- `popoverClass: 'hb-fc-popover'` sert seulement de **sentinelle de test** : aucun élément `.hb-fc-popover` ne doit jamais exister.
- Le panneau recouvre le corps (`absolute inset-0 overflow-y-auto bg-canvas`, corps en `relative`). La zone du calendrier reçoit `inert` tant qu'un panneau est ouvert : FullCalendar reste monté, sans perte d'état.
- Le panneau contient, dans cet ordre :
  - le bouton invisible compact « Retour » ;
  - le titre du jour (`weekday-long`) ;
  - la liste du jour (`calendar-day-list` avec ce seul jour). Ses événements viennent des données déjà chargées, sans nouvel appel.
- Échap ou « Retour » ferme le panneau. Le focus revient à l'élément « +N » s'il est encore dans le document, sinon au bouton de vue « Mois ».

### T3. Réglages FullCalendar (validés à l'essai ou vérifiés dans la doc)
```ts
{
  plugins: [dayGridPlugin], locale: frLocale,                       // as in the spike
  initialView: 'dayGridMonth', initialDate: monthStart,              // 'YYYY-MM-01'
  timeZone: userZone, firstDay: 1, fixedWeekCount: true,
  headerToolbar: false, height: '100%', navLinks: false,
  dayMaxEvents: maxEventsPerDay,                                     // true in production
  moreLinkClick: (info) => { this.openDay(info); },                  // safety net only: the capture listener (T2) takes the "+N" first
  moreLinkHint: (count) => t('widgets.calendar.moreHint', { count }),
  popoverClass: 'hb-fc-popover',                                     // test sentinel only
  eventInteractive: true,
  eventClick: (info) => { info.jsEvent.preventDefault(); this.openEvent(info.event.id, info.el); },
  eventDidMount: ({ event, el }) => el.setAttribute('aria-label', this.nameOf(event.id)),
  defaultTimedEventDuration: { minutes: 0 },                         // end always omitted
  eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },  // "02:00", "23:30"
  now: clock.nowIso(),
  events: toEventInputs(events),
  // theme: the class props of the spike (dayHeaderClass, dayCellClass, moreLinkClass, eventClass…), unchanged
}
```
- **Conversion** (`toEventInputs`, pure) : `id` ; `title` ; `timed` → `start` = instant ISO, **sans `end`** ; `all-day` → `start` = `startOn`, `end` = `addDays(lastOn, 1)`, `allDay: true`. Le ton passe par `className` = classe sémantique du ton. Jamais de `url`, d'`eventContent`, de `html`.
- Seul `calendar-month.component.ts` importe `fullcalendar` à l'exécution. `calendar-month-options.ts` n'en importe que des types (`import type`).
- Création dans `afterNextRender`, après `ensureCalendarStyles` ; `calendar.destroy()` par `DestroyRef`. Changements par `setOption` (P4) : `events` après chaque chargement, `timeZone` quand `UserTimeZone` change, `gotoDate(monthStart)` à la navigation. `now` n'est pas mis à jour par `setOption` (P4) : le calendrier est recréé quand `Today.date()` change.

### T4. Chargement paresseux et CSS à part
- Dans `calendar.component.html`, la vue Mois est dans un `@defer` (sous `@if (view() === 'month')`) : FullCalendar et Preact ne se chargent qu'au **premier affichage du Mois**. L'Agenda n'en a jamais besoin.
- `angular.json`, dans `styles` : `["src/styles.css", { "input": "fullcalendar/skeleton.css", "bundleName": "calendar-lib", "inject": false }]`. Si la résolution par nom de paquet échoue (P3), reprendre le chemin de l'essai.
- `ensureCalendarStyles(doc)` (`calendar-styles.ts`) :
  - insère **une fois** `<link rel="stylesheet" href="calendar-lib.css" data-hb-style="calendar-lib">` (création par `createElement`, jamais par chaîne HTML) ;
  - se résout sur `load` et se rejette sur `error` ou après 10 s ;
  - est fourni par le jeton `CALENDAR_STYLES_LOADER` (remplacé dans les tests).
  En cas d'échec : `flash-danger` « La vue Mois n'a pas pu s'afficher. » et un bouton « Afficher l'Agenda ».
- **Budget** : aucun changement d'`angular.json` côté `budgets`. Le total initial ne peut croître que du coût de la définition (environ 0,7 kB, accepté, ADR-004 §3.1).

### T5. Chargement des données
`CalendarLoader` (`widgets/calendar/calendar-loader.ts`, fourni par le composant) :
- signaux `events`, `failedSources`, `truncated`, `unavailable`, `loading` (premier chargement seulement), `error` ;
- `request(range, delayMs)` : la navigation charge à 0 ms, les autres déclencheurs à 300 ms (anti-rebond). Un compteur fait ignorer les réponses périmées (L11). Les données précédentes restent affichées (`aria-busy="true"`) jusqu'à la réponse.
- Déclencheurs :
  - en C2 : la plage visible, `Today.date()`, `UserTimeZone.id()` ;
  - en C3, en plus : `CalendarChanges.version()` et le retour de focus ou de visibilité (`DueRefresher` sans échéance, `arm(null)`).

### T6. Taille et vue effective
- Un `ResizeObserver` sur le corps produit le signal `bodySize` (px). `monthAllowed = width ≥ 576 && height ≥ 352`, soit 36rem × 22rem (seuils à confirmer en MC4). `view = monthAllowed ? config.view : 'agenda'`. Sans `ResizeObserver` (jsdom), la taille vaut `{ 0, 0 }`, sauf si un test appelle `onResize(w, h)`.
- Sous le seuil, le choix de vue est masqué, mais la configuration n'est pas modifiée (L12). Sous 20rem de large, le choix du nombre de jours est masqué.

---

## 4. Conception

### 4.1 `core/calendar`
```ts
// calendar-source.ts (ADR-004 3.2.1): add CalendarTone and CalendarEvent.tone
// calendar-range.ts
export const MAX_CALENDAR_RANGE_DAYS = 62;
/** Days whose [startOfDay(d), startOfDay(d + 1)) overlaps [from, to). */
export function rangeLocalDates(range: CalendarRange): { readonly firstOn: LocalDateIso; readonly lastOn: LocalDateIso };
/** DataError('invalid_input') if from >= to, unknown zone, or more than 62 days. */
export function assertCalendarRange(range: CalendarRange): void;
// map-limited.ts
/** Runs fn on every item with at most `limit` calls in flight; results keep input order (allSettled). */
export function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]>;
// calendar-aggregator.ts (ADR-004 3.2.2, with `unavailable`)
export const MAX_CALENDAR_EVENTS = 2000;
@Injectable({ providedIn: 'root' }) export class CalendarAggregator { listEvents(range: CalendarRange): Promise<AggregatedEvents>; }
// calendar-changes.ts (C3) — no import other than @angular/core
@Injectable({ providedIn: 'root' }) export class CalendarChanges {
  readonly version: Signal<number>;
  notify(sourceType: string): void;
}
```
- `index.ts` réexporte tout, sauf `calendar-changes.ts` : les écrivains l'importent par son chemin direct, pour ne pas tirer l'agrégateur.
- Tri : `all-day` d'abord (par `startOn`), puis `timed` par `start` (ordre des chaînes, format fixe). Le tri est stable (PV0) : à égalité, l'ordre du registre des sources, puis l'ordre renvoyé par la source. Dédoublonnage par `id`, le premier gardé. Coupe à 2000 après le tri.
- Intégrité (écart et journal en développement, identifiants seulement), voir ADR-004 §3.2.2. Est hors de la plage :
  - un `timed` dont `start ∉ [from, to)` ;
  - un `all-day` qui ne chevauche pas `[firstOn, lastOn]`.

### 4.2 `data/` : `TodoRepository.listDue`
```ts
/**
 * Active todos (completed_at IS NULL) whose due_on is within [fromOn, toOn] (inclusive), across
 * all lists, ordered by due_on, sort_order, id. Both dates YYYY-MM-DD and fromOn <= toOn, limit an
 * integer 1..1000: invalid_input before any query.
 */
listDue(range: { readonly fromOn: LocalDateIso; readonly toOn: LocalDateIso }, limit: number): Promise<Todo[]>;
```
SQL dans `data/sqlite/sqlite-todo.repository.ts` seulement, paramètres liés (`$1`, `$2`, `$3`), aucune concaténation, mêmes colonnes et même mappeur que `listTodos`. Pas de migration ni d'index. Le fake `core/testing/fake-todo.repository.ts` a la même sémantique.

### 4.3 Sources
- `widgets/reminders/reminders.calendar-source.ts` : `@Injectable({ providedIn: 'root' }) export class RemindersCalendarSource implements CalendarSource`. Règles de l'ADR-004 §3.2.3, avec `mapLimited(…, 8, …)`. Un rejet de `list()` rejette la source. Un rejet d'`expand` saute seulement ce rappel (journal en développement : id). `id` = `reminders:<id>:<clé>` (série) ou `reminders:<id>:` (rappel unique).
- `widgets/todo/todo.calendar-source.ts` : `TodoCalendarSource` ; `rangeLocalDates`, puis `listDue(…, 1000)`, puis le ton par `compareLocalDates(dueOn, today.date())`. `id` = `todo:<id>:`.
- Définitions : `loadCalendarSource: () => import('./reminders.calendar-source').then((m) => m.RemindersCalendarSource)`, de même pour `todo`.

### 4.4 `core/time` (ajouts, amendement ADR-003 §3.6 proposé)
- `month.ts` : `startOfMonth(date)` et `addMonths(date, n)` (gardés hors de `local-date.ts` pour rester hors du chunk initial), par `Temporal.PlainDate` (débordement `constrain`).
- `time-display.ts` : `DateStyle` gagne `'month-year'` (`{ month: 'long', year: 'numeric' }` → « novembre 2026 »).

### 4.5 Widget `widgets/calendar/`
```
calendar.definition.ts / calendar.config.ts
calendar.component.ts/.html            hôte : barre, vue effective, panneaux, chargeur, bandeaux
calendar-toolbar.component.ts/.html    barre D8
calendar-view.ts                       pur : visibleDays(view, anchor, agendaDays), navigate(…), titre
calendar-days.ts                       pur : groupByDay(events, firstOn, lastOn, timeZone): DayGroup[]
calendar-day-list.component.ts/.html   Agenda (N jours) et panneau Jour (1 jour), T1
calendar-day-panel.component.ts/.html  T2
calendar-month.component.ts            adaptateur FullCalendar (seul import d'exécution)
calendar-month-options.ts              pur : options T3 et toEventInputs
calendar-styles.ts                     T4
calendar-loader.ts                     T5
calendar-label.ts                      pur : libellé d'heure (C2), nom accessible (C3)
calendar-event-detail.component.ts/.html   fiche (C3)
testing/calendar-fixtures.ts           F1 à F11 (ADR-004 §4.1)
```
- Définition : `type: 'calendar'`, `titleKey: 'widgets.calendar.title'`, `icon: 'pi pi-calendar'`, tailles min 3 × 3, défaut 6 × 5, max 12 × 8, `permissions: []`, pas de `loadCalendarSource`.
- Config v1 (valibot) : `{ view: 'agenda' | 'month', agendaDays: 7 | 14 | 31 }`, défaut `{ view: 'agenda', agendaDays: 14 }`. L'ancre de navigation n'est pas enregistrée : le widget rouvre toujours sur aujourd'hui.
- `DayGroup = { day: LocalDateIso; events: readonly CalendarEvent[] }`. Un `timed` appartient au jour `toLocalDate(start, tz)`. Un `all-day` appartient à chaque jour de `[startOn, lastOn] ∩ [firstOn, lastOn]`. L'ordre de l'agrégateur est conservé.
- Plages : Mois = `startOfIsoWeek(startOfMonth(anchor))` + 41 jours ; Agenda = `anchor` + N − 1. Ensuite `from`/`to` par `startOfDay` (ADR-004 §3.2.4).
- Tons → classes : `neutral` `text-fg-muted`, `accent` `text-accent`, `success` `text-success`, `attention` `text-attention`, `danger` `text-danger`. Une table unique (`TONE_CLASS`) sert l'Agenda et `className`.

### 4.6 Barre d'outils (D8)
Une ligne, dans cet ordre :
- précédent et suivant : `btn btn-invisible btn-icon btn-compact`, `pi pi-chevron-left` / `pi pi-chevron-right`. Noms : « Mois précédent » / « Mois suivant », ou « {{n}} jours précédents » / « {{n}} jours suivants » ;
- « Aujourd'hui » : `btn btn-compact` ;
- le titre `truncate text-sm font-semibold`, `aria-live="polite"` : « novembre 2026 », ou « 18 nov. – 1 déc. » ;
- à droite, « Agenda » et « Mois » : `btn btn-compact` avec `aria-pressed`, l'état pressé en `bg-accent-subtle text-accent` ;
- en Agenda, un `<select class="field">` « 7 jours / 14 jours / 31 jours », avec un libellé `sr-only`.
Sous 28rem, le titre passe sur sa propre ligne. Le choix de vue et le nombre de jours sont enregistrés par `context.updateConfig`. Un échec d'enregistrement laisse le choix en mémoire et l'annonce par une zone `role="status"`.

### 4.7 Fiche (C3, D4)
Même mécanique que le panneau Jour : recouvrement, `inert`, « Retour », Échap, focus rendu à l'élément d'origine. La fiche peut être ouverte depuis une ligne d'Agenda, un événement du Mois ou une ligne du panneau Jour. Depuis le panneau, « Retour » revient au panneau, avec le focus sur la ligne d'origine. Contenu :
- le titre complet, en `<h3>`, avec `break-words` ;
- la source : son icône et « Rappel » ou « Tâche » (clé `widgets.calendar.source.<type>` ; sinon le `titleKey` de la définition) ;
- la date : `weekday-long` ; pour un `all-day` sur plusieurs jours, « Du {{from}} au {{to}} » ;
- pour un `timed` : « à 09:00 ». Si `time.timeZone` ≠ fuseau d'affichage, on ajoute « (09:00 Paris) » (`formatInstant(start, 'time', zone)` et `zoneCity`) ;
- pour une tâche en retard : « En retard » (`text-danger` et une icône) ;
- si `occurrenceKey` n'est pas `null` : « Occurrence d'un rappel répété ».
Aucune action.

### 4.8 Noms accessibles et textes
`eventName(event, display, tz, t)` (pur, `calendar-label.ts`) donne « {{source}} : {{title}}, {{date}}, {{time}} », par exemple « Rappel : Payer le loyer, mercredi 18 novembre 2026, 09:00 ». Variantes :
- `all-day` : « …, toute la journée » ;
- tâche en retard : « …, en retard ».
Le nom sert pour les lignes de l'Agenda et du panneau, et pour `aria-label` dans le Mois (`eventDidMount`).

**Clés i18n** (`widgets.calendar.*`) :
- widget : `title` « Calendrier », `description` « Rappels et échéances des tâches, en agenda ou par mois » ;
- vues : `view.agenda` « Agenda », `view.month` « Mois », `days` « {{count}} jours » ;
- navigation : `prevMonth`, `nextMonth`, `prevDays`, `nextDays`, `today` « Aujourd'hui », `tomorrow` « Demain » ;
- Agenda : `allDay` « Journée », `allDayLong` « toute la journée », `overdue` « en retard », `overdueLabel` « En retard », `nothingToday` « Rien de prévu aujourd'hui. », `empty` « Rien de prévu du {{from}} au {{to}}. » ;
- Mois : `moreHint` « Voir les {{count}} autres événements de ce jour » ;
- panneaux : `back` « Retour » ;
- fiche : `range` « Du {{from}} au {{to}} », `at` « à {{time}} », `zoneTime` « ({{time}} {{city}}) », `recurring` « Occurrence d'un rappel répété », `source.reminders` « Rappel », `source.todo` « Tâche » ;
- bandeaux et état : `partial` « Certains éléments n'ont pas pu être chargés. », `truncated` « Trop d'événements : seuls les 2000 premiers sont affichés. », `monthFailed` « La vue Mois n'a pas pu s'afficher. », `showAgenda` « Afficher l'Agenda », `configNotSaved` « Le choix n'a pas pu être enregistré. ».

### 4.9 Sécurité
- Les titres sont rendus par interpolation (Agenda, fiche) ou en texte par FullCalendar. Aucun `innerHTML`, `[innerHTML]`, `eventContent`, `url` ni `navLinks`. `setAttribute('aria-label')` seulement.
- Aucune ressource distante : locale importée du paquet ; CSS servi par l'application (`'self'`). CSP inchangée.
- Aucune permission Tauri ni commande nouvelle ; `listDue` est une lecture paramétrée.
- Journaux : identifiants seulement, jamais de titres.

---

## 5. Cas limites

L1 à L13 de l'ADR-004 §7, plus :

| # | Cas | Attendu |
|---|---|---|
| L14 | Agenda qui commence aujourd'hui, sans événement aujourd'hui | Section « Aujourd'hui » avec « Rien de prévu aujourd'hui. » |
| L15 | Clic sur « +N » d'un jour hors du mois affiché (cellule grisée) | Panneau de ce jour, avec les événements chargés (la plage couvre les 42 jours) |
| L16 | Plusieurs widgets Calendrier | Un seul `<link>` ; chaque widget a son chargeur ; même agrégateur |
| L17 | La carte rétrécit sous le seuil pendant que le panneau Jour est ouvert | Le panneau se ferme et la vue passe en Agenda ; le focus va au titre de la barre |
| L18 | `formatIso` rend une valeur invalide (P1 et V5 faux) | Le panneau ne s'ouvre pas ; journal en développement ; « +N » reste sans effet (bug à remonter) |
| L19 | Changement de mois pendant un chargement | La réponse de l'ancien mois est ignorée (L11) |
| L20 | Le widget TODO est supprimé (ses tâches avec lui) | `DashboardStore.remove` prévient `CalendarChanges` : les tâches disparaissent |
| L21 | Changement de thème clair ou sombre, ou de teinte, avec le Mois affiché | Instantané : classes et tokens, sans recréer FullCalendar |
| L22 | Événement de 23:30 (F2) | Un seul jour, sans débordement (durée 0) |

---

## 6. Lots

Ordre : C1 → C2 (après la réponse à D11) → C3. Chaque lot : `npm run format:check`, `npm run lint`, `npm run test`, `npm run rust:fmt:check`, `npm run rust:lint`, `npm run rust:test`, tous verts, lancés depuis `F:/Marius/Projects/homebase-calendar` (F majuscule), puis une revue `reviewer`. Un lot bloqué s'arrête et rapporte.

### Lot C1 : sources et agrégateur (sans bibliothèque ni interface)
Fichiers :
- modifier `core/calendar/calendar-source.ts`, `data/repositories.ts`, `data/sqlite/sqlite-todo.repository.ts` (+ spec), `core/testing/fake-todo.repository.ts`, `widgets/reminders/reminders.definition.ts`, `widgets/todo/todo.definition.ts` ;
- créer `core/calendar/{calendar-range,map-limited,calendar-aggregator,index}.ts` (+ specs), `widgets/reminders/reminders.calendar-source.ts` (+ spec), `widgets/todo/todo.calendar-source.ts` (+ spec).

Critères :
- **CA-C1-1** `test:data` (`listDue`) : exclut les tâches terminées, sans échéance et hors plage ; bornes incluses ; deux listes mêlées ; ordre `due_on, sort_order, id` ; `limit` respecté ; `invalid_input` sans requête pour une date mal formée, `fromOn > toOn`, une limite de 0, de 1001 ou non entière.
- **CA-C1-2** `calendar-range.spec.ts` :
  - `rangeLocalDates` sur le mois de novembre 2026 à Paris (`2026-10-26` → `2026-12-06`) ;
  - L3 : Santiago, 2026-09-06 (début 01:00 locale) ;
  - une plage non alignée sur minuit ;
  - `assertCalendarRange` refuse 63 jours, `from >= to` et un fuseau inconnu.
- **CA-C1-3** `calendar-aggregator.spec.ts` (registre et sources factices) :
  - dédoublonnage, tri, `allSettled` (`failedSources`) ;
  - `unavailable` vrai seulement si tous les échecs sont `unavailable` ;
  - chaque règle d'intégrité (mauvais `sourceType`, `id` mal formé, instant invalide, hors plage, ton inconnu) ;
  - coupe à 2000 (`truncated`) ;
  - `loadCalendarSource` appelé une fois pour deux `listEvents`, et rappelé après un échec de chargement ;
  - `mapLimited` : jamais plus de 8 appels en vol, ordre conservé.
- **CA-C1-4** `reminders.calendar-source.spec.ts` (`FakeReminderRepository`, `FakeRecurrenceEngine`) :
  - les rappels désactivés et `invalid` sont exclus ; un rappel `finished` est inclus ;
  - `occurrenceKey` vaut `null` sans `rrule`, et la clé avec ;
  - forme de l'`id` ; ton `accent` ; `timeZone` du rappel ;
  - un `expand` en échec ne saute que son rappel ; un rejet de `list()` rejette la source.
- **CA-C1-5** `todo.calendar-source.spec.ts` (`ManualClock` au 2026-11-18 à Paris) : le 2026-11-17 donne `danger`, les 18 et 19 donnent `neutral` ; `listDue` est appelé avec `rangeLocalDates` et 1000.
- **CA-C1-6** `npm run lint` : frontières vertes, aucun import statique de source par `core/`. `npm run web:build` : total initial inchangé hors `loadCalendarSource` : au plus +1 kB pour les deux définitions (ADR-004 R9 ; mesuré +0,73 kB, accepté le 2026-11-20 par le coordinateur).
- **PV-C1** (P5) : en `npm run dev`, `window.__hbCalendar` (outil de développement, absent de la production) : `await __hbCalendar.seedReminders(100)` puis `await __hbCalendar.measure(42)`, ensuite `clearSeeded()`, puis la même mesure à **1000** rappels (limite `SCHEDULE_LIMITS.maxReminders`). Rapporter les deux durées ; au-delà de 300 ms, s'arrêter et rapporter (repli : commande Rust groupée).

### Lot C2 : widget, Agenda, Mois, panneau Jour
Fichiers :
- modifier `apps/web/package.json` et `package-lock.json` (racine), `apps/web/angular.json`, `core/time/{local-date,time-display,index}.ts` (+ specs), `widgets/widgets.providers.ts`, `core/i18n/fr.json` ;
- créer `widgets/calendar/*` (§4.5, sauf la fiche), avec les specs.

Critères :
- **CA-C2-1** Dépendances :
  - `"fullcalendar": "7.1.5"` (version exacte) dans les `dependencies` de `apps/web`, et **aucun autre** paquet ajouté ;
  - `npm ci --ignore-scripts` passe sans `overrides` ni `--legacy-peer-deps` ;
  - le lockfile ne contient qu'une copie de `preact`.
- **CA-C2-2** Build :
  - JS initial ≤ le JS mesuré sur `phase-2-calendar` avant C2 (il comprend C1), + 1 kB ; la feuille globale `styles-*.css` ne croît que des utilitaires Tailwind génériques des gabarits du calendrier (amendé le 2026-11-21 par le coordinateur : total 495,56 → 497,44 kB, soit +0,62 kB de JS, dont la définition à +0,57 kB, et +1,26 kB pour 25 utilitaires Tailwind ; rien du code paresseux dans l'initial ; sous l'avertissement de 500 kB, arbitrage R5 en fin de phase) ;
  - aucun fichier « Initial » de `ng build` ne contient `@fullcalendar` ni `preact` (`rg`) ;
  - FullCalendar est dans un chunk paresseux **distinct** de celui du composant `calendar` ;
  - `calendar-lib.css` est présent dans la sortie et absent d'`index.html` (P3).
- **CA-C2-3** Fonctions pures :
  - `calendar-view` : mois de novembre 2026 = `2026-10-26` → `2026-12-06` ; Agenda de 14 jours depuis le 2026-11-18 ; précédent, suivant et « Aujourd'hui » ; titres ;
  - `groupByDay` : F1 à F11 à Paris et à Santiago (F3 le 17/11 à Santiago, F5 sur trois jours, F6 le 24/10 à Santiago) ;
  - `startOfMonth`, `addMonths('2027-01-31', 1) = '2027-02-28'` ;
  - `'month-year'` donne « novembre 2026 » ;
  - `toEventInputs` : aucun `end` pour un `timed`, F5 → `end: '2026-11-26'`, aucune clé `url`.
- **CA-C2-4 (défaut 1, Agenda)** `calendar-day-list.spec.ts`, avec F1 à F11 à Paris, 7 jours depuis le 2026-11-18, `ManualClock` au 2026-11-18T10:00Z :
  - une `section` par jour qui a des événements, chacune avec **un** en-tête (`h3`) qui contient sa date ; les événements de deux jours ne sont jamais dans la même `ul` ;
  - l'en-tête porte `sticky`, `bg-canvas-subtle` et `border-default` ; les lignes portent `border-muted` ;
  - l'en-tête du 18 contient « Aujourd'hui », celui du 19 « Demain » ;
  - les heures valent exactement « 09:00 », « 23:30 », « 02:00 » (`/^\d{2}:\d{2}$/`, jamais « h ») ;
  - F10 donne 12 lignes sous le 20/11 ;
  - à Santiago, F3 est sous le 17/11 ;
  - F8 est en `textContent`, sans aucun `img` ;
  - L14 : une plage sans événement aujourd'hui affiche « Rien de prévu aujourd'hui. ».
- **CA-C2-5 (défaut 2, Mois)** `calendar-month.spec.ts` (jsdom, `maxEventsPerDay = 2`, styles factices), avec F10 :
  - un clic sur l'élément nommé par `moreHint` ouvre le panneau du 2026-11-20 avec **12** lignes ;
  - aucun élément `.hb-fc-popover` n'existe dans `document` ;
  - le panneau a `overflow-y-auto` et est contenu dans le corps du widget ; la zone du calendrier est `inert` ;
  - Échap rend le focus à « +N » ;
  - à Santiago, avec F3 et deux autres événements le 17/11 (heure locale), « +N » de cette cellule ouvre le panneau du **2026-11-17** (`formatIso`).
- **CA-C2-6** Options (`calendar-month-options.spec.ts`), valeurs exactes : `headerToolbar: false`, `defaultTimedEventDuration: { minutes: 0 }`, `eventTimeFormat` de T3, `firstDay: 1`, `fixedWeekCount: true`, `height: '100%'`, `eventInteractive: true`, `timeZone` = zone utilisateur, `moreLinkClick` est une fonction qui renvoie `undefined`, `now` = `clock.nowIso()`, aucune clé `eventContent` ni `navLinks: true`.
- **CA-C2-7** Rendu du Mois (jsdom) :
  - à Paris, le 18/11 affiche « 23:30 » (F2) et « 02:00 » (F3), et F2 n'apparaît pas le 19/11 (L22) ;
  - l'en-tête de colonne commence par « lun. » ;
  - après `setOption('now', …)` au lendemain, la cellule « aujourd'hui » change (P1 ; sinon s'arrêter et rapporter) ;
  - F8 est rendu en texte.
- **CA-C2-8** Taille : `onResize(500, 400)` masque le choix de vue et force l'Agenda alors que la configuration dit `month` ; `onResize(700, 400)` affiche le Mois ; la configuration n'est pas réécrite.
- **CA-C2-9** `calendar-styles.spec.ts` : deux appels insèrent un seul `<link>` ; résolution sur `load` ; rejet sur `error` ; le composant affiche alors `monthFailed` et le bouton vers l'Agenda.
- **CA-C2-10** `rg -n "innerHTML|eventContent|url:|new Date|navLinks: true" apps/web/src/app/widgets/calendar` : vide. Aucun hexadécimal (`check-design-tokens`). `fullcalendar` n'est importé à l'exécution que par `calendar-month.component.ts`.
- **CA-C2-11** Hors Tauri (`unavailable`) : bandeau `common.desktopOnly`, aucune exception. Source partielle : `partial` en `flash-attention` ; `truncated` affiché.
- **CA-C2-12** Manuels MC1 à MC4, MC7 et MC8.

### Lot C3 : fiche, rafraîchissement, accessibilité
Fichiers :
- créer `core/calendar/calendar-changes.ts` (+ spec), `widgets/calendar/calendar-event-detail.component.*` (+ spec) ;
- modifier `core/reminders/reminder.store.ts`, `widgets/todo/todo.component.ts`, `widgets/todo/todo-detail.component.ts`, `core/dashboard/dashboard.store.ts` (+ leurs specs), `widgets/calendar/{calendar.component,calendar-loader,calendar-label,calendar-day-list.component,calendar-month.component}.ts`, `core/i18n/fr.json`.

Critères :
- **CA-C3-1** `CalendarChanges` : `notify` incrémente `version`. Il est appelé après :
  - un succès de `ReminderStore` en `create`, `update`, `remove` et `skipNext`, mais **pas** après un échec ni après `markSeen` ;
  - les écritures du TODO : `create`, `setCompleted`, `shiftRepeatDue` (et son annulation), `remove`, `update` de la fiche (mais pas `reorder` ni `clearCompleted`) ;
  - `DashboardStore.remove`.
  `calendar-changes.ts` n'importe que `@angular/core`.
- **CA-C3-2** Rechargement (minuteries simulées) :
  - un `notify` donne **un** appel à l'agrégateur après 300 ms (trois `notify` rapprochés aussi) ;
  - `focus` et `visibilitychange` déclenchent un rechargement ; un changement de `Today` ou de fuseau aussi ;
  - deux réponses arrivées en ordre inverse : la plus récente l'emporte.
- **CA-C3-3** Fiche :
  - F1 à Santiago affiche « 05:00 » et « (09:00 Paris) » ; F7 à Paris « 15:00 (09:00 Montreal) » (`zoneCity` = dernier segment IANA, partagé avec rappels et habitudes) ;
  - F5 donne « Du … au … » ; une tâche en retard donne « En retard » ; F9 affiche son titre complet ;
  - Échap ou « Retour » rend le focus à l'origine (ligne d'Agenda, événement du Mois, ligne du panneau) ;
  - du panneau Jour à la fiche, puis « Retour » : le panneau, avec le focus sur la ligne.
- **CA-C3-4** Noms : `eventName` dans tous les cas du §4.8 ; dans le Mois, chaque événement a `aria-label` = `eventName` ; chaque ligne d'Agenda a ce nom.
- **CA-C3-5** Aucun texte en dur (toutes les clés existent dans `fr.json`), comme les tests des autres widgets.
- **CA-C3-6** Manuels MC5 et MC6.

---

## 7. Vérifications manuelles (Marius)
En `npm run dev` avec quelques rappels et tâches, puis sur l'exe de `npm run build` pour MC8.
- **MC1 (défaut 1)** Agenda de 7 jours à 3 × 3 puis 6 × 5, avec plusieurs événements sur trois jours consécutifs :
  - chaque jour est nettement séparé, avec sa date en en-tête ;
  - « Aujourd'hui » et « Demain » sont visibles ;
  - l'en-tête reste collé en défilant ;
  - les heures sont en HH:MM ; le titre reste lisible à 3 × 3.
- **MC2 (défaut 2)** Mois à 6 × 5, avec 15 événements le même jour :
  - « +N » ouvre le panneau Jour **dans la carte** ;
  - la molette atteint le dernier événement ; Tab les atteint tous ;
  - Échap rend le focus à « +N » ;
  - aucun popover n'apparaît hors de la carte.
- **MC3** Clair, sombre, deux teintes de carte : tons lisibles (rappel en accent, tâche en retard en danger) ; aucune couleur étrangère aux tokens ; changement de thème instantané.
- **MC4** Redimensionner de 3 × 3 à 12 × 8 : le Mois disparaît sous le seuil puis revient. Relever la largeur et la hauteur du corps à 3 × 3, 6 × 5, 6 × 8 et 12 × 8 (DevTools) pour confirmer 36rem × 22rem.
- **MC5** Clavier seul, puis Narrateur :
  - barre, événements, « +N » (P2), fiche ;
  - noms lus complets (« Rappel : …, mercredi 18 novembre 2026, 09:00 ») ;
  - focus visible partout.
- **MC6** Créer un rappel, cocher une tâche, changer une échéance dans les autres widgets : le calendrier suit sans rechargement. Supprimer un widget TODO : ses tâches disparaissent.
- **MC7** Réglage `time.zone` = `America/Santiago` : un rappel de 02:00 à Paris passe à la veille, 22:00 ; une tâche ne bouge pas.
- **MC8** Exe release, console DevTools (port de débogage WebView2) : aucune violation CSP, aucune requête externe ; `calendar-lib.css` n'est chargé qu'au premier affichage du Mois.

---

## 8. Amendements appliqués (2026-11-21)
- **ROADMAP** phase 2 : cocher « ADR-004 » ; remplacer « (S) Calendrier agrégé via `CalendarSource` » par les lots C1, C2 et C3 (« C2 après D11 »).
- **PLAN** §2, ligne « Calendrier » : « FullCalendar 7.1.5 (vue Mois, chargée à la demande) ; Agenda rendu par nous (D11) » ; §9 point 2 fermé par l'ADR-004.
- **ADR-003** §3.6 : `startOfMonth`, `addMonths` dans `core/time` ; §3.4 : style `'month-year'` de `TimeDisplay`.
- **ADR-001** §3.2 : premières implémentations de `loadCalendarSource` (`reminders`, `todo`).
- **SECURITY-NOTES** : « Feuille de style non injectée `calendar-lib.css` (`angular.json`, `inject: false`), servie par l'application et insérée par un `<link>` créé par `createElement` ; aucune ressource distante ; CSP inchangée. »
- **DESIGN** §3 : « **Agenda (calendrier)** : une section par jour, en-tête collant `bg-canvas-subtle` bordé `border-default`, pastille « Aujourd'hui » en accent ; événements séparés par `border-muted`. » et « **Panneau Jour** : “+N” du Mois ouvre la liste du jour dans la carte (panneau), jamais un popover. »

## 9. Risques et points à vérifier
| Risque | Impact | Mitigation |
|---|---|---|
| R1. Une option FullCalendar citée se comporte autrement que sa doc (P1, P2, P4) | Défaut 2 non corrigé, ou « aujourd'hui » faux | Tests jsdom CA-C2-5 et CA-C2-7 ; arrêt et rapport plutôt qu'un contournement |
| R2. Le CSS non injecté prend un nom haché (P3) | `<link>` en 404, Mois sans squelette | CA-C2-2 vérifie le nom ; sinon s'arrêter et rapporter |
| R3. `dayMaxEvents: true` en petite carte | « +N » partout | Seuil de taille (T6) ; panneau Jour ; MC4 |
| R4. Charge IPC (P5) | Ouverture lente | PV-C1 ; commande groupée en repli |
| R5. Total initial proche de 500 kB (ADR-004 R9) | Avertissement de build | Définition seule dans l'initial ; arbitrage en fin de phase |
| R6. D11 refusée | Le défaut 1 dépend des hooks de la vue liste | Repli T1 bis, MC1 |
| R7. `listDue` sans index sur `due_on` (balayage de la table) | Lenteur avec beaucoup de tâches | Index partiel possible : `todos_due_active_idx ON todos (due_on, sort_order, id) WHERE completed_at IS NULL AND due_on IS NOT NULL`. Nouvelle migration seulement si la mesure l'exige |

- **PV0** (tranché le 2026-11-21 : l'Agenda conserve l'ordre des listes ; tri stable de l'agrégateur, départage par l'ordre de la source puis l'ordre renvoyé par la source, sans nouveau champ dans `CalendarEvent`) Ordre des tâches d'un même jour : `listDue` départage par `sort_order` puis `id`, mais l'agrégateur trie les `all-day` d'un jour par `id` seulement, donc le `sort_order` de la liste est perdu. Décider si l'Agenda doit le conserver (champ de tri dans `CalendarEvent`) ou si l'ordre par `id` suffit.
- **PV1** P1 à P4, par les critères cités.
- **PV2** Le niveau des titres (`h3`) suit celui de l'en-tête de carte de `widget-host` : à vérifier en C2.
- **PV3** Montage de l'essai (§2, note) : relevé par le coordinateur avant la suppression de la branche ; écarts rapportés par l'implémenteur en début de C2.

## 10. Sources
Doc FullCalendar v7 consultée le 2026-11-20 (liste complète : ADR-004 §8). Pages citées ici :
- https://fullcalendar.io/docs/moreLinkClick
- https://fullcalendar.io/docs/dayMaxEvents
- https://fullcalendar.io/docs/hints
- https://fullcalendar.io/docs/popover-render-hooks
- https://fullcalendar.io/docs/Calendar-formatIso
- https://fullcalendar.io/docs/eventInteractive
- https://fullcalendar.io/docs/eventClick
- https://fullcalendar.io/docs/eventTimeFormat
- https://fullcalendar.io/docs/defaultTimedEventDuration
- https://fullcalendar.io/docs/height
- https://fullcalendar.io/docs/fixedWeekCount
- https://fullcalendar.io/docs/now
- https://fullcalendar.io/docs/upgrading-from-v6
- https://fullcalendar.io/docs/custom-view-with-settings
- https://fullcalendar.io/docs/list-day-header-render-hooks
- https://fullcalendar.io/docs/list-day-render-hooks
- https://cdn.jsdelivr.net/npm/fullcalendar@7.1.5/package.json
