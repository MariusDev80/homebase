# ADR-004 : Calendrier agrégé (bibliothèque d'affichage, `CalendarEvent`, sources)

- **Statut** : **accepté** (2026-11-20). Décisions D1 à D10 validées par Marius le 2026-11-20, telles que recommandées. Essai du §4 mené le 2026-11-20 ; verdict de Marius au §3.1. Bibliothèque retenue : **FullCalendar 7.1.5** (paquet npm `fullcalendar` seul, ses points d'entrée `fullcalendar/daygrid` et `fullcalendar/locales/fr`, plus `fullcalendar/list` si D11 de la spec est refusée), **sans** `@fullcalendar/angular`.
- **Auteur** : architect (Opus)
- **Liens** : `docs/PLAN.md` §2 (ligne « Calendrier »), §5, §9 point 2 ; `docs/ROADMAP.md` phase 2 ; ADR-001 §3.1 (R1 à R4), §3.2 (`loadCalendarSource` et son amendement timers-reminders), §7.1 ; ADR-003 §3.2, §3.4, §3.5.4, §3.6, §3.7, §3.10 ; `docs/DESIGN.md` §2, §3, §4, §5 ; `docs/SECURITY-NOTES.md` ; `docs/specs/habits.md` (H6) ; `docs/specs/timers-reminders.md` ; **`docs/specs/calendar.md`** (lots C1 à C3)
- **Ce qui suit** : la spec `docs/specs/calendar.md` est écrite. La branche locale d'essai `spike/calendar-lib` (jamais poussée) **sera donc supprimée** (`git branch -D spike/calendar-lib`) par le coordinateur, une fois retirées les instances `spike-*` du tableau de bord de développement. L'architecte n'a pas pu relire le code de l'essai (pas d'accès shell). **Avant la suppression**, le coordinateur relève donc par `git show` ce que le lot C2 reprend : imports des plugins et de la locale, props de classes du thème, mise à jour des événements, entrée `styles` d'`angular.json`. Il joint ce relevé à la mission de C2 (spec §2, PV3). Rien n'est à nettoyer sur `phase-2-calendar`.

> **Préséance** : l'ADR-003 §3.7 fige les champs temporels de `CalendarEvent` et la signature de `CalendarSource`. Cet ADR **ajoute** des champs (§3.2.1, §3.2.2) sans rien modifier de ce qui existe. Il ferme le point ouvert 1 de l'ADR-001 §7 et le point 2 du PLAN §9.

---

## 0. Décisions validées par Marius (2026-11-20)

Chaque ligne donne la **recommandation** de l'architecte, retenue telle quelle.

- **D1** Bibliothèque : **FullCalendar v7** (MIT), cœur JS et module `daygrid`, intégré par un composant adaptateur à nous, sans le wrapper `@fullcalendar/angular`. **Confirmé par l'essai** (§3.1). Schedule-X est écarté (§2.3). Repli : rendu maison (option C). (§2, §3.1)
- **D2** Un **widget** `calendar` en v1, sans page dédiée. Une page pourra réutiliser le même composant plus tard. (§1.1)
- **D3** Deux vues : **« Agenda »** (liste des N prochains jours, 14 par défaut, 7 ou 31 au choix) et **« Mois »** (grille de 6 semaines). Pas de vue semaine ni jour avec une grille horaire en v1 : les rappels sont des instants sans durée. Si la carte est trop petite, l'Agenda est imposé (§1.1). (§1.1, §3.2.4)
- **D4** **Lecture seule**. Un clic, ou Entrée, ouvre la fiche de l'événement dans la carte (titre, date, heure, fuseau d'origine, source). Pas de glisser-déposer ni de lien vers l'élément en v1. (§3.2.1)
- **D5** Sources v1 : les **rappels activés**, hors rappels d'habitude (H6), et les **tâches non terminées qui ont une échéance**. Les **habitudes** restent hors du calendrier en v1. (§3.2.3)
- **D6** Tâche répétée : seule l'**échéance courante** s'affiche, pas la série projetée. (§3.2.3)
- **D7** La semaine commence le **lundi**, sans réglage (ADR-003 §3.10).
- **D8** La barre d'outils est **la nôtre** : précédent, suivant, « Aujourd'hui », choix de la vue, avec les classes `btn` et les textes Transloco. Celle de la bibliothèque est masquée. (§3.2.5)
- **D9** Rafraîchissement : un service `CalendarChanges` (`core/calendar`) que les écritures de tâches et de rappels préviennent. S'y ajoutent le retour de focus ou de visibilité et le changement de jour (`Today`). (§3.2.6)
- **D10** Couleur : un **ton sémantique** fixé par la source (rappel `accent`, tâche `neutral`, tâche en retard `danger`). L'utilisateur ne choisit pas de couleur en v1. (§3.2.1)

La spec propose une décision nouvelle, **D11** (Agenda rendu par nous, FullCalendar réservé au Mois), soumise à Marius : voir `docs/specs/calendar.md` §0.

---

## 1. Contexte

### 1.1 Besoin
- **Agrégation** : le widget affiche les `CalendarSource` déclarées par les définitions de widgets (`loadCalendarSource`, ADR-001 §3.2). La source est **par type** et non par instance : les rappels s'affichent même si aucun widget Rappels n'est placé. Sources v1 : rappels, par `ReminderRepository.list()` puis `RECURRENCE_ENGINE.expand`, et échéances des tâches. Habitudes et objectifs viendront plus tard (D5).
- **Tailles** : la grille fait 12 × 8 (DESIGN §4). Le widget va de **3 × 3** (min) à **12 × 8** (max), 6 × 5 par défaut. Règle par la taille réelle du corps, pas par nombre de colonnes : sous **36rem** de large ou **22rem** de haut (seuils à confirmer en C2), seul l'Agenda est proposé. Au-dessus, Agenda et Mois.
- **Interaction** : lecture seule (D4). Le glisser-déposer d'une échéance reste une évolution possible (module `interaction` libre), pas à construire.
- **Temps** (ADR-003) : les instants s'affichent dans le fuseau utilisateur (`UserTimeZone`). Les événements « toute la journée » sont des dates murales qui ne bougent jamais avec le fuseau. Une heure dans un autre fuseau que celui d'affichage s'affiche « 03:00 (09:00 Paris) » dans la fiche (ADR-003 §3.2, `zoneCity`). Le « maintenant » vient de `CLOCK`. Aucun calcul de date à la main.
- **UI** : tokens `--hb-*` et classes sémantiques seulement (DESIGN §5, `check-design-tokens`). Clair et sombre à parité. Cartes teintées. Bordures plutôt qu'ombres. Heures en **HH:MM sur 24 h** partout.
- **i18n** : textes en français par Transloco, dates par `TimeDisplay`.
- **Accessibilité** : tout au clavier, focus visible (`--hb-focus`), noms accessibles complets (« Rappel : Payer le loyer, mercredi 18 novembre, 09:00 »), contraste AA, `prefers-reduced-motion`. **Tous** les événements d'un jour sont atteignables, à la souris comme au clavier.
- **Sécurité** : titres = données utilisateur, rendues en texte seul. CSP inchangée. Aucune ressource distante.
- **Budget** : aucun code de bibliothèque dans le chargement initial (§3.1, E2).

### 1.2 Faits vérifiés (consultés le 2026-11-20)

| # | Fait | Source |
|---|---|---|
| V1 | **FullCalendar** : `fullcalendar` **7.1.5** (`latest`), MIT. Dépendances : `preact` ^10.29.8, `@fullcalendar/core` 7.1.5, `@full-ui/headless-calendar` 7.1.5. Peer : `temporal-polyfill` ^1.0.7. Exports : `.`, `./daygrid`, `./list`, `./interaction`, `./locales/*`, `./skeleton.css`, thèmes | https://registry.npmjs.org/fullcalendar/latest ; https://cdn.jsdelivr.net/npm/fullcalendar@7.1.5/package.json |
| V2 | `@fullcalendar/angular` 7.1.5 : rien sur le mode zoneless ni les signals | https://registry.npmjs.org/@fullcalendar/angular/latest |
| V3 | Modules libres dans le paquet MIT : `daygrid`, `timegrid`, `list`, `multimonth`, `interaction`, `locales/*` | V1 ; https://fullcalendar.io/docs/upgrading-from-v6 |
| V4 | v7 n'embarque plus de CSS de thème ; `skeleton.css` est requis, sans couleur. Le thème passe par des **props de classes** (`dayCellClass`, `eventClass`…) ; la prop d'événement `classNames` devient `className` | https://fullcalendar.io/docs/upgrading-from-v6 ; https://fullcalendar.io/docs/custom-themes |
| V5 | `timeZone` accepte un fuseau IANA sans plugin. Les `Date` de l'API sont des instants ; `calendar.formatIso(date, true)` rend la date `YYYY-MM-DD` dans le fuseau du calendrier | https://fullcalendar.io/docs/timeZone ; https://fullcalendar.io/docs/Calendar-formatIso |
| V6 | Accessibilité v7 : Axe, éléments interactifs atteignables par Tab, `eventInteractive: true` rend tous les événements focalisables, popover navigable au clavier, libellés par les `*Hint` (`moreLinkHint` reçoit le nombre caché, `closeHint`) | https://fullcalendar.io/docs/accessibility ; https://fullcalendar.io/docs/eventInteractive ; https://fullcalendar.io/docs/hints |
| V7 | Poids de `fullcalendar@7.1.5` (entrée `.`) : 133 981 o minifiés, 41 095 o gzip | https://bundlephobia.com/api/size?package=fullcalendar@7.1.5 |
| V8 | Dépôt actif (dernier push 2026-11-12), projet financé par son offre premium | https://api.github.com/repos/fullcalendar/fullcalendar |
| V9-V16 | Faits sur Schedule-X : retirés avec l'option (§2.3) | — |
| V17 | CSP : `script-src 'self'`, `style-src 'self' 'unsafe-inline'` ; `connect-src` limité à l'IPC | `apps/desktop/src-tauri/tauri.conf.json` ; `docs/SECURITY-NOTES.md` |
| V18 | Budgets : `initial` 500 kB (avertissement) / 1 MB (erreur) ; `anyComponentStyle` 4 kB / 8 kB ; `inlineCritical: false` | `apps/web/angular.json` l. 34-53 |
| V19 | `loadCalendarSource?: () => Promise<Type<CalendarSource>>` existe ; aucun widget ne le définit. `ReminderRepository.list()` exclut les rappels d'habitude. `TodoRepository` ne lit les tâches que par liste. `RECURRENCE_ENGINE.expand` : plage ≤ 400 jours, limite 1 à 1000 | `core/widgets/widget-definition.ts` l. 55 ; `data/repositories.ts` l. 150-222 ; `core/time/recurrence-engine.ts` |
| V20 | ESLint interdit `Date` (valeur), `Temporal.Now` et `Intl.DateTimeFormat` hors de `core/time` ; `check-design-tokens` contrôle `.html`, `.css`, `.ts` | `apps/web/eslint.config.js` l. 68-111 ; `apps/web/scripts/check-design-tokens.mjs` |
| V21 | `dayMaxEvents` (daygrid) : nombre, ou `true` = limité par la hauteur de la cellule ; le reste derrière un lien « +N » | https://fullcalendar.io/docs/dayMaxEvents |
| V22 | `moreLinkClick` : `"popover"` (défaut), `"week"`, `"day"`, nom de vue, ou **fonction** `(info: { date, allSegs, hiddenSegs, jsEvent })` ; si elle renvoie une chaîne, ce comportement s'applique, sinon seul notre code s'exécute | https://fullcalendar.io/docs/moreLinkClick |
| V23 | Popover : seules `popoverClass`, `popoverCloseClass`, `popoverCloseContent` ; il est rendu dans **`<body>`** (z-index par `--fc-popover-z`) ; son corps reprend `dayCellClass` avec `inPopover: true`. Rien n'est documenté sur sa hauteur ni son défilement | https://fullcalendar.io/docs/popover-render-hooks ; https://fullcalendar.io/docs/day-cell-render-hooks |
| V24 | Vue liste v7 : colonne d'heure **fixée à 165 px** ; en-têtes de jour par `listDayHeaderClass` / `listDayHeaderInnerClass` / `listDayHeaderContent` (arguments `date`, `isToday`, `isPast`, `isFuture`, `text`, `level`) ; `listDaysClass`, `listDayClass`, `listDayBodyClass` | https://fullcalendar.io/docs/upgrading-from-v6 ; https://fullcalendar.io/docs/list-day-header-render-hooks ; https://fullcalendar.io/docs/list-day-render-hooks |
| V25 | `eventTimeFormat` : défauts « 7p » (daygrid) et « 7pm » (liste) ; `{ hour: '2-digit', minute: '2-digit', meridiem: false }` donne « 14:30 » | https://fullcalendar.io/docs/eventTimeFormat |
| V26 | `defaultTimedEventDuration` vaut `'01:00'` par défaut ; `headerToolbar` est désactivée par défaut en v7 ; `height: '100%'` suit le parent ; `fixedWeekCount: true` (défaut) = toujours 6 semaines ; `now` accepte une date analysable (chaîne ISO) | https://fullcalendar.io/docs/defaultTimedEventDuration ; https://fullcalendar.io/docs/upgrading-from-v6 ; https://fullcalendar.io/docs/height ; https://fullcalendar.io/docs/fixedWeekCount ; https://fullcalendar.io/docs/now |
| V27 | `eventClick(info: { event, el, jsEvent, view })` sans plugin ; un événement avec `url` navigue la fenêtre (à empêcher par `jsEvent.preventDefault()`) | https://fullcalendar.io/docs/eventClick |

### 1.3 Suppositions : état après l'essai

| # | Supposition | État |
|---|---|---|
| S1 | Le cœur JS tourne sans zone.js (création dans `afterNextRender`, destruction par `DestroyRef`) | Tenu à l'essai (rendu dans le widget d'essai) ; revérifié en C2 |
| S2 | L'adaptateur n'a pas besoin de construire de `Date` | À tenir en C2 : lecture de chaînes et `calendar.formatIso` seulement (V5) |
| S3 | `now` accepte notre horloge (`CLOCK`) | Non relevé à l'essai : test de C2 |
| S7 | Une feuille non injectée (`inject: false`), chargée par `<link>`, laisse le total initial inchangé et respecte `style-src 'self'` | **Vérifié** (§3.1 : CSS à part, aucune bibliothèque dans un chunk initial) ; la console CSP reste à revoir en release (C2) |
| S8 | Le titre est rendu en texte si l'on n'utilise aucun gabarit HTML | **Vérifié** : F8 rendu en texte (jsdom) |
| S9 | 100 rappels développés sur 42 jours (8 appels en parallèle) en moins de 300 ms | Mesure du lot C1 |

S4 à S6 (Schedule-X) sont sans objet.

---

## 2. Options étudiées

| Option | Pour | Contre |
|---|---|---|
| **A. FullCalendar v7** (cœur JS + `daygrid`) | Thème par props de classes : nos classes sémantiques s'appliquent directement ; `skeleton.css` sans couleur ; accessibilité documentée ; fuseaux IANA natifs ; glisser-déposer resté libre ; projet très actif et financé ; `fr` fourni | Chunk paresseux le plus lourd (Preact + polyfill Temporal embarqué) ; API en `Date` ; quelques réglages imposés (§3.1) ; popover rendu hors de la carte (V23) ; colonne d'heure de la vue liste fixée à 165 px (V24) |
| **C. Rendu maison** (Angular pur) | Zéro dépendance ; tokens, requêtes de conteneur et i18n natifs ; chunk minimal | Grille de 42 cellules, barres sur plusieurs jours, « +N », navigation clavier en grille : à écrire et tester. Pas de vue horaire ni de glisser-déposer sans gros travail |

### 2.1 Critères pondérés (notes de 0 à 5, après essai)

| Critère | Poids | A. FullCalendar | C. Maison |
|---|---|---|---|
| Rendu en tokens, clair et sombre, cartes teintées | 20 | 5 | 5 |
| Lisibilité de 3 × 3 à 12 × 8 | 15 | 3 | 5 |
| Accessibilité (clavier, lecteur d'écran) | 15 | 4 | 3 |
| Coût d'intégration et de maintenance chez nous | 15 | 3 | 2 |
| Poids paresseux, CSS hors chargement initial | 10 | 3 | 5 |
| Pérennité amont, licence | 10 | 5 | 4 |
| Évolutivité (vue horaire, glisser-déposer) | 10 | 5 | 1 |
| Accord avec l'ADR-003 et dépendances | 5 | 3 | 5 |
| **Total sur 100** | | **79** | **75** |

### 2.2 Éliminatoires (rappel)
Erreur CSP ou CSP à modifier ; bibliothèque dans un chunk initial ; couleur brute dans nos fichiers ; titre interprété comme du HTML ; `npm ci --ignore-scripts` en échec. FullCalendar n'en a déclenché aucun (§3.1).

### 2.3 Option écartée : B. Schedule-X 4.9.1
Retirée après l'essai, pour ces raisons cumulées :
- **Installation** : `npm ci` échoue sans `overrides` (peer `temporal-polyfill` en version exacte 0.3.2) et l'essai a exigé un paquet de plus, `@schedule-x/calendar-controls`.
- **CSS** : 31,45 kB contre 4,84 kB, rôles Material éloignés de nos tokens, `#f00` en dur non neutralisé.
- **Rendu** : vue liste non bornée, heures affichées en double.
- **Règles du projet** : le lint de l'ADR-003 a dû être contourné.
- **Amont** : accessibilité non documentée, glisser-déposer devenu premium.
Son seul avantage mesuré (chunk JS de 178,88 kB contre 198,19 kB) ne compense rien de ceci.
Sources consultées le 2026-11-20 : https://registry.npmjs.org/@schedule-x/calendar/4.9.1 ; https://schedule-x.dev/docs/calendar/views ; https://schedule-x.dev/docs/calendar/theme ; https://schedule-x.dev/docs/calendar/major-version-migrations ; https://api.github.com/repos/schedule-x/schedule-x.

---

## 3. Décision

### 3.1 Bibliothèque : FullCalendar 7.1.5 (D1, après essai)

**Relevé automatisé de l'implémenteur** (branche `spike/calendar-lib`, 2026-11-20) :

| Mesure | FullCalendar 7.1.5 | Schedule-X 4.9.1 (pour mémoire) |
|---|---|---|
| `npm ci --ignore-scripts` | passe sans `overrides` ; `temporal-polyfill` en ^1.0.8 (déjà la version de `main`) | échoue sans `overrides` ; exige `@schedule-x/calendar-controls` |
| Chunk JS paresseux | 198,19 kB brut, 50,78 kB estimé | 178,88 kB brut, 37,73 kB estimé |
| CSS non injecté | `spike-fc.css` 4,84 kB | `spike-sx.css` 31,45 kB |
| Total initial | 494,82 → 496,40 kB (+1,58 kB) avec les **deux** widgets d'essai enregistrés | (même mesure) |
| E8 (jsdom, Paris et Santiago) | OK ; F8 rendu en texte | OK |

- **E2 tranché** : la tolérance de ±1 kB du §4.4 vise **le code des bibliothèques** : aucun octet de `fullcalendar`, `@fullcalendar/core`, `@full-ui/headless-calendar` ni `preact` dans un chunk initial. C'est le cas. Le coût d'une **définition de widget** (définition + `provideWidget`, environ 0,7 kB ; ici deux, d'où +1,58 kB) est **accepté**, comme pour tout widget.
- **Réglages imposés par FullCalendar, validés à l'essai** :
  - `defaultTimedEventDuration: { minutes: 0 }` et `end` toujours omis : sinon un événement de 23:30 déborde sur le lendemain (défaut d'une heure, V26).
  - `headerToolbar: false` (D8).
  - Thème **uniquement** par les props de classes (`eventClass`, `dayCellClass`, `dayHeaderClass`…, et `className` par événement) : `skeleton.css` n'a que des classes hachées, impossibles à cibler.
  - **Heures en HH:MM sur 24 h** : l'essai affichait « 9:00 » en Agenda et « 02 h » en Mois. `eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false }` (V25) pour FullCalendar ; `TimeDisplay` (style `time`) pour tout ce que nous rendons.
- **Verdict de Marius après l'essai visuel (2026-11-20)** : FullCalendar lui convient ; ADR acceptée. **Deux défauts à corriger** dans l'implémentation réelle (critères dans la spec, §3 et lots C2) :
  1. **Agenda (liste sur 7 jours)** : les jours se distinguent mal, les événements semblent se suivre sans séparation. Il faut une séparation nette par jour (en-tête visible avec la date et « Aujourd'hui », bordures, groupes), en tokens, lisible à 3 × 3. *Solution retenue par la spec* : Agenda rendu par nous, groupé par jour (D11, soumise à Marius) ; repli décrit si D11 est refusée.
  2. **Mois** : la liste « +N » (popover) ne défile pas, des événements restent invisibles. Il faut que tous les événements d'un jour soient atteignables, souris et clavier. *Solution retenue* : `moreLinkClick` en fonction, qui ouvre **notre panneau « Jour » dans la carte**, défilant, cohérent avec D4 ; le popover de FullCalendar (rendu dans `<body>`, hauteur non documentée, V23) n'est jamais ouvert.

**Points d'entrée utilisés** : `fullcalendar` (cœur), `fullcalendar/daygrid`, `fullcalendar/locales/fr`, `fullcalendar/skeleton.css`. Le wrapper `@fullcalendar/angular` n'est pas retenu (une dépendance de moins, aucune garantie zoneless, V2).

### 3.2 Ce qui est figé (indépendant de la bibliothèque)

#### 3.2.1 Extension de `CalendarEvent` (`core/calendar/calendar-source.ts`)
```ts
/** Closed set of semantic tones; the view maps each to --hb-* tokens (a tinted card redefines
 *  them). Never a raw colour: no hex, no user-chosen colour in v1 (D10). */
export type CalendarTone = 'neutral' | 'accent' | 'success' | 'attention' | 'danger';

export interface CalendarEvent {
  // ...fields of ADR-003 3.7, unchanged
  readonly tone: CalendarTone;
}
```
- **Couleur** : `tone` seulement. La couleur n'est jamais le seul porteur de sens : la fiche et le nom accessible disent « Rappel », « Tâche », « en retard ».
- **Lien** : **aucun champ** en v1 (D4). Une navigation interne future passera par un amendement, **jamais par une URL** : FullCalendar transforme `url` en lien qui ferait naviguer la WebView (V27). L'adaptateur ne la renseigne jamais.
- **Éditabilité** : aucun champ en v1. Un glisser-déposer futur ajoutera, par amendement, une méthode optionnelle à `CalendarSource`.
- **Libellé et icône de la source** : pris de la `WidgetDefinition` du type (`titleKey`, `icon`).

#### 3.2.2 Chargement des sources et agrégateur (`core/calendar/calendar-aggregator.ts`)
```ts
export interface AggregatedEvents {
  /** Deduplicated by id (first kept), sorted: all-day first, then by start (string order). */
  readonly events: readonly CalendarEvent[];
  /** sourceType of every source whose listEvents rejected (partial result shown). */
  readonly failedSources: readonly string[];
  /** More than MAX_CALENDAR_EVENTS (2000) events: the rest is dropped. */
  readonly truncated: boolean;
  /** Added 2026-11-20: at least one source failed and every failure was DataError('unavailable'). */
  readonly unavailable: boolean;
}
@Injectable({ providedIn: 'root' })
export class CalendarAggregator { listEvents(range: CalendarRange): Promise<AggregatedEvents>; }
```
- L'agrégateur parcourt les définitions du `WidgetRegistry` qui ont un `loadCalendarSource`, charge chaque source **une fois** (promesse mise en cache, retirée du cache en cas d'échec) puis l'obtient par l'`Injector` racine. **Aucun import statique** de source (ADR-001 R1, R2).
- Appels par `Promise.allSettled` : une source en échec ne masque pas les autres (bandeau `flash-attention`). `unavailable` permet le bandeau `common.desktopOnly` hors Tauri (L4).
- **Contrôle d'intégrité** : un événement dont `sourceType` diffère du `type` de sa définition, dont l'`id` n'a pas la forme de l'ADR-003 §3.7, dont la `time` est invalide ou hors de la plage, ou dont le `tone` est inconnu, est écarté et journalisé en développement (identifiants seulement).
- `core/calendar/index.ts` n'est importé que par le widget `calendar` et, en type seulement, par `widget-definition.ts`. Seul `core/calendar/calendar-changes.ts` (sans dépendance) est importé directement par les écrivains (§3.2.6).

#### 3.2.3 Sources v1 (D5, D6)
| Source | Fichier | Données | `CalendarEvent` |
|---|---|---|---|
| Rappels | `widgets/reminders/reminders.calendar-source.ts`, déclarée par `loadCalendarSource` dans `reminders.definition.ts` | `ReminderRepository.list()` filtré sur `enabled` et `status !== 'invalid'` ; puis `RECURRENCE_ENGINE.expand({ anchor: date-time, rrule, exdates }, { ...range, limit: 500 })`, 8 appels en parallèle au plus | `timed`, `start` = instant de l'occurrence, `end: null`, `timeZone` = celui du rappel ; `occurrenceKey` = clé si `rrule`, sinon `null` ; `tone: 'accent'`. Un rappel dont l'expansion échoue est sauté |
| Tâches | `widgets/todo/todo.calendar-source.ts`, déclarée dans `todo.definition.ts` | **Nouvelle** méthode `TodoRepository.listDue(range: { fromOn; toOn }, limit)` : toutes listes, `completed_at IS NULL AND due_on BETWEEN ? AND ?`, triées par `due_on, sort_order, id`, `LIMIT` ≤ 1000 | `all-day`, `startOn = lastOn = dueOn` ; `occurrenceKey: null` ; `tone` = `danger` si `dueOn` < `Today.date()`, sinon `neutral` |
| Habitudes | aucune en v1 | — | — |

#### 3.2.4 Plages et bornes
- Plage calculée dans le fuseau d'affichage par `core/time` : `from = startOfDay(premier jour, tz)`, `to = startOfDay(dernier jour + 1, tz)`. Aucune arithmétique en millisecondes.
- **Mois** : 42 jours, du lundi précédant ou égal au 1er du mois (`startOfIsoWeek`), identique à la grille de FullCalendar (`firstDay: 1`, `fixedWeekCount: true`, V26). **Agenda** : de l'ancre (aujourd'hui par défaut) à ancre + N − 1, N ∈ {7, 14, 31}. Toute plage fait **au plus 62 jours** ; l'agrégateur refuse au-delà (`invalid_input`).
- Une règle revient au plus une fois par jour : 62 occurrences au plus par rappel, sous la limite de 500.
- `rangeLocalDates(range): { firstOn; lastOn }` (`core/calendar`, testé) : les jours dont la journée chevauche `[from, to)`.

#### 3.2.5 Conversion vers FullCalendar (adaptateur, dans `widgets/calendar/`)
- `timed` : chaîne ISO de l'instant, `timeZone` du calendrier = `UserTimeZone`. `end` toujours omis, avec `defaultTimedEventDuration: { minutes: 0 }` (§3.1).
- `all-day` : `start` = `startOn`, fin **exclusive** = `addDays(lastOn, 1)` (ADR-003 §3.7), `allDay: true`.
- **Interdit** : `url`, contenu HTML (`eventContent` qui renvoie `{ html }`, `innerHTML` dans un `*DidMount`), locales chargées depuis un CDN, `navLinks`. Le titre passe en texte seul. `setAttribute('aria-label', …)` dans `eventDidMount` est permis.
- `headerToolbar: false`, navigation par l'API depuis notre barre (D8). `firstDay: 1` (D7), locale `fr`, `now` = `CLOCK` (chaîne ISO).
- Une `Date` reçue de la bibliothèque n'est jamais construite ni manipulée : seulement lue par `calendar.formatIso(date, true)` (V5), dans l'adaptateur, puis validée (`isValidLocalDate`).
- **CSS de la bibliothèque** : jamais dans `src/styles.css` ni dans les styles d'un composant. Entrée `styles` d'`angular.json` `{ input: "fullcalendar/skeleton.css", bundleName: "calendar-lib", inject: false }` (ou le chemin retenu à l'essai), chargée par un `<link rel="stylesheet">` que l'adaptateur insère une seule fois (S7). Le thème passe par nos classes sémantiques dans les props de classes.

#### 3.2.6 Rafraîchissement (D9)
`CalendarChanges` (`core/calendar/calendar-changes.ts`, `providedIn: 'root'`, sans dépendance) expose `version: Signal<number>` et `notify(sourceType)`. Les écrivains l'appellent après chaque écriture réussie : `ReminderStore`, les composants du widget TODO (aucun store TODO n'existe : les écritures sont dans `todo.component.ts` et `todo-detail.component.ts`) et `DashboardStore.remove` (un widget TODO supprimé emporte ses tâches). Le widget recharge sa plage quand `version`, `Today.date()` ou `UserTimeZone` changent, et au retour de focus ou de visibilité, avec un anti-rebond de 300 ms. La dernière réponse l'emporte (compteur de requête).

---

## 4. Essai (mené le 2026-11-20)

Branche locale `spike/calendar-lib`, jamais poussée ni fusionnée, widgets `spike-fc` et `spike-sx` côte à côte, source factice `SpikeFixtureSource`. Relevé au §3.1. Les fixtures ci-dessous restent la référence des tests de la spec (`widgets/calendar/testing/calendar-fixtures.ts`).

### 4.1 Données fictives (Paris UTC+1, Santiago UTC−3 en novembre 2026)
| # | Événement | Attendu à Paris | Attendu à Santiago |
|---|---|---|---|
| F1 | `timed` `2026-11-18T08:00:00.000Z`, `Europe/Paris` | 18/11 09:00 | 18/11 05:00, « (09:00 Paris) » dans la fiche |
| F2 | `timed` `2026-11-18T22:30:00.000Z`, `Europe/Paris` | 18/11 23:30 | 18/11 19:30 |
| F3 | `timed` `2026-11-18T01:00:00.000Z`, `Europe/Paris` | 18/11 02:00 | **17/11** 22:00 |
| F4 | `all-day` `2026-11-18` → `2026-11-18` | 18/11 | 18/11 |
| F5 | `all-day` `2026-11-23` → `2026-11-25` | lundi au mercredi | idem |
| F6 | `timed` `2026-10-25T00:30:00.000Z`, `Europe/Paris` (pli) | 25/10 02:30 | 24/10 21:30 |
| F7 | `timed` `2026-11-19T14:00:00.000Z`, `America/Montreal` | 19/11 15:00, « (09:00 Montréal) » | 19/11 11:00 |
| F8 | `all-day` `2026-11-19`, titre `<img src=x onerror=alert(1)>` | texte littéral | idem |
| F9 | `timed` `2026-11-19T10:00:00.000Z`, titre de 200 caractères | tronqué, complet dans la fiche | idem |
| F10 | 12 événements `timed` le `2026-11-20` | « +N » en Mois, tous atteignables ; liste complète en Agenda | idem |
| F11 | `timed` `2026-11-22T22:30:00.000Z`, `Europe/Paris` (dimanche 23:30) | dernière colonne de la semaine | dimanche 19:30 |

Tons : F1, F2, F3, F6, F7, F9, F10, F11 `accent` ; F4 `danger` ; F5, F8 `neutral`.

### 4.2 Étapes menées
E1 installation, E2 build et poids, E3 thèmes, E4 lecture de l'adaptateur, E5 tailles, E6 clavier, E7 CSP, E8 fixtures : protocole de la version « proposé » de cet ADR. E5, E6 et E7 en release sont **repris** comme vérifications manuelles de la spec (MC1 à MC8).

---

## 5. Conséquences
Positives :
- Sources, agrégateur, `listDue` et ton ne dépendent pas de la bibliothèque : le lot C1 démarre tout de suite.
- La bibliothèque est enfermée dans le composant Mois du widget `calendar`, chargé seulement quand la vue Mois s'affiche. En changer ne touche ni `core/` ni `data/`.
- Aucun changement de CSP ni du budget initial (hors définition du widget, §3.1).

Négatives et coûts :
- Une méthode de plus dans `TodoRepository` (SQL et tests `test:data`), sans migration (la table est petite ; pas d'index sur `due_on`).
- N appels IPC `time_expand` par plage (S9). Si c'est trop lent : commande Rust groupée (amendement à timers-reminders).
- Chunk paresseux d'environ 200 kB bruts, dont un polyfill Temporal inutile en production.
- Une feuille non injectée et son `<link>` : mécanisme nouveau, à documenter dans `SECURITY-NOTES.md` (amendement proposé par la spec).

## 6. Risques
| Risque | Impact | Mitigation |
|---|---|---|
| R2. FullCalendar change ses noms de classes ou ses props (v7 date de juin 2026) | Thème cassé à une mise à jour | Version exacte `7.1.5`, Dependabot, vérification visuelle MC3 à chaque montée |
| R3. Une bibliothèque injecte un jour du HTML venant d'un titre | XSS dans la WebView | Aucun gabarit HTML ; F8 en test unitaire de l'adaptateur et de l'Agenda |
| R4. Charge IPC avec beaucoup de rappels | Calendrier lent | 8 appels en parallèle, plage ≤ 62 jours, mesure S9, commande groupée en repli |
| R5. Calendrier périmé après une modification ailleurs | Information fausse | `CalendarChanges` (D9), plus focus et visibilité |
| R6. Fiche d'un rappel dans un autre fuseau mal comprise | Confusion d'heure | « 03:00 (09:00 Paris) » (ADR-003 §3.2) |
| R7. `skeleton.css` (`!important`, hors `@layer`) l'emporte sur nos utilitaires | Rendu incohérent | Le squelette ne touche pas aux couleurs ; vérifié à l'essai et en MC3 |
| R8. Popover de FullCalendar rendu dans `<body>`, hors de la carte | Défaut 2 (défilement), teinte de carte perdue | Jamais ouvert : `moreLinkClick` en fonction, panneau « Jour » dans la carte |
| R9. Le total initial approche l'avertissement de 500 kB (≈ 495 kB + 0,7 kB par définition) | Avertissement de build aux prochains widgets | Hors de cet ADR ; à arbitrer en fin de phase 2 (relever le seuil ou alléger l'initial) |

## 7. Cas limites (repris dans la spec calendar, §5)
| # | Cas | Attendu |
|---|---|---|
| L1 | Changement d'heure (pli, trou) | Instants résolus par le Rust (ADR-003 §3.3) ; la vue affiche l'instant sans recalcul (F6) |
| L2 | Changement de fuseau utilisateur | Rechargement (D9) ; les `all-day` ne bougent pas ; un `timed` peut changer de jour (F3) |
| L3 | Minuit inexistant (`America/Santiago`, 2026-09-06) | La plage commence à `startOfDay` (01:00 locale), ADR-003 C23 |
| L4 | Hors Tauri (`web:start`) | Les sources rejettent `unavailable` ; bandeau `common.desktopOnly`, pas d'exception |
| L5 | Doublons | Supprimés par `id` dans l'agrégateur |
| L6 | Rappel supprimé ou désactivé pendant l'affichage | Disparaît au rechargement suivant (D9) |
| L7 | Tâche terminée, ou échéance retirée | Disparaît ; une tâche répétée cochée avance d'une échéance (D6) |
| L8 | Une source en échec | Les autres s'affichent ; bandeau |
| L9 | Plus de 2000 événements | Coupe et mention `truncated` |
| L10 | Hors ligne, synchronisation | Sans objet : tout est local |
| L11 | Navigation rapide | Les réponses périmées sont ignorées |
| L12 | Widget de 3 × 3 | Agenda imposé ; le choix de vue est masqué |
| L13 | Beaucoup d'événements un même jour (F10) | Mois : « +N » ouvre le panneau « Jour », qui défile ; Agenda : tous listés sous l'en-tête du jour |

## 8. Sources
FullCalendar (consultées le 2026-11-20) : https://registry.npmjs.org/fullcalendar/latest ; https://cdn.jsdelivr.net/npm/fullcalendar@7.1.5/package.json ; https://registry.npmjs.org/@fullcalendar/angular/latest ; https://fullcalendar.io/docs/upgrading-from-v6 ; https://fullcalendar.io/docs/custom-themes ; https://fullcalendar.io/docs/render-hook-index ; https://fullcalendar.io/docs/timeZone ; https://fullcalendar.io/docs/Calendar-formatIso ; https://fullcalendar.io/docs/accessibility ; https://fullcalendar.io/docs/eventInteractive ; https://fullcalendar.io/docs/hints ; https://fullcalendar.io/docs/dayMaxEvents ; https://fullcalendar.io/docs/moreLinkClick ; https://fullcalendar.io/docs/more-link-render-hooks ; https://fullcalendar.io/docs/popover-render-hooks ; https://fullcalendar.io/docs/day-cell-render-hooks ; https://fullcalendar.io/docs/list-day-header-render-hooks ; https://fullcalendar.io/docs/list-day-render-hooks ; https://fullcalendar.io/docs/custom-view-with-settings ; https://fullcalendar.io/docs/eventTimeFormat ; https://fullcalendar.io/docs/defaultTimedEventDuration ; https://fullcalendar.io/docs/height ; https://fullcalendar.io/docs/fixedWeekCount ; https://fullcalendar.io/docs/now ; https://fullcalendar.io/docs/eventClick ; https://bundlephobia.com/api/size?package=fullcalendar@7.1.5 ; https://api.github.com/repos/fullcalendar/fullcalendar.
Schedule-X : voir §2.3.
