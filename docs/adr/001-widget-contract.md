# ADR-001 : contrat `Widget`, registre et format de configuration

- **Statut** : proposé (à valider par Marius)
- **Date** : 2026-10-20 (amendé le même jour pour alignement sur l'ADR-002)
- **Auteur** : architect (Opus)
- **Liens** : `docs/PLAN.md` §3 « Contrat Widget », §4, §5, §6 ; `docs/ROADMAP.md` phases 0 et 1 ; `docs/adr/002-data-layer.md` (couche de données)

> **Règle de préséance** : l'ADR-002 fait foi pour **toute** la couche `data/` (SQL **et** forme TypeScript des modèles, repositories, erreurs, JSON). Cet ADR ne définit que ce qui vit dans `core/` et `widgets/`, et ne fait que **référencer** les types de `data/`.

## 1. Contexte

Homebase est un dashboard Windows (Tauri 2 + Angular 21 zoneless, signals, standalone, OnPush, pas de `any`), mono-utilisateur, local-first, SQLite derrière des interfaces de repository (`data/`, ADR-002). Une quinzaine de widgets arriveront par phases (TODO, notes, météo, RSS, rappels, budget…). Avant le premier, il faut :

1. un contrat unique que chaque widget implémente (métadonnées, composant lazy, tailles, configuration typée et versionnée, source calendrier éventuelle, permissions) ;
2. un registre qui découvre les widgets **sans import croisé** et détecte les erreurs au démarrage ;
3. un format d'instance placée sur la grille et un format JSON de configuration versionné, sans secret, exportable ;
4. une règle de communication widget ↔ `core/` ;
5. un lien explicite entre permissions déclarées et capabilities Tauri (moindre privilège) ;
6. un widget factice « hello » pour la sortie de phase 0.

Contraintes :
- Contrat indépendant de la lib de grille : tailles en **unités de grille**. Phase 0 : CSS Grid simple. Phase 1 : **angular-gridster2 21.x** (repli : gridstack), derrière un adaptateur.
- CSP stricte dans le WebView : pas de `unsafe-eval`, donc aucune lib de validation qui génère du code (`new Function`) sans mode « sans JIT ».
- Pas de transaction multi-instructions depuis le front (ADR-002 §2.3) : une écriture logique = une instruction SQL.
- i18n : **Transloco** (clés runtime, interpolation `{{ param }}`, traductions embarquées, `provideAppI18n()` dans `core/i18n`, fichier `apps/web/src/app/core/i18n/fr.json`), retenu par la tâche Shell.

### Faits vérifiés (sources consultées le 2026-10-20)
- Capabilities Tauri 2 : elles s'appliquent **par fenêtre/webview**, pas par composant. Les commandes Rust propres à l'app sont **autorisées par défaut pour toutes les fenêtres** ; on peut les restreindre via `tauri_build::AppManifest::commands` dans `build.rs` (https://v2.tauri.app/security/capabilities/).
- Plugin `opener` : permission `opener:allow-open-url` avec portée `allow: [{ "url": "<glob>" }]` ; la permission `default` autorise `mailto:`, `tel:`, `http://`, `https://` et `reveal-item-in-dir` (https://v2.tauri.app/plugin/opener/).
- Valibot v1 implémente Standard Schema v1 (propriété `~standard` avec `validate`) (https://valibot.dev/guides/integrate-valibot/).
- Zod 4 contient un chemin JIT (`new Function`) désactivable via une option globale `jitless` (source : `zod@4.6.5/src/compile.ts` sur unpkg) : utilisable, mais demande une configuration à ne pas oublier.
- Couche données (ADR-002 §6.3, §6.6) : table `widget_instances` (`widget_type` TEXT 1..64, `grid_x/y/w/h`, `config` TEXT objet JSON ≤ 65 536 caractères, `config_version` ≥ 1), repositories `WidgetInstanceRepository` / `DashboardRepository`, `DataError`, `JsonObject` / `parseJsonObject` dans `data/json.ts`.

### Supposé (à confirmer pendant l'implémentation)
- `NgComponentOutlet` accepte toujours `ngComponentOutletInjector` en Angular 21 (API présente depuis v14, non revérifiée sur v21).
- Les imports dynamiques (`import()`) de chunks Angular fonctionnent depuis le protocole d'assets Tauri en build de production (comportement standard, non testé ici).
- Importer `data/index.ts` depuis un test du runner Angular est sans effet de bord (le module `@tauri-apps/plugin-sql` n'appelle rien à l'import ; `Database.get` n'est appelé que par la fabrique de `provideDataLayer`). Si faux : s'arrêter et remonter.

## 2. Options étudiées

### 2.1 Schéma de configuration
| Option | Pour | Contre |
|---|---|---|
| A. Validateurs écrits à la main (`(raw: unknown) => Result<T>`) | Zéro dépendance | Verbeux, types et validation désynchronisés, erreurs fréquentes sur 15 widgets |
| B. JSON Schema + Ajv | Standard, exportable | Ajv compile avec `new Function` : incompatible avec une CSP sans `unsafe-eval` (sauf mode standalone précompilé, outillage en plus) ; types TS à dériver à part |
| C. Zod 4 | Très connu, inférence de types | Chemin JIT à désactiver (`jitless`), bundle plus lourd |
| **D. Valibot v1, contrat typé sur Standard Schema v1** | Pas d'`eval`, tree-shakable, inférence de types ; le contrat ne dépend que de l'interface Standard Schema (lib remplaçable) | Une dépendance de plus ; API moins connue que Zod |

### 2.2 Registre
| Option | Pour | Contre |
|---|---|---|
| A. Tableau statique importé par `core/` | Trivial | `core/` importe les widgets : viole la règle de dépendance |
| B. Découverte automatique (`import.meta.glob`) | Aucun fichier à maintenir | Non supporté par le builder esbuild d'Angular CLI ; magique |
| C. Décorateur / effet de bord à l'import | Peu de code | Dépend de l'ordre d'import, invisible, difficile à tester |
| **D. `InjectionToken` multi (`WIDGET_DEFINITIONS`) + un seul fichier `widgets/widgets.providers.ts` importé par `app.config.ts`** | Explicite, testable (on fournit d'autres définitions en test), `core/` n'importe aucun widget | Une ligne à ajouter par widget |

### 2.3 Passage de l'instance au composant
| Option | Pour | Contre |
|---|---|---|
| A. `input()` sur chaque composant | Idiomatique | Typage perdu au travers d'un composant chargé dynamiquement ; chaque widget redéclare les mêmes inputs |
| **B. Contexte injecté (`WIDGET_CONTEXT`) via l'injector enfant créé par l'hôte** | Une seule API typée (`injectWidgetContext<T>()`), écriture de config centralisée (validation, coalescence) | Un cast unique et documenté dans `injectWidgetContext` |

### 2.4 Permissions
| Option | Pour | Contre |
|---|---|---|
| A. Une fenêtre/webview ou iframe isolée par widget, capabilities par fenêtre | Vraie frontière de sécurité | Lourd (mémoire, IPC, layout), disproportionné pour un usage solo |
| **B. Permissions déclaratives + garde-fou dans les services `core/` + frontière réelle côté Rust** | Simple ; documente et limite les erreurs ; la sécurité réelle reste dans les capabilities et les listes autorisées Rust | Les permissions ne sont **pas** une frontière de sécurité entre widgets (même realm JS) : à dire clairement |

## 3. Décision

### 3.1 Règles de dépendance (vérifiées par script en lint, en complément des règles ESLint de l'ADR-002 §6.8)
```
app.config.ts ──> widgets/widgets.providers.ts ──> widgets/<x>/<x>.definition.ts
widgets/<x>/** ──> core/**, data/index.ts, son propre dossier
core/**        ──> data/index.ts       (jamais widgets/**)
data/**        ──> rien de core/ ni de widgets/
```
- R1 : un widget n'importe jamais un autre widget ni `widgets/widgets.providers.ts`.
- R2 : `core/` n'importe jamais `widgets/`.
- R3 : `data/` n'importe ni `core/` ni `widgets/`.
- R4 : un widget n'importe jamais `@tauri-apps/*` (tout accès natif passe par `core/` ou `data/`).
- Hors `data/`, on importe `data/` **uniquement via `data/index.ts`** (règle ESLint de l'ADR-002).

### 3.2 `WidgetDefinition`
Une définition par type de widget, déclarée dans `widgets/<type>/<type>.definition.ts`. Seul ce fichier (léger) est chargé au démarrage ; le composant est chargé à la demande (`loadComponent`).

- `type` : identifiant **stable et persisté** (colonne `widget_type`), motif `^[a-z][a-z0-9-]{1,31}$` (ex. `hello`, `todo`, `service-status`). Le renommer exige une migration SQL. **Le motif est validé par le registre, pas par SQL** : `widget_type` reste volontairement peu contraint en base (1 à 64 caractères, ADR-002 §3.4) afin qu'une instance d'un type inconnu ou retiré soit **conservée** et affichée en placeholder. Aucune modification de V1 n'est donc requise par cet ADR (réponse au point O5 de l'ADR-002).
- `titleKey`, `descriptionKey` : clés Transloco (jamais de texte en dur).
- `icon` : classe PrimeIcons, motif `^pi pi-[a-z0-9-]+$` (pas de SVG/HTML arbitraire : pas de vecteur d'injection).
- `loadComponent` : `() => import('./x.component').then(m => m.XComponent)`.
- `size` : `min`, `default`, `max` en unités de grille (`w` sur une grille de `GRID_COLUMNS = 12` colonnes, `h` ≤ `GRID_MAX_ROWS = 24`), entiers, `1 ≤ min ≤ default ≤ max` sur chaque axe.
- `config` : `version` (entier ≥ 1), `schema` (Standard Schema v1, synchrone), `defaults()` (fabrique, pas d'objet partagé), `migrations` (`migrations[n]` transforme une config de version `n` en version `n+1` ; clés exactement `1..version-1`).
- `permissions` : sous-ensemble de `'network' | 'notifications' | 'launch-apps' | 'open-url'`, sans doublon.
- `maxInstances?` : entier ≥ 1, **par dashboard** (ex. barre de recherche unique) ; absent = illimité.
- `loadCalendarSource?` : chargement lazy d'un service `@Injectable({ providedIn: 'root' })` implémentant `CalendarSource`. La source est **par type** et non par instance : les rappels existent même si aucun widget « rappels » n'est placé. L'interface `CalendarSource` est **provisoire** ; l'ADR-003 (modèle de temps) et l'ADR-004 (calendrier) la figent avant tout usage (phase 2).

### 3.3 Registre
- `WIDGET_DEFINITIONS` : `InjectionToken<readonly WidgetDefinition[]>` multi, alimenté par `provideWidget(def)`.
- `widgets/widgets.providers.ts` exporte `provideAllWidgets(): Provider[]`, seul fichier qui connaît tous les widgets ; importé uniquement par `app.config.ts`.
- `WidgetRegistry` (`core/`, `providedIn: 'root'`) valide **toutes** les définitions à sa construction et lève une `WidgetRegistryError` qui liste **tous** les problèmes (doublon de `type`, motifs, tailles, migrations manquantes, `defaults()` invalide ou non sérialisable en JSON, schéma asynchrone, permissions en double, `maxInstances` invalide). Fail-fast au démarrage : un widget mal déclaré est une erreur de développement, pas d'exécution.

### 3.4 Configuration : format, validation, versionnement
- Une config est un `JsonObject` **au sens de `data/json.ts`** (ADR-002 ; `core/` réutilise ce type, sans doublon) : pas de `undefined`, `Date`, `NaN`, `Infinity`, classes ni fonctions. Pas de champ optionnel sans défaut : utiliser `null` ou une valeur par défaut du schéma.
- Persistance (ADR-002) : `config: JsonObject` + `configVersion: number` sur `WidgetInstanceRecord`. La sérialisation, le `JSON.parse`, le contrôle « est un objet » (`parseJsonObject`, `DataError('corrupt_data')`) et la limite SQL `length(config) <= 65536` sont assurés par `data/` et le `CHECK` SQL.
- `core/` ajoute un **pré-contrôle de taille à l'écriture** : `JSON.stringify(valeur).length <= MAX_CONFIG_CHARS` (65 536). La longueur JS compte des unités UTF-16, toujours ≥ au nombre de caractères compté par SQLite : le pré-contrôle est donc au moins aussi strict que le `CHECK`, et produit une erreur métier lisible (`too-large`) au lieu d'un `DataError('constraint')`.
- **Lecture** (`resolveConfig(spec, version, config: JsonObject)`) : version entière ≥ 1 (défensif) → si version > courante : `future-version` (lecture seule, aucune réécriture) → migrations successives (fonctions pures sur `unknown`) → validation par le schéma (sortie typée, clés inconnues retirées). Résultat : union discriminée `ok | invalid(reason, issues)`.
- La config migrée n'est **pas réécrite automatiquement** : elle est enregistrée à la prochaine écriture de l'instance. Les migrations sont pures, peu coûteuses, immuables et jamais supprimées.
- **Écriture** (`serializeConfig`) : validation par le schéma → contrôle de taille → `{ version: courante, config: <sortie validée> }` (un `JsonObject`, que le repository sérialise).
- Échec de lecture : l'hôte affiche un placeholder, **ne réinitialise jamais** sans action explicite de l'utilisateur (bouton « Réinitialiser » sauf pour `future-version`, où seule la suppression est proposée).
- Schémas : `v.object` (qui retire les clés inconnues), jamais `v.looseObject` / `v.objectWithRest`. Migrations : construction explicite ou spread, **jamais** `Object.assign` ni fusion profonde générique (risque de pollution de prototype via une clé `__proto__` issue d'un import).
- URL dans une config : validées par le schéma avec une liste de schémas autorisés (`https:`, `http:`), jamais affichées via `innerHTML`.
- **Aucun secret dans une config.** Un widget qui a besoin d'un secret stocke une **référence** opaque (champ suffixé `Ref`, ex. `tokenRef: "homebase/github"`) vers le gestionnaire d'identifiants Windows. Un test vérifie que les `defaults()` de tous les widgets n'ont aucune clé correspondant à la même expression que l'ADR-002 pour les réglages (`/(secret|token|passw(or)?d|api[-_.]?key|credential)/i`), hors suffixe `Ref`.
- **Données métier ≠ configuration.** La config ne contient que des préférences d'affichage et des références (ex. `listId`). Les données (TODO, notes, transactions) vivent dans leurs tables via leurs repositories ; si elles sont rattachées à une instance, elles la référencent en `ON DELETE CASCADE` (ADR-002 §3.3), sinon elles survivent à la suppression de l'instance.

### 3.5 Instance placée et format d'export
L'instance est le `WidgetInstanceRecord` de l'ADR-002 : `id` (UUID v4), `dashboardId`, `widgetType`, `grid` (`GridRect` : `x`, `y`, `w`, `h`, entiers), `config` (`JsonObject`), `configVersion`, `createdAt`, `updatedAt` (générés par `data/`).

Correspondance avec le contrat (explicite, faite par l'hôte) :

| `WidgetInstanceRecord` (data) | `WidgetContext` (core) |
|---|---|
| `id` | `instanceId` |
| `widgetType` | `type` (= `WidgetDefinition.type`) |
| `grid` (borné par `clampGrid`) | `size` (`{ w, h }`) |
| `config` + `configVersion` | `config` (signal typé, après `resolveConfig`) |

À l'affichage, `grid` est **borné** aux contraintes courantes de la définition (`clampGrid`) sans réécriture en base ; la valeur bornée est enregistrée à la prochaine sauvegarde de layout (`updateLayout`, phase 1).

Dashboard affiché en phase 0 : le **dashboard par défaut**, créé au premier lancement par `DashboardRepository.createIfNone({ name })` (nom traduit côté front, clé `dashboard.defaultName` ; une fois créé, c'est une donnée utilisateur renommable, plus une traduction), puis premier élément de `DashboardRepository.list()`.

Format JSON d'export de la configuration (implémenté en phase 1, figé ici) :
```json
{
  "format": "homebase/dashboard-config",
  "formatVersion": 1,
  "exportedAt": "2026-10-20T08:15:00.000Z",
  "dashboards": [
    {
      "id": "8a1d5f0e-2b7c-4d3e-9f10-6c2b4a8e7d01",
      "name": "Accueil",
      "sortOrder": 0,
      "widgets": [
        {
          "id": "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11",
          "widgetType": "hello",
          "grid": { "x": 0, "y": 0, "w": 3, "h": 2 },
          "config": { "version": 1, "data": { "name": "monde" } }
        }
      ]
    }
  ]
}
```
Règles d'import (à détailler en phase 1, principes figés ici) : le fichier est une **donnée non fiable** ; taille max 1 Mio ; `format` exact et `formatVersion` ≤ supportée sinon refus ; ids en double dans le fichier → refus ; chaque config passe par `resolveConfig` ; type inconnu → instance conservée telle quelle (placeholder) ; import = **remplacement complet** des dashboards. Comme le front n'a pas de transaction (ADR-002 §2.3), ce remplacement atomique nécessitera **une commande Rust dédiée (transaction sqlx) ou une instruction SQL unique**, à concevoir en phase 1 (spec Opus).

### 3.6 Communication widget ↔ core
- Le widget obtient tout ce qui le concerne via `injectWidgetContext<TConfig>()` : `instanceId`, `type`, `config` (signal typé), `size` (signal), `permissions`, `updateConfig(next)`.
- `updateConfig` : valide (rejet sans effet si invalide) → met à jour le signal tout de suite (optimiste) → persiste via `WidgetInstanceRepository.updateConfig(id, config, configVersion)`. **Au plus une écriture en cours par instance + une en attente** (la plus récente remplace la précédente : coalescence, dernier gagnant, cohérent avec ADR-002 §3.5). En cas d'échec, le signal revient à la dernière valeur persistée et la promesse est rejetée (`DataError('not_found')` traduit en `WidgetInstanceNotFoundError`). Debounce de saisie : à la charge du widget.
- Les autres besoins passent par des **services typés de `core/`** (thème, i18n, puis notifications, ouverture d'URL, lancement d'apps, HTTP sortant via Rust) et par les **interfaces de `data/`** (via `data/index.ts`). Pas de bus d'événements générique à sujets libres. Si deux widgets doivent partager quelque chose, c'est soit une donnée (repository), soit un service `core/` typé ajouté par un ADR.
- Les services sensibles prennent le `WidgetContext` appelant en premier paramètre et appellent `assertWidgetPermission(ctx, kind)` (ex. `notifications.notify(ctx, …)`).

### 3.7 Interface côté données : référence à l'ADR-002
Cet ADR **ne définit aucun type de `data/`**. `core/` et `widgets/` utilisent, via `data/index.ts`, les éléments de l'ADR-002 §6.6 :
- `JsonObject`, `JsonValue`, `parseJsonObject` (`data/json.ts`) ;
- `DataError` / `DataErrorKind` (`data/data-error.ts`) ;
- `GridRect { x, y, w, h }`, `WidgetInstanceRecord { id, dashboardId, widgetType, grid, config, configVersion, createdAt, updatedAt }`, `NewWidgetInstance`, `LayoutItem`, `Dashboard`, `NewDashboard` (`data/models.ts`) ;
- `WidgetInstanceRepository { listByDashboard, get, create, updateConfig (lève DataError('not_found')), updateLayout(dashboardId, items) → number, remove }` et `DashboardRepository { list, get, create, createIfNone, rename, remove }` (`data/repositories.ts`) ;
- tokens `WIDGET_INSTANCE_REPOSITORY`, `DASHBOARD_REPOSITORY` et `provideDataLayer()` (`data/data.providers.ts`).

Usage par le contrat :
- les mises à jour de config (`updateConfig`) et de layout (`updateLayout`) touchent des colonnes distinctes : une sauvegarde de layout n'écrase pas une config écrite juste avant (et inversement) ;
- aucune opération du contrat ne suppose de transaction côté front ; chaque appel de repository est une instruction SQL unique (ADR-002 §2.3).

### 3.8 Permissions et capabilities Tauri
Toutes les vues Angular tournent dans **une seule webview** : les capabilities Tauri s'y appliquent en bloc (union des besoins). Les permissions déclarées par un widget sont donc :
1. de la **documentation exécutable** (le registre les valide, l'UI pourra les afficher) ;
2. un **garde-fou** contre les erreurs (les services `core/` sensibles refusent un widget qui ne les a pas déclarées) ;
3. **pas** une frontière de sécurité. La frontière réelle est : CSP stricte, assainissement des contenus externes, capabilities minimales, et validation/listes autorisées **côté Rust**.

| Permission | Service `core/` (phase) | Côté Tauri (moindre privilège) |
|---|---|---|
| `notifications` | `NotificationService` (phase 2) | `tauri-plugin-notification` : uniquement les permissions nécessaires (envoi + état de l'autorisation), pas `default` sans relecture ; rappels planifiés côté Rust |
| `open-url` | `UrlOpener` (phase 1, raccourcis liens) | `opener:allow-open-url` avec portée explicite `[{ "url": "https://*" }, { "url": "http://*" }]` ; **pas** `opener:default` (il autorise aussi `reveal-item-in-dir`, `mailto:`, `tel:`) ; pas `allow-open-path` |
| `network` | `OutboundHttp` (phase 3) | **Aucune** permission `http:*` exposée au JS. Commandes Rust dédiées (`fetch_feed`, `probe_service`…) avec liste d'hôtes, refus des IP privées sauf NAS, timeouts, taille max (spec phase 3) |
| `launch-apps` | `AppLauncher` (phase 3) | **Aucune** permission `shell:*`. Commande Rust `launch_app(appId)` : `appId` résolu dans une liste autorisée tenue côté Rust ; jamais de chemin ni d'argument venant du front |

Règle complémentaire : restreindre les commandes Rust de l'app via `AppManifest::commands` dans `build.rs` (par défaut elles sont toutes accessibles à toutes les fenêtres). Ajouter un type de permission = amendement de cet ADR + mise à jour du tableau. Rappel ADR-002 : `sql:allow-execute`/`sql:allow-select` donnent au front un accès SQL complet (risque R1 de l'ADR-002) ; c'est une raison de plus de ne pas considérer les permissions JS comme une barrière.

### 3.9 Hôte et grille
- `WidgetHostComponent` (`core/`, sélecteur `app-widget-host`) : résout la définition, charge le composant, résout la config, crée un injector enfant fournissant `WIDGET_CONTEXT`, rend via `NgComponentOutlet`. États : `loading | ready | unknown-type | invalid-config | load-error`.
- Phase 0 : grille **CSS Grid** simple (12 colonnes, `grid-column: x+1 / span w`, `grid-row: y+1 / span h`, hauteur de ligne fixe), sans drag & drop.
- Phase 1 : **angular-gridster2 21.x** (repli : gridstack) derrière un adaptateur dans `core/dashboard/` qui consomme `GridRect` et `WidgetSizeConstraints` (gridster : `x`, `y`, `cols`, `rows`, `minItemCols`, `maxItemCols`, `minItemRows`, `maxItemRows` par item ; gridstack : `x`, `y`, `w`, `h`, `minW`, `maxW`, `minH`, `maxH`) et persiste via `updateLayout(dashboardId, items)`.

### 3.10 Widget factice `hello`
Config v1 `{ name: string }` (1 à 40 caractères après `trim`, défaut `"monde"`), affiche « Bonjour, {{ name }} ! » et un champ pour modifier le nom (enregistré via `updateConfig`). Tailles min 2×1, défaut 3×2, max 6×4 (`w`×`h`). Aucune permission. Il valide de bout en bout : registre, chargement lazy, contexte, écriture/lecture en base.

## 4. Conséquences
- Ajouter un widget = créer `widgets/<type>/` (définition, config, composant, tests) + une ligne dans `widgets.providers.ts`. Rien d'autre à toucher.
- Dépendances ajoutées : `valibot` (^1) et `@standard-schema/spec` (^1, types uniquement).
- Un widget mal déclaré fait échouer le démarrage et les tests (fail-fast).
- Chaque migration de config livre une fixture de la version précédente et un test de migration.
- Les erreurs de config ou de type inconnu sont visibles et récupérables par l'utilisateur, jamais silencieusement « réparées ».
- Le contrat ne connaît pas la lib de grille ; l'arrivée de gridster en phase 1 ne touche que l'adaptateur dans `core/dashboard/`.
- Les tests de `core/` (runner Angular) n'utilisent pas SQLite : `data/**` est exclu de ce runner (ADR-002 §2.5). Ils utilisent des **fakes** de repositories placés dans `core/testing/`, fidèles à la sémantique documentée de l'ADR-002.

## 5. Cas limites (décisions)
| Cas | Comportement |
|---|---|
| Deux définitions avec le même `type` | `WidgetRegistryError` au démarrage (liste les problèmes) |
| Instance d'un `widgetType` inconnu (widget retiré, renommé, ou valeur hors motif) | Placeholder « Widget inconnu : <type> » + Supprimer ; ligne conservée en base ; le reste du dashboard fonctionne |
| Config plus récente que le code (retour à une ancienne version de l'app) | `future-version` : placeholder, lecture seule, aucune réécriture ni réinitialisation proposée |
| `configVersion` non entière ou < 1 (impossible via le `CHECK`, contrôle défensif) | `invalid` (`invalid-version`) ; bouton Réinitialiser explicite |
| `config` stockée qui n'est pas un objet JSON | Impossible via le `CHECK` ; sinon `DataError('corrupt_data')` levée par `data/` à la lecture : le dashboard passe en état d'erreur (voir risques) |
| Migration qui lève une exception / résultat invalide | `invalid` (`migration-failed` / `schema-mismatch`) ; données intactes |
| Schéma asynchrone (`validate` renvoie une `Promise`) | Refusé par le registre au démarrage, et `invalid` (`async-schema`) si rencontré |
| Config trop grande à l'écriture | `WidgetConfigError('too-large')` avant tout appel au repository |
| Clé `__proto__` dans un JSON importé | Retirée par `v.object` ; aucune pollution de `Object.prototype` (testé) |
| `updateConfig` rapides en rafale | Coalescence : 1 écriture en cours + 1 en attente (dernière valeur) |
| Échec d'écriture en base (`DataError` quelconque) | Signal remis à la dernière valeur persistée, promesse rejetée |
| `updateConfig` sur une instance supprimée entre-temps | `DataError('not_found')` → rejet `WidgetInstanceNotFoundError`, signal remis à la dernière valeur persistée |
| Écriture layout et config concurrentes | Colonnes distinctes, aucune perte (§3.7) |
| Grid hors contraintes (définition modifiée, colonnes dépassées) | Borné à l'affichage (`clampGrid`), pas de réécriture immédiate |
| `maxInstances` atteint sur le dashboard | `add` rejeté (`WidgetLimitError`), entrée de menu désactivée |
| Double clic sur « Ajouter » | Entrée désactivée pendant l'ajout (sinon deux instances, ADR-002 « Doublons ») |
| Échec du chargement lazy du composant | État `load-error` + bouton Réessayer |
| Premier lancement (aucun dashboard) | `createIfNone` crée le dashboard par défaut (idempotent, atomique) |
| Application lancée hors Tauri (`ng serve` dans un navigateur) | `DataError('unavailable')` (ADR-002) → état d'erreur du dashboard, message traduit |
| Suppression d'une instance | Supprime la ligne (cascade sur les données rattachées à l'instance, s'il y en a) ; idempotent |
| Référence dans la config vers une donnée absente (ex. `listId` après import sur base vide) | Le widget doit afficher un état vide/choix, jamais planter (règle pour chaque widget) |
| Hors-ligne | Sans effet sur le contrat (tout est local) ; les widgets `network` affichent un état dégradé (spec phase 3) |
| Changement d'heure / fuseaux | Le contrat ne manipule que `createdAt`/`updatedAt` UTC générés par `data/` ; aucune date locale dans la config hors champs typés par l'ADR-003 |
| Deux processus de l'app ouverts en même temps | Hors contrat ; plugin single-instance prévu (ADR-002 R11) |

## 6. Risques
- **Même realm JS** : une XSS dans n'importe quel widget obtient toutes les capabilities de la webview (dont l'accès SQL complet, ADR-002 R1). Mitigation : CSP stricte, assainissement (DOMPurify) des contenus externes, aucune capability large, validation côté Rust. Les permissions JS ne sont qu'un garde-fou.
- **Pas d'« error boundary » Angular** : une exception dans le template d'un widget remonte à l'`ErrorHandler` global et peut perturber le cycle de rendu. Mitigation : états d'erreur gérés par l'hôte pour le chargement et la config, `ErrorHandler` qui journalise, tests par widget. Risque accepté.
- **Une ligne corrompue bloque tout le dashboard** : `listByDashboard` lève `corrupt_data` pour l'ensemble si une `config` n'est pas un objet. Probabilité très faible (le `CHECK` l'interdit ; seule une édition manuelle de la base y mène). Accepté en phase 0 ; à rouvrir si cela se produit (lecture tolérante ligne par ligne dans `data/`, par amendement de l'ADR-002).
- **Migration de config boguée** → perte de préférences. Mitigation : jamais de réécriture en cas d'échec, fixtures obligatoires, sauvegardes de la base (ADR-002 §2.7).
- **Heuristique anti-secret** incomplète (un secret sous un nom anodin passe). Mitigation : règle de revue + convention `…Ref`.
- **Grille** : la sémantique min/max de gridster2 est par item mais complétée de minimums globaux d'options ; l'adaptateur doit les régler pour ne pas contredire `WidgetSizeConstraints`.

## 7. Points ouverts
1. Forme définitive de `CalendarSource` / `CalendarEvent` : ADR-003/004.
2. Plusieurs dashboards affichés (navigation entre dashboards) : le modèle de données les supporte (ADR-002), l'interface reste mono-dashboard en phases 0 et 1.
3. Permission `secrets` (GitHub, phase 6) : à ajouter par amendement quand le besoin arrive.
4. Import/remplacement atomique (phase 1) : commande Rust ou instruction unique (§3.5).

Points clos : mécanisme i18n (Transloco, clés runtime) ; nommage SQL/TS de la couche données (ADR-002) ; lib de grille de phase 1 (angular-gridster2 21.x, repli gridstack).

---

## 8. Spec d'implémentation (phase 0)

Destinataire : `implementer` (Sonnet). Spec autonome : lire aussi `CLAUDE.md` et `docs/adr/002-data-layer.md` §6.6 (types de `data/`). Ne pas improviser : en cas d'ambiguïté ou de prérequis manquant, **s'arrêter et remonter**.

### 8.1 Prérequis exacts (à vérifier avant d'écrire du code)
1. **Init monorepo** faite : `apps/web` (Angular 21 zoneless, Vitest via le runner Angular, ESLint avec préfixe de sélecteur `app-`), `apps/desktop/src-tauri`.
2. **Shell** fait : routing, Transloco configuré via `provideAppI18n()` (`apps/web/src/app/core/i18n/`), traductions embarquées dans `apps/web/src/app/core/i18n/fr.json`.
3. **Spec ADR-002 implémentée** : `apps/web/src/app/data/index.ts` exporte au moins `JsonObject`, `JsonValue`, `parseJsonObject`, `DataError`, `DataErrorKind`, `GridRect`, `Dashboard`, `NewDashboard`, `WidgetInstanceRecord`, `NewWidgetInstance`, `LayoutItem`, `DashboardRepository`, `WidgetInstanceRepository`, `DASHBOARD_REPOSITORY`, `WIDGET_INSTANCE_REPOSITORY`, `provideDataLayer`. `src/app/data/**` est exclu du runner Angular ; les tests de `data/` tournent via `test:data`.
4. **Ne rien modifier sous `src/app/data/`** (propriété de l'ADR-002). S'il manque un export ou si une signature diffère de l'ADR-002 §6.6 : s'arrêter et remonter.
5. Si `provideDataLayer()` n'est pas encore branché dans `app.config.ts`, le brancher (le Shell est fait, condition de l'ADR-002 §6.6 levée).
6. Dépendances à ajouter dans `apps/web/package.json` : `valibot` (^1) et `@standard-schema/spec` (^1). Vérifier à l'installation que les schémas Valibot exposent `~standard` (sinon s'arrêter).

Chemins relatifs à `apps/web/src/app/` sauf mention contraire. Imports de `data/` **uniquement** via `data/index.ts` (règle ESLint ADR-002 §6.8).

### 8.2 Fichiers à créer
```
core/widgets/widget-definition.ts
core/widgets/grid.ts
core/widgets/widget-config.ts
core/widgets/widget-registry.ts
core/widgets/widget-permissions.ts
core/widgets/widget-context.ts
core/widgets/widget-host.component.ts      (+ .html si besoin)
core/widgets/index.ts                      (barrel public pour les widgets)
core/calendar/calendar-source.ts           (PROVISOIRE, types seulement)
core/dashboard/dashboard.store.ts
core/dashboard/dashboard.component.ts      (+ .html)
core/testing/fake-dashboard.repository.ts
core/testing/fake-widget-instance.repository.ts
core/testing/fixture-definitions.ts        (définitions factices, dont une en version 3 avec migrations)
widgets/widgets.providers.ts
widgets/hello/hello.config.ts
widgets/hello/hello.definition.ts
widgets/hello/hello.component.ts           (+ .html)
apps/web/scripts/check-widget-boundaries.mjs
apps/web/scripts/fixtures/boundaries/ok/**   (mini-arborescence core/ data/ widgets/ conforme)
apps/web/scripts/fixtures/boundaries/ko/**   (une violation par règle R1 à R4)
```
Tests (Vitest, runner Angular), à côté des fichiers : `grid.spec.ts`, `widget-config.spec.ts`, `widget-registry.spec.ts`, `widget-permissions.spec.ts`, `widget-context.spec.ts`, `widget-host.component.spec.ts`, `dashboard.store.spec.ts`, `widgets.providers.spec.ts`, `hello.component.spec.ts`.

### 8.3 Fichiers à modifier
- `apps/web/package.json` : dépendances ; script `lint` = lint existant `&& node scripts/check-widget-boundaries.mjs`.
- `apps/web/src/app/app.config.ts` : `...provideAllWidgets()` ; `provideDataLayer()` s'il n'y est pas.
- Routes : `DashboardComponent` sur la route `''` (lazy `loadComponent`).
- `apps/web/src/app/core/i18n/fr.json` : vérifier la présence des clés de §8.6, ajouter les manquantes.

### 8.4 Types et signatures exacts

```ts
// core/widgets/widget-definition.ts
import type { Type } from '@angular/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JsonObject } from '../../data';            // via data/index.ts
import type { CalendarSource } from '../calendar/calendar-source';

export type WidgetTypeId = string;
export const WIDGET_TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
export const WIDGET_ICON_PATTERN = /^pi pi-[a-z0-9-]+$/;

export interface GridSize { readonly w: number; readonly h: number; }
export interface WidgetSizeConstraints { readonly min: GridSize; readonly default: GridSize; readonly max: GridSize; }

export type WidgetPermissionKind = 'network' | 'notifications' | 'launch-apps' | 'open-url';
export const WIDGET_PERMISSION_KINDS: readonly WidgetPermissionKind[] = ['network', 'notifications', 'launch-apps', 'open-url'];

/** Transforme une config de version n en version n+1. Pure, synchrone, sans I/O ni horloge. */
export type ConfigMigration = (previous: unknown) => unknown;

export interface WidgetConfigSpec<TConfig extends JsonObject> {
  readonly version: number;
  readonly schema: StandardSchemaV1<unknown, TConfig>;
  readonly defaults: () => TConfig;
  readonly migrations: Readonly<Record<number, ConfigMigration>>;
}

export interface WidgetDefinition<TConfig extends JsonObject = JsonObject> {
  readonly type: WidgetTypeId;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly icon: string;
  readonly loadComponent: () => Promise<Type<unknown>>;
  readonly size: WidgetSizeConstraints;
  readonly config: WidgetConfigSpec<TConfig>;
  readonly permissions: readonly WidgetPermissionKind[];
  /** Par dashboard. */
  readonly maxInstances?: number;
  readonly loadCalendarSource?: () => Promise<Type<CalendarSource>>;
}

/** Identité typée, sert à l'inférence de TConfig. */
export function defineWidget<TConfig extends JsonObject>(definition: WidgetDefinition<TConfig>): WidgetDefinition<TConfig>;
```
(Le chemin d'import de `data/index.ts` suit la convention de l'init : relatif ou alias existant.)

```ts
// core/widgets/grid.ts
import type { GridRect } from '../../data';
export const GRID_COLUMNS = 12;
export const GRID_MAX_ROWS = 24;
/** Borne w/h dans [min, max], x dans [0, GRID_COLUMNS - w], y >= 0 ; arrondi à l'entier inférieur ; NaN -> min (w/h) ou 0 (x/y). */
export function clampGrid(grid: GridRect, constraints: WidgetSizeConstraints): GridRect;
/** { x: 0, y: max(y + h) des existants (0 si vide), w, h }. */
export function nextFreePosition(existing: readonly GridRect[], size: GridSize): GridRect;
```

```ts
// core/widgets/widget-config.ts
export const MAX_CONFIG_CHARS = 65_536; // aligné sur CHECK length(config) <= 65536 (ADR-002 §6.3)
export type ConfigErrorReason =
  | 'too-large' | 'invalid-version' | 'future-version'
  | 'migration-failed' | 'schema-mismatch' | 'async-schema';

export type ResolvedConfig<TConfig extends JsonObject> =
  | { readonly status: 'ok'; readonly config: TConfig; readonly migratedFrom: number | null }
  | { readonly status: 'invalid'; readonly reason: ConfigErrorReason; readonly issues: readonly string[] };

export type SerializedConfig<TConfig extends JsonObject> =
  | { readonly ok: true; readonly version: number; readonly config: TConfig }
  | { readonly ok: false; readonly reason: 'too-large' | 'schema-mismatch' | 'async-schema'; readonly issues: readonly string[] };

/** Point de départ : ce que data/ a déjà parsé et vérifié (objet JSON). */
export function resolveConfig<TConfig extends JsonObject>(spec: WidgetConfigSpec<TConfig>, version: number, stored: JsonObject): ResolvedConfig<TConfig>;
/** Valide, puis contrôle JSON.stringify(sortie).length <= MAX_CONFIG_CHARS. */
export function serializeConfig<TConfig extends JsonObject>(spec: WidgetConfigSpec<TConfig>, value: unknown): SerializedConfig<TConfig>;
/** Valide de façon synchrone ; async = true si validate renvoie un thenable. */
export function validateSync<T>(schema: StandardSchemaV1<unknown, T>, value: unknown):
  | { readonly ok: true; readonly value: T } | { readonly ok: false; readonly async: boolean; readonly issues: readonly string[] };
```
Détails : `issues` formatées `"<chemin>: <message>"` (chemin joint par `.`, vide pour la racine) ; `migratedFrom` = version lue si au moins une migration a été appliquée, sinon `null` ; `resolveConfig` ne modifie jamais `stored` (les migrations reçoivent `stored` tel quel et doivent produire de nouveaux objets).

```ts
// core/widgets/widget-registry.ts
export const WIDGET_DEFINITIONS: InjectionToken<readonly WidgetDefinition[]>; // multi
export function provideWidget<TConfig extends JsonObject>(definition: WidgetDefinition<TConfig>): Provider;
export class WidgetRegistryError extends Error { readonly problems: readonly string[]; }
/** Liste des problèmes d'UNE définition (vide si valide). Pure, exportée pour les tests. */
export function validateDefinition(definition: WidgetDefinition): readonly string[];

@Injectable({ providedIn: 'root' })
export class WidgetRegistry {
  get(type: WidgetTypeId): WidgetDefinition | undefined;
  list(): readonly WidgetDefinition[]; // ordre d'enregistrement
}
```
`validateDefinition` vérifie : motif `type` ; motif `icon` ; `titleKey`/`descriptionKey` non vides ; tailles entières, `1 ≤ min ≤ default ≤ max` sur chaque axe, `max.w ≤ GRID_COLUMNS`, `max.h ≤ GRID_MAX_ROWS` ; `config.version` entier ≥ 1 ; clés de `migrations` exactement `1..version-1` ; `defaults()` valide **de façon synchrone** ; `defaults()` survit à un aller-retour JSON (`validateSync(schema, JSON.parse(JSON.stringify(d)))` réussit et `JSON.stringify` identique avant/après) ; `JSON.stringify(defaults()).length ≤ MAX_CONFIG_CHARS` ; permissions connues et sans doublon ; `maxInstances` entier ≥ 1 si présent ; `loadComponent` est une fonction. Le registre ajoute la détection de doublons de `type` et lève une seule `WidgetRegistryError` avec tous les problèmes, préfixés par le `type`. Aucun token fourni = registre vide (valide).

```ts
// core/widgets/widget-permissions.ts
export class WidgetPermissionError extends Error { readonly widgetType: WidgetTypeId; readonly permission: WidgetPermissionKind; }
export function hasWidgetPermission(ctx: Pick<WidgetContext, 'permissions'>, kind: WidgetPermissionKind): boolean;
export function assertWidgetPermission(ctx: Pick<WidgetContext, 'type' | 'permissions'>, kind: WidgetPermissionKind): void;
```

```ts
// core/widgets/widget-context.ts
export interface WidgetContext<TConfig extends JsonObject = JsonObject> {
  readonly instanceId: string;          // = WidgetInstanceRecord.id
  readonly type: WidgetTypeId;          // = WidgetInstanceRecord.widgetType
  readonly config: Signal<TConfig>;
  readonly size: Signal<GridSize>;      // = clampGrid(record.grid) -> { w, h }
  readonly permissions: ReadonlySet<WidgetPermissionKind>;
  updateConfig(next: TConfig): Promise<void>;
}
export class WidgetConfigError extends Error { readonly reason: ConfigErrorReason; readonly issues: readonly string[]; }
export class WidgetInstanceNotFoundError extends Error { readonly instanceId: string; }
export const WIDGET_CONTEXT: InjectionToken<WidgetContext>;
/** Seul cast autorisé du contrat (as unknown as), documenté en commentaire. */
export function injectWidgetContext<TConfig extends JsonObject>(): WidgetContext<TConfig>;

/** Port d'écriture, implémenté par DashboardStore ; remplaçable en test. */
export interface WidgetConfigWriter {
  /** Délègue à WidgetInstanceRepository.updateConfig ; propage DataError (dont 'not_found'). */
  saveConfig(id: string, config: JsonObject, configVersion: number): Promise<WidgetInstanceRecord>;
}
export function createWidgetContext<TConfig extends JsonObject>(params: {
  readonly record: WidgetInstanceRecord;
  readonly definition: WidgetDefinition<TConfig>;
  readonly initialConfig: TConfig;
  readonly size: Signal<GridSize>;
  readonly writer: WidgetConfigWriter;
}): WidgetContext<TConfig>;
```
Sémantique de `updateConfig` (§3.6) : `serializeConfig` ; si échec → rejet `WidgetConfigError`, signal et base inchangés. Sinon signal = valeur **validée** (sortie du schéma, ex. nom « trimé ») ; écriture coalescée (1 en cours + 1 en attente, la plus récente) ; les promesses de valeurs remplacées se résolvent quand l'écriture qui les remplace aboutit (ou sont rejetées si elle échoue). Échec du writer → signal = dernière valeur persistée ; si `DataError` de `kind === 'not_found'` → rejet `WidgetInstanceNotFoundError`, sinon rejet avec l'erreur d'origine.

```ts
// core/calendar/calendar-source.ts  (PROVISOIRE : ADR-003/004 la figent ; aucun consommateur en phase 0)
export interface CalendarRange { readonly startUtc: string; readonly endUtc: string; } // ISO 8601 UTC, [start, end)
export interface CalendarEvent {
  readonly id: string; readonly sourceType: string; readonly title: string;
  readonly startUtc: string; readonly endUtc: string | null; readonly allDay: boolean; readonly timeZone: string; // IANA
}
export interface CalendarSource { listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]>; }
```

```ts
// core/dashboard/dashboard.store.ts
export class WidgetLimitError extends Error { readonly widgetType: string; readonly maxInstances: number; }
export class UnknownWidgetTypeError extends Error { readonly widgetType: string; }

@Injectable({ providedIn: 'root' })
export class DashboardStore implements WidgetConfigWriter {
  // injecte DASHBOARD_REPOSITORY, WIDGET_INSTANCE_REPOSITORY, WidgetRegistry
  readonly dashboard: Signal<Dashboard | null>;
  readonly instances: Signal<readonly WidgetInstanceRecord[]>;
  readonly status: Signal<'idle' | 'loading' | 'ready' | 'error'>;
  readonly error: Signal<DataError | null>;
  /** createIfNone({ name: defaultDashboardName }) puis list()[0] puis listByDashboard(id). */
  load(defaultDashboardName: string): Promise<void>;
  canAdd(type: WidgetTypeId): boolean;                      // dashboard chargé, type connu, maxInstances non atteint
  add(type: WidgetTypeId): Promise<WidgetInstanceRecord>;   // create({ dashboardId, widgetType, grid: nextFreePosition(..., size.default), config: defaults(), configVersion })
  remove(id: string): Promise<void>;                        // repository.remove ; retire de instances
  resetConfig(id: string): Promise<void>;                   // updateConfig(id, defaults(), version courante)
  saveConfig(id: string, config: JsonObject, configVersion: number): Promise<WidgetInstanceRecord>;
}
```
Le store met à jour `instances` après chaque écriture réussie (remplacement de l'enregistrement par celui renvoyé). Le nom par défaut est passé par le composant (`transloco.translate('dashboard.defaultName')`) pour garder le store indépendant de Transloco. `id` des nouvelles instances : laissé à `data/` (`IdGenerator`).

```ts
// core/widgets/widget-host.component.ts
// selector 'app-widget-host', standalone, OnPush
// instance = input.required<WidgetInstanceRecord>()
type WidgetHostState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly component: Type<unknown>; readonly injector: Injector }
  | { readonly kind: 'unknown-type'; readonly type: string }
  | { readonly kind: 'invalid-config'; readonly reason: ConfigErrorReason; readonly issues: readonly string[] }
  | { readonly kind: 'load-error' };
```
L'hôte : résout la définition par `instance.widgetType` (`unknown-type` sinon) ; `resolveConfig(def.config, instance.configVersion, instance.config)` (`invalid-config` sinon) ; `await loadComponent()` (`load-error` sinon, bouton Réessayer) ; crée `Injector.create({ providers: [{ provide: WIDGET_CONTEXT, useValue: ctx }], parent })` ; rend via `NgComponentOutlet` + `ngComponentOutletInjector`. En-tête minimal : icône, titre traduit, bouton Supprimer. Placeholder `invalid-config` : bouton Réinitialiser (sauf `future-version`) → `store.resetConfig`. Le contexte n'est recréé que si `instance.id` change (pas à chaque nouvel enregistrement renvoyé par `saveConfig`). `size` = signal dérivé de `clampGrid(instance.grid, def.size)`.

`DashboardComponent` (sélecteur `app-dashboard`) : appelle `store.load(transloco.translate('dashboard.defaultName'))` ; CSS Grid 12 colonnes (`grid-column: x+1 / span w`, `grid-row: y+1 / span h`, hauteur de ligne fixe) en appliquant `clampGrid` (pour un type inconnu : `grid` tel quel, borné seulement à `GRID_COLUMNS`) ; menu « Ajouter un widget » listant `registry.list()` (icône + titre traduit), entrée désactivée si `!canAdd(type)` ou pendant un ajout en cours ; état vide quand aucune instance ; état d'erreur (`dashboard.loadError`) si `status() === 'error'`.

Fakes (`core/testing/`) : `FakeDashboardRepository implements DashboardRepository`, `FakeWidgetInstanceRepository implements WidgetInstanceRepository`, en mémoire, reproduisant la sémantique de l'ADR-002 §6.6 utile ici : tri `listByDashboard` (`grid.y, grid.x, createdAt, id`), `updateConfig` → `DataError('not_found')` si absent, `remove` → booléen idempotent, `createIfNone` → `true` puis `false`, `updateLayout` → nombre de lignes modifiées ; ids et horodatages déterministes ; méthode `failNext(error: unknown)` pour simuler un échec. Importés uniquement par des `*.spec.ts`.

```ts
// widgets/hello/hello.config.ts
import * as v from 'valibot';
export const helloConfigSchema = v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)) });
export type HelloConfig = v.InferOutput<typeof helloConfigSchema>;
export const HELLO_CONFIG_VERSION = 1;
export const helloDefaults = (): HelloConfig => ({ name: 'monde' });

// widgets/hello/hello.definition.ts
export const helloWidget = defineWidget<HelloConfig>({
  type: 'hello',
  titleKey: 'widgets.hello.title',
  descriptionKey: 'widgets.hello.description',
  icon: 'pi pi-star',
  loadComponent: () => import('./hello.component').then((m) => m.HelloComponent),
  size: { min: { w: 2, h: 1 }, default: { w: 3, h: 2 }, max: { w: 6, h: 4 } },
  config: { version: HELLO_CONFIG_VERSION, schema: helloConfigSchema, defaults: helloDefaults, migrations: {} },
  permissions: [],
});

// widgets/widgets.providers.ts
export function provideAllWidgets(): Provider[] { return [provideWidget(helloWidget)]; }
```
`HelloComponent` (sélecteur `app-hello-widget`, standalone, OnPush) : `ctx = injectWidgetContext<HelloConfig>()` ; affiche `widgets.hello.greeting` avec `{ name }` par le pipe/directive Transloco (interpolation, jamais `innerHTML`) ; formulaire (champ texte + bouton « Enregistrer », Entrée valide) ; à la soumission `ctx.updateConfig({ ...ctx.config(), name })` ; en cas de `WidgetConfigError`, message `widgets.hello.invalidName`, valeur persistée inchangée.

### 8.5 Script de frontières `apps/web/scripts/check-widget-boundaries.mjs`
- Node pur (ESM, aucune dépendance). Argument optionnel : dossier racine (défaut `src/app` relatif à `apps/web`).
- Parcourt récursivement les `.ts` ; extrait les spécificateurs : `import … from '…'`, `export … from '…'`, `import '…'`, `import('…')`.
- Résout les relatifs (`path.resolve`) ; reconnaît aussi les alias `@core/`, `@data/`, `@widgets/` s'ils existent. Zone d'un fichier = 1er segment sous la racine (`core`, `data`, `widgets`, autre) ; widget = 2e segment sous `widgets/`.
- Règles R1 à R4 (§3.1). Sortie : une ligne par violation `<fichier>:<ligne> [R<n>] <message>`, code de sortie 1 ; sinon message de succès et code 0.
- Ne duplique pas les règles ESLint de l'ADR-002 (plugin SQL, `data/sqlite`, `data/testing`).

### 8.6 Clés i18n FR (`core/i18n/fr.json`, syntaxe Transloco)
`widgets.hello.title` « Bonjour », `widgets.hello.description` « Widget de démonstration », `widgets.hello.greeting` « Bonjour, {{ name }} ! », `widgets.hello.nameLabel` « Nom », `widgets.hello.save` « Enregistrer », `widgets.hello.invalidName` « Le nom doit contenir de 1 à 40 caractères. », `dashboard.defaultName` « Accueil », `dashboard.addWidget` « Ajouter un widget », `dashboard.empty` « Aucun widget pour l'instant. », `dashboard.loadError` « Impossible de charger le tableau de bord. », `widgetHost.remove` « Supprimer », `widgetHost.unknownType` « Widget inconnu : {{ type }} », `widgetHost.invalidConfig` « Configuration invalide », `widgetHost.futureVersion` « Configuration créée par une version plus récente de Homebase », `widgetHost.resetConfig` « Réinitialiser », `widgetHost.loadError` « Impossible de charger ce widget », `widgetHost.retry` « Réessayer ».

### 8.7 Tests Vitest à écrire (runner Angular, cas minimaux)
- `grid.spec.ts` : `clampGrid` (x qui dépasse → recalé, w < min, w > max, valeurs négatives, non entières, NaN) ; `nextFreePosition` (vide → 0,0 ; plusieurs → sous le plus bas).
- `widget-config.spec.ts` : ok sans migration (`migratedFrom = null`) ; `invalid-version` (0, -1, 1.5) ; `future-version` ; chaîne de migrations 1→2→3 appliquée dans l'ordre (fixture v3) avec `migratedFrom = 1` ; `stored` non muté ; migration qui lève → `migration-failed` ; résultat invalide → `schema-mismatch` ; clés inconnues retirées ; objet issu de `JSON.parse('{"__proto__":{"polluted":true},"name":"x"}')` → `({} as Record<string, unknown>)['polluted'] === undefined` et pas de clé `__proto__` propre dans le résultat ; schéma asynchrone factice → `async-schema` ; `serializeConfig` ok (sortie transformée, ex. trim), invalide, `too-large` (chaîne de 65 537 caractères).
- `widget-registry.spec.ts` : définition valide acceptée ; registre vide ; doublon de `type` ; `type` invalides (`Hello`, `a`, `hello_world`, 33 caractères) ; icône invalide (`<svg>`, `fa fa-x`) ; tailles (min > default, `max.w` 13, 0, 1.5) ; migration manquante (version 3 sans clé 2) ; clé de migration en trop ; `defaults()` invalide ; `defaults()` non JSON (`NaN`, `undefined`, `Date`) ; schéma asynchrone ; `maxInstances: 0` ; permission en double ; permission inconnue (via cast dans le test) ; plusieurs problèmes agrégés dans une seule erreur ; `get` d'un type inconnu → `undefined`.
- `widget-permissions.spec.ts` : `has`/`assert` ; l'erreur porte `widgetType` et `permission`.
- `widget-context.spec.ts` (writer factice contrôlable par promesses) : mise à jour valide → signal immédiat, writer appelé une fois avec `(id, config, 1)` ; invalide → rejet `WidgetConfigError`, writer non appelé ; échec writer → signal rétabli, rejet ; 3 appels pendant une écriture en cours → writer appelé exactement 2 fois au total, la 2e avec la dernière valeur, toutes les promesses résolues ; writer qui rejette `new DataError('not_found', …)` → `WidgetInstanceNotFoundError`, signal rétabli.
- `dashboard.store.spec.ts` (fakes de `core/testing`, définitions fixtures) : premier `load` crée le dashboard par défaut avec le nom fourni, second `load` n'en crée pas d'autre ; `add('hello')` → `widgetType`, defaults, `grid` taille par défaut en position libre, `configVersion` ; type inconnu → `UnknownWidgetTypeError` ; `maxInstances` → `WidgetLimitError` et `canAdd` false ; `remove` ; `resetConfig` écrit les defaults ; `instances` triées ; `status` = `error` et `error()` renseigné si un repository rejette (`DataError('unavailable')`).
- `widget-host.component.spec.ts` : instance valide → composant hello rendu ; type inconnu → texte placeholder et pas de crash ; config invalide → placeholder + Réinitialiser appelle `resetConfig` ; `future-version` → pas de bouton Réinitialiser ; `loadComponent` rejeté → `load-error`, puis Réessayer recharge.
- `widgets.providers.spec.ts` : `provideAllWidgets()` → `WidgetRegistry` se construit sans erreur ; pour chaque définition, `loadComponent()` résout un composant (`reflectComponentType(...) !== null`) ; aucune clé de `defaults()` (récursif) ne correspond à `/(secret|token|passw(or)?d|api[-_.]?key|credential)/i`, sauf si elle se termine par `Ref`.
- `hello.component.spec.ts` (contexte factice fourni via `WIDGET_CONTEXT`, Transloco de test) : affiche le nom ; soumission « Alice » → `updateConfig({ name: 'Alice' })` ; soumission vide ou 41 caractères → message d'erreur, rien de persisté.

### 8.8 Critères d'acceptation (vérifiables)
- **CA-1** Tous les tests ci-dessus existent et passent (runner Angular) ; `test:data` (ADR-002) reste vert.
- **CA-2** Lint propre, y compris `check-widget-boundaries` sur `src/app` et les règles ESLint de l'ADR-002.
- **CA-3** `node apps/web/scripts/check-widget-boundaries.mjs apps/web/scripts/fixtures/boundaries/ko` sort en code 1 avec exactement une violation pour chacune de R1, R2, R3, R4 ; sur `…/ok` sort en code 0.
- **CA-4** Aucun `any` (`@typescript-eslint/no-explicit-any` en erreur) ; `as unknown as` n'apparaît qu'une fois hors tests et `core/testing/` : `rg -n "as unknown as" apps/web/src/app -g "!*.spec.ts" -g "!**/testing/**"` → 1 résultat (dans `injectWidgetContext`).
- **CA-5** Aucun fichier modifié sous `apps/web/src/app/data/` (`git diff --stat -- apps/web/src/app/data` vide).
- **CA-6** Le build de production liste le composant hello dans un **chunk lazy** séparé (section « Lazy chunk files » de la sortie de build).
- **CA-7** (manuel, `tauri dev`) Premier lancement : dashboard « Accueil » vide avec message → « Ajouter un widget » → « Bonjour » → widget en (0,0), 3×2, « Bonjour, monde ! ».
- **CA-8** (manuel) Changer le nom en « Marius », fermer et relancer l'application : « Bonjour, Marius ! » s'affiche ; un seul dashboard en base.
- **CA-9** (manuel, application fermée, via `sqlite3` ou DB Browser sur `%APPDATA%\<identifier>\homebase.db`) : une ligne `widget_instances` de `widget_type = 'ghost'` (config `{}`) affiche « Widget inconnu : ghost » sans casser les autres widgets ; une ligne hello avec `config_version = 99` affiche le placeholder « version plus récente » et la ligne est **identique** (`config`, `config_version`, `updated_at`) après redémarrage.
- **CA-10** Aucun secret, aucun texte d'interface en dur (tout passe par Transloco), composants standalone OnPush, sélecteurs préfixés `app-`.

### 8.9 Commandes de test
Les commandes du projet seront figées dans `CLAUDE.md` (section « Commandes ») en fin de phase 0. Utiliser celles de l'init ; à défaut, attendu (depuis `apps/web`, `<pm>` = gestionnaire de paquets retenu) :
```
<pm> install
<pm> run test          # runner Angular (Vitest) : tests core/ et widgets/
<pm> run test:data     # ADR-002, doit rester vert
<pm> run lint          # ESLint && node scripts/check-widget-boundaries.mjs
<pm> run build         # vérifier le chunk lazy hello (CA-6)
node scripts/check-widget-boundaries.mjs scripts/fixtures/boundaries/ko   # code 1 attendu
```
Rapport attendu : fichiers créés/modifiés, résultats test/lint, écarts à la spec, prérequis manquants et doutes.
