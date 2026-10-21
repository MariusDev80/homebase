# ADR-003 : Modèle de temps (instants UTC, dates murales, fuseau IANA, RRULE)

- **Statut** : proposé (P1 à P3 validés par Marius le 2026-10-20 ; acceptation globale en attente)
- **Date** : 2026-10-20 (révisé le même jour après revue indépendante)
- **Auteur** : architect (Opus)
- **Liens** : `docs/PLAN.md` §2 (Récurrence, Timers), §4 « Temps », §9 ; `docs/ROADMAP.md` phases 1 et 2 ; `docs/adr/001-widget-contract.md` §3.2, §3.8, §7.1 (`CalendarSource` provisoire) ; `docs/adr/002-data-layer.md` §3.3 (conventions de colonnes), §3.2 (migrations), §6.6 (`Clock`, `provideDataLayer`), O2 (accès Rust à la base)

> **Préséance** : l'ADR-002 reste la référence pour la couche `data/`. Cet ADR **amende** `data/` sur deux points seulement : un fichier de formats (`data/time-formats.ts`, types et motifs, sans logique de calendrier) et un jeton `CLOCK` déclaré dans `data/data.providers.ts` et injecté dans les repositories (§3.6). Il fixe les conventions des colonnes temporelles métier, que l'ADR-002 §3.3 lui renvoie. Il fige la **partie temporelle** de `CalendarSource` (ADR-001 §7.1) ; le reste relève de l'ADR-004.
>
> **Hors de ce fichier** (fait par le coordinateur) : ajout des lots A et B à la ROADMAP ; mise à jour de la ligne « Récurrence | `rrule` » de `docs/PLAN.md` §2 (désormais : moteur Rust `rrule` en mode flottant + `jiff`, aucune lib RRULE côté front).

---

## 1. Contexte

Homebase manipulera plusieurs sortes de temps :

| Besoin | Phase | Nature |
|---|---|---|
| `created_at` / `updated_at` techniques | 0 (fait) | instant |
| Échéance d'une TODO | 1 | **date murale** (un jour du calendrier, sans heure) |
| « Aujourd'hui », « en retard », « demain » | 1 | date murale calculée dans le fuseau de l'utilisateur |
| Timers, pomodoro, sessions « en cours depuis X » | 2 | instants + durées |
| Rappels datés (« le 3 novembre à 9 h ») | 2 | **heure murale + fuseau** |
| Rappels récurrents (« chaque lundi à 9 h ») | 2 | heure murale + fuseau + RRULE |
| Habitudes (jours cochés, jours attendus) | 2 | dates murales + RRULE sur des dates |
| Calendrier agrégé (`CalendarSource`) | 2 | occurrences sur une plage |

Contraintes : application Windows mono-utilisateur, sans serveur, SQLite, front Angular 21 (WebView2), planificateur de rappels en Rust (phase 2). Exigences du PLAN : stockage UTC + fuseau IANA, récurrence RRULE, aucun calcul de date « à la main », tests obligatoires sur les changements d'heure, et **un seul moteur de vérité** pour l'expansion des occurrences qui déclenchent des notifications : le Rust.

### 1.1 Faits vérifiés (sources consultées le 2026-10-20)

| # | Fait | Source |
|---|---|---|
| V1 | Temporal est livré activé dans **Chrome 144** (stable, 13/01/2026). La WebView2 de Marius est en 155 (`docs/TOOLCHAIN.md`), donc Temporal y est natif (déduit : WebView2 suit Chromium) | https://developer.chrome.com/blog/new-in-chrome-144 ; https://www.infoq.com/news/2026/02/chrome-temporal-date-api |
| V2 | Node.js 26 (05/05/2026) active Temporal par défaut. Le projet est sur **Node 24**, qui ne l'a pas : les tests Vitest ont besoin d'un polyfill | https://nodejs.org/es/blog/release/v26.0.0 ; https://www.helpnetsecurity.com/2026/05/07/node-js-26-released/ |
| V3 | `temporal-polyfill` (FullCalendar) : `latest` = **1.0.6** publiée le 2026-10-13, MIT, publications mensuelles. `import { Temporal } from 'temporal-polyfill'` est un *ponyfill* sans effet de bord qui **utilise le Temporal natif s'il existe** ; `temporal-polyfill/implementation` force le polyfill. 19,5 kB min+gzip. Conformité « near-perfect » (deux écarts volontaires listés). ESM uniquement ; Vitest fonctionne avec le pool `forks` par défaut | https://registry.npmjs.org/temporal-polyfill ; https://cdn.jsdelivr.net/npm/temporal-polyfill@1.0.6/README.md |
| V4 | FullCalendar v7 a `temporal-polyfill` en peerDependency | https://v7.fullcalendar.io/temporal-polyfill.md |
| V5 | `rrule` (npm, jkbrzt) : `latest` = **2.8.1**, publiée le 2023-11-10, aucune publication depuis ; dates « flottantes » à gérer soi-même ; bug ouvert sur `after()` avec TZID depuis la 2.7.2 | https://registry.npmjs.org/rrule ; https://github.com/jkbrzt/rrule/issues/608 |
| V6 | `rrule-temporal` (npm) : réécriture sur Temporal, première publication avril 2025, un seul mainteneur (source secondaire) | https://mcp.depscope.dev/pkg/npm/rrule-temporal |
| V7 | Crate `rrule` (fmeringdal/rust-rrule) : **0.14.0** (2025-04-20), MSRV 1.74, dépend de `chrono` 0.4 et `chrono-tz` 0.10 ; dernier commit sur `main` le 2025-04-20 ; 25 issues ouvertes. API : `RRule<Unvalidated>` (builder `interval`, `count`, `until`, `by_weekday(Vec<NWeekday>)`, `by_month_day(Vec<i8>)`…), `build(dt_start: DateTime<Tz>) -> Result<RRuleSet, RRuleError>`, `RRuleSet::{after, before, exdate, all(limit: u16), all_unchecked}`, itérateur. `rrule::Tz` a une constante `UTC`. Limite d'itération 100 000 pour `all`, **non appliquée** à l'itérateur ni à `all_unchecked` | https://crates.io/api/v1/crates/rrule ; https://github.com/fmeringdal/rust-rrule ; https://docs.rs/rrule/0.14.0/rrule/struct.RRule.html ; https://docs.rs/rrule/0.14.0/rrule/struct.RRuleSet.html ; https://docs.rs/rrule/0.14.0/rrule/enum.Tz.html |
| V8 | Crate `rrule`, conversion locale → zonée (`add_time_to_date`) : `and_local_timezone(tz).single()`, sinon minuit local + durée écoulée (heure inexistante décalée vers l'avant). Comportement **non utilisé** ici (expansion en UTC, §3.5.4) | https://raw.githubusercontent.com/fmeringdal/rust-rrule/main/rrule/src/iter/utils.rs |
| V9 | Crate `jiff` : **0.2.38** (2026-10-06), MSRV 1.70. `TimeZone::get(&str)` = recherche **IANA uniquement** dans la tzdb ; `TimeZone::to_zoned` résout avec `Disambiguation::Compatible` (trou : « the time after the gap » ; pli : « the first repetition ») ; `to_ambiguous_zoned` laisse choisir. Feature par défaut `tzdb-bundle-platform` : sous **Windows**, la tzdb est **embarquée** (`jiff-tzdb`) | https://crates.io/api/v1/crates/jiff ; https://docs.rs/jiff/latest/jiff/tz/struct.TimeZone.html ; https://docs.rs/jiff/latest/jiff/index.html |
| V10 | RFC 5545 : heure ambiguë → **première** occurrence ; heure inexistante (DTSTART) → décalage **d'avant** le trou (§3.3.5). Dans une récurrence, instances à date invalide ou heure inexistante « MUST be ignored and MUST NOT be counted » (§3.3.10). `UNTIL` du même type que `DTSTART` (UTC si TZID, DATE si DATE). `COUNT` et `UNTIL` « MUST NOT occur in the same recur ». `WKST` = `MO` par défaut | https://www.rfc-editor.org/rfc/rfc5545.txt |
| V11 | Règles UE (`Europe/Paris`) : dernier dimanche de mars et d'octobre à 01:00 UTC → **2026-10-25**, **2027-03-28**, 2027-10-31 | Revue indépendante : revérifié sous Node 24 (Temporal + Intl) |
| V12 | **Tous les vecteurs et résultats attendus de cet ADR** (tableau §3.3, cas limites §6, contenu §8.6, dont `America/Santiago` le 2026-09-06) ont été revérifiés sous Node 24 avec Temporal + Intl : corrects (côté TS ; le côté Rust reste à exécuter) | Revue indépendante du 2026-10-20 |
| V13 | SQLite 3.53 (better-sqlite3) : `strftime('%Y-%m-%dT%H:%M:%S', '2026-10-25T24:00:00')` renvoie l'entrée **inchangée** ; avec le modificateur `'+0 seconds'`, la valeur est normalisée (24:00 → jour suivant, 02-30 → mars, 13-01 → `NULL`, :60 → minute suivante), ce qui fait échouer le contrôle d'aller-retour. `date('2026-02-30')` est normalisé et `date('2026-13-01')` vaut `NULL` : `date(x) IS x` est correct. Un `SELECT` avec JSON mal formé lève une erreur au lieu de renvoyer 0 | Revue indépendante (tests exécutés) |
| V14 | Temporal accepte des décalages fixes comme fuseau (`+02`, `+0200`, `-03`) et normalise silencieusement la seconde intercalaire (`23:59:60` → `23:59:59`) ; `Temporal.Instant.from` accepte bien plus que RFC 3339 (`10:15Z`, espace, minuscules, forme compacte, annotation `[…]`, virgule décimale, `+0200`). `Intl.supportedValuesOf('timeZone')` ne contient pas `UTC` et liste des noms anciens (`Asia/Calcutta`, `Europe/Kiev`) | Revue indépendante (Node 24) |
| V15 | Code existant : `data/clock.ts` expose `Clock { nowIso(): string }`, `systemClock`, `IdGenerator` ; `data/data.providers.ts` (l. 45-53) **câble `systemClock` en dur** dans les trois repositories ; `build.rs` (l. 21-25) restreint les commandes de l'app par `AppManifest::commands` (permissions autogénérées `allow-<commande>`) ; `capabilities/default.json` liste explicitement les permissions ; `core/calendar/calendar-source.ts` est provisoire ; la clé `time.zone` respecte le motif des réglages | Lecture du dépôt |
| V16 | Une commande Tauri synchrone (`#[tauri::command]` sur `fn`) s'exécute sur le thread principal ; `#[tauri::command(async)]` ou `async fn` la déporte | Revue indépendante (documentation Tauri 2) |
| V17 | Le build front est déjà à ~504 kB pour un budget initial de 500 kB | Revue indépendante |

### 1.2 Supposé (à vérifier pendant l'implémentation, critère associé)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | `temporal-polyfill` 1.x se compile avec le builder esbuild d'Angular 21 et tourne dans les deux runners Vitest | CA-A1, CA-A2 |
| S3 | La WebView2 met à jour son fuseau par défaut quand le fuseau Windows change, sans redémarrage | CA-A9 (manuel) ; sinon : relecture au démarrage seulement, documentée |
| S4 | L'itérateur de la crate `rrule` en mode « flottant » (`Tz::UTC`) renvoie les heures murales nominales sans les modifier et **n'inclut pas** `DTSTART` s'il ne correspond pas à la règle | vecteurs `E-WEEKLY-DTSTART-NOMATCH`, `E-GAP` |
| S5 | `COUNT` est compté depuis `DTSTART` par la crate | vecteur `E-COUNT-WINDOW` |
| S6 | `jiff` (tzdb embarquée) donne les mêmes résultats que la WebView2 (ICU) sur les vecteurs | vecteurs partagés exécutés des deux côtés (lot B) |
| S8 | `jiff::tz::TimeZone::get` accepte l'identifiant normalisé par Temporal (casse canonique, alias conservés) | vecteurs `timeZoneValidity` côté Rust (lot B) |

(S2 et S7 de la version initiale sont devenus V13 et V12.)

---

## 2. Options étudiées

### 2.1 Représentation d'un moment futur planifié (rappel, occurrence)
| Option | Pour | Contre |
|---|---|---|
| A. Instant UTC seul | Simple, triable | Faux après un changement de règles tzdb : « 9 h » deviendrait « 8 h » ; une récurrence ne peut pas se dériver d'un instant à travers les changements d'heure |
| B. Heure murale flottante (interprétée dans le fuseau courant de l'utilisateur) | Suit l'utilisateur en voyage | Rien ne fixe l'instant si le fuseau Windows change par erreur ; le planificateur Rust devrait connaître le fuseau utilisateur |
| **C. Heure murale + fuseau IANA stocké sur l'élément** (RFC 5545 `DTSTART;TZID=`) | Survit aux changements de règles ; récurrence correcte à travers les changements d'heure ; **le Rust n'a jamais besoin du fuseau utilisateur** | Un rappel « 9 h Paris » reste à 9 h Paris si Marius change de fuseau (**accepté par Marius**, D1) |

### 2.2 Échéances et jours sans heure (TODO, habitudes)
| Option | Verdict |
|---|---|
| Instant à minuit UTC | Rejeté : décalage d'un jour selon le fuseau d'affichage |
| Instant à minuit local | Rejeté : minuit peut ne pas exister (`America/Santiago`), et la date change si le fuseau change |
| **Date murale `YYYY-MM-DD` flottante** | **Retenu** |

### 2.3 Bibliothèque de dates côté TypeScript
| Option | Pour | Contre |
|---|---|---|
| `Date` + `Intl` | Zéro dépendance | Pas de date ni d'heure murale typées, arithmétique en millisecondes, aucune désambiguïsation explicite |
| `date-fns` 4 + `@date-fns/tz` | Fonctions pures | Toujours fondé sur `Date` ; pas de type « date sans heure » |
| Luxon | Mature, immuable | API propriétaire ; pas de type date pure |
| **Temporal via `temporal-polyfill`** | Standard ; types distincts qui collent au modèle ; désambiguïsation `compatible` identique à `jiff` ; natif dans la WebView2 ; aligné avec FullCalendar v7 | 19,5 kB (budget, V17) ; natif en prod, polyfill en test ; laxisme de parsing (V14) à encadrer par des motifs stricts |

### 2.4 Où développer les RRULE
| Option | Pour | Contre |
|---|---|---|
| A. Moteur TS (`rrule` npm) pour l'affichage + Rust pour les notifications | Pas d'IPC | **Deux moteurs** ; `rrule` npm abandonné, bugs de fuseau (V5) |
| B. Moteur TS seul (`rrule-temporal`) | Une seule lib | Le planificateur Rust doit sonner fenêtre réduite ; lib jeune (V6) |
| **C. Moteur Rust seul, exposé par une commande Tauri pure** (`time_expand`) | **Un seul moteur** ; le front ne fait que coder/décoder le sous-ensemble ; cohérence par vecteurs partagés | Pas d'expansion hors Tauri (comme la base) ; un aller-retour IPC par plage affichée |

### 2.5 Bibliothèques côté Rust
| Option | Pour | Contre |
|---|---|---|
| `chrono` + `chrono-tz` seuls, `rrule` en mode zoné | Une famille de types | Pas de désambiguïsation « compatible » prête : à coder à la main ; sémantique DST de `rrule` implicite |
| Expansion maison sur `jiff` | Une seule lib | Réécrire un moteur RRULE = le calcul à la main interdit |
| **`jiff` + crate `rrule` comme moteur d'expansion « flottant » (UTC), encapsulée dans un seul fichier** | Même sémantique que Temporal ; la crate ne voit jamais de changement d'heure ; résolution faite une seule fois par `jiff` | Deux libs de dates dans le binaire ; `rrule` peu active mais isolée |

### 2.6 Heures inexistantes dans une récurrence
| Option | Verdict |
|---|---|
| Ignorer l'occurrence (RFC §3.3.10) | Rejeté : un rappel quotidien à 02:30 ne sonnerait pas le jour du passage à l'heure d'été |
| Erreur à la création | Rejeté : le problème survient des mois plus tard |
| **Décaler vers l'avant (`compatible`)** | **Retenu, validé par Marius (D3)**. Les dates invalides (31 avril, 29 février non bissextile) restent **ignorées** (D2) |

### 2.7 Typage TS des chaînes temporelles
| Option | Verdict |
|---|---|
| Types « marqués » (*branded*) | Rejeté pour l'instant : conversions de type dans chaque mapper de `data/` |
| **Alias documentés + validation aux frontières** | **Retenu** |

---

## 3. Décision

### 3.1 Formes stockées

#### 3.1.1 Les cinq formes
| Forme | Type TS (`data/time-formats.ts`) | Format exact | Suffixe | Exemple |
|---|---|---|---|---|
| Instant | `InstantIso` | `YYYY-MM-DDTHH:MM:SS.sssZ` (24 caractères, ms, toujours `Z`, troncature). Identique à `created_at` (ADR-002) | `_at` | `2026-10-25T00:30:00.000Z` |
| Date murale | `LocalDateIso` | `YYYY-MM-DD` | `_on` | `2026-11-03` |
| Heure murale | `LocalDateTimeIso` | `YYYY-MM-DDTHH:MM:SS` (seconde, sans fraction ni décalage) | `_local` | `2026-10-25T02:30:00` |
| Fuseau | `TimeZoneId` | identifiant IANA, 1 à 64 caractères, motif `^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$` (commence par une lettre : exclut les décalages fixes `+02`, `+02:00`, `-03`), `Etc/Unknown` refusé, puis validé par la tzdb des deux côtés (§3.2). Stocké sous la forme **normalisée par Temporal** (`timeZoneId`, casse canonique) | `time_zone` | `Europe/Paris` |
| Durée | `number` | entier de **millisecondes**, ≥ 0 | `_ms` | `1500000` |

Règles :
- **Validité** d'une date, d'une heure murale ou d'un instant stocké = **motif strict** **et** aller-retour exact `format(parse(x)) === x` (refuse `2026-02-30`, `T24:00:00`, `T23:59:60` que Temporal normaliserait en silence, V14).
- Bornes : **du 1900-01-01 au 2199-12-31** (comparaison de chaînes). Hors bornes : `out_of_range`.
- Une valeur qui traverse une frontière (base, IPC, configuration de widget, export JSON, signal partagé) est **toujours une de ces chaînes**. Les objets Temporal ne servent qu'aux calculs locaux.
- Entrées externes : un instant **RFC 3339 strict** (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$`, `T` et `Z` majuscules) est accepté puis normalisé en `Z` ; toute autre forme (espace, minuscules, compacte, `+0200`, annotation `[…]`, virgule) est refusée. Une date ou heure murale doit être exactement au format.
- Configuration de widget (JSON) : mêmes formats ; une durée de configuration porte son unité dans le nom (`workMinutes`).
- Pas de type « heure du jour seule » : une heure récurrente s'exprime par une ancre `start_local` + RRULE.

#### 3.1.2 Ancre d'un élément planifié (phase 2)
Un élément planifié a **exactement une** ancre :
- **horodatée** : `start_local` + `time_zone` ;
- **datée** : `start_on` (élément « toute la journée »), sans fuseau.

Plus, optionnellement : `rrule` (sans préfixe `RRULE:` ni `DTSTART`, sous-ensemble §3.5) et `exdates` (tableau JSON d'heures murales pour une ancre horodatée, de dates pour une ancre datée). Sans `rrule`, l'élément est ponctuel. L'instant d'un élément ponctuel horodaté n'est **pas stocké** : il est résolu à la lecture (§3.3). **Seules les ancres horodatées déclenchent des notifications** (§3.5.5).

#### 3.1.3 Fragments SQL normatifs (à recopier dans chaque migration qui crée une colonne temporelle)
`<c>` désigne la colonne. Tables `STRICT`, type `TEXT`. Le `IS` (et non `=`) est indispensable : un `CHECK` qui vaut `NULL` **passe**. Le modificateur `'+0 seconds'` est indispensable : sans lui, `strftime` renvoie `T24:00:00` tel quel (V13).

```sql
-- Instant (_at)
<c> TEXT NOT NULL CHECK (
  <c> GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', <c>, '+0 seconds') IS <c>
  AND <c> BETWEEN '1900-01-01' AND '2200-01-01')

-- Date murale (_on)
<c> TEXT NOT NULL CHECK (
  <c> GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND date(<c>) IS <c>
  AND <c> BETWEEN '1900-01-01' AND '2199-12-31')

-- Heure murale (_local)
<c> TEXT NOT NULL CHECK (
  <c> GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
  AND strftime('%Y-%m-%dT%H:%M:%S', <c>, '+0 seconds') IS <c>
  AND <c> BETWEEN '1900-01-01' AND '2200-01-01')

-- Fuseau
time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64
  AND time_zone GLOB '[A-Za-z]*'
  AND time_zone NOT GLOB '*[^A-Za-z0-9_+/-]*')

-- Durée
<c>_ms INTEGER NOT NULL CHECK (<c>_ms >= 0)

-- Règle et exceptions (phase 2)
rrule   TEXT NULL CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*'))
exdates TEXT NOT NULL CHECK (json_valid(exdates) AND json_type(exdates) = 'array'
  AND json_array_length(exdates) <= 366 AND length(exdates) <= 8192)

-- Ancre exclusive (phase 2) : start_local, time_zone et start_on utilisent la variante
-- OPTIONNELLE de leur fragment (TEXT NULL CHECK (<c> IS NULL OR (…))), et cette contrainte de table :
CHECK ((start_local IS NOT NULL AND time_zone IS NOT NULL AND start_on IS NULL)
    OR (start_local IS NULL AND time_zone IS NULL AND start_on IS NOT NULL))
```
Variante optionnelle d'un fragment : `<c> TEXT NULL CHECK (<c> IS NULL OR (…))`. Pas de `DEFAULT` SQL. La validation fine (tzdb, grammaire RRULE, contenu des `exdates`) est faite par `core/time` avant l'écriture et par le Rust à la lecture ; le `CHECK` est un filet. 366 exceptions de 22 caractères (`"2026-10-25T02:30:00",`) tiennent dans 8 192 caractères.

### 3.2 Fuseau de l'utilisateur
- **Réglage** : clé `time.zone` de `settings` ; valeur JSON chaîne, ou **absente** = « suivre Windows » (`SettingsRepository.remove('time.zone')`).
- **Défaut système** : `Intl.DateTimeFormat().resolvedOptions().timeZone`, lu uniquement dans `core/time`. Si la valeur est invalide (dont `Etc/Unknown`) : `UTC`, signalé dans Réglages.
- **Validation** (identique des deux côtés, vecteurs `timeZoneValidity`) : longueur 1..64 ; motif §3.1.1 ; refus explicite de `Etc/Unknown` (insensible à la casse) ; puis tzdb : `Temporal.ZonedDateTime.from({ year: 2026, month: 1, day: 1, timeZone })` sans exception (TS) / `jiff::tz::TimeZone::get` sans erreur **et** différent de `TimeZone::unknown()` (Rust). Valeur stockée : `zdt.timeZoneId` (casse normalisée par Temporal, alias conservés : `Asia/Calcutta` reste `Asia/Calcutta`).
- **Valeur stockée invalide** : ignorée, on suit Windows, Réglages le signale. Jamais d'exception au démarrage.
- **Usages du fuseau utilisateur** (front uniquement) : affichage des instants ; « aujourd'hui » ; fuseau par défaut des nouveaux éléments horodatés ; placement des occurrences « toute la journée » dans une plage d'affichage. **Le Rust ne lit jamais le fuseau utilisateur ni celui de Windows.**
- **Rafraîchissement** : au démarrage, sur `visibilitychange` (visible) et `focus`, et au changement du réglage.

**Si le fuseau change** (ex. `Europe/Paris` → `America/Montreal`) :
| Donnée | Effet |
|---|---|
| Instants (`_at`) | Inchangés ; ré-affichés dans le nouveau fuseau |
| Dates murales (`_on`) | Inchangées ; « aujourd'hui » recalculé |
| Éléments horodatés existants | **Inchangés dans leur propre fuseau** (D1) : « 9 h Europe/Paris » sonne à 9 h à Paris (3 h à Montréal) ; affiché « 03:00 (09:00 Paris) » |
| Nouveaux éléments | Créés dans le nouveau fuseau |
| Timers en cours | Inchangés |

### 3.3 Résolution heure murale → instant, changements d'heure
Une seule règle, identique en TS (`resolveLocal`) et en Rust (`resolve_local`) : heure unique → l'instant ; **pli** → la **première** occurrence ; **trou** → décalage d'avant le trou, donc **décalée vers l'avant** (D3). C'est `disambiguation: 'compatible'` (Temporal) = `Disambiguation::Compatible` (`jiff`) = RFC 5545 §3.3.5, appliquée aussi à chaque occurrence d'une récurrence. L'interface signale une heure en trou ou en pli à la saisie (`classifyLocal`).

Exemples `Europe/Paris` (vérifiés, V12) :
| Cas | Heure murale | Instant |
|---|---|---|
| Pli du 2026-10-25 (03:00 CEST → 02:00 CET) | `2026-10-25T02:30:00` | `2026-10-25T00:30:00.000Z` (1re occurrence, CEST) |
| Début du pli | `2026-10-25T02:00:00` | `2026-10-25T00:00:00.000Z` |
| Juste avant le pli | `2026-10-25T01:59:59` | `2026-10-24T23:59:59.000Z` |
| Après le pli | `2026-10-25T03:00:00` | `2026-10-25T02:00:00.000Z` (CET) |
| Trou du 2027-03-28 (02:00 CET → 03:00 CEST) | `2027-03-28T02:30:00` | `2027-03-28T01:30:00.000Z` (= 03:30 CEST) |
| Début du trou | `2027-03-28T02:00:00` | `2027-03-28T01:00:00.000Z` |
| Après le trou | `2027-03-28T03:00:00` | `2027-03-28T01:00:00.000Z` |
| Instant → heure murale, 2e passage | `2026-10-25T01:30:00.000Z` | heure murale `2026-10-25T02:30:00` (CET) |

Conséquences : un quotidien à 02:30 sonne **une fois** le 2026-10-25 (00:30Z) et à 03:30 le 2027-03-28 ; un quotidien à 09:00 passe de 07:00Z à 08:00Z le 25/10 ; les durées se calculent entre instants (pomodoro de 25 min lancé à `00:50:00.000Z` le 25/10 : fin `01:15:00.000Z`, affichée 02:15) ; `startOfDay` gère un minuit inexistant ; le 2026-10-25 dure 25 h à Paris, le 2027-03-28 dure 23 h.

### 3.4 Bibliothèques
**TypeScript (`apps/web`)**
- `temporal-polyfill` **^1.0.6**, référencé **uniquement** dans `core/time/temporal.ts`. Tout le reste importe `Temporal` depuis `core/time`, **sans alias**.
  - **Amendement (2026-10-21, validé par Marius) : chargement conditionnel.** La forme initiale (`export { Temporal } from 'temporal-polyfill'`, ponyfill) embarquait ~57 kB de polyfill dans le bundle initial alors que la WebView2 a Temporal natif (code mort en production). `temporal.ts` exporte désormais une liaison vivante `export let Temporal = globalThis.Temporal` (fusionnée avec un espace de noms de types seuls, pour que `Temporal.Instant` serve de type et de valeur) et `installTemporal()`, qui fait `import('temporal-polyfill')` (chunk paresseux) **uniquement** si `globalThis.Temporal` est absent. `main.ts` appelle `installTemporal().then(() => bootstrapApplication(…))` (pas un initialiseur Angular : ils tournent en parallèle, un service racine pourrait utiliser `core/time` trop tôt). Tests : `src/test-setup.ts` (cible `test`, `setupFiles`) charge `temporal-polyfill/global` (Node 24 n'a pas Temporal natif) ; exempté de la règle d'import ESLint, comme `import()` dans `temporal.ts`. Risque R3 inchangé : vecteurs vérifiés sous polyfill, production en natif ; contrôle manuel `typeof globalThis.Temporal === 'object'` dans la WebView2.
- **Aucune** bibliothèque RRULE : codec strict maison (§3.5), qui ne calcule aucune date ; il appelle `parseLocalDate` de `core/time` pour valider la date d'un `UNTIL`.
- Formatage : `TimeDisplay` uniquement (`Intl.DateTimeFormat` avec `timeZone` explicite). `DatePipe`, `formatDate` et `CommonModule` (qui apporte `| date`) interdits.
- Saisie de dates (phase 1) : `<input type="date">` natif (valeur `YYYY-MM-DD`, validée par `parseLocalDate`). Le `DatePicker` de PrimeNG (qui produit un `Date`) est **interdit** tant qu'un adaptateur `Date` ↔ `LocalDateIso` n'existe pas dans `core/time` (à concevoir s'il devient nécessaire).
- **Budget** : le build est déjà à ~504 kB pour 500 kB (V17). **Ne pas relever le budget sans l'accord de Marius.** Si `web:build` échoue sur le budget, s'arrêter et rapporter. Piste à lui soumettre : garder Temporal hors du bundle initial (initialiseur de fuseau fondé sur `Intl` seul, Temporal chargé avec les widgets et Réglages paresseux).

**Rust (`apps/desktop/src-tauri`, phase 2)**
- `jiff = "0.2"` (≥ 0.2.38, features par défaut) : instants, dates et heures murales, fuseaux, résolution.
- `rrule = "=0.14.0"` (version exacte) : moteur d'expansion flottant, dans **un seul fichier** (`time/recurrence/engine.rs`).
- `chrono` seulement si `rrule` ne réexporte pas les types nécessaires ; alors `chrono = { version = "0.4", default-features = false, features = ["std"] }`, importé seulement dans `engine.rs`.
- Pas de `chrono-tz` direct, pas de `thiserror`.
- MSRV : `jiff` 1.70, `rrule` 1.74 ; projet 1.90, toolchain 1.99 : compatible.

### 3.5 Récurrence

#### 3.5.1 Sous-ensemble supporté
Texte **canonique**, majuscules, sans `RRULE:` ni `DTSTART`, ≤ 256 caractères, ordre `FREQ`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `COUNT`, `UNTIL`.

| Partie | Valeurs | Autorisée avec |
|---|---|---|
| `FREQ` (obligatoire) | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` | — |
| `INTERVAL` | entier sans zéro initial ; DAILY 1..366, WEEKLY 1..52, MONTHLY 1..11, YEARLY 1..10 ; **omis s'il vaut 1** | toutes |
| `BYDAY` (liste) | jours `MO`…`SU` sans ordinal, sans doublon, triés `MO`→`SU` | `WEEKLY` uniquement |
| `BYDAY` (ordinal) | **exactement un** jeton `<n><JJ>`, `n` ∈ {1, 2, 3, 4, -1} | `MONTHLY` uniquement |
| `BYMONTHDAY` | **une** valeur, 1..31 ou -1 | `MONTHLY` uniquement, exclusif avec `BYDAY` |
| `COUNT` | 1..1000 | exclusif avec `UNTIL` |
| `UNTIL` | ancre horodatée : `YYYYMMDDTHHMMSSZ` ; ancre datée : `YYYYMMDD` | exclusif avec `COUNT` |

Refusés : `SECONDLY`, `MINUTELY`, `HOURLY`, `BYHOUR`, `BYMINUTE`, `BYSECOND`, `BYMONTH`, `BYYEARDAY`, `BYWEEKNO`, `BYSETPOS`, `WKST` (toujours `MO`), `RDATE`, `EXRULE`. `MONTHLY;INTERVAL=12` refusé (recherche infinie possible, ex. « le 31 de chaque février ») : utiliser `YEARLY`. Sans `BYDAY`/`BYMONTHDAY`, le jour vient de l'ancre (RFC). L'interface propose « dernier jour du mois » (`BYMONTHDAY=-1`) et avertit quand le jour choisi est > 28 (D2).

#### 3.5.2 Codes d'erreur (identiques TS et Rust, ordre de contrôle imposé)
Le premier contrôle en échec détermine le code :
1. `too_long` : > 256 caractères.
2. `syntax` : ne correspond pas à `^[A-Z]+=[^;=]+(;[A-Z]+=[^;=]+)*$` (vide, minuscules, préfixe `RRULE:`).
3. `duplicate_part`.
4. `unsupported_part` : clé hors {`FREQ`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `COUNT`, `UNTIL`}.
5. `missing_freq`.
6. `invalid_value` : chaque valeur, dans l'ordre canonique, est examinée **jeton par jeton** :
   - `FREQ` ∈ les 4 valeurs ; `INTERVAL`, `COUNT`, `BYMONTHDAY` entiers sans zéro initial dans leurs bornes (`INTERVAL` selon la `FREQ`) ;
   - chaque jeton de `BYDAY` correspond à `^(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$` ;
   - `UNTIL` correspond à l'**une des trois formes** `YYYYMMDD`, `YYYYMMDDTHHMMSS`, `YYYYMMDDTHHMMSSZ`, avec date **valide** (aller-retour `parseLocalDate` / `parse_local_date`), heure valide (`HH` ≤ 23, `MM` et `SS` ≤ 59) et bornes 1900..2199. Ex. `UNTIL=20260230` → `invalid_value`.
7. `duplicate_value` : jetons identiques (`BYDAY=MO,MO`, `BYDAY=2TU,2TU`).
8. `part_not_allowed` : partie ou **forme** interdite pour cette `FREQ` : `BYDAY` hors WEEKLY/MONTHLY ; en WEEKLY, tout jeton ordinal (`BYDAY=MO,2TU` → `part_not_allowed`) ; en MONTHLY, autre chose qu'**exactement un** jeton ordinal (`BYDAY=MO,2TU`, `BYDAY=2TU,3WE`, `BYDAY=MO` → `part_not_allowed`) ; `BYMONTHDAY` hors MONTHLY.
9. `conflicting_parts` : `BYDAY` et `BYMONTHDAY` ensemble.
10. `count_and_until`.
11. Type d'`UNTIL` selon l'ancre : ancre horodatée + `YYYYMMDDTHHMMSS` → `until_not_utc` ; ancre horodatée + `YYYYMMDD` → `until_kind_mismatch` ; ancre datée + forme date-heure (avec ou sans `Z`) → `until_kind_mismatch`.
12. `until_before_start` : `UNTIL` antérieur à l'instant (ou à la date) de l'ancre. Contrôlé par `time_validate` / `validate_spec` seulement (il faut l'ancre).

#### 3.5.3 EXDATE et UNTIL
- `exdates` : heures murales **nominales** (ancre horodatée) ou dates (ancre datée), triées, uniques, ≤ 366. Correspondance par **égalité de chaînes** avec l'heure murale nominale : l'occurrence décalée du 2027-03-28 se supprime avec `2027-03-28T02:30:00`. Une exception sans correspondance est sans effet.
- `COUNT` est appliqué **avant** les exceptions : `COUNT=5` + 1 exception = 4 occurrences.
- `UNTIL` est **inclusif**, comparé à l'**instant résolu**. L'interface propose « jusqu'au <date> inclus » et calcule `UNTIL = startOfDay(date + 1 jour, fuseau de l'élément) − 1 s` en UTC. Ex. : quotidien à 23:30 Paris jusqu'au 31/12/2026 inclus → `UNTIL=20261231T225959Z`.

#### 3.5.4 Sémantique de l'expansion (Rust, moteur unique)
Entrée : spec, plage `[from, to)`, fuseau d'affichage de la plage, limite.
1. **Expansion flottante** : la crate reçoit `DTSTART` = heure murale nominale de l'ancre (minuit pour une ancre datée) **déguisée en UTC** (`rrule::Tz::UTC`), et la règle construite par le builder à partir de la structure validée, **sans `UNTIL`**. En UTC, ni trou ni pli. Les dates invalides sont ignorées par la crate (RFC, D2).
2. Itération paresseuse depuis `DTSTART` (inévitable : `COUNT` et l'alignement d'`INTERVAL` se calculent depuis l'ancre ; la crate itère de toute façon depuis là) ; arrêt quand l'heure murale dépasse `hi` = `to` converti en heure murale du fuseau de l'élément (d'affichage pour une ancre datée) + 1 jour. Au-delà de **100 000 itérations** : `expansion_limit`.
3. Seules les heures murales nominales dans `[lo, hi]`, avec `lo` = `from` converti de même − 1 jour, sont **résolues** par `jiff` (les autres ne servent qu'au compte) ; exclusion des `exdates` ; **résolution** par `resolve_local` pour une ancre horodatée.
4. Filtre `UNTIL` (inclusif) puis filtre de plage : instant ∈ `[from, to)` (ancre horodatée) ; journée `[startOfDay(d), startOfDay(d+1))` dans le **fuseau d'affichage** qui chevauche `[from, to)` (ancre datée).
5. Tri chronologique, coupe à `limit` (`truncated = true`).

Une ancre sans règle suit le même chemin. **Clé d'occurrence** = heure murale nominale ou date : stable, unique par élément, clé de déduplication des notifications et cible des `exdates`. Une ancre qui ne correspond pas à sa règle (un mardi avec `BYDAY=MO,WE`) n'est **ni une occurrence ni comptée** (RFC : cas non défini ; sémantique python-dateutil, S4).

Limites : plage ≤ **400 jours** et `from < to` (sinon `invalid_range`) ; `limit` 1..1000 (défaut 500) ; entrées IPC bornées (§3.8).

#### 3.5.5 Prochaine occurrence et notifications
`next_after(spec, after)` (Rust) renvoie la première occurrence **strictement après** `after`, cherchée sur **10 ans** au plus (au-delà : « aucune »). Elle n'est définie que pour une **ancre horodatée** ; pour une ancre datée elle renvoie `TimeError::NotSchedulable`. Décision : **une ancre datée ne déclenche jamais de notification** (sinon le Rust devrait connaître le fuseau utilisateur pour savoir quand commence la journée). Un rappel d'habitude « à 20 h » est donc une ancre horodatée ; une habitude « tous les lundis » sans heure n'est qu'affichée.

### 3.6 Horloge injectable et interdiction du calcul à la main
**TS**
- `Clock` (`data/clock.ts`) reste **l'unique** source du « maintenant » (`nowIso()`).
- **Amendement ADR-002** : le jeton `CLOCK` est déclaré dans `data/data.providers.ts` (seul fichier de `data/` qui importe Angular ; `data/` ne peut pas importer `core/`) : `new InjectionToken<Clock>('CLOCK', { providedIn: 'root', factory: () => systemClock })`. Les fabriques des trois repositories utilisent `inject(CLOCK)` au lieu de `systemClock` en dur. `data/index.ts` l'exporte ; `core/time` le réexporte avec `nowInstant(clock)`. Ainsi, fournir `ManualClock` comme `CLOCK` pilote aussi `created_at` / `updated_at`.
- Toute arithmétique de date passe par `core/time`. Interdits hors `core/time/**` et `data/clock.ts` (ESLint, §8.3) : toute référence à `Date` hors position de type, les accesseurs `get*/set*` de date, `getTimezoneOffset`, `toLocaleDateString/TimeString`, `Intl.DateTimeFormat` (y compris `Intl['DateTimeFormat']` et la déstructuration), `Temporal.Now` (y compris via alias ou `Temporal['Now']`), l'import de `temporal-polyfill`, `DatePipe`, `formatDate`, `CommonModule`. `*.spec.ts` et `**/testing/**` sont exemptés de la règle `Date` (fakes existants) mais pas de `Temporal.Now`.
- Les ticks d'interface ne font que déclencher un recalcul depuis `clock.nowIso()`.

**Rust**
- `trait Clock: Send + Sync { fn now(&self) -> jiff::Timestamp; }`, `SystemClock`, `FixedClock` (test).
- `clippy.toml` (`disallowed-methods`) : `std::time::SystemTime::now`, `jiff::Timestamp::now`, `jiff::Zoned::now`, `jiff::tz::TimeZone::system` (+ `chrono::Utc::now`, `chrono::Local::now` si `chrono` est direct). Seul `time/clock.rs` porte un `#[allow(clippy::disallowed_methods)]`. `std::time::Instant` reste autorisé pour mesurer une attente.

### 3.7 `CalendarSource` : partie figée ici
Remplace `core/calendar/calendar-source.ts` (lot B). Les autres champs de `CalendarEvent` (couleur, lien, éditabilité) relèvent de l'ADR-004 et s'ajouteront **sans modifier** ceux-ci.
```ts
import type { InstantIso, LocalDateIso, TimeZoneId } from '../../data';

/** Plage [from, to) ; to - from <= 400 jours. timeZone = fuseau d'affichage (utilisateur),
 *  sert à placer les événements « toute la journée ». */
export interface CalendarRange {
  readonly from: InstantIso;
  readonly to: InstantIso;
  readonly timeZone: TimeZoneId;
}

export type CalendarEventTime =
  | { readonly kind: 'timed'; readonly start: InstantIso; readonly end: InstantIso | null; readonly timeZone: TimeZoneId }
  /** lastOn inclus (>= startOn) ; l'adaptateur de la lib calendrier convertit en fin exclusive si besoin. */
  | { readonly kind: 'all-day'; readonly startOn: LocalDateIso; readonly lastOn: LocalDateIso };

export interface CalendarEvent {
  /** `${sourceType}:${sourceId}:${occurrenceKey ?? ''}` : stable entre deux appels. */
  readonly id: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Clé d'occurrence (§3.5.4) ou null pour un élément non récurrent. */
  readonly occurrenceKey: string | null;
  /** Donnée utilisateur : rendue par interpolation, jamais innerHTML. */
  readonly title: string;
  readonly time: CalendarEventTime;
}

export interface CalendarSource {
  /** Rejette avec DataError ; ne renvoie que des événements qui chevauchent la plage. */
  listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]>;
}
```

### 3.8 Commandes Tauri de temps (phase 2)
Deux commandes **pures** (aucun accès disque, réseau ni état), **asynchrones** (`#[tauri::command(async)]`, pour ne pas bloquer le thread principal pendant une expansion, V16) : `time_validate(spec)` et `time_expand(spec, range)`.
- `build.rs` : ajouter `"time_validate"` et `"time_expand"` à la liste `AppManifest::commands` existante.
- `capabilities/default.json` : ajouter `"allow-time-validate"` et `"allow-time-expand"`. Aucun nouveau fichier de capability.
- Surface d'attaque : déni de service par entrée énorme. Bornes vérifiées **avant** tout calcul : chaînes ≤ 256 caractères, `exdates` ≤ 366, plage ≤ 400 jours, `limit` ≤ 1000, itérations ≤ 100 000. Fuseaux filtrés par le motif avant `TimeZone::get` (aucun chemin de fichier n'est construit, la tzdb est embarquée).

### 3.9 Phase 1 : TODO avec échéance optionnelle
- `due_on TEXT NULL` (date murale, variante optionnelle du fragment §3.1.3). **Pas** d'heure, **pas** de fuseau, **pas** de notification en phase 1.
- `completed_at TEXT NULL` (instant), écrit depuis `CLOCK`.
- TS : `dueOn: LocalDateIso | null`, `completedAt: InstantIso | null`.
- Saisie : `<input type="date">` (§3.4), valeur validée par `parseLocalDate` ; chaîne vide → `null`.
- Statut d'échéance calculé par `core/time` : `daysBetween(Today.date(), dueOn)` < 0 → en retard de N jours ; = 0 → aujourd'hui ; = 1 → demain ; sinon `TimeDisplay.formatLocalDate`.
- Tri SQL direct sur `due_on`, `NULLS LAST` explicite.
- **Amendement (2026-10-21, implémentation du widget TODO)** : le widget trie par ordre manuel (`sort_order`, tâches non terminées d'abord, puis terminées par `completed_at` décroissant) et non par échéance ; l'échéance n'est qu'une étiquette. Un tri par `due_on` (`NULLS LAST`) reste possible plus tard comme option d'affichage. Une tâche terminée n'est jamais « en retard ».
- Une échéance avec heure et rappel arrivera en phase 2 sous forme d'un **rappel** lié (ancre horodatée).

### 3.10 Ce qui reste pour la phase 2 et l'ADR-004
**Spec planificateur (phase 2, Opus)** : boucle (réveil à intervalle borné, ≤ 30 s, comparé à `Clock::now()` pour survivre à la veille et aux changements d'horloge) ; rattrapage au démarrage (recommandation : une notification pour la **dernière** occurrence manquée par élément, plus un résumé) ; table des déclenchements avec unicité `(élément, clé d'occurrence)` ; cache `next_fire_at` ; accès Rust à la base (ADR-002 O2) ; plugin single-instance ; modèle des timers ; édition « cette occurrence / les suivantes / toutes ».
**ADR-004** : bibliothèque calendrier, champs visuels de `CalendarEvent`, conversion vers la lib, début de semaine (lundi en `fr`).

---

## 4. Conséquences
Positives :
- Un seul moteur d'expansion (Rust) pour les notifications et l'affichage ; aucune lib RRULE côté front.
- Résolution DST identique des deux côtés par construction, vérifiée par des vecteurs partagés.
- Les éléments futurs suivent automatiquement une mise à jour de la tzdb.
- Le Rust n'a pas besoin du fuseau utilisateur.
- Les dates sans heure ne bougent jamais avec le fuseau.

Négatives et coûts :
- +19,5 kB gzip côté front, alors que le budget initial est déjà dépassé (V17) : décision de Marius requise si le build échoue.
- Deux libs de dates dans le binaire Rust.
- Pas d'expansion hors Tauri.
- Règles ESLint et clippy supplémentaires ; amendement de `data/data.providers.ts` (`CLOCK`).
- Écart assumé à la RFC 5545 §3.3.10 (D3) : un export iCalendar futur devra le documenter.
- Les ancres datées n'émettent pas de notification (§3.5.5).

## 5. Risques
| Risque | Impact | Mitigation |
|---|---|---|
| R1. Crate `rrule` peu maintenue | Bug non corrigé, incompatibilité future de `chrono` | Version exacte ; encapsulée dans `engine.rs` ; vecteurs exhaustifs ; repli : moteur maison sur `jiff` limité au sous-ensemble (ADR amendé), les vecteurs servant de spécification |
| R2. tzdb différente entre WebView2 (ICU) et `jiff-tzdb` | Affichage décalé d'une heure par rapport à la sonnerie pendant quelque temps | Le Rust fournit les occurrences affichées ; Dependabot sur `jiff` ; WebView2 Evergreen |
| R3. Natif (prod) et polyfill (tests) divergent | Un test passe, la prod diffère | Vecteurs sur les cas critiques ; contrôle CA-A8 ; passage au natif en test avec Node 26 |
| R4. Fuseau Windows mal configuré | « Aujourd'hui » faux, nouveaux rappels dans le mauvais fuseau | Réglage `time.zone` ; fuseau effectif affiché ; les rappels existants ne bougent pas |
| R5. Rappel « 9 h Paris » non suivi en voyage | Rappel à 3 h à Montréal | Accepté (D1) ; fuseau d'origine affiché |
| R6. Règles non terminantes ou coûteuses | Blocage | Sous-ensemble restreint, plafond de 100 000 itérations, horizon de 10 ans, commandes asynchrones |
| R7. Calcul de date à la main réintroduit (ex. `+ 86400000`) | Bugs DST | ESLint + clippy + revue (la règle n'attrape pas l'arithmétique sur des nombres) |
| R8. Fuseau accepté par Temporal mais refusé par `jiff` (décalage fixe, `Etc/Unknown`) | Rappel qui ne sonne jamais | Motif commun commençant par une lettre, refus explicite d'`Etc/Unknown`, vecteurs `timeZoneValidity` des deux côtés (S8) |
| R9. Parsing laxiste de Temporal (`23:59:60`, formes non RFC 3339) | Valeurs normalisées en silence | Motifs stricts + aller-retour (§3.1.1) |
| R10. Budget de build dépassé | Build en échec | Arrêt et décision de Marius (§3.4) |

## 6. Cas limites (résultats attendus, vérifiés côté TS, V12)
Tous les exemples horodatés sont en `Europe/Paris` sauf mention. « R » = règle, « A » = ancre.

| # | Cas | Entrée | Résultat attendu |
|---|---|---|---|
| C1 | Pli, rappel ponctuel | A `2026-10-25T02:30:00` | `2026-10-25T00:30:00.000Z`, une seule notification ; l'interface signale l'heure ambiguë |
| C2 | Pli, quotidien | A `2026-10-24T02:30:00`, R `FREQ=DAILY;COUNT=3` | `2026-10-24T00:30:00.000Z`, `2026-10-25T00:30:00.000Z`, `2026-10-26T01:30:00.000Z` |
| C3 | Trou, quotidien | A `2027-03-27T02:30:00`, R `FREQ=DAILY;COUNT=3` | `2027-03-27T01:30:00.000Z`, `2027-03-28T01:30:00.000Z` (03:30 CEST), `2027-03-29T00:30:00.000Z` |
| C4 | Trou, exception sur l'occurrence décalée | C3 + `exdates ["2027-03-28T02:30:00"]` | `2027-03-27T01:30:00.000Z`, `2027-03-29T00:30:00.000Z` |
| C5 | 09:00 à travers le pli | A `2026-10-24T09:00:00`, `FREQ=DAILY;COUNT=3` | `07:00Z` le 24, `08:00Z` le 25, `08:00Z` le 26 |
| C6 | Hebdo, ancre hors règle | A mardi `2026-10-20T09:00:00`, `FREQ=WEEKLY;BYDAY=WE,MO;COUNT=3` (canonique `BYDAY=MO,WE`) | `2026-10-21T07:00:00.000Z`, `2026-10-26T08:00:00.000Z`, `2026-10-28T08:00:00.000Z` (ancre ni occurrence ni comptée, S4) |
| C7 | Le 31 de chaque mois | A `2026-01-31T09:00:00`, `FREQ=MONTHLY;BYMONTHDAY=31;COUNT=4` | 31/01 `08:00Z`, 31/03 `07:00Z`, 31/05 `07:00Z`, 31/07 `07:00Z` (mois de 30 jours et février ignorés, D2) |
| C8 | Dernier jour du mois | A datée `2028-01-31`, `FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3` | `2028-01-31`, `2028-02-29`, `2028-03-31` |
| C9 | 29 février annuel | A datée `2028-02-29`, `FREQ=YEARLY;COUNT=3` | `2028-02-29`, `2032-02-29`, `2036-02-29` (D2) |
| C10 | Dernier vendredi | A `2026-10-30T18:00:00`, `FREQ=MONTHLY;BYDAY=-1FR;COUNT=3` | `2026-10-30T17:00:00.000Z`, `2026-11-27T17:00:00.000Z`, `2026-12-25T17:00:00.000Z` |
| C11 | `UNTIL` correct en UTC | A `2026-12-29T23:30:00`, `FREQ=DAILY;UNTIL=20261231T225959Z` | 3 occurrences, la dernière `2026-12-31T22:30:00.000Z` |
| C12 | `UNTIL` naïf | même A, `FREQ=DAILY;UNTIL=20261231T000000Z` | 2 occurrences (29 et 30) |
| C13 | `UNTIL` égal à une occurrence dans le pli | A `2026-10-23T02:30:00`, `FREQ=DAILY;UNTIL=20261025T003000Z` | 3 occurrences, la dernière `2026-10-25T00:30:00.000Z` (inclusif) |
| C14 | `UNTIL` sans `Z` | `FREQ=DAILY;UNTIL=20261231T225959`, ancre horodatée | `until_not_utc` |
| C15 | `COUNT` + `UNTIL` | `FREQ=DAILY;COUNT=3;UNTIL=20261231T225959Z` | `count_and_until` |
| C16 | `COUNT` et exception | `FREQ=DAILY;COUNT=5` + 1 exception correspondante | 4 occurrences |
| C17 | `COUNT` et fenêtre | A `2026-11-01T09:00:00`, `FREQ=DAILY;COUNT=3`, plage `[2026-11-02T11:00:00.000Z, 2026-12-01T00:00:00.000Z)` | 1 occurrence, `2026-11-03T08:00:00.000Z` (S5) |
| C18 | Changement de fuseau utilisateur | `Europe/Paris` → `America/Montreal` | TODO due le `2026-11-03` inchangée ; rappel 09:00 Paris sonne `08:00Z`, affiché « 03:00 (09:00 Paris) » ; nouveaux rappels en Montréal |
| C19 | Fuseau stocké invalide | `time.zone` = `"Mars/Base"`, `"+02:00"` ou `"Etc/Unknown"` | Ignoré, fuseau Windows utilisé, Réglages signale l'erreur |
| C20 | Fuseau Windows inconnu | `resolvedOptions().timeZone` invalide (dont `Etc/Unknown`) | `UTC` + avertissement |
| C21 | Passage de minuit (y compris sortie de veille) | 23:59:59 → 00:00:01 Paris | `Today.date()` change au retour visible / focus, ou au minuit suivant (minuterie bornée à 15 min) |
| C22 | Journées de 25 h / 23 h | `startOfDay` 25/10/2026, 26/10/2026 ; 28/03/2027 | `2026-10-24T22:00:00.000Z`, `2026-10-25T23:00:00.000Z` ; `2027-03-27T23:00:00.000Z` |
| C23 | Minuit inexistant | `startOfDay('2026-09-06', 'America/Santiago')` | `2026-09-06T04:00:00.000Z` (01:00 locale) |
| C24 | « Toute la journée » et plage | A datée `2026-10-25`, plage `[2026-10-25T22:30:00.000Z, …)` en Paris | Inclus (la journée du 25 finit à 23:00Z) |
| C25 | Pomodoro à travers le pli | Début `2026-10-25T00:50:00.000Z`, 25 min | Fin `2026-10-25T01:15:00.000Z`, affichée 02:15 ; durée 25:00 |
| C26 | Horloge système reculée | `nowIso` recule de 1 h | Aucune erreur d'écriture ; timer affiché plus court ; pas de double notification (clé d'occurrence, phase 2) |
| C27 | Instant importé avec décalage | `2026-10-20T10:15:00+02:00` | `2026-10-20T08:15:00.000Z` ; `2026-10-20 10:15:00Z`, `2026-10-20T10:15Z`, `2026-10-20t10:15:00z`, `2026-10-20T10:15:00+0200` refusés |
| C28 | Dates et heures invalides | `2026-02-29`, `2026-13-01`, `2026-2-1` ; `2026-10-25T24:00:00`, `2026-12-31T23:59:60` ; instant `2026-10-25T24:00:00.000Z` | `invalid_local_date` / `invalid_local_date_time` / `invalid_instant` (TS) ; `CHECK` en échec (SQL) |
| C29 | Hors bornes | `1899-12-31`, `2200-01-01` | `out_of_range` |
| C30 | Plage trop longue | `time_expand` sur 401 jours | `invalid_range` |
| C31 | Règles refusées | `FREQ=HOURLY` ; `FREQ=DAILY;BYHOUR=9` ; `FREQ=MONTHLY;INTERVAL=12` ; `FREQ=MONTHLY;BYDAY=MO,2TU` ; `FREQ=MONTHLY;BYDAY=2TU,3WE` ; `FREQ=WEEKLY;BYDAY=MO,2TU` ; `FREQ=DAILY;UNTIL=20260230` | `invalid_value` ; `unsupported_part` ; `invalid_value` ; `part_not_allowed` ; `part_not_allowed` ; `part_not_allowed` ; `invalid_value` |
| C32 | Hors Tauri | `RecurrenceEngine.expand` sous `ng serve` | `DataError('unavailable')` ; le reste de `core/time` fonctionne |
| C33 | Doublons | Même exception deux fois ; `BYDAY=MO,MO` ; `BYDAY=2TU,2TU` | Exceptions dédoublonnées ; `duplicate_value` ; `duplicate_value` |
| C34 | Suppression | Une occurrence / tout l'élément | Clé ajoutée aux `exdates` / suppression dure (ADR-002) |
| C35 | Hors-ligne, synchronisation | — | Sans objet : tzdb embarquée ou ICU, aucun réseau, pas de synchro |
| C36 | Secondes fractionnaires | `toLocalDateTime('2026-10-20T08:15:30.999Z', 'UTC')` | `2026-10-20T08:15:30` (troncature) |
| C37 | Prochaine occurrence d'une ancre datée | `next_after` sur A datée | `not_schedulable` (§3.5.5) |
| C38 | Fuseau en minuscules | saisie `europe/paris` | Accepté, stocké `Europe/Paris` |

## 7. Décisions validées par Marius (2026-10-20)
- **D1** Un rappel garde son propre fuseau (« 9 h Paris » reste 9 h Paris si le fuseau change).
- **D2** Les jours inexistants sont ignorés comme le veut la RFC (le « 31 » saute les mois de 30 jours ; le 29 février ne sonne que les années bissextiles). L'interface propose « dernier jour du mois ».
- **D3** Une heure inexistante (trou du passage à l'heure d'été) est décalée vers l'avant (écart RFC §3.3.10 assumé).

Points restant ouverts : aucun dans cet ADR (ROADMAP et PLAN mis à jour par le coordinateur ; budget de build : décision de Marius seulement si le build échoue, §3.4).

---

## 8. Spec d'implémentation

Destinataire : `implementer` (Sonnet). Spec autonome : lire aussi `CLAUDE.md`, `docs/adr/002-data-layer.md` §3.3 et §6.6, `docs/adr/001-widget-contract.md` §3.1 et §3.8. Chemins relatifs à `apps/web/src/app/` sauf mention. Ne pas improviser : si une supposition (S1, S3 à S6, S8) se révèle fausse, ou si un vecteur donne **des deux côtés** un résultat différent de l'attendu, s'arrêter et rapporter.

- **Lot A (phase 1, avant le widget TODO)** : formats, `CLOCK`, `core/time`, fuseau utilisateur, « aujourd'hui », affichage, lint TS, vecteurs sans récurrence.
- **Lot B (début de phase 2)** : module Rust `time`, codec RRULE TS, moteur, commandes Tauri, `CalendarSource`, clippy.

### 8.1 Lot A : fichiers
Créer :
```
data/time-formats.ts
data/time-formats.spec.ts                 (test:data)
data/sql-time-checks.spec.ts              (test:data)
core/time/temporal.ts                     (seul import de temporal-polyfill)
core/time/time-error.ts
core/time/clock.ts
core/time/time-format.ts
core/time/zoned.ts
core/time/local-date.ts
core/time/time-zone.ts
core/time/today.ts
core/time/time-display.ts
core/time/index.ts
core/time/testing/manual-clock.ts
core/time/testing/time-vectors.json       (vecteurs partagés, §8.6)
core/time/time-format.spec.ts
core/time/zoned.spec.ts
core/time/local-date.spec.ts
core/time/time-zone.spec.ts
core/time/today.spec.ts
core/time/time-display.spec.ts
core/time/vectors.spec.ts
```
Modifier :
```
apps/web/package.json                dépendance "temporal-polyfill": "^1.0.6"
data/data.providers.ts               jeton CLOCK + inject(CLOCK) dans les 3 fabriques (§3.6)
data/index.ts                        exporter CLOCK et le contenu de time-formats.ts
apps/web/eslint.config.js            règles §8.3
apps/web/tsconfig.spec.json          "resolveJsonModule": true si nécessaire pour le JSON des vecteurs
features/settings/settings.page.ts   section « Fuseau horaire »
core/i18n/fr.json                    clés §8.5
app.config.ts                        provideTime()
```
Ne pas toucher : migrations existantes, `data/clock.ts`, `core/calendar/calendar-source.ts` (lot B), le budget de `angular.json`.

### 8.2 Lot A : types et signatures
```ts
// data/time-formats.ts — pur, sans Temporal ni Angular
export type InstantIso = string;        // 'YYYY-MM-DDTHH:MM:SS.sssZ'
export type LocalDateIso = string;      // 'YYYY-MM-DD'
export type LocalDateTimeIso = string;  // 'YYYY-MM-DDTHH:MM:SS'
export type TimeZoneId = string;        // IANA, forme normalisée par Temporal
export const INSTANT_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
export const TIME_ZONE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/; // + longueur 1..64
export const MIN_LOCAL_DATE = '1900-01-01';
export const MAX_LOCAL_DATE = '2199-12-31';
/** Forme seulement (motif + bornes) ; validité calendaire : core/time et CHECK SQL. */
export function hasInstantShape(value: string): boolean;
export function hasLocalDateShape(value: string): boolean;
export function hasLocalDateTimeShape(value: string): boolean;
/** Motif + longueur + refus de 'Etc/Unknown' (insensible à la casse). */
export function hasTimeZoneIdShape(value: string): boolean;

// data/data.providers.ts (ajout)
export const CLOCK: InjectionToken<Clock>; // providedIn 'root', factory: () => systemClock ; utilisé par les 3 fabriques
```

```ts
// core/time/temporal.ts
// liaison vivante + espace de noms de types ; voir §3.4 (amendement 2026-10-21)
export let Temporal: typeof import('temporal-polyfill').Temporal;
export declare namespace Temporal { type Instant = …; type PlainDate = …; type PlainDateTime = …; type ZonedDateTime = …; }
export function installTemporal(): Promise<void>; // import('temporal-polyfill') si globalThis.Temporal est absent

// core/time/time-error.ts
export type TimeErrorCode =
  | 'invalid_instant' | 'invalid_local_date' | 'invalid_local_date_time' | 'out_of_range'
  | 'unknown_time_zone' | 'invalid_rule' | 'invalid_exdate' | 'invalid_range' | 'expansion_limit'
  | 'not_schedulable';
export type RuleErrorCode =
  | 'too_long' | 'syntax' | 'duplicate_part' | 'unsupported_part' | 'missing_freq' | 'invalid_value'
  | 'duplicate_value' | 'part_not_allowed' | 'conflicting_parts' | 'count_and_until'
  | 'until_not_utc' | 'until_kind_mismatch' | 'until_before_start';
export class TimeError extends Error {
  constructor(readonly code: TimeErrorCode, message: string,
              readonly detail?: { readonly rule?: RuleErrorCode; readonly part?: string; readonly value?: string });
}

// core/time/clock.ts
export { CLOCK } from '../../data';                          // réexport
export function nowInstant(clock: Clock): Temporal.Instant;

// core/time/time-format.ts — lèvent TimeError ; bornes §3.1.1.
// Validité = motif strict + aller-retour format(parse(x)) === x (refuse 24:00, :60, 02-30).
/** Motif RFC 3339 strict (§3.1.1) ; la partie date-heure (19 premiers caractères) doit passer
 *  l'aller-retour PlainDateTime ; puis Instant.from ; renvoie la forme stockée (ms, Z, troncature). */
export function normalizeInstant(text: string): InstantIso;
export function parseInstant(text: string): Temporal.Instant;           // forme stockée stricte uniquement
export function formatInstant(instant: Temporal.Instant): InstantIso;    // toString({ fractionalSecondDigits: 3 })
export function parseLocalDate(text: string): Temporal.PlainDate;
export function formatLocalDate(date: Temporal.PlainDate): LocalDateIso;
export function parseLocalDateTime(text: string): Temporal.PlainDateTime;
export function formatLocalDateTime(dt: Temporal.PlainDateTime): LocalDateTimeIso; // smallestUnit 'second'
export function isValidLocalDate(text: string): boolean;
export function isValidLocalDateTime(text: string): boolean;
export function isValidInstant(text: string): boolean;                  // forme stockée stricte

// core/time/zoned.ts
export type LocalTimeKind = 'unique' | 'gap' | 'fold';
/** Validation §3.2 ; renvoie l'identifiant normalisé (zdt.timeZoneId) ou null si invalide. */
export function normalizeTimeZone(id: string): TimeZoneId | null;
export function isValidTimeZone(id: string): boolean;                   // normalizeTimeZone(id) !== null
/** disambiguation 'compatible' (§3.3). */
export function resolveLocal(local: LocalDateTimeIso, timeZone: TimeZoneId): InstantIso;
/** 'earlier' et 'later' égaux → unique ; tous deux de même heure murale que local → fold ; sinon gap. */
export function classifyLocal(local: LocalDateTimeIso, timeZone: TimeZoneId): LocalTimeKind;
export function toLocalDateTime(instant: InstantIso, timeZone: TimeZoneId): LocalDateTimeIso; // troncature
export function toLocalDate(instant: InstantIso, timeZone: TimeZoneId): LocalDateIso;
/** PlainDate.toZonedDateTime({ timeZone }) : gère un minuit inexistant. */
export function startOfDay(date: LocalDateIso, timeZone: TimeZoneId): InstantIso;
/** startOfDay(date + 1 jour) − 1 s, au format RRULE 'YYYYMMDDTHHMMSSZ' (§3.5.3). */
export function untilEndOfLocalDay(date: LocalDateIso, timeZone: TimeZoneId): string;
export function todayIn(clock: Clock, timeZone: TimeZoneId): LocalDateIso;
export function addDuration(instant: InstantIso, durationMs: number): InstantIso;
export function durationBetween(start: InstantIso, end: InstantIso): number;  // ms, peut être négatif

// core/time/local-date.ts
export function compareLocalDates(a: LocalDateIso, b: LocalDateIso): -1 | 0 | 1;
export function addDays(date: LocalDateIso, days: number): LocalDateIso;
/** to - from en jours, via PlainDate.until({ largestUnit: 'days' }). */
export function daysBetween(from: LocalDateIso, to: LocalDateIso): number;

// core/time/time-zone.ts
export const TIME_ZONE_SETTING_KEY = 'time.zone';
/** Défaut : () => Intl.DateTimeFormat().resolvedOptions().timeZone ; remplaçable en test. */
export const SYSTEM_TIME_ZONE_READER: InjectionToken<() => string>;
/** Défaut : () => Intl.supportedValuesOf('timeZone') ; remplaçable en test. */
export const SUPPORTED_TIME_ZONES_READER: InjectionToken<() => readonly string[]>;
@Injectable({ providedIn: 'root' })
export class UserTimeZone {
  readonly id: Signal<TimeZoneId>;                       // fuseau effectif
  readonly source: Signal<'setting' | 'system' | 'fallback-utc'>;
  readonly preference: Signal<TimeZoneId | null>;        // réglage valide, ou null
  readonly invalidPreference: Signal<string | null>;     // valeur stockée invalide (C19)
  readonly systemId: Signal<TimeZoneId>;                 // fuseau Windows validé, ou 'UTC'
  /** Lit SETTINGS_REPOSITORY ; ne rejette jamais. */
  load(): Promise<void>;
  /** null = suivre Windows (remove). Invalide : rejet TimeError('unknown_time_zone'), rien n'écrit.
   *  Valide : écrit l'identifiant NORMALISÉ (normalizeTimeZone). */
  setPreference(id: TimeZoneId | null): Promise<void>;
  /** Relit le fuseau Windows (démarrage, visibilitychange visible, focus). */
  refreshSystem(): void;
  /** Liste pour l'interface : SUPPORTED_TIME_ZONES_READER() + 'UTC' + systemId() + preference()
   *  si absents, dédoublonnée, triée, filtrée par isValidTimeZone. */
  availableTimeZones(): readonly TimeZoneId[];
}
/** provideAppInitializer : UserTimeZone.load() + écouteurs ; n'échoue jamais. */
export function provideTime(): EnvironmentProviders;

// core/time/today.ts
@Injectable({ providedIn: 'root' })
export class Today {
  /** Date murale courante dans UserTimeZone.id(). Recalculée au minuit local suivant
   *  (setTimeout de min(délai, 15 min) puis recalcul), sur visibilitychange/focus, et au changement de fuseau. */
  readonly date: Signal<LocalDateIso>;
}

// core/time/time-display.ts
export type DateStyle = 'short' | 'long' | 'weekday-long';
export type InstantStyle = 'time' | 'date' | 'date-time';
@Injectable({ providedIn: 'root' })
export class TimeDisplay {
  /** Locale dérivée de la langue Transloco active ('fr' → 'fr-FR'). Date murale : jamais de conversion
   *  de fuseau (formatage du PlainDate). */
  formatLocalDate(date: LocalDateIso, style: DateStyle): string;
  /** timeZone par défaut : UserTimeZone.id(). */
  formatInstant(instant: InstantIso, style: InstantStyle, timeZone?: TimeZoneId): string;
}

// core/time/testing/manual-clock.ts
export class ManualClock implements Clock {
  constructor(initial?: InstantIso);                      // défaut '2026-01-01T00:00:00.000Z'
  nowIso(): InstantIso;
  set(instant: InstantIso): void;                         // via normalizeInstant
  advance(durationMs: number): void;
}
```
Options `Intl.DateTimeFormat` de `TimeDisplay` (vérifiées en fr-FR, ICU 78) :
| Style | Options | Exemple fr-FR |
|---|---|---|
| `DateStyle` `short` | `{ day: 'numeric', month: 'short', year: 'numeric' }` | « 3 nov. 2026 » |
| `DateStyle` `long` | `{ dateStyle: 'long' }` | « 3 novembre 2026 » |
| `DateStyle` `weekday-long` | `{ dateStyle: 'full' }` | « mardi 3 novembre 2026 » |
| `InstantStyle` `time` | `{ hour: '2-digit', minute: '2-digit', timeZone }` | « 09:00 » |
| `InstantStyle` `date` | `{ day: 'numeric', month: 'short', year: 'numeric', timeZone }` | « 3 nov. 2026 » |
| `InstantStyle` `date-time` | `{ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }` | selon ICU (tester contre `Intl` construit dans le test) |

Instancier les formateurs une fois par (locale, style, fuseau) et les mettre en cache. `core/time/index.ts` exporte tout ce qui précède (sauf `testing/`) et `Temporal`.

Section Réglages « Fuseau horaire » : fuseau effectif et source ; `<select>` natif avec `<label>` : « Suivre Windows (<systemId>) », puis `availableTimeZones()` ; message `role="alert"` si `invalidPreference()` ou `source() === 'fallback-utc'`. Tokens et classes de `docs/DESIGN.md` uniquement.

### 8.3 Lot A : règles ESLint (`apps/web/eslint.config.js`)
Bloc 1, pour `src/**/*.ts` avec `ignores: ['src/app/core/time/**', 'src/app/data/clock.ts', 'src/**/*.spec.ts', 'src/**/testing/**']` (`no-restricted-syntax`) :
```js
{ selector: "Identifier[name='Date']:not([parent.type='TSTypeReference']):not([parent.type='TSTypeQuery'])",
  message: 'ADR-003 : utiliser core/time (Temporal) et CLOCK.' }, // couvre new Date(), Date.now, globalThis.Date, const D = Date
{ selector: "CallExpression[callee.property.name=/^(get|set)(UTC)?(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|Time)$/]",
  message: 'ADR-003 : pas de calcul de date à la main.' },
{ selector: "CallExpression[callee.property.name=/^(getTimezoneOffset|toLocaleDateString|toLocaleTimeString)$/]",
  message: 'ADR-003 : passer par TimeDisplay.' },
{ selector: "MemberExpression[object.name='Intl'][property.name='DateTimeFormat'], MemberExpression[object.name='Intl'][property.value='DateTimeFormat'], VariableDeclarator[init.name='Intl']",
  message: 'ADR-003 : passer par TimeDisplay.' },
```
Bloc 2, pour **tout** `src/**/*.ts` (tests compris) sauf `src/app/core/time/clock.ts` :
```js
{ selector: "MemberExpression[object.name='Temporal'][property.name='Now'], MemberExpression[object.name='Temporal'][property.value='Now'], VariableDeclarator[init.name='Temporal']",
  message: 'ADR-003 : utiliser CLOCK.' },
{ selector: "ImportSpecifier[imported.name='Temporal'][local.name!='Temporal']",
  message: 'ADR-003 : pas d\'alias pour Temporal.' },
```
Une même règle n'a qu'une liste d'options effective par fichier : pour les fichiers où les deux blocs s'appliquent, la configuration doit contenir **les deux listes fusionnées** (construire les listes par une fonction, comme `restrict()`).
`no-restricted-imports` : compléter la fonction `restrict()` existante (ne pas créer un second bloc qui écraserait celui de l'ADR-002) avec `{ name: 'temporal-polyfill', message: 'Importer Temporal depuis core/time.' }` (sauf `src/app/core/time/temporal.ts`) et `{ name: '@angular/common', importNames: ['DatePipe', 'formatDate', 'CommonModule'], message: 'ADR-003 : TimeDisplay (CommonModule apporte | date).' }`. Les exceptions de l'ADR-002 restent intactes. Faux positif sur une API tierce (`getTime` d'un autre objet, propriété nommée `Date`) : le signaler dans le rapport, ne pas affaiblir la règle sans validation.

### 8.4 Lot A : tests
- `data/time-formats.spec.ts` : motifs (valeurs valides ; `2026-2-1`, `2026-10-25 02:30:00`, `2026-10-25T02:30`, `…+02:00`, `x` refusés) ; bornes ; `hasTimeZoneIdShape` (`Europe/Paris`, `Etc/GMT+5`, `UTC`, `EST5EDT` acceptés ; `+02`, `+02:00`, `-03`, `Etc/Unknown`, `etc/unknown`, `../etc`, `Europe/ Paris`, 65 caractères refusés).
- `data/sql-time-checks.spec.ts` (better-sqlite3) : créer une **table temporaire `STRICT`** dont les colonnes portent exactement les fragments §3.1.3 (versions obligatoire et optionnelle, plus `rrule`, `exdates` et la contrainte d'ancre), puis tester chaque valeur par **`INSERT`** (succès attendu, ou `DataError('constraint')` / exception `CHECK`), jamais par `SELECT` (un JSON mal formé lève une erreur, V13). Cas : instant valide → accepté ; `2026-02-30T00:00:00.000Z`, `2026-10-20T08:15:00Z`, `2026-10-25T24:00:00.000Z`, `2026-12-31T23:59:60.000Z` → refusés ; ms conservées (`…30.123Z` relu identique) ; date `2026-02-29` refusée, `2028-02-29` acceptée, `2026-13-01` refusée ; heure murale `2026-10-25T24:00:00`, `2026-02-30T10:00:00`, `2026-10-25T10:00:60` refusées ; fuseau `+02`, `Europe/ Paris` refusés ; `exdates` `'x'` (JSON invalide), `'{}'`, 367 éléments, > 8 192 caractères refusés ; ancre : les deux formes valides acceptées, les mélanges refusés ; `NULL` accepté dans les variantes optionnelles.
- `time-format.spec.ts` : C27, C28, C29, C36 ; aller-retour `format(parse(x)) === x` ; `formatInstant` tronque.
- `zoned.spec.ts` : tableau §3.3 ; `classifyLocal` ; C22, C23 ; `untilEndOfLocalDay('2026-12-31', 'Europe/Paris') === '20261231T225959Z'` ; `addDuration` / `durationBetween` (C25) ; `normalizeTimeZone` (C38 ; `Asia/Calcutta` conservé ; `Mars/Base`, `+02`, `+02:00`, `Etc/Unknown`, chaîne vide → `null`).
- `local-date.spec.ts` : `daysBetween('2026-10-20', '2026-10-19') === -1`, `'2026-10-24'` → `'2026-10-26'` = 2, à travers le 29/02/2028 ; `addDays` fin de mois et année bissextile.
- `time-zone.spec.ts` (fake de `SettingsRepository` de `core/testing`, lecteurs fournis) : absent → système ; valide → réglage ; C19 (trois valeurs) ; C20 → `UTC` + `fallback-utc` ; `setPreference('Mars/Base')` rejeté sans écriture ; `setPreference('europe/paris')` écrit `Europe/Paris` ; `setPreference(null)` appelle `remove` ; `refreshSystem` ; erreur du repository au `load` → suit Windows ; `availableTimeZones()` contient `UTC`, `systemId()` et la préférence même si le lecteur ne les liste pas, sans doublon.
- `today.spec.ts` (`ManualClock` fournie comme `CLOCK` + `vi.useFakeTimers()` pour `setTimeout` uniquement) : 23:59:59 → 00:00:01 Paris ; journée de 25 h (changement à `2026-10-25T23:00:00.000Z`) ; changement de fuseau ; `visibilitychange` (C21).
- `time-display.spec.ts` : tableau des options §8.2 (« 3 nov. 2026 », « 3 novembre 2026 », « mardi 3 novembre 2026 », « 09:00 ») ; même instant en Paris et en Montréal ; date murale sans décalage quel que soit le fuseau. Comparer à la sortie d'`Intl` construite dans le test quand ICU insère des espaces insécables.
- `vectors.spec.ts` : sections `timeZoneValidity`, `resolveLocal` (avec `kind`), `toLocal`, `startOfDay` (et `ruleCodec` au lot B) ; chaque échec cite l'`id`.
- `features/settings/settings.page.spec.ts` : fuseau effectif affiché, sélection → `setPreference`, alerte en cas de valeur invalide.

### 8.5 Lot A : clés i18n (fr)
`settings.timeZone.label` « Fuseau horaire », `settings.timeZone.followSystem` « Suivre Windows ({{ zone }}) », `settings.timeZone.effective` « Fuseau utilisé : {{ zone }} », `settings.timeZone.invalidStored` « Le fuseau enregistré ({{ value }}) est invalide : le fuseau de Windows est utilisé. », `settings.timeZone.fallbackUtc` « Fuseau de Windows non reconnu : UTC est utilisé. Choisissez votre fuseau. », `time.ambiguous` « Cette heure existe deux fois ce jour-là : la première sera utilisée. », `time.nonexistent` « Cette heure n'existe pas ce jour-là (changement d'heure) : {{ time }} sera utilisée. », `time.today` « Aujourd'hui », `time.tomorrow` « Demain », `time.overdue` « En retard de {{ days }} j ».

### 8.6 Vecteurs partagés (`core/time/testing/time-vectors.json`)
Lu par les tests TS (lots A et B) et Rust (lot B) via `include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/src/app/core/time/testing/time-vectors.json"))`. Format :
```json
{
  "formatVersion": 1,
  "timeZoneValidity": [
    { "id": "Z-PARIS", "value": "Europe/Paris", "valid": true },
    { "id": "Z-OFFSET", "value": "+02:00", "valid": false }
  ],
  "resolveLocal": [
    { "id": "R-PARIS-FOLD", "timeZone": "Europe/Paris", "local": "2026-10-25T02:30:00", "expected": "2026-10-25T00:30:00.000Z", "kind": "fold" }
  ],
  "toLocal": [
    { "id": "L-PARIS-FOLD-2ND", "timeZone": "Europe/Paris", "instant": "2026-10-25T01:30:00.000Z", "expected": "2026-10-25T02:30:00" }
  ],
  "startOfDay": [
    { "id": "S-PARIS-25H", "timeZone": "Europe/Paris", "date": "2026-10-25", "expected": "2026-10-24T22:00:00.000Z" }
  ],
  "ruleCodec": [
    { "id": "K-WEEKLY-SORT", "anchorKind": "date-time", "input": "FREQ=WEEKLY;BYDAY=WE,MO", "canonical": "FREQ=WEEKLY;BYDAY=MO,WE" },
    { "id": "K-HOURLY", "anchorKind": "date-time", "input": "FREQ=HOURLY", "error": "invalid_value" }
  ],
  "expand": [
    { "id": "E-GAP", "anchor": { "kind": "date-time", "startLocal": "2027-03-27T02:30:00", "timeZone": "Europe/Paris" },
      "rrule": "FREQ=DAILY;COUNT=3", "exdates": [],
      "range": { "from": "2027-03-01T00:00:00.000Z", "to": "2027-04-01T00:00:00.000Z", "timeZone": "Europe/Paris" },
      "limit": 10,
      "expected": [
        { "key": "2027-03-27T02:30:00", "start": "2027-03-27T01:30:00.000Z" },
        { "key": "2027-03-28T02:30:00", "start": "2027-03-28T01:30:00.000Z" },
        { "key": "2027-03-29T02:30:00", "start": "2027-03-29T00:30:00.000Z" }
      ],
      "truncated": false }
  ]
}
```
Ancre datée : `{ "key": "2028-02-29", "date": "2028-02-29" }` ; erreur attendue : `"error": "<code>"` à la place de `expected`.

Contenu minimal :
- `timeZoneValidity` : valides `Europe/Paris`, `UTC`, `America/New_York`, `Asia/Kolkata`, `Asia/Calcutta`, `Etc/GMT+5` ; invalides `+02`, `+02:00`, `-03`, `+0200`, `Etc/Unknown`, `Mars/Base`, chaîne vide. (La normalisation de casse `europe/paris` reste un test TS seul, C38 ; S8.)
- `resolveLocal` : les 7 lignes « heure murale → instant » du §3.3 ; `America/New_York` `2026-11-01T01:30:00` → `2026-11-01T05:30:00.000Z` (pli) et `2026-03-08T02:30:00` → `2026-03-08T07:30:00.000Z` (trou) ; `UTC` ; `Asia/Kolkata` et `Asia/Calcutta` `2026-06-01T12:00:00` → `2026-06-01T06:30:00.000Z`.
- `toLocal` : pli 1er et 2e passage ; `2026-12-31T23:30:00.000Z` → `2027-01-01T00:30:00` (Paris), `2026-12-31T18:30:00` (New York) ; C36.
- `startOfDay` : C22 (3 valeurs), `S-SANTIAGO` (C23).
- `ruleCodec` (lot B) : chaque ligne du §3.5.1 et chaque code du §3.5.2 au moins une fois (sauf `until_before_start`), dont C14, C15, C31, C33 ; `INTERVAL=1` supprimé ; `RRULE:FREQ=DAILY`, `freq=daily` → `syntax` ; `FREQ=YEARLY;BYMONTHDAY=1` → `part_not_allowed` ; `FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=1` → `conflicting_parts` ; `FREQ=DAILY;WKST=SU` → `unsupported_part` ; `UNTIL=20261231` avec ancre horodatée → `until_kind_mismatch` ; `UNTIL=20261231T000000Z` avec ancre datée → `until_kind_mismatch` ; `UNTIL=20261231T246000Z` → `invalid_value`.
- `expand` (lot B, Rust seul) : C2 à C13, C16, C17 (`E-COUNT-WINDOW`), C24, `E-WEEKLY-DTSTART-NOMATCH` (C6), `E-GAP` (C3), une ancre ponctuelle sans règle, une limite qui tronque, C30.

Les valeurs ont été revérifiées côté TS (V12) : si le Rust diverge, c'est le Rust qui est en cause ; s'arrêter et rapporter sans modifier le vecteur.

### 8.7 Lot A : critères d'acceptation
- **CA-A1** `npm run test` vert (runner Angular + `test:data`), dont tous les fichiers de §8.4.
- **CA-A2** `npm run web:build` réussit **sans modification du budget** ; sinon s'arrêter et rapporter la taille (décision de Marius, §3.4).
- **CA-A3** `npm run lint` et `npm run format:check` propres.
- **CA-A4** Chacune de ces insertions temporaires fait échouer `npm run lint` (puis l'annuler) : `const d = new Date();` et `const D = globalThis.Date;` dans `core/dashboard/dashboard.store.ts` ; `Temporal.Now.instant()` dans un `*.spec.ts` ; `import { Temporal as T } from '../time';` dans un fichier de `core/` ; `Intl['DateTimeFormat']` dans un composant ; `import { DatePipe } from '@angular/common'` puis `import { CommonModule } from '@angular/common'`.
- **CA-A5** `rg -n "temporal-polyfill" apps/web/src` → un seul résultat (`core/time/temporal.ts`).
- **CA-A6** `rg -n "new Date\(|Date\.now\(" apps/web/src/app -g "!*.spec.ts" -g "!**/testing/**"` → uniquement `data/clock.ts` ; `rg -n "systemClock" apps/web/src/app/data/data.providers.ts` → uniquement la fabrique de `CLOCK`.
- **CA-A7** Les règles de l'ADR-002 §6.8 restent actives (importer `better-sqlite3` dans `core/` fait échouer le lint).
- **CA-A8** (manuel, `npm run dev`) Réglages affiche « Fuseau utilisé : Europe/Paris », source Windows ; la liste réelle de la WebView2 contient `UTC` et `Europe/Paris` ; choisir `America/Montreal`, redémarrer : choix conservé ; « Suivre Windows » supprime la clé. Console : `typeof globalThis.Temporal === 'object'` (natif).
- **CA-A9** (manuel) Changer le fuseau Windows application ouverte, revenir sur la fenêtre : en « Suivre Windows », le fuseau affiché change (S3). Sinon, noter le comportement.
- **CA-A10** Aucune migration existante modifiée ; aucun secret ; textes via Transloco.

### 8.8 Lot B : fichiers
Rust (`apps/desktop/src-tauri/`), créer :
```
clippy.toml
src/time/mod.rs
src/time/error.rs
src/time/clock.rs
src/time/formats.rs
src/time/zone.rs
src/time/recurrence/mod.rs        (types, parse/format canoniques, validation)
src/time/recurrence/engine.rs     (SEUL fichier qui importe la crate rrule / chrono)
src/time/commands.rs
```
Modifier : `Cargo.toml` (`jiff`, `rrule = "=0.14.0"`, `chrono` seulement si nécessaire) ; `src/lib.rs` (`mod time;` + enregistrement des 2 commandes dans `invoke_handler`) ; `build.rs` (ajouter `"time_validate"`, `"time_expand"` à `AppManifest::commands`) ; `capabilities/default.json` (ajouter `"allow-time-validate"`, `"allow-time-expand"`).

TS, créer :
```
core/time/recurrence.ts            (codec du sous-ensemble ; utilise parseLocalDate pour UNTIL)
core/time/recurrence.spec.ts
core/time/recurrence-engine.ts     (interface, jeton, implémentation Tauri)
core/time/recurrence-engine.spec.ts
core/time/testing/fake-recurrence-engine.ts
```
Modifier : `core/calendar/calendar-source.ts` (§3.7), `core/time/index.ts`, `core/time/testing/time-vectors.json` (`ruleCodec`, `expand`), `core/time/vectors.spec.ts`.

### 8.9 Lot B : signatures Rust
```rust
// src/time/error.rs
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimeError {
    InvalidInstant { value: String },
    InvalidLocalDate { value: String },
    InvalidLocalDateTime { value: String },
    OutOfRange { value: String },
    UnknownTimeZone { value: String },
    InvalidRule { code: RuleErrorCode, part: Option<String> },
    InvalidExdate { value: String },
    InvalidRange,
    ExpansionLimit,
    NotSchedulable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleErrorCode { TooLong, Syntax, DuplicatePart, UnsupportedPart, MissingFreq, InvalidValue,
    DuplicateValue, PartNotAllowed, ConflictingParts, CountAndUntil, UntilNotUtc, UntilKindMismatch, UntilBeforeStart }

// src/time/clock.rs
pub trait Clock: Send + Sync { fn now(&self) -> jiff::Timestamp; }
pub struct SystemClock;
impl Clock for SystemClock { /* #[allow(clippy::disallowed_methods)] Timestamp::now() */ }
#[cfg(test)] pub struct FixedClock { /* Mutex<Timestamp> */ }
#[cfg(test)] impl FixedClock { pub fn new(at: jiff::Timestamp) -> Self; pub fn set(&self, at: jiff::Timestamp); pub fn advance(&self, by: jiff::SignedDuration); }

// src/time/formats.rs — motif strict + aller-retour (§3.1.1), bornes 1900..2199
pub fn parse_instant(s: &str) -> Result<jiff::Timestamp, TimeError>;          // forme stockée stricte
pub fn format_instant(t: jiff::Timestamp) -> String;                          // ms, Z, troncature
pub fn parse_local_date(s: &str) -> Result<jiff::civil::Date, TimeError>;
pub fn format_local_date(d: jiff::civil::Date) -> String;
pub fn parse_local_date_time(s: &str) -> Result<jiff::civil::DateTime, TimeError>;
pub fn format_local_date_time(dt: jiff::civil::DateTime) -> String;
/** Longueur, motif, refus de Etc/Unknown, puis TimeZone::get et refus de TimeZone::unknown(). */
pub fn parse_time_zone(s: &str) -> Result<jiff::tz::TimeZone, TimeError>;

// src/time/zone.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum LocalTimeKind { Unique, Gap, Fold }
pub fn resolve_local(local: jiff::civil::DateTime, tz: &jiff::tz::TimeZone) -> Result<jiff::Timestamp, TimeError>; // Compatible
pub fn classify_local(local: jiff::civil::DateTime, tz: &jiff::tz::TimeZone) -> LocalTimeKind;
pub fn to_local(t: jiff::Timestamp, tz: &jiff::tz::TimeZone) -> jiff::civil::DateTime;
pub fn start_of_day(d: jiff::civil::Date, tz: &jiff::tz::TimeZone) -> Result<jiff::Timestamp, TimeError>;

// src/time/recurrence/mod.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Freq { Daily, Weekly, Monthly, Yearly }
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)] pub enum Weekday { Mo, Tu, We, Th, Fr, Sa, Su }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum AnchorKind { DateTime, Date }
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleEnd { Never, Count(u32), UntilInstant(jiff::Timestamp), UntilDate(jiff::civil::Date) }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecurrenceRule {
    pub freq: Freq,
    pub interval: u16,
    pub by_day: Vec<Weekday>,                  // WEEKLY, trié, sans doublon
    pub by_nth_weekday: Option<(i8, Weekday)>, // MONTHLY ; n ∈ {1,2,3,4,-1}
    pub by_month_day: Option<i8>,              // MONTHLY ; 1..=31 ou -1
    pub end: RuleEnd,
}
pub fn parse_rule(text: &str, anchor: AnchorKind) -> Result<RecurrenceRule, TimeError>; // contrôles 1 à 11
pub fn format_rule(rule: &RecurrenceRule) -> String;                                    // forme canonique

#[derive(Debug, Clone)]
pub enum Anchor {
    DateTime { start_local: jiff::civil::DateTime, time_zone_id: String, time_zone: jiff::tz::TimeZone },
    Date { start_on: jiff::civil::Date },
}
#[derive(Debug, Clone)]
pub struct RecurrenceSpec { pub anchor: Anchor, pub rule: Option<RecurrenceRule>, pub exdates: Vec<String> } // canoniques
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OccurrenceStart { Instant { at: jiff::Timestamp, nominal_local: jiff::civil::DateTime }, Date(jiff::civil::Date) }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence { pub key: String, pub start: OccurrenceStart }
pub struct ExpandRequest { pub from: jiff::Timestamp, pub to: jiff::Timestamp, pub range_time_zone: jiff::tz::TimeZone, pub limit: usize }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expansion { pub occurrences: Vec<Occurrence>, pub truncated: bool }
pub const MAX_RANGE_DAYS: i64 = 400;
pub const MAX_LIMIT: usize = 1000;
pub const MAX_ITERATIONS: usize = 100_000;
pub const NEXT_HORIZON_YEARS: i16 = 10;
/** Contrôle 12 (until_before_start) et format des exdates selon l'ancre. */
pub fn validate_spec(spec: &RecurrenceSpec) -> Result<(), TimeError>;
pub fn expand(spec: &RecurrenceSpec, req: &ExpandRequest) -> Result<Expansion, TimeError>;   // §3.5.4
/** Ancre horodatée uniquement ; ancre datée : Err(NotSchedulable) (§3.5.5). Strictement après. */
pub fn next_after(spec: &RecurrenceSpec, after: jiff::Timestamp) -> Result<Option<Occurrence>, TimeError>;

// src/time/recurrence/engine.rs (privé au module)
/// Heures murales nominales générées en « UTC flottant » par la crate rrule, depuis l'ancre, jusqu'à `upper` inclus.
pub(super) fn floating_occurrences(start: jiff::civil::DateTime, rule: &RecurrenceRule, upper: jiff::civil::DateTime)
    -> Result<Vec<jiff::civil::DateTime>, TimeError>;

// src/time/commands.rs — DTO camelCase, chaînes uniquement
#[derive(serde::Deserialize)] #[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AnchorDto { #[serde(rename_all = "camelCase")] DateTime { start_local: String, time_zone: String },
                     #[serde(rename_all = "camelCase")] Date { start_on: String } }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase")]
pub struct RecurrenceSpecDto { pub anchor: AnchorDto, pub rrule: Option<String>, pub exdates: Vec<String> }
#[derive(serde::Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ExpandRangeDto { pub from: String, pub to: String, pub time_zone: String, pub limit: Option<u32> }
#[derive(serde::Serialize)] #[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OccurrenceDto { #[serde(rename_all = "camelCase")] DateTime { key: String, start: String, nominal_local: String, time_zone: String },
                         #[serde(rename_all = "camelCase")] Date { key: String, date: String } }
#[derive(serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct ExpansionDto { pub occurrences: Vec<OccurrenceDto>, pub truncated: bool }
#[derive(serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct CanonicalSpecDto { pub rrule: Option<String>, pub exdates: Vec<String> }
#[tauri::command(async)] pub fn time_validate(spec: RecurrenceSpecDto) -> Result<CanonicalSpecDto, TimeError>;
#[tauri::command(async)] pub fn time_expand(spec: RecurrenceSpecDto, range: ExpandRangeDto) -> Result<ExpansionDto, TimeError>;
```
Bornes d'entrée (§3.8) vérifiées dans `commands.rs` **avant** toute conversion ; `exdates` validées selon l'ancre, triées, dédoublonnées. Les noms exacts des API `jiff` / `rrule` utilisées à l'intérieur sont à vérifier sur docs.rs (V7, V9).

`clippy.toml` :
```toml
disallowed-methods = [
  { path = "std::time::SystemTime::now", reason = "ADR-003 : utiliser time::clock::Clock" },
  { path = "jiff::Timestamp::now", reason = "ADR-003 : utiliser time::clock::Clock" },
  { path = "jiff::Zoned::now", reason = "ADR-003 : utiliser time::clock::Clock" },
  { path = "jiff::tz::TimeZone::system", reason = "ADR-003 : le Rust n'utilise jamais le fuseau système" },
]
```
(+ `chrono::Utc::now`, `chrono::Local::now` si `chrono` est direct.) Un fichier existant qui déclenche la règle est adapté ou annoté avec justification ; pas de désactivation globale.

### 8.10 Lot B : signatures TS
```ts
// core/time/recurrence.ts — codec pur (aucun calcul de date ; parseLocalDate pour valider UNTIL)
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type AnchorKind = 'date-time' | 'date';
export type RuleEnd =
  | { readonly kind: 'never' }
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'until-instant'; readonly until: string }   // 'YYYYMMDDTHHMMSSZ'
  | { readonly kind: 'until-date'; readonly until: string };     // 'YYYYMMDD'
export interface RecurrenceRule {
  readonly freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  readonly interval: number;
  readonly byDay: readonly Weekday[];                                    // WEEKLY
  readonly byNthWeekday: { readonly n: 1 | 2 | 3 | 4 | -1; readonly weekday: Weekday } | null; // MONTHLY
  readonly byMonthDay: number | null;                                    // MONTHLY
  readonly end: RuleEnd;
}
export type RuleParseResult =
  | { readonly ok: true; readonly rule: RecurrenceRule; readonly canonical: string }
  | { readonly ok: false; readonly code: RuleErrorCode; readonly part: string | null };
/** Contrôles 1 à 11 de §3.5.2. */
export function parseRecurrenceRule(text: string, anchor: AnchorKind): RuleParseResult;
export function formatRecurrenceRule(rule: RecurrenceRule): string;

// core/time/recurrence-engine.ts
export type ScheduleAnchor =
  | { readonly kind: 'date-time'; readonly startLocal: LocalDateTimeIso; readonly timeZone: TimeZoneId }
  | { readonly kind: 'date'; readonly startOn: LocalDateIso };
export interface RecurrenceSpec { readonly anchor: ScheduleAnchor; readonly rrule: string | null; readonly exdates: readonly string[]; }
export type Occurrence =
  | { readonly kind: 'date-time'; readonly key: LocalDateTimeIso; readonly start: InstantIso; readonly nominalLocal: LocalDateTimeIso; readonly timeZone: TimeZoneId }
  | { readonly kind: 'date'; readonly key: LocalDateIso; readonly date: LocalDateIso };
export interface ExpandRange { readonly from: InstantIso; readonly to: InstantIso; readonly timeZone: TimeZoneId; readonly limit?: number; }
export interface RecurrenceEngine {
  /** Rejette TimeError (erreur Rust traduite) ou DataError('unavailable') hors Tauri. */
  validate(spec: RecurrenceSpec): Promise<{ readonly rrule: string | null; readonly exdates: readonly string[] }>;
  expand(spec: RecurrenceSpec, range: ExpandRange): Promise<{ readonly occurrences: readonly Occurrence[]; readonly truncated: boolean }>;
}
export const RECURRENCE_ENGINE: InjectionToken<RecurrenceEngine>; // providedIn root : TauriRecurrenceEngine
export class TauriRecurrenceEngine implements RecurrenceEngine { /* invoke('time_validate' | 'time_expand') */ }
```
`TauriRecurrenceEngine` traduit `{ kind: 'invalid_rule', code, part }` en `TimeError('invalid_rule', …, { rule: code, part })` et les autres `kind` en `TimeError(kind)` ; hors Tauri : `DataError('unavailable')`. Seul `core/` importe `@tauri-apps/api` (ADR-001 R4).

### 8.11 Lot B : tests
- Rust `formats` : formes exactes, troncature des ms, bornes, refus de `+02:00` en forme stockée, de `24:00:00` et de `23:59:60`.
- Rust `zone` et `formats::parse_time_zone` : sections `timeZoneValidity`, `resolveLocal` (avec `kind`), `toLocal`, `startOfDay`.
- Rust `recurrence` : section `ruleCodec` (code exact, forme canonique) ; aller-retour `format_rule(parse_rule(x)) == canonical` ; `validate_spec` → `until_before_start`.
- Rust `expand` : section `expand` ; `next_after` (strictement après ; règle épuisée → `None` ; horizon de 10 ans ; ancre datée → `NotSchedulable`) ; 401 jours → `InvalidRange` ; `limit` → `truncated` ; ancre `1900-01-01` `FREQ=DAILY` et plage en 2199 → `ExpansionLimit`.
- Rust `commands` : DTO (camelCase, `kind` en kebab-case) ; sérialisation exacte `{"kind":"invalid_rule","code":"count_and_until","part":null}` ; refus des entrées trop longues avant calcul.
- Rust `clock` : `FixedClock`.
- TS `recurrence.spec.ts` : section `ruleCodec` (mêmes codes que Rust).
- TS `recurrence-engine.spec.ts` : `invoke` simulé ; traduction des erreurs ; `unavailable` hors Tauri.

### 8.12 Lot B : critères d'acceptation
- **CA-B1** `npm run rust:test`, `npm run rust:lint` (clippy `-D warnings` avec `clippy.toml`), `npm run rust:fmt:check` verts.
- **CA-B2** `npm run test`, `npm run lint`, `npm run format:check` verts ; `ruleCodec` et `timeZoneValidity` exécutées **des deux côtés** sur le même fichier.
- **CA-B3** `rg -n "rrule::|chrono::" apps/desktop/src-tauri/src` → uniquement `src/time/recurrence/engine.rs`.
- **CA-B4** Ajouter temporairement `let _ = jiff::Timestamp::now();` dans `lib.rs` fait échouer `npm run rust:lint`. Annuler ensuite.
- **CA-B5** `Cargo.toml` : `rrule = "=0.14.0"` ; pas de `chrono-tz` direct.
- **CA-B6** `core/calendar/calendar-source.ts` conforme à §3.7 et compile.
- **CA-B7** (manuel, `npm run dev`) `invoke('time_expand', …)` avec `E-GAP` renvoie les 3 occurrences attendues ; une plage de 401 jours renvoie `{ kind: 'invalid_range' }` ; l'interface reste réactive pendant une expansion longue (commande asynchrone).
- **CA-B8** `build.rs` liste exactement les commandes existantes + `time_validate`, `time_expand` ; `capabilities/default.json` ne gagne que `allow-time-validate` et `allow-time-expand` ; aucun nouveau fichier de capability ; aucun secret.

### 8.13 Commandes (depuis la racine)
```
npm ci --ignore-scripts
npm install temporal-polyfill@^1.0.6 -w web        # lot A, une fois
npm run format:check
npm run lint
npm run test                                       # runner Angular + test:data
npm run web:build                                  # CA-A2 (budget inchangé)
npm run rust:fmt:check                             # lot B
npm run rust:lint                                  # lot B
npm run rust:test                                  # lot B
npm run dev                                        # vérifications manuelles CA-A8, CA-A9, CA-B7
```
Rapport attendu : fichiers créés et modifiés, résultats des commandes, écarts à la spec, suppositions confirmées ou infirmées, vecteurs en désaccord, taille du build.
