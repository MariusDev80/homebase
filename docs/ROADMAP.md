# ROADMAP : Homebase

Légende modèle : **H** = Haiku, **S** = Sonnet (`implementer`), **O** = Opus (`architect` / `reviewer`). Cocher chaque tâche une fois ses critères atteints. Chaque phase se termine par une revue `reviewer` (O).

## Phase 0 : Fondations (application Windows)
- [x] (H) Vérifier la toolchain Windows (Rust MSVC, Build Tools C++, WebView2, Node) et la documenter (`docs/TOOLCHAIN.md`)
- [x] (S) Init monorepo : Tauri 2 + Angular 21 zoneless + Tailwind 4 + PrimeNG, Vitest, ESLint, Prettier
- [x] (S) Fenêtre native qui affiche le shell ; build d'un installateur de test
- [x] (S) Shell : layout, thème clair/sombre, routing, i18n FR
- [x] (S) Spike : une notification native planifiée + icône de zone de notification + démarrage automatique (valide la faisabilité des rappels) (`docs/spikes/001-tray-notification-autostart.md` ; vérification manuelle à faire par Marius)
- [x] (S) SQLite via `tauri-plugin-sql` + migrations `V1__init.sql` ; interface `Repository` + une implémentation de test (SQLite en mémoire pour les tests)
- [x] (S) CI GitHub Actions sur `windows-latest` (lint + test + build), Dependabot (validée localement avec actionlint ; premier run GitHub à confirmer après le premier push)
- [x] (O) ADR-001 : contrat `Widget` + registre + format de configuration (`docs/adr/001-widget-contract.md`, statut proposé)
- [x] (O) ADR-002 : couche de données (schéma SQLite, UUID, conventions de migration, stockage des images, sauvegardes) (`docs/adr/002-data-layer.md`, statut proposé ; fait foi pour `data/`)
- [x] (H, scout) Vérifier angular-gridster2 vs Angular 21 ; sinon alternative (angular-gridster2 21.x, repli gridstack ; voir PLAN §2)
- [x] (H) Compléter la section « Commandes » de `CLAUDE.md`
**Sortie** : application Windows qui se lance, lit et écrit en base, grille avec un widget factice.

## Phase 1 : MVP
- [x] (S) Design system selon `docs/DESIGN.md` : `core/theme/tokens.css` (clair/sombre), `@theme` Tailwind sémantique, preset PrimeNG dérivé d'Aura sur les tokens `--hb-*`, refonte de la barre supérieure (UnderlineNav), du dashboard et de l'hôte de widget (carte Box) ; captures clair/sombre de l'exe release (à refaire par Marius dans la procédure manuelle de fin de phase 1). **À faire avant les widgets**
- [x] (S) Reliquats revue phase 0 : remplacer `core:default` par la liste minimale, retirer/limiter au debug les commandes de spike, menu « Ajouter un widget » accessible (Échap, clic extérieur, flèches), confirmation de suppression, F5 sur `/settings` en release (sinon `withHashLocation()`), flash de thème au démarrage, coalescence `updateConfig` vs ADR-001 §3.6 (aucune permission `core:*` ; spike et devtools dans `capabilities/debug.json` ; routage par chemin conservé, Tauri renvoie vers `index.html` ; `public/theme-init.js` ; vérification manuelle dans l'exe release à faire par Marius)
- [x] (S) Grille drag & drop redimensionnable, layout enregistré en base (angular-gridster2 21.0.1 derrière `core/dashboard/grid-adapter.ts`, 12 colonnes, mode « Modifier la disposition », déplacement clavier ; vérification manuelle dans `npm run dev` à faire par Marius)
- [x] (S) ADR-003 lot A : fondations temps (`data/time-formats.ts`, `core/time`, fuseau utilisateur, affichage, règle ESLint, vecteurs sans récurrence). **Avant le widget TODO** (revu ; vérification manuelle CA-A8 dans Réglages à faire par Marius)
- [x] (S) Widgets : TODO, notes, raccourcis (liens), recherche (`UrlOpener` + opener restreint ; recherche insensible à la casse ASCII seulement, pas aux accents)
- [x] (S) Widget météo Open-Meteo (+ géocodage) (`docs/specs/weather-widget.md` ; commandes Rust `weather_*` sur le module `net` ; vérifications manuelles CA-W1-M et CA-M* à faire par Marius)
- [x] (S) Sauvegarde/restauration : archive de la base et des images, export JSON de la configuration (spec `docs/specs/backup-restore.md`, lots B1a à B6, chaque lot revu ; vérifications manuelles M1 à M9 et M11 à faire par Marius ; M10 (sauvegarde avant migration) à vérifier à la première migration V4 (spec dashboards-sidebar, M10))
- [x] (O) ADR-003 : modèle de temps (UTC + IANA + RRULE) (`docs/adr/003-time-model.md`, accepté ; décisions D1 à D3 validées par Marius)
- [x] (S) Instance unique : `tauri-plugin-single-instance` 2.5.4 enregistré en premier, avant le plugin de sauvegarde ; relancer Homebase remet au premier plan la fenêtre existante (revue de fin de phase 1, I2 ; vérification manuelle à faire par Marius)
- [x] (O) Revue de fin de phase 1 (jalon atteint sous réserve des vérifications manuelles de Marius ; ADR-001 à 003 acceptés)
**Sortie** : tableau de bord utilisable au quotidien. **Jalon MVP.**

## Phase 1 bis : navigation et grille
Spec : `docs/specs/dashboards-sidebar.md`. Vérifications manuelles M1 à M17 (et MT1 à MT9 de `docs/specs/dashboard-theme.md`, MD1 à MD9 de `docs/specs/todo-details.md`) à faire par Marius (M1 à M17, MT1 à MT9 et MD8 à MD9 sur l'exe release et la vraie base, juste avant la fusion ; MD1 à MD7 sur l'app de dev, `npm run dev`).
- [x] (S) Lot 0 : base et démarrage automatique de développement séparés (`tauri.dev.conf.json`, « Homebase Dev »)
- [x] (S) Lot A : grille de 12 × 8 qui s'adapte à la fenêtre, repositionnement à l'affichage
- [x] (S) Lot B : barre verticale à bulles, retrait du H1, du nom de l'app et du bouton de thème
- [x] (S) Lot C1 : migration V4 `dashboards.icon`, couche de données
- [x] (S) Lot C2a : plusieurs tableaux de bord (stores, garde, routes `/dashboards/:id`, page)
- [x] (S) Lot C2b : recherche inter-tableaux, `Ctrl+K`, exclusion de `dashboard.last`
- [x] (S) Lot C3a : bulles de tableaux, création, modification
- [x] (S) Lot C3b : suppression d'un tableau (sauvegarde `pre-delete`, verrou)
- [x] (S) Lot D : `+` vert et V bleu d'ajout de widget
- [x] (S) Lot E : déplacement toujours actif depuis la poignée de l'en-tête
- [x] (S) Lot F : export et import (`formatVersion` 2)
- [x] (S) Lot T1 (spec `dashboard-theme.md`) : palette de douze teintes, tokens clair et sombre, `check-contrast` étendu et ses fixtures
- [x] (S) Lot T2 : migration V5 `dashboards.theme` / `theme_version`, couche de données (texte de V5 figé à la revue ; pas de `npm run dev` avant)
- [x] (S) Lot T3 : application du thème aux cartes (`.card-theme`), flux d'édition, thème hérité par le tableau « (suite) »
- [x] (S) Lot T4 : bouton palette et panneau avec aperçu en direct
- [x] (S) Lot T5 : export et import (`formatVersion` 3) ; vérifications manuelles MT1 à MT5 à faire par Marius
- [x] (S) Lot TD1a (spec `todo-details.md`) : migration V6 `todos.description` / `rrule` / `important`, couche de données (texte de V6 figé à la revue ; pas de `npm run dev` avant)
- [x] (S) Lot TD1b : prochaine échéance d'une tâche répétée (`core/time/date-rule.ts`, vecteurs `dateNext`)
- [x] (S) Lot TD2a : fiche de tâche (titre, « Important », description, échéance, suppression), non branchée
- [x] (S) Lot TD2b : ligne de tâche sur une ligne (bouton [i], échéance sur la ligne, requêtes de conteneur) et branchement de la fiche (vérifications manuelles MD1 à MD4 et MD6 à faire par Marius)
- [x] (S) Lot TD3 : répétition des tâches (cocher avance l'échéance, « Annuler ») (vérification manuelle MD5 à faire par Marius)
- [x] (S) Lot TD4 : recherche dans les descriptions de tâches (vérification manuelle MD7 à faire par Marius)
- [x] (O) Revue de fin de phase (thème et détail des tâches compris) ; vérifications manuelles M1 à M17, MT1 à MT9 et MD1 à MD9 faites par Marius, OK (phase fusionnée dans `main` par la PR #12 le 2026-11-12 ; revue faite après la fusion le 2026-11-13 : OK avec suivis, aucun point bloquant ni important)
- [x] (S) Suivis mineurs de la revue : l'aperçu d'import d'un fichier v1 annonce la remise des icônes par défaut (`resetsIcons`, M17) ; contrat `TodoRepository.search` mis à jour (titre ou description, ordre, `excerpt`) ; faute dans un message d'erreur de `dashboard-theme-input.ts`
- [ ] (S) Tests Playwright des parcours critiques (navigation, ajout de widget, géométrie de la grille), tâche séparée après cette refonte (décision de Marius) ; y inclure `Ctrl+K` vers un autre tableau, le clic sur un résultat de recherche d'un autre tableau, la suppression du tableau courant, une tâche répétée cochée puis annulée

## Phase 2 : Temps
- [ ] (S) Audit des dépendances au vert (job CI rouge depuis le 2026-11-12) : `tokio` 1.54.1 (RUSTSEC-2026-0384, PR Dependabot #13) ; `libsqlite3-sys` 0.30.1 (RUSTSEC-2026-0459, imposé par `sqlx` 0.8 via `tauri-plugin-sql` 2.6 : évaluer l'exposition de Homebase, puis exception justifiée en attendant le plugin) ; `rsa` 0.9.10 (RUSTSEC-2023-0071, absent du build Windows : exception justifiée)
- [ ] (S) ADR-003 lot B : module Rust `time` (jiff + rrule), codec RRULE TS, moteur d'expansion, commandes Tauri `time_expand`/`time_validate`, `CalendarSource` ; vecteurs `dateNext` (spec todo-details) exécutés aussi côté Rust ; `parseDateRule` rebasé sur le codec
- [ ] (O) Spec timers/pomodoro et planificateur de rappels (Rust, rattrapage au démarrage)
- [ ] (S) Timers/alarmes, pomodoro, session « en cours depuis X » + historique
- [ ] (S) Rappels datés/récurrents (rrule) + notifications natives + zone de notification + démarrage automatique
- [ ] (S) Habit tracker (+ rappels de mise à jour périodique)
- [ ] (O) ADR-004 : choix du calendrier (Schedule-X vs FullCalendar) après essai
- [ ] (S) Calendrier agrégé via `CalendarSource`
**Sortie** : un rappel sonne à l'heure, fenêtre réduite, application lancée.

## Phase 3 : Données externes et applications locales
- [ ] (O→S) **Avant tout contenu externe** : O3 de l'ADR-002, remplacer `sql:allow-execute`/`sql:allow-select` par des commandes Rust typées (un XSS ne doit plus donner d'accès SQL complet ni d'écriture de fichier via `ATTACH`/`VACUUM INTO`) ; durcir les tests de capabilities (CSP comparée en chaîne exacte, liste exacte de `debug.json`) ; toute suppression de tableau passe alors par `dashboard_delete` (aujourd'hui `DashboardRepository.remove`, utilisé par `discardEmpty`, supprime sans sauvegarde `pre-delete`)
- [ ] (H, scout) Lister les flux RSS des sources de Marius
- [ ] (O) Spec du client HTTP sortant en Rust (liste d'hôtes, anti-SSRF, exception NAS)
- [ ] (S) Widget RSS
- [ ] (S) Statut de services (sondes HTTP/TCP, NAS compris)
- [ ] (O→S) Raccourcis vers applications locales (liste autorisée, capacités Tauri)
- [ ] (S) Widget objectifs (édition manuelle, durées, étiquettes)
**Sortie** : informations externes et lancement d'applications, sans surface d'attaque inutile.

## Phase 4 : Budget et comptes
- [ ] (O) ADR-005 : modèle financier (comptes, catégories, historique, chiffrement au repos ?)
- [ ] (S) Saisie manuelle, import CSV, graphiques
- [ ] (H, scout) Réévaluer les agrégateurs bancaires (Bridge, Enable Banking, Powens)

## Phase 5 : Page « Ressources » (blog perso)
- [ ] (O) ADR-006 : modèle (article Markdown, catégories hiérarchiques, tags, images), index de recherche (images : png, jpg, jpeg, webp, gif, avif avec signature binaire, écriture temporaire puis renommage — voir spec backup-restore §10.7)
- [ ] (S) CRUD articles : éditeur Markdown avec aperçu, rendu assaini
- [ ] (S) Catégories en arbre + tags, navigation et filtres
- [ ] (S) Images : ajout/collage, redimensionnement, fichiers dans le dossier de données
- [ ] (S) Indexation plein texte (MiniSearch) branchée dans la barre de recherche globale
- [ ] (O) Revue : XSS (Markdown, images, liens), poids de la sauvegarde

## Phase 6 : Finitions Windows
- [ ] (S) Installateur (NSIS/MSI) et mises à jour signées (`tauri-plugin-updater`)
- [ ] (S) GitHub stats (jeton dans le coffre du système), ressources système (basse priorité)
- [ ] (S) Accessibilité, raccourcis clavier, tests E2E des parcours critiques
- [ ] (O) Audit sécurité global (capacités Tauri, CSP, dépendances Rust et npm)
- [ ] (S) Sauvegardes automatiques (base + images, copie vers le NAS ; rétention configurable, emplacement secondaire, écran d'erreur natif complet), documentation d'utilisation (y rappeler que la réserve de sécurité de 5 archives, `pre-delete` comprises, évince les plus anciennes)

## Hors périmètre (volontairement)
Serveur, Spring Boot, PostgreSQL/Flyway, Docker, synchronisation multi-appareils, mobile : l'application n'est utilisée que sur le PC de Marius. À rouvrir uniquement si ce besoin change (ADR dédié).
