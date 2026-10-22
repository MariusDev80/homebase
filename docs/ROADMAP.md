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
- [x] (S) Design system selon `docs/DESIGN.md` : `core/theme/tokens.css` (clair/sombre), `@theme` Tailwind sémantique, preset PrimeNG dérivé d'Aura sur les tokens `--hb-*`, refonte de la barre supérieure (UnderlineNav), du dashboard et de l'hôte de widget (carte Box) ; captures clair/sombre de l'exe release. **À faire avant les widgets**
- [x] (S) Reliquats revue phase 0 : remplacer `core:default` par la liste minimale, retirer/limiter au debug les commandes de spike, menu « Ajouter un widget » accessible (Échap, clic extérieur, flèches), confirmation de suppression, F5 sur `/settings` en release (sinon `withHashLocation()`), flash de thème au démarrage, coalescence `updateConfig` vs ADR-001 §3.6 (aucune permission `core:*` ; spike et devtools dans `capabilities/debug.json` ; routage par chemin conservé, Tauri renvoie vers `index.html` ; `public/theme-init.js` ; vérification manuelle dans l'exe release à faire par Marius)
- [x] (S) Grille drag & drop redimensionnable, layout enregistré en base (angular-gridster2 21.0.1 derrière `core/dashboard/grid-adapter.ts`, 12 colonnes, mode « Modifier la disposition », déplacement clavier ; vérification manuelle dans `npm run dev` à faire par Marius)
- [x] (S) ADR-003 lot A : fondations temps (`data/time-formats.ts`, `core/time`, fuseau utilisateur, affichage, règle ESLint, vecteurs sans récurrence). **Avant le widget TODO** (revu ; vérification manuelle CA-A8 dans Réglages à faire par Marius)
- [x] (S) Widgets : TODO, notes, raccourcis (liens), recherche (`UrlOpener` + opener restreint ; recherche insensible à la casse ASCII seulement, pas aux accents)
- [x] (S) Widget météo Open-Meteo (+ géocodage) (`docs/specs/weather-widget.md` ; commandes Rust `weather_*` sur le module `net` ; vérifications manuelles CA-W1-M et CA-M* à faire par Marius)
- [ ] (S) Sauvegarde/restauration : archive de la base et des images, export JSON de la configuration
- [x] (O) ADR-003 : modèle de temps (UTC + IANA + RRULE) (`docs/adr/003-time-model.md`, statut proposé ; revu, décisions D1 à D3 validées par Marius)
**Sortie** : tableau de bord utilisable au quotidien. **Jalon MVP.**

## Phase 2 : Temps
- [ ] (S) ADR-003 lot B : module Rust `time` (jiff + rrule), codec RRULE TS, moteur d'expansion, commandes Tauri `time_expand`/`time_validate`, `CalendarSource`
- [ ] (O) Spec timers/pomodoro et planificateur de rappels (Rust, rattrapage au démarrage)
- [ ] (S) Timers/alarmes, pomodoro, session « en cours depuis X » + historique
- [ ] (S) Rappels datés/récurrents (rrule) + notifications natives + zone de notification + démarrage automatique
- [ ] (S) Habit tracker (+ rappels de mise à jour périodique)
- [ ] (O) ADR-004 : choix du calendrier (Schedule-X vs FullCalendar) après essai
- [ ] (S) Calendrier agrégé via `CalendarSource`
**Sortie** : un rappel sonne à l'heure, fenêtre réduite, application lancée.

## Phase 3 : Données externes et applications locales
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
- [ ] (S) Sauvegardes automatiques (base + images, copie vers le NAS ; rétention configurable, emplacement secondaire, écran d'erreur natif complet), documentation d'utilisation

## Hors périmètre (volontairement)
Serveur, Spring Boot, PostgreSQL/Flyway, Docker, synchronisation multi-appareils, mobile : l'application n'est utilisée que sur le PC de Marius. À rouvrir uniquement si ce besoin change (ADR dédié).
