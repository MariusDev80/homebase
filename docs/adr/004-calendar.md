# ADR-004 : Calendrier agrégé (bibliothèque d'affichage, `CalendarEvent`, sources)

- **Statut** : **proposé** (2026-11-20) ; décisions D1 à D10 validées par Marius le 2026-11-20, telles que recommandées. La bibliothèque (§3.1, D1) reste **conditionnée à l'essai du §4**. Le §3.2 est indépendant de la bibliothèque.
- **Auteur** : architect (Opus)
- **Liens** : `docs/PLAN.md` §2 (ligne « Calendrier »), §5, §9 point 2 ; `docs/ROADMAP.md` phase 2 ; ADR-001 §3.1 (R1 à R4), §3.2 (`loadCalendarSource` et son amendement timers-reminders), §7.1 ; ADR-003 §3.2, §3.4, §3.5.4, §3.6, §3.7, §3.10 ; `docs/DESIGN.md` §2, §3, §4, §5 ; `docs/SECURITY-NOTES.md` ; `docs/specs/habits.md` (H6) ; `docs/specs/timers-reminders.md`
- **Ce qui suit** : après l'essai, l'architecte passe cet ADR en « accepté », amende le §3.1 avec les mesures et rédige `docs/specs/calendar.md` (lots). Le lot « sources » (§3.2) peut démarrer avant.

> **Préséance** : l'ADR-003 §3.7 fige les champs temporels de `CalendarEvent` et la signature de `CalendarSource`. Cet ADR **ajoute** un champ (§3.2.1) sans rien modifier de ce qui existe. Il ferme le point ouvert 1 de l'ADR-001 §7 et le point 2 du PLAN §9.

---

## 0. Décisions validées par Marius (2026-11-20)

Chaque ligne donne la **recommandation** de l'architecte. Une réponse différente modifie les sections citées.

- **D1** Bibliothèque : **FullCalendar v7**, avec ses modules libres (MIT) `fullcalendar/daygrid` et `fullcalendar/list`. On utilise son cœur JS par un composant adaptateur à nous, sans le wrapper `@fullcalendar/angular`. Le choix reste **conditionné à l'essai** (§4). Repli : rendu maison (option C). Schedule-X n'est retenu que s'il bat FullCalendar à l'essai. *Recommandation : oui.* (§2, §3.1)
- **D2** Un **widget** `calendar` en v1, sans page dédiée. Une page pourra réutiliser le même composant plus tard. *Recommandation : oui.* (§1.1)
- **D3** Deux vues : **« Agenda »** (liste des N prochains jours, 14 par défaut, 7 ou 31 au choix) et **« Mois »** (grille de 6 semaines). Pas de vue semaine ni jour avec une grille horaire en v1 : les rappels sont des instants sans durée. Si la carte est trop petite, l'Agenda est imposé (§1.1). *Recommandation : oui.* (§1.1, §3.2.4)
- **D4** **Lecture seule**. Un clic, ou Entrée, ouvre la fiche de l'événement dans la carte (titre, date, heure, fuseau d'origine, source). Pas de glisser-déposer ni de lien vers l'élément en v1. *Recommandation : oui.* (§3.2.1)
- **D5** Sources v1 : les **rappels activés**, hors rappels d'habitude (H6), et les **tâches non terminées qui ont une échéance**. Les **habitudes** restent hors du calendrier en v1 : une habitude quotidienne remplirait chaque case. *Recommandation : oui.* (§3.2.3)
- **D6** Tâche répétée : seule l'**échéance courante** s'affiche, pas la série projetée. Projeter la série demanderait d'étendre `date-rule.ts` à une plage, contre l'ADR-003 §3.9. *Recommandation : oui.* (§3.2.3)
- **D7** La semaine commence le **lundi**, sans réglage (ADR-003 §3.10). *Recommandation : oui.*
- **D8** La barre d'outils est **la nôtre** : précédent, suivant, « Aujourd'hui », choix de la vue, avec les classes `btn` et les textes Transloco. Celle de la bibliothèque est masquée. *Recommandation : oui.* (§3.2.5)
- **D9** Rafraîchissement : un service `CalendarChanges` (`core/calendar`) que les stores TODO et Rappels préviennent après chaque écriture. S'y ajoutent le retour de focus ou de visibilité et le changement de jour (`Today`). *Recommandation : oui.* (§3.2.6)
- **D10** Couleur : un **ton sémantique** fixé par la source (rappel `accent`, tâche `neutral`, tâche en retard `danger`). L'utilisateur ne choisit pas de couleur en v1. *Recommandation : oui.* (§3.2.1)

---

## 1. Contexte

### 1.1 Besoin
- **Agrégation** : le widget affiche les `CalendarSource` déclarées par les définitions de widgets (`loadCalendarSource`, ADR-001 §3.2). La source est **par type** et non par instance : les rappels s'affichent même si aucun widget Rappels n'est placé. Sources v1 : rappels, par `ReminderRepository.list()` puis `RECURRENCE_ENGINE.expand`, et échéances des tâches. Habitudes et objectifs viendront plus tard (D5).
- **Tailles** : la grille fait 12 × 8 (DESIGN §4). Le widget va de **3 × 3** (min) à **12 × 8** (max), 6 × 5 par défaut. La largeur réelle du corps dépend de la fenêtre et sera relevée à l'essai. Règle par requêtes de conteneur, pas par nombre de colonnes : sous **36rem** de large ou **22rem** de haut (seuils à confirmer à l'essai), seul l'Agenda est proposé. Au-dessus, Agenda et Mois.
- **Vues indispensables** : Agenda à toutes les tailles, Mois à partir de la taille moyenne. Les vues semaine et jour avec grille horaire n'apportent rien tant que les événements n'ont pas de durée (D3).
- **Interaction** : lecture seule (D4). Le glisser-déposer d'une échéance est une évolution possible, à prévoir dans le choix (§2), pas à construire.
- **Temps** (ADR-003) : les instants s'affichent dans le fuseau utilisateur (`UserTimeZone`). Les événements « toute la journée » sont des dates murales qui ne bougent jamais avec le fuseau. Une heure dans un autre fuseau que celui d'affichage s'affiche « 03:00 (09:00 Paris) » (ADR-003 §3.2, `zoneCity`). Le « maintenant » vient de `CLOCK`. Aucun calcul de date à la main.
- **UI** : tokens `--hb-*` et classes sémantiques seulement (DESIGN §5, `check-design-tokens`). Clair et sombre à parité. Cartes teintées : variantes `--hb-on-tint-*`. Bordures plutôt qu'ombres.
- **i18n** : textes en français par Transloco, dates par `TimeDisplay` (`Intl` avec fuseau explicite).
- **Accessibilité** : tout au clavier, focus visible (`--hb-focus`), noms accessibles complets (« Rappel : Payer le loyer, mercredi 18 novembre, 09:00 »), contraste AA, `prefers-reduced-motion`.
- **Sécurité** : titres = données utilisateur, rendues en texte seul. CSP actuelle inchangée. Aucune ressource distante.
- **Budget** : rien dans le chargement initial (budget de 500 kB, 494,82 kB mesurés par le coordinateur, valeur non remesurée ici).

### 1.2 Faits vérifiés (consultés le 2026-11-20)

| # | Fait | Source |
|---|---|---|
| V1 | **FullCalendar** : `fullcalendar` **7.1.5** (`latest`, tag `legacy` = 6.1.22), MIT. Dépendances : `preact` ^10.29.8, `@fullcalendar/core` 7.1.5, `@full-ui/headless-calendar` 7.1.5. Peer : `temporal-polyfill` **^1.0.7**. Publications : 7.1.2 (2026-10-12), 7.1.3 (10-16), 7.1.4 (11-04), 7.1.5 (11-12) | https://registry.npmjs.org/fullcalendar/latest ; https://api.github.com/repos/fullcalendar/fullcalendar/releases |
| V2 | `@fullcalendar/angular` 7.1.5 : peer `@angular/core` « 16 - 22 », `fullcalendar` 7.1.5, `temporal-polyfill` ^1.0.7. Exemple standalone. Rien sur le mode zoneless ni les signals | https://registry.npmjs.org/@fullcalendar/angular/latest ; https://cdn.jsdelivr.net/npm/@fullcalendar/angular@7/README.md |
| V3 | Modules libres dans le paquet MIT : `daygrid`, `timegrid`, `list`, `multimonth`, `interaction` (glisser-déposer), `locales/*`. Les modules premium (timeline, ressources) sont dans `@fullcalendar/angular-scheduler` | exports de V1 et V2 ; https://fullcalendar.io/docs/upgrading-from-v6 |
| V4 | FullCalendar v7 « no longer bundles its own CSS ». `skeleton.css` est toujours requis : environ 12 000 caractères, **aucune couleur**, beaucoup de `!important`, sans `@layer`, seulement deux variables de `z-index`. Le thème passe par des **props de noms de classes** (chaîne, ou fonction de l'état, ex. `dayCellClass`, `blockEventClass`) et par `--fc-event-color` / `--fc-event-contrast-color`. Mode sombre : prop `colorScheme` ou attribut `data-color-scheme` | https://fullcalendar.io/docs/upgrading-from-v6 ; https://fullcalendar.io/docs/custom-themes ; https://fullcalendar.io/docs/color-palettes ; https://cdn.jsdelivr.net/npm/fullcalendar@7.1.5/skeleton.css |
| V5 | FullCalendar v7 : `timeZone` accepte un fuseau IANA sans plugin. L'API émet encore des `Date`. `temporal-polyfill` est utilisé par son API importable (pas global) | https://fullcalendar.io/docs/upgrading-from-v6 |
| V6 | Accessibilité de FullCalendar v7 : toutes les vues passent Axe, boutons avec `aria-label`, événements cliquables en `role=button`, vue liste en balisage de liste, `headingLevel` réglable, popover navigable au clavier. La 7.1.2 regroupe les événements des cellules en listes | https://fullcalendar.io/docs/upgrading-from-v6 ; https://api.github.com/repos/fullcalendar/fullcalendar/releases |
| V7 | Poids de `fullcalendar@7.1.5` (entrée `.`) : 133 981 o minifiés, 41 095 o gzip, dont `preact` ≈ 54,8 ko et `headless-calendar` ≈ 34,6 ko. Modules de vue et polyfill non compris | https://bundlephobia.com/api/size?package=fullcalendar@7.1.5 |
| V8 | Dépôt FullCalendar : 20 785 étoiles, 1 084 issues ouvertes, dernier push le 2026-11-12. Projet financé par son offre premium | https://api.github.com/repos/fullcalendar/fullcalendar |
| V9 | **Schedule-X** : `@schedule-x/calendar` **4.9.1** (2026-09-29), 4.0.0 (2026-01-15), MIT. Peer : `preact` ^10.19.2, `@preact/signals` ^2.0.2, `temporal-polyfill` **0.3.2** (version exacte, en conflit avec notre ^1.0.6) | https://registry.npmjs.org/@schedule-x/calendar/4.9.1 ; https://cdn.jsdelivr.net/npm/@schedule-x/calendar@4.9.1/package.json |
| V10 | `@schedule-x/angular` 4.1.0 : peer Angular « 14 - 22 », composant `sx-calendar`, `createCalendar(config)`. Le conteneur doit avoir une hauteur explicite. Rien sur le mode zoneless | https://registry.npmjs.org/@schedule-x/angular/latest ; https://schedule-x.dev/docs/frameworks/angular |
| V11 | Schedule-X v4 : glisser-déposer et redimensionnement **passés en premium** (`@sx-premium/drag-and-drop`, `@sx-premium/resize`). Vues libres : jour, semaine, mois (grille), agenda du mois, agenda de la semaine, année, liste. Vue ressources premium | https://schedule-x.dev/docs/calendar/major-version-migrations ; https://schedule-x.dev/docs/calendar/views |
| V12 | Schedule-X a un **point de rupture interne de 700 px**. La grille du mois et la semaine sont réservées aux grands écrans, les agendas aux petits | https://schedule-x.dev/docs/calendar/views |
| V13 | Schedule-X : `start`/`end` en `Temporal.ZonedDateTime` / `Temporal.PlainDate`. Temporal est attendu **en global** (la doc fait `import 'temporal-polyfill/global'`). Options `timezone` (UTC par défaut), `locale` (**`fr-FR`** parmi 37 langues), `firstDayOfWeek` (1 = lundi par défaut), `isDark` | https://schedule-x.dev/docs/calendar/temporal ; https://schedule-x.dev/docs/calendar/configuration ; https://schedule-x.dev/docs/calendar/language |
| V14 | Thème de Schedule-X : `theme-default/dist/index.css` fait environ 35 000 caractères. Variables `--sx-color-*` (rôles Material). Sombre par `.is-dark`. Quelques couleurs **en dur** (`#f00` pour l'indicateur d'heure, fonds des numéros de semaine, ombres `rgba`). Aucune ressource distante | https://schedule-x.dev/docs/calendar/theme ; https://cdn.jsdelivr.net/npm/@schedule-x/theme-default@4.9.1/dist/index.css |
| V15 | Poids de `@schedule-x/calendar@4.9.1` : 154 065 o minifiés, 38 943 o gzip, peers non compris | https://bundlephobia.com/api/size?package=@schedule-x/calendar@4.9.1 |
| V16 | Dépôt Schedule-X : 2 611 étoiles, 64 issues ouvertes, dernier push le 2026-11-17. Accessibilité **non documentée** : la recherche n'a rien donné | https://api.github.com/repos/schedule-x/schedule-x |
| V17 | CSP : `script-src 'self'`, `style-src 'self' 'unsafe-inline'` et `dangerousDisableAssetCspModification: ["style-src"]` : les `<style>` et les attributs `style` sont permis, les scripts en ligne interdits. `connect-src` limité à l'IPC | `apps/desktop/src-tauri/tauri.conf.json` l. 27-28 ; `docs/SECURITY-NOTES.md` |
| V18 | Budgets : `initial` à 500 kB (avertissement) et 1 MB (erreur) ; `anyComponentStyle` à 4 kB et 8 kB. Un seul style global, `src/styles.css`, et `inlineCritical: false` | `apps/web/angular.json` l. 34-53 |
| V19 | `loadCalendarSource?: () => Promise<Type<CalendarSource>>` existe dans `WidgetDefinition`, mais aucun widget ne le définit. `ReminderRepository.list()` exclut les rappels d'habitude (H6). `TodoRepository` ne liste les tâches que par liste (`listTodos(listId)`). `RECURRENCE_ENGINE.expand` prend une plage d'au plus 400 jours et une limite de 1 à 1000 (500 par défaut). `SPIKE_TOOLS_ENABLED` (`core/system`) vaut `isDevMode()` | `core/widgets/widget-definition.ts` l. 55 ; `data/repositories.ts` l. 150-221 ; `core/time/recurrence-engine.ts` ; `core/system/spike-tools.ts` ; ADR-003 §3.5.4 |
| V20 | ESLint interdit `Date`, `Temporal.Now` et `Intl.DateTimeFormat` hors de `core/time` (ADR-003 §3.6). `check-design-tokens` contrôle les `.html`, `.css` et `.ts` de `src/` (sauf `tokens.css` et `homebase-preset.ts`) | ADR-003 §3.6 ; `apps/web/scripts/check-design-tokens.mjs` l. 18-19 |

### 1.3 Supposé (à vérifier, étape associée)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Le cœur JS de FullCalendar tourne sans zone.js dans un composant zoneless : création dans `afterNextRender`, destruction par `DestroyRef` | essai E4 |
| S2 | Les rappels de FullCalendar exposent des chaînes (`startStr`, `endStr`), si bien que l'adaptateur n'a pas besoin de `Date` | essai E4, lint de la branche d'essai |
| S3 | L'option `now` de FullCalendar accepte notre horloge (`CLOCK`) pour marquer « aujourd'hui » | essai E6 |
| S4 | Schedule-X s'installe avec `temporal-polyfill` 1.x grâce à un `overrides`, et son `dist` n'importe pas `temporal-polyfill` : il n'utilise que le `Temporal` global | essai E1 (`npm ci`, recherche dans `dist/`) |
| S5 | Le point de rupture de 700 px de Schedule-X mesure le conteneur, pas la fenêtre | essai E5 |
| S6 | L'en-tête de Schedule-X (sélecteur de date, choix de vue) peut être masqué ou remplacé | essai E4 |
| S7 | Une feuille non injectée (`styles` avec `inject: false`), chargée par `<link>` à l'exécution, laisse le total initial inchangé et respecte `style-src 'self'` | essai E2, E7 |
| S8 | Les deux bibliothèques rendent le titre en texte (échappé par Preact) si l'on n'utilise aucun gabarit de contenu personnalisé | essai E8 (fixture F8) |
| S9 | 100 rappels développés sur 42 jours par des appels `time_expand` (8 en parallèle) prennent moins de 300 ms | mesure du lot « sources » (spec calendar) |

---

## 2. Options étudiées

| Option | Pour | Contre |
|---|---|---|
| **A. FullCalendar v7** (cœur JS + `daygrid` + `list`) | Thème par props de classes : nos classes sémantiques Tailwind s'appliquent directement (V4) ; `skeleton.css` sans couleur ; accessibilité testée (V6) ; fuseaux IANA natifs (V5) ; glisser-déposer resté libre (V3) ; projet très actif et financé (V1, V8) ; `fr` fourni | Chunk paresseux le plus lourd : cœur + Preact + polyfill Temporal importé, qui reste du code mort avec le Temporal natif (V5, V7) ; peer `temporal-polyfill` ^1.0.7 (passer de ^1.0.6 à ^1.0.7) ; API en `Date` (S2) ; `skeleton.css` de 12 ko, au-dessus du budget de style par composant (V18) |
| **B. Schedule-X v4** | Temporal global, donc natif dans la WebView2 sans polyfill embarqué (V13) ; vues agenda pensées pour les petites largeurs (V12) ; `fr-FR`, lundi par défaut ; variables CSS (V14) | Peer `temporal-polyfill` **0.3.2 exact**, en conflit (V9) ; glisser-déposer devenu premium (V11) ; accessibilité non documentée (V16) ; point de rupture fixe de 700 px (V12) ; couleurs en dur dans le thème (V14) ; un mainteneur principal, publications plus espacées (V9, V16) ; rôles Material, éloignés de nos tokens |
| **C. Rendu maison** (Angular pur : liste Agenda + grille Mois) | Zéro dépendance ; tokens, requêtes de conteneur et i18n natifs ; motif de grille WAI-ARIA maîtrisé ; dates par `core/time` uniquement ; chunk minimal | Code à écrire et à tester : grille de 42 cellules, barres sur plusieurs jours, « +N », navigation clavier en grille. Pas de vue horaire ni de glisser-déposer sans gros travail. Accessibilité à construire nous-mêmes |

### 2.1 Critères pondérés (notes provisoires de 0 à 5, sur documentation ; l'essai les remplace)

| Critère | Poids | A. FullCalendar | B. Schedule-X | C. Maison |
|---|---|---|---|---|
| Rendu en tokens, clair et sombre, cartes teintées | 20 | 5 | 3 | 5 |
| Lisibilité de 3 × 3 à 12 × 8 | 15 | 3 | 3 | 5 |
| Accessibilité (clavier, lecteur d'écran) | 15 | 4 | 2 | 3 |
| Coût d'intégration et de maintenance chez nous | 15 | 3 | 3 | 2 |
| Poids paresseux, CSS hors chargement initial | 10 | 2 | 3 | 5 |
| Pérennité amont, licence | 10 | 5 | 3 | 4 |
| Évolutivité (vue horaire, glisser-déposer) | 10 | 5 | 2 | 1 |
| Accord avec l'ADR-003 et dépendances | 5 | 3 | 3 | 5 |
| **Total sur 100** | | **77** | **55** | **75** |

**Éliminatoires** (n'importe quelle option, à l'essai) : erreur CSP dans la console ou besoin de modifier la CSP ; total initial modifié ; couleur brute nécessaire dans nos fichiers ; titre interprété comme du HTML ; `npm ci --ignore-scripts` en échec.

### 2.2 Ce qui ferait gagner ou perdre chaque option à l'essai
- **A gagne** si le thème par classes rend fidèlement les tokens dans les deux thèmes et en carte teintée, si l'Agenda (`list`) reste lisible à 3 × 3 et si le clavier atteint tous les événements. **A perd** si l'adaptateur doit manipuler `Date` hors de `core/time` sans contournement propre, si le chunk dépasse 350 kB bruts ou si le rendu à 3 × 3 est illisible même en vue liste.
- **B gagne** s'il s'installe proprement (S4), si l'accessibilité clavier se révèle correcte et si sa vue liste gère mieux les petites tailles que A. **B perd** au premier éliminatoire, si le point de rupture suit la fenêtre (S5), si l'en-tête ne se remplace pas (S6) ou si les couleurs en dur ne peuvent pas être neutralisées sans hexadécimal chez nous.
- **C gagne** si A et B échouent sur un éliminatoire, ou si l'intégration de A coûte plus que l'option C elle-même (environ deux lots Sonnet). **C perd** si Marius veut à court terme une vue horaire ou le glisser-déposer.

---

## 3. Décision

### 3.1 Recommandation provisoire (D1)
**FullCalendar v7**, cœur JS (`fullcalendar`, `fullcalendar/daygrid`, `fullcalendar/list`, locale `fr`), intégré par un composant adaptateur à nous dans le dossier du widget `calendar`. Raisons : meilleur accord avec DESIGN.md (thème par nos classes sémantiques, squelette sans couleur), seule accessibilité documentée et testée, licence libre pour toute évolution prévisible, maintenance la plus solide. Ses défauts (poids, polyfill embarqué) ne touchent qu'un chunk paresseux. Le wrapper `@fullcalendar/angular` n'est pas retenu : une dépendance de moins, et aucune garantie zoneless (V2).

**Repli** : option C si A échoue sur un éliminatoire. Schedule-X n'est essayé jusqu'au bout que s'il passe l'étape E1 (installation propre).

### 3.2 Ce qui est figé dès maintenant (indépendant de la bibliothèque)

#### 3.2.1 Extension de `CalendarEvent` (`core/calendar/calendar-source.ts`)
On ajoute un champ, sans toucher aux champs de l'ADR-003 §3.7 :
```ts
/** Closed set of semantic tones; the view maps each to --hb-* tokens (on-tint variants in a
 *  tinted card). Never a raw colour: no hex, no user-chosen colour in v1 (D10). */
export type CalendarTone = 'neutral' | 'accent' | 'success' | 'attention' | 'danger';

export interface CalendarEvent {
  // ...fields of ADR-003 3.7, unchanged
  readonly tone: CalendarTone;
}
```
- **Couleur** : `tone` seulement. La couleur n'est jamais le seul porteur de sens : la fiche et le nom accessible disent « Rappel », « Tâche », « en retard ».
- **Lien** : **aucun champ** en v1 (D4). `sourceType` et `sourceId` identifient déjà l'élément. Une navigation interne future passera par un amendement (méthode de la source ou service du `core`), **jamais par une URL** : FullCalendar transforme la propriété `url` d'un événement en lien `<a href>` qui ferait naviguer la WebView. L'adaptateur ne la renseigne donc jamais.
- **Éditabilité** : **aucun champ** en v1 (lecture seule). Un glisser-déposer futur ajoutera, par amendement, une méthode optionnelle à `CalendarSource` (ex. `reschedule?(event, time)`) et un indicateur par événement.
- **Libellé et icône de la source** : pris de la `WidgetDefinition` du type (`titleKey`, `icon`). On n'ajoute rien à `CalendarSource`.

#### 3.2.2 Chargement des sources et agrégateur (`core/calendar/calendar-aggregator.ts`)
```ts
export interface AggregatedEvents {
  /** Deduplicated by id (first kept), sorted: all-day first, then by start (string order). */
  readonly events: readonly CalendarEvent[];
  /** sourceType of every source whose listEvents rejected (partial result shown). */
  readonly failedSources: readonly string[];
  /** More than MAX_CALENDAR_EVENTS (2000) events: the rest is dropped. */
  readonly truncated: boolean;
}
@Injectable({ providedIn: 'root' })
export class CalendarAggregator { listEvents(range: CalendarRange): Promise<AggregatedEvents>; }
```
- L'agrégateur parcourt les définitions du `WidgetRegistry` qui ont un `loadCalendarSource`. Il charge chaque source **une fois** (promesse mise en cache) puis l'obtient par l'`Injector` racine. Il ne fait **aucun import statique** de source : ADR-001 R1 et R2 sont respectés, et les sources restent paresseuses.
- Les appels se font par `Promise.allSettled` : une source en échec ne masque pas les autres (bandeau `flash-attention` « Certains éléments n'ont pas pu être chargés »).
- **Contrôle d'intégrité** : un événement dont `sourceType` diffère du `type` de sa définition, ou dont la `time` est invalide (validateurs de `core/time`), est écarté et journalisé en développement.
- `core/calendar/index.ts` n'est importé que par le widget `calendar` et, en type seulement, par `widget-definition.ts`. Rien de `core/calendar` n'entre dans le bundle initial.

#### 3.2.3 Sources v1 (D5, D6)
| Source | Fichier | Données | `CalendarEvent` |
|---|---|---|---|
| Rappels | `widgets/reminders/reminders.calendar-source.ts`, déclarée par `loadCalendarSource` dans `reminders.definition.ts` | `ReminderRepository.list()` filtré sur `enabled` et `status !== 'invalid'` ; puis `RECURRENCE_ENGINE.expand({ anchor: date-time, rrule, exdates }, { ...range, limit: 500 })`, 8 appels en parallèle au plus | `timed`, `start` = instant de l'occurrence, `end: null`, `timeZone` = celui du rappel ; `occurrenceKey` = clé d'occurrence si `rrule`, sinon `null` ; `tone: 'accent'`. Un rappel dont l'expansion échoue est sauté, la source n'est pas en échec |
| Tâches | `widgets/todo/todo.calendar-source.ts`, déclarée dans `todo.definition.ts` | **Nouvelle** méthode `TodoRepository.listDue(range: { fromOn; toOn }, limit)` : toutes listes confondues, `completed_at IS NULL AND due_on BETWEEN ? AND ?`, triées par `due_on, sort_order`, `LIMIT` ≤ 1000 (SQL dans `data/` seulement) | `all-day`, `startOn = lastOn = dueOn` ; `occurrenceKey: null` ; `tone` = `danger` si `dueOn` < `Today.date()`, sinon `neutral` |
| Habitudes | aucune en v1 | — | — |

#### 3.2.4 Plages et bornes
- La vue calcule la plage dans le fuseau d'affichage par `core/time` : `from = startOfDay(premier jour visible, tz)`, `to = startOfDay(dernier jour visible + 1, tz)`. Elle ne fait jamais d'arithmétique en millisecondes.
- **Mois** : 6 semaines, soit 42 jours, du lundi précédant ou égal au 1er du mois (`startOfIsoWeek`). **Agenda** : de « aujourd'hui » à aujourd'hui + N − 1 jours, avec N ∈ {7, 14, 31}. Toute plage fait **au plus 62 jours** (largement sous la limite de 400 jours de l'ADR-003).
- Une règle ne revient pas plus d'une fois par jour (`DAILY` au plus, ADR-003 §3.5.1). Une plage de 62 jours donne donc au plus 62 occurrences par rappel, sous la limite de 500 : `truncated` ne peut pas être vrai pour une source de rappels. Il est quand même traité, comme une source partielle.
- Une source de dates (tâches) obtient ses dates de la plage par un utilitaire `rangeLocalDates(range): { firstOn; lastOn }` (`core/calendar`, testé). Ce sont les jours dont la journée `[startOfDay(d), startOfDay(d + 1))` chevauche `[from, to)`, comme l'ADR-003 §3.5.4 étape 4.

#### 3.2.5 Conversion vers la bibliothèque (adaptateur, dans `widgets/calendar/`)
- `timed` : instant et fuseau d'affichage passés à la bibliothèque (FullCalendar : chaîne ISO et `timeZone: UserTimeZone`. Schedule-X : `Temporal.Instant.from(start).toZonedDateTimeISO(tz)`). `end: null` donne un événement ponctuel : sans `end` pour FullCalendar, et `end = start` pour Schedule-X (à vérifier).
- `all-day` : `startOn` tel quel, fin **exclusive** = `addDays(lastOn, 1)` (ADR-003 §3.7).
- **Interdit** : `url`, contenu HTML (`eventContent` qui renvoie `{ html }`, `innerHTML` dans `eventDidMount`), locales chargées depuis un CDN, `navLinks`. Le titre passe en texte seul.
- Barre d'outils masquée (FullCalendar : `headerToolbar: false`). Navigation par l'API de la bibliothèque depuis notre barre (D8). `firstDay` = lundi (D7), locale `fr`, `now` = `CLOCK` (S3).
- Toute `Date` reçue de la bibliothèque reste confinée à l'adaptateur et sert seulement à lire une chaîne (S2). Sinon la conversion passe par un fichier de `core/time` dédié, ajouté par amendement de l'ADR-003.
- **CSS de la bibliothèque** : jamais dans `src/styles.css` ni dans les styles d'un composant (12 ko et 35 ko dépassent `anyComponentStyle`). Entrée `styles` d'`angular.json` avec `inject: false` et `bundleName: "calendar-lib"`, chargée par un `<link rel="stylesheet">` que l'adaptateur insère une seule fois (S7). Notre correspondance vers les tokens (`widgets/calendar/calendar-theme.css`) n'utilise que `var(--hb-*)` et nos classes.

#### 3.2.6 Rafraîchissement (D9)
`CalendarChanges` (`core/calendar`, `providedIn: 'root'`) expose `version: Signal<number>` et `notify(sourceType)`. Les stores TODO et Rappels l'appellent après chaque écriture réussie. Le widget recharge sa plage quand `version`, `Today.date()` ou `UserTimeZone` changent, et au retour de focus ou de visibilité, avec un anti-rebond de 300 ms. La dernière réponse l'emporte : un compteur de requête ignore les réponses périmées.

---

## 4. Protocole d'essai (spike jetable)

### 4.1 Cadre
- Branche locale **`spike/calendar-lib`**, créée depuis `phase-2-calendar` dans `F:/Marius/Projects/homebase-calendar`. Elle n'est **jamais fusionnée** ni poussée. Durée : une demi-journée à une journée par bibliothèque. On arrête une bibliothèque à son premier éliminatoire.
- Deux types de widget d'essai, **`spike-fc`** et **`spike-sx`**, placés côte à côte à la même taille dans un vrai tableau de bord : vraie grille, vrai hôte, vraies teintes. Le drapeau debug `SPIKE_TOOLS_ENABLED` n'est **pas** utilisé, parce que la mesure du chunk exige un build de production où ces widgets existent. L'isolement vient de la branche jetable.
- Mêmes données pour les deux : une source factice `SpikeFixtureSource` qui implémente `CalendarSource` et filtre par chevauchement (comparaison de chaînes, aucun calcul).
- Implémenteur : Sonnet, à partir de cette section. Vérifications visuelles et clavier : Marius.

### 4.2 Fichiers (tous sur la branche d'essai)
| Fichier | Contenu |
|---|---|
| `apps/web/src/app/core/calendar/spike/fixture-source.ts` | `SPIKE_EVENTS` (§4.3, valeurs en dur) et `SpikeFixtureSource` |
| `apps/web/src/app/widgets/spike-fc/spike-fc.definition.ts`, `.component.ts`, `spike-fc-theme.css` | Adaptateur FullCalendar (§3.2.5), deux boutons Agenda et Mois, correspondance des tokens |
| `apps/web/src/app/widgets/spike-sx/spike-sx.definition.ts`, `.component.ts`, `spike-sx-theme.css` | Adaptateur Schedule-X, même interface |
| `apps/web/src/app/widgets/widgets.providers.ts` | Ajout de deux lignes `provideWidget` |
| `apps/web/angular.json` | Deux entrées `styles` `{ input, bundleName: "spike-fc" / "spike-sx", inject: false }` |
| `apps/web/package.json`, `package-lock.json` | FullCalendar : `fullcalendar@7.1.5`, `temporal-polyfill@^1.0.7`. Schedule-X : `@schedule-x/calendar@4.9.1`, `@schedule-x/theme-default@4.9.1`, `preact`, `@preact/signals`, sans `--legacy-peer-deps` |
| Fichier de traduction `fr` existant | Deux titres de widget |

**Après l'essai** : relever les mesures (§4.5) et les envoyer au coordinateur. Supprimer les instances `spike-*` du tableau de bord (sinon elles resteront en placeholder « type inconnu »). Revenir sur `phase-2-calendar` puis `git branch -D spike/calendar-lib`. Rien n'est à nettoyer sur `phase-2-calendar`.

### 4.3 Données fictives (affichage `Europe/Paris`, puis `America/Santiago` ; Paris est en UTC+1 et Santiago en UTC−3 en novembre 2026)
| # | Événement | Attendu à Paris | Attendu à Santiago |
|---|---|---|---|
| F1 | `timed` `2026-11-18T08:00:00.000Z`, `Europe/Paris` | 18/11 09:00 | 18/11 05:00, avec « (09:00 Paris) » dans la fiche |
| F2 | `timed` `2026-11-18T22:30:00.000Z`, `Europe/Paris` | 18/11 23:30 | 18/11 19:30 |
| F3 | `timed` `2026-11-18T01:00:00.000Z`, `Europe/Paris` | 18/11 02:00 | **17/11** 22:00 (change de jour) |
| F4 | `all-day` `2026-11-18` → `2026-11-18` | 18/11 | 18/11 (ne bouge pas) |
| F5 | `all-day` `2026-11-23` → `2026-11-25` | barre du lundi au mercredi | idem |
| F6 | `timed` `2026-10-25T00:30:00.000Z`, `Europe/Paris` (pli, ADR-003 C1) | 25/10 02:30 | 24/10 21:30 |
| F7 | `timed` `2026-11-19T14:00:00.000Z`, `America/Montreal` | 19/11 15:00 « (09:00 Montréal) » | 19/11 11:00 |
| F8 | `all-day` `2026-11-19`, titre `<img src=x onerror=alert(1)>` | texte littéral, aucune requête ni alerte | idem |
| F9 | `timed` `2026-11-19T10:00:00.000Z`, titre de 200 caractères | tronqué proprement, titre complet dans la fiche | idem |
| F10 | 12 événements `timed` le `2026-11-20` | « +N » en vue Mois, liste complète en Agenda | idem |
| F11 | `timed` `2026-11-22T22:30:00.000Z`, `Europe/Paris` (dimanche 23:30) | dernière colonne de la semaine (lundi en premier) | dimanche 19:30 |

Tons : F1, F2, F3, F6, F7, F9, F10 et F11 en `accent` ; F4 en `danger` ; F5 et F8 en `neutral`.

### 4.4 Étapes et critères
| Étape | Action | Critère (seuil) |
|---|---|---|
| E1 | `npm install` des paquets, puis `npm ci --ignore-scripts` depuis `F:/Marius/Projects/homebase-calendar` | Passe sans `--legacy-peer-deps` (éliminatoire). Schedule-X : noter si un `overrides` est requis, et chercher `temporal-polyfill` dans `node_modules/@schedule-x/calendar/dist` (S4) |
| E2 | `npm run web:build`, sur `phase-2-calendar` puis sur la branche d'essai | « Initial total » **identique** à ±1 kB (éliminatoire). Relever la taille brute et estimée du chunk de chaque widget, et du CSS `spike-*.css` dans le dossier de sortie (`outputPath`). Seuil indicatif : ≤ 350 kB bruts de JS |
| E3 | `npm run dev`, clair puis sombre (Réglages), carte neutre puis carte teintée | Toutes les couleurs viennent des tokens. Le changement de thème est instantané, sans recréer le calendrier. Aucun hexadécimal dans nos fichiers (`npm run lint` limité à `check-design-tokens`) |
| E4 | Lire le code de l'adaptateur | Pas de zone.js ; pas de `Date` hors lecture de chaînes (S1, S2) ; barre d'outils de la bibliothèque masquée (S6) |
| E5 | Redimensionner chaque widget à 3 × 3, 6 × 5, 6 × 8 et 12 × 8 (relever la largeur du corps en px) | 3 × 3 : Agenda lisible, au moins 4 événements sans défilement horizontal. 6 × 8 : Mois avec au moins 2 événements par jour et « +N ». Schedule-X : le passage à 700 px suit la carte (S5) |
| E6 | Clavier seul, puis Narrateur | Barre, jours et événements atteignables ; Entrée ouvre la fiche, Échap la ferme et rend le focus ; focus visible `--hb-focus` ; le nom lu contient le titre, la date et l'heure ; « aujourd'hui » suit `CLOCK` (S3) |
| E7 | Console DevTools en `npm run dev`, puis sur l'exe de `npm run build` (port de débogage WebView2, DESIGN §6) | **Aucune** violation CSP ni requête externe (éliminatoire) ; CSP inchangée |
| E8 | Fixtures F1 à F11 en `Europe/Paris`, puis réglage `time.zone` = `America/Santiago` | Valeurs du §4.3 exactes ; F8 en texte (éliminatoire) |

### 4.5 Relevé à remettre (une ligne par critère, colonnes FC et SX)
`npm ci` / overrides ; initial total avant et après ; chunk JS brut et estimé ; CSS ; tokens clair, sombre et teinté ; largeur du corps à 3 × 3 et rendu ; Mois à 6 × 8 ; clavier ; Narrateur ; CSP en dev et en release ; F1 à F11 ; durée d'intégration ; remarques.

---

## 5. Conséquences
Positives :
- Les sources, l'agrégateur, `listDue` et le ton ne dépendent pas de la bibliothèque : le lot « sources » peut démarrer tout de suite.
- La bibliothèque est enfermée dans un adaptateur du widget `calendar`. En changer ne touche ni `core/` ni `data/`.
- Aucun changement de CSP ni du budget initial.

Négatives et coûts :
- Une méthode de plus dans `TodoRepository` (SQL et tests `test:data`).
- N appels IPC `time_expand` par plage (S9). Si c'est trop lent, il faudra une commande Rust groupée (amendement à la spec timers-reminders).
- Option A : environ 200 à 300 kB paresseux, dont un polyfill Temporal inutile en production ; `temporal-polyfill` passe à ^1.0.7.
- Une feuille non injectée et son `<link>` : un mécanisme nouveau, à documenter dans `SECURITY-NOTES.md` si on le retient.

## 6. Risques
| Risque | Impact | Mitigation |
|---|---|---|
| R1. L'essai n'a pas lieu et l'on code directement | Choix fait sur la seule documentation | Statut « proposé » ; le lot widget de la spec calendar dépend de l'acceptation de cet ADR |
| R2. FullCalendar v7 change ses noms de classes ou ses props (v7 date de juin 2026) | Thème cassé à une mise à jour | Version exacte (`7.1.5`), Dependabot, contrôle visuel E3 à chaque montée |
| R3. Une bibliothèque injecte un jour du HTML venant d'un titre | XSS dans la WebView | Aucun gabarit HTML (§3.2.5) ; F8 conservé en test unitaire de l'adaptateur (le titre arrive en `textContent`) |
| R4. Charge IPC avec beaucoup de rappels | Calendrier lent | 8 appels en parallèle, plage ≤ 62 jours, mesure S9, commande groupée en repli |
| R5. Calendrier périmé après une modification ailleurs | Information fausse | `CalendarChanges` (D9), plus focus et visibilité |
| R6. Fiche d'un rappel dans un autre fuseau mal comprise | Confusion d'heure | Affichage « 03:00 (09:00 Paris) » (ADR-003 §3.2) |
| R7. Le CSS de la bibliothèque, non mis en couche, l'emporte sur nos utilitaires (`!important`) | Rendu incohérent | Le squelette ne touche pas aux couleurs (V4) ; vérifié en E3 |

## 7. Cas limites (à reprendre dans la spec calendar)
| # | Cas | Attendu |
|---|---|---|
| L1 | Changement d'heure (pli, trou) | Instants résolus par le Rust (ADR-003 §3.3) ; la vue affiche l'instant sans recalcul (F6) |
| L2 | Changement de fuseau utilisateur | Rechargement (D9) ; les `all-day` ne bougent pas ; un `timed` peut changer de jour (F3) |
| L3 | Minuit inexistant (`America/Santiago`, 2026-09-06) | La plage commence à `startOfDay` (01:00 locale), ADR-003 C23 |
| L4 | Hors Tauri (`web:start`) | Les sources rejettent `unavailable` ; état vide avec bandeau, pas d'exception |
| L5 | Doublons | Supprimés par `id` dans l'agrégateur |
| L6 | Rappel supprimé ou désactivé pendant l'affichage | Disparaît au rechargement suivant (D9) |
| L7 | Tâche terminée, ou échéance retirée | Disparaît ; une tâche répétée cochée avance d'une échéance (D6) |
| L8 | Une source en échec | Les autres s'affichent ; bandeau (§3.2.2) |
| L9 | Plus de 2000 événements | Coupe et mention `truncated` |
| L10 | Hors ligne, synchronisation | Sans objet : tout est local |
| L11 | Navigation rapide (mois suivant plusieurs fois) | Les réponses périmées sont ignorées (§3.2.6) |
| L12 | Widget de 3 × 3 | Agenda imposé ; le choix de vue est masqué |

## 8. Sources
FullCalendar : https://registry.npmjs.org/fullcalendar/latest ; https://registry.npmjs.org/@fullcalendar/angular/latest ; https://registry.npmjs.org/@fullcalendar/core/7.1.5 ; https://cdn.jsdelivr.net/npm/@fullcalendar/angular@7/README.md ; https://fullcalendar.io/docs/upgrading-from-v6 ; https://fullcalendar.io/docs/custom-themes ; https://fullcalendar.io/docs/color-palettes ; https://cdn.jsdelivr.net/npm/fullcalendar@7.1.5/skeleton.css ; https://api.github.com/repos/fullcalendar/fullcalendar ; https://api.github.com/repos/fullcalendar/fullcalendar/releases ; https://bundlephobia.com/api/size?package=fullcalendar@7.1.5.
Schedule-X : https://registry.npmjs.org/@schedule-x/calendar/4.9.1 ; https://cdn.jsdelivr.net/npm/@schedule-x/calendar@4.9.1/package.json ; https://registry.npmjs.org/@schedule-x/angular/latest ; https://schedule-x.dev/docs/frameworks/angular ; https://schedule-x.dev/docs/calendar/configuration ; https://schedule-x.dev/docs/calendar/views ; https://schedule-x.dev/docs/calendar/temporal ; https://schedule-x.dev/docs/calendar/language ; https://schedule-x.dev/docs/calendar/theme ; https://schedule-x.dev/docs/calendar/major-version-migrations ; https://cdn.jsdelivr.net/npm/@schedule-x/theme-default@4.9.1/dist/index.css ; https://api.github.com/repos/schedule-x/schedule-x ; https://bundlephobia.com/api/size?package=@schedule-x/calendar@4.9.1.
